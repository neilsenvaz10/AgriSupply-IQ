import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  MARKETS,
  healthyHandlers,
  id,
  latestMeta,
  latestObservation,
  listBody,
  mockFetch,
} from '../test/historicalFixtures';
import { renderApp } from '../test/renderApp';

/**
 * Milestone 2.3D: the "Latest by mandi" view. The API is a mocked fetch serving SYNTHETIC fixtures.
 */

/** @param {ReturnType<typeof mockFetch>} fetchImpl */
const latestCalls = (fetchImpl) =>
  fetchImpl.mock.calls
    .map(([u]) => new URL(String(u)))
    .filter((u) => u.pathname === '/api/v1/mandi-prices/latest');

async function openLatest(fetchImpl, choose = true) {
  renderApp('/markets', { fetchImpl });
  await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
  fireEvent.click(screen.getByRole('tab', { name: 'Latest by mandi' }));
  const panel = screen.getByRole('tabpanel');
  if (choose) {
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Commodity' }), {
      target: { value: id(101) },
    });
  }
  return panel;
}

describe('Latest by mandi view', () => {
  it('asks for a commodity first and requests nothing until one is chosen', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const idle = await openLatest(fetchImpl, false);
    expect(await within(idle).findByText(/Choose a commodity first/)).toBeVisible();
    expect(latestCalls(fetchImpl)).toHaveLength(0);
  });

  it('is a separate tab, labelled historical and never live', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openLatest(fetchImpl);
    const cards = await within(panel).findAllByText(/Historical observation/);
    expect(cards.length).toBe(2);
    expect(panel.textContent).toMatch(/Latest available · not live/);
    expect(panel.textContent).toMatch(/not a live feed and it is not a ranking/);
    const calls = latestCalls(fetchImpl);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.searchParams.get('commodity_id')).toBe(id(101));
    expect(calls[0]?.searchParams.get('limit')).toBe('50');
  });

  it('shows each mandi with its own date, neutral freshness wording and no fresh/current/live claim', async () => {
    const panel = await openLatest(mockFetch(healthyHandlers()));
    await within(panel).findAllByText(/Historical observation/);
    expect(panel.textContent).toMatch(/Last reported on 28 Mar 2024/);
    expect(panel.textContent).toMatch(/Last reported on 18 Mar 2024/);
    expect(panel.textContent).toMatch(/on the reference date \(28 Mar 2024\)/);
    expect(panel.textContent).toMatch(/10 days before the reference date \(28 Mar 2024\)/);
    expect(panel.textContent).toMatch(/modal price per quintal \(unit assumed\)/);
    expect(panel.textContent).toMatch(/synthetic_source/);
    expect(panel.textContent).not.toMatch(/\b(fresh|current|up[- ]to[- ]date|real[- ]time)\b/i);
    expect(panel.textContent?.replace(/not live|not a live|live feed/gi, '')).not.toMatch(
      /\blive\b/i,
    );
  });

  it('shows verification and geographic uncertainty on each card', async () => {
    const panel = await openLatest(mockFetch(healthyHandlers()));
    await within(panel).findAllByText(/Historical observation/);
    expect(panel.textContent).toMatch(/unverified/i);
    expect(panel.textContent).toMatch(/oddly spelled district/);
  });

  it('sends state and district filters, and clears the district when the state changes', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openLatest(fetchImpl);
    await within(panel).findAllByText(/Historical observation/);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    await within(panel).findAllByText(/Historical observation/);
    const last = latestCalls(fetchImpl).at(-1);
    expect(last?.searchParams.get('state_id')).toBe(id(11));
    expect(last?.searchParams.get('district_id')).toBeNull();
  });

  it('pages with the server cursor and appends without duplicating', async () => {
    const [a, b] = MARKETS;
    const fetchImpl = mockFetch({
      ...healthyHandlers(),
      '/api/v1/mandi-prices/latest': (url) => {
        const cursor = new URL(url).searchParams.get('cursor');
        return cursor
          ? {
              body: {
                ...listBody([latestObservation(702, b)], { limit: 50 }),
                meta: latestMeta(),
              },
            }
          : {
              body: {
                ...listBody([latestObservation(701, a)], {
                  limit: 50,
                  hasMore: true,
                  next: 'abc12345',
                }),
                meta: latestMeta(),
              },
            };
      },
    });
    const panel = await openLatest(fetchImpl);
    await within(panel).findAllByText(/Historical observation/);
    expect(panel.textContent).toMatch(/Showing 1 mandis so far; more are available/);
    fireEvent.click(within(panel).getByRole('button', { name: /Load more mandis/ }));
    await within(panel).findByText(/Showing 2 mandis: all that match/);
    expect(latestCalls(fetchImpl).at(-1)?.searchParams.get('cursor')).toBe('abc12345');
    expect(within(panel).getAllByText(/Historical observation/)).toHaveLength(2);
  });

  it('drops loaded rows and the cursor when a filter changes, so the old cursor is never sent with new filters', async () => {
    const [a, b] = MARKETS;
    const fetchImpl = mockFetch({
      ...healthyHandlers(),
      '/api/v1/mandi-prices/latest': (url) => {
        const q = new URL(url).searchParams;
        if (q.get('state_id'))
          return {
            body: { ...listBody([latestObservation(703, b)], { limit: 50 }), meta: latestMeta() },
          };
        return {
          body: {
            ...listBody([latestObservation(701, a)], {
              limit: 50,
              hasMore: true,
              next: 'abc12345',
            }),
            meta: latestMeta(),
          },
        };
      },
    });
    const panel = await openLatest(fetchImpl);
    await within(panel).findAllByText(/Historical observation/);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    await within(panel).findByText(/Showing 1 mandis: all that match/);
    expect(panel.textContent).toMatch(/Synthetic Mandi B/);
    expect(panel.textContent).not.toMatch(/Synthetic Mandi A/);
    const withState = latestCalls(fetchImpl).filter((u) => u.searchParams.get('state_id'));
    expect(withState.every((u) => u.searchParams.get('cursor') === null)).toBe(true);
  });

  it('says plainly when no mandi has an observation, without substituting state-level data', async () => {
    const fetchImpl = mockFetch({
      ...healthyHandlers(),
      '/api/v1/mandi-prices/latest': () => ({
        body: { ...listBody([], { limit: 50 }), meta: latestMeta(null) },
      }),
    });
    const panel = await openLatest(fetchImpl);
    expect(await within(panel).findByText(/No mandi has an observation/)).toBeVisible();
    expect(panel.textContent).toMatch(/State-level prices are not shown in their place/);
    expect(fetchImpl.mock.calls.some(([u]) => String(u).includes('/state-prices'))).toBe(false);
  });
});
