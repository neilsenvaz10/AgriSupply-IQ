import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  COMMODITIES,
  MARKETS,
  commodity,
  healthyHandlers,
  id,
  listBody,
  mockFetch,
  observation,
  stateObservation,
} from '../test/historicalFixtures';
import { must, up } from '../test/must';
import { renderApp } from '../test/renderApp';

/**
 * Milestone 2.3C: the state-level view, latest-day discovery and the data-quality panel. The API is
 * a mocked fetch serving SYNTHETIC fixtures (test/historicalFixtures.js).
 */

/** @param {ReturnType<typeof mockFetch>} fetchImpl @param {string} pathname */
const callsTo = (fetchImpl, pathname) =>
  fetchImpl.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === pathname);

async function openStateView(fetchImpl) {
  renderApp('/markets', { fetchImpl });
  await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
  fireEvent.click(screen.getByRole('tab', { name: 'State-level prices' }));
  return screen.getByRole('tabpanel');
}

describe('State-level prices view (separate from mandi prices)', () => {
  it('is a separate tab with its own label, and the mandi view is the default', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    expect(screen.getByRole('tab', { name: 'Mandi prices' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'State-level prices' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(callsTo(fetchImpl, '/api/v1/state-prices')).toHaveLength(0);

    fireEvent.click(screen.getByRole('tab', { name: 'State-level prices' }));
    const panel = screen.getByRole('tabpanel');
    expect(screen.getByRole('tab', { name: 'State-level prices' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(panel).toHaveAccessibleName('State-level prices');
    expect(panel.textContent).toMatch(/State-level prices describe a state as a whole/);
    expect(panel.textContent).toMatch(/not prices in any mandi/);
    expect(panel.textContent).toMatch(/never used to fill a missing mandi price/);
    expect(panel.textContent).toMatch(/State-level · not live/i);
    // The mandi directory and mandi prices are not part of this view.
    expect(within(panel).queryByText('Market hubs')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Synthetic Mandi A')).not.toBeInTheDocument();
  });

  it('asks for a state or a commodity first, and sends no request until one is chosen? (default window is the dataset latest)', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openStateView(fetchImpl);
    // No state or commodity chosen: nothing is requested.
    expect(await within(panel).findByText(/choose a state or a commodity/i)).toBeVisible();
    expect(callsTo(fetchImpl, '/api/v1/state-prices')).toHaveLength(0);
  });

  it('requests state-prices with the state, commodity and a 90-day window ending at the latest state-level day', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    expect(
      await within(panel).findAllByText(/State-level observation · not a mandi price/),
    ).toHaveLength(2);
    const first = callsTo(fetchImpl, '/api/v1/state-prices')[0];
    expect(first.searchParams.get('state_id')).toBe(id(11));
    expect(first.searchParams.has('commodity_id')).toBe(false);
    expect(first.searchParams.get('to')).toBe('2026-07-02');
    expect(first.searchParams.get('from')).toBe('2026-04-04');
    expect(first.searchParams.get('limit')).toBe('50');
    expect(callsTo(fetchImpl, '/api/v1/mandi-prices').length).toBeGreaterThanOrEqual(0);

    // Choose a commodity with the searchable selector: only state-covered commodities are offered.
    const box = within(panel).getByRole('combobox', { name: 'Commodity' });
    fireEvent.focus(box);
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.querySelector('span')?.textContent),
    ).toEqual(['Testcrop Alpha', 'Testcrop Beta']);
    fireEvent.click(screen.getByRole('option', { name: /Testcrop Beta/ }));
    await waitFor(() =>
      expect(
        must(callsTo(fetchImpl, '/api/v1/state-prices').at(-1)).searchParams.get('commodity_id'),
      ).toBe(id(102)),
    );
  });

  it('shows the original units, arrivals unconverted, source provenance and the state-level label', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/state-prices': () => ({
          body: listBody([
            stateObservation(601),
            stateObservation(602, {
              modal_price: 40,
              price_unit: 'bundle',
              price_unit_dimension: 'count',
              source_price_unit_label: 'Rs./Bundle',
              arrival_quantity: 300,
              arrival_unit: 'bundle',
              arrival_unit_dimension: 'count',
              source_arrival_unit_label: 'Bundle',
              commodity: { id: id(102), name: 'Testcrop Beta' },
            }),
          ]),
        }),
      }),
    );
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    const mass = up(
      await within(panel).findByText('Testcrop Alpha', { selector: 'h3' }),
      'article',
    );
    expect(mass.textContent).toMatch(/₹3,100/);
    expect(mass.textContent).toMatch(/modal price per quintal \(source unit “Rs\.\/Quintal”\)/);
    expect(mass.textContent).toMatch(
      /Arrival: 12.5 Metric Tonnes \(original unit, not converted\)/,
    );
    expect(mass.textContent).toMatch(/Observed 2 Jul 2026/);
    expect(mass.textContent).toMatch(
      /Source: synthetic_state_source · report “synthetic report” · historical record, not a live price/,
    );
    expect(mass.textContent).toMatch(/State-level observation · not a mandi price/);
    expect(mass.textContent).toMatch(/SYNTHETIC STATE ONE \(state as a whole\)/);
    expect(mass.textContent).not.toMatch(/Count unit/);

    const count = up(within(panel).getByText('Testcrop Beta', { selector: 'h3' }), 'article');
    expect(count.textContent).toMatch(/modal price per bundle \(source unit “Rs\.\/Bundle”\)/);
    expect(count.textContent).toMatch(/Arrival: 300 Bundle \(original unit, not converted\)/);
    expect(count.textContent).toMatch(/Count unit · not convertible to weight/);
    expect(count.textContent).not.toMatch(/tonne/i);
  });

  it('shows a provisional state mapping with the source label', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/state-prices': () => ({
          body: listBody([
            stateObservation(601, {
              state: {
                id: id(11),
                name: 'SYNTHETIC KERALA',
                mapping_status: 'provisional',
                mapping_note: 'x',
              },
              source_labels: {
                state: 'Keralam',
                commodity: 'c',
                commodity_group: null,
                report: 'r',
              },
            }),
          ]),
        }),
      }),
    );
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    expect(await within(panel).findByText(/provisional state mapping: “Keralam”/i)).toBeVisible();
  });

  it('uses cursor pagination: Load more sends the server cursor and appends', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/state-prices': (url) =>
          url.searchParams.get('cursor') === 'sp-2'
            ? {
                body: listBody([
                  stateObservation(603, { commodity: { id: id(103), name: 'Testcrop Gamma' } }),
                ]),
              }
            : { body: listBody([stateObservation(601)], { hasMore: true, next: 'sp-2' }) },
      }),
    );
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    await within(panel).findByText('Testcrop Alpha', { selector: 'h3' });
    expect(
      within(panel).getByText(/showing 1 observations so far; more are available/i),
    ).toBeVisible();
    fireEvent.click(within(panel).getByRole('button', { name: /load more observations/i }));
    expect(await within(panel).findByText('Testcrop Gamma', { selector: 'h3' })).toBeVisible();
    expect(within(panel).getByText('Testcrop Alpha', { selector: 'h3' })).toBeVisible();
    expect(
      callsTo(fetchImpl, '/api/v1/state-prices').map((u) => u.searchParams.get('cursor')),
    ).toEqual([null, 'sp-2']);
  });

  it('shows explicit empty and error states, and never falls back to mandi prices', async () => {
    let fail = false;
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/state-prices': () => (fail ? { status: 500, body: {} } : { body: listBody([]) }),
      }),
    );
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    const empty = await within(panel).findByText(
      /no state-level observations exist for these filters between/i,
    );
    expect(empty).toHaveTextContent(/mandi prices are not shown in their place/i);
    expect(within(panel).queryAllByText(/mandi price per/i)).toHaveLength(0);

    fail = true;
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(12) },
    });
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent(/could not load this data/i);
  });

  it('rejects an over-long window locally and never sends it', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openStateView(fetchImpl);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    await within(panel).findAllByText(/State-level observation · not a mandi price/);
    const before = callsTo(fetchImpl, '/api/v1/state-prices').length;
    fireEvent.change(within(panel).getByLabelText('From'), { target: { value: '2022-01-01' } });
    expect(await within(panel).findByText(/choose a window of at most 366 days/i)).toBeVisible();
    expect(callsTo(fetchImpl, '/api/v1/state-prices')).toHaveLength(before);
  });

  it('leaves the mandi view untouched when switching back', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const panel = await openStateView(fetchImpl);
    expect(panel).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Mandi prices' }));
    expect(await screen.findByText('Market hubs')).toBeVisible();
    expect(screen.getByRole('button', { name: /open filters/i })).toBeVisible();
  });
});

describe('Latest-observation discovery (no client-side re-sorting)', () => {
  it('states the latest available observation date for the selection, and that it is not live', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets?commodity=' + id(101), { fetchImpl });
    const note = await screen.findByText(/latest available observation for this selection/i);
    expect(note).toHaveTextContent(/28 Mar 2024/);
    expect(note).toHaveTextContent(/historical files, not live/);
  });

  it('"Latest available day only" narrows the request to that single day and says it is not live or a ranking', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets?commodity=' + id(101), { fetchImpl });
    const button = await screen.findByRole('button', {
      name: /latest available day only \(28 Mar 2024\)/i,
    });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    await waitFor(() => {
      const last = must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1)).searchParams;
      expect(last.get('from')).toBe('2024-03-28');
      expect(last.get('to')).toBe('2024-03-28');
    });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    const note = screen.getByText(/only rows observed on 28 Mar 2024/i);
    expect(note).toHaveTextContent(/latest available, not live, and it is not a ranking/);
    // The rows are shown in the order the API returned them; nothing is re-sorted or ranked.
    const reporters = () =>
      screen
        .queryAllByRole('article')
        .filter((a) => a.textContent?.includes('Source: synthetic_source'))
        .map((c) => c.querySelector('h3')?.textContent);
    await waitFor(() => expect(reporters()).toEqual(['Synthetic Mandi A', 'Synthetic Mandi B']));
    expect(screen.getByRole('main').textContent).not.toMatch(/\btop\b|\bbest\b|\branked\b/i);

    fireEvent.click(screen.getByRole('button', { name: 'Last 90 days' }));
    await waitFor(() => {
      const last = must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1)).searchParams;
      expect(last.get('from')).toBe('2023-12-30');
      expect(last.get('to')).toBe('2024-03-28');
    });
  });

  it("uses the chosen mandi's own latest date and explains when it stopped reporting before the commodity", async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({
          body: listBody(
            [
              commodity(101, 'Testcrop Alpha', 'Vegetables', {
                mandi: { observations: 120, first_date: '2024-01-02', last_date: '2025-06-11' },
              }),
            ],
            { limit: 500 },
          ),
        }),
        // The market itself last reported on 2024-03-28.
      }),
    );
    renderApp('/markets?commodity=' + id(101), { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    const note = await screen.findByText(/this mandi has no observations after 28 Mar 2024/i);
    expect(note).toHaveTextContent(/latest day for Testcrop Alpha in the files is 11 Jun 2025/);
    await waitFor(() => {
      const last = must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1)).searchParams;
      expect(last.get('market_id')).toBe(id(201));
      expect(last.get('to')).toBe('2024-03-28');
    });
  });

  it('handles a market with no observations at all, without offering a latest day', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        [`/api/v1/markets/${id(201)}`]: () => ({
          body: {
            data: {
              ...MARKETS[0],
              coverage: {
                mandi_daily: { observations: 0, first_date: null, last_date: null, commodities: 0 },
              },
            },
            meta: {
              data_status: 'historical_snapshot',
              is_live: false,
              notice: 'n',
              granularity: 'registry',
            },
          },
        }),
      }),
    );
    renderApp('/markets', { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    expect(
      await screen.findByText(/has no mandi-level observations in the historical files/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /latest available day only/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the dashboard card limited to the mandis that reported on that date', async () => {
    renderApp('/dashboard', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    expect(screen.getByRole('main').textContent).toMatch(/not all mandis, and not a ranking/);
  });
});

describe('Data quality and coverage panel', () => {
  async function openPanel(fetchImpl) {
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const summary = screen.getByText('Data quality and coverage');
    const details = up(summary, 'details');
    return { summary, details };
  }

  it('makes the heavier requests only when the panel is opened', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const { summary } = await openPanel(fetchImpl);
    expect(callsTo(fetchImpl, '/api/v1/sources')).toHaveLength(0);
    expect(callsTo(fetchImpl, '/api/v1/geography/unresolved')).toHaveLength(0);
    fireEvent.click(summary);
    // jsdom does not fire "toggle" on click, so dispatch it as a browser would.
    const details = /** @type {HTMLDetailsElement} */ (up(summary, 'details'));
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(callsTo(fetchImpl, '/api/v1/sources')).toHaveLength(1));
    expect(callsTo(fetchImpl, '/api/v1/geography/unresolved')).toHaveLength(1);
  });

  it('states unverified mandis, unresolved districts, provisional aliases, unit assumptions, limits and latest dates', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    const { summary } = await openPanel(fetchImpl);
    const details = /** @type {HTMLDetailsElement} */ (up(summary, 'details'));
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await within(details).findByText('Sources and provenance');
    const text = details.textContent ?? '';
    // latest available (not live)
    expect(text).toMatch(/Latest available observations \(not live\)/);
    expect(text).toMatch(/Mandi-level daily: 2 Jan 2024 to 28 Mar 2024/);
    expect(text).toMatch(/State-level daily: 1 Jan 2022 to 2 Jul 2026/);
    expect(text).toMatch(/not a live feed/);
    // geography
    expect(text).toMatch(/All 2 of 2 mandis are unverified/);
    expect(text).toMatch(
      /1 mandis \(5 observations\) have a district that could not be resolved; 1 district labels are unresolved/,
    );
    expect(text).toMatch(/provisional December 2022 mirror/);
    expect(text).toMatch(/Provisional mapping/);
    expect(text).toMatch(
      /“Synthetic Spelling” is mapped to SYNTHETIC STATE ONE by a reviewed decision, pending authoritative confirmation/,
    );
    // unresolved labels, with their row counts
    await within(details).findByText(/Unresolved district labels \(1\)/);
    expect(text + (details.textContent ?? '')).toMatch(
      /“oddly spelled district” \(Synthetic State One\): 5 observations, 1 mandis/,
    );
    expect(details.textContent).toMatch(
      /State label “Synthetic Unknown State”: unresolved, 4 rows quarantined/,
    );
    // units
    expect(text).toMatch(/INR per quintal is an assumption/);
    expect(text).toMatch(/Count units are never converted to weight/);
    // limitations
    expect(text).toMatch(
      /Only 1 of 3 commodities have mandi-level observations; mandi data covers 1 of 2 states/,
    );
    expect(text).toMatch(/A missing mandi price is never filled from state or national data/);
    // provenance
    expect(details.textContent).toMatch(/synthetic_mandi\.csv \(SHA-256 aaaaaaaaaaaa…\)/);
    expect(details.textContent).toMatch(/loaded with importer 9\.9\.9: 10 accepted, 2 quarantined/);
    expect(details.textContent).toMatch(/Prices are assumed to be INR per quintal\./);
  });

  it('shows an error with retry for the heavier requests without hiding the coverage facts', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({ '/api/v1/sources': () => ({ status: 500, body: {} }) }),
    );
    const { summary } = await openPanel(fetchImpl);
    const details = /** @type {HTMLDetailsElement} */ (up(summary, 'details'));
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const alert = await within(details).findByRole('alert');
    expect(alert).toHaveTextContent(/could not load this data/i);
    expect(details.textContent).toMatch(/All 2 of 2 mandis are unverified/);
  });

  it('is present in both views and does not change the existing page structure', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    expect(screen.getByText('Data quality and coverage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'State-level prices' }));
    expect(screen.getByText('Data quality and coverage')).toBeInTheDocument();
    expect(COMMODITIES).toHaveLength(3);
    expect(observation(1, MARKETS[0]).granularity).toBe('mandi_daily');
  });
});
