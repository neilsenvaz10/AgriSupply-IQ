import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  COVERAGE,
  MARKETS,
  META,
  commodity,
  healthyHandlers,
  id,
  listBody,
  market,
  mockFetch,
  observation,
  stateObservation,
} from '../test/historicalFixtures';
import { must } from '../test/must';
import { renderApp } from '../test/renderApp';

/**
 * Regression tests for "Latest available day only" and for cursor pagination and filter resets.
 * The latest day offered must be one the API's summary data PROVES for the exact active filters
 * (a commodity on its own, or a market on its own); it must never be borrowed from the dataset-wide
 * maximum. SYNTHETIC fixtures, mocked fetch.
 */

const ALPHA = id(101);
const ALPHA_LAST = '2024-03-28'; // the commodity's own latest mandi day
const DATASET_LAST = '2025-06-11'; // a LATER dataset-wide maximum that must never be used instead

/** @param {ReturnType<typeof mockFetch>} fetchImpl @param {string} pathname */
const callsTo = (fetchImpl, pathname) =>
  fetchImpl.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === pathname);
const lastMandi = (fetchImpl) =>
  must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1)).searchParams;
const select = (name) => {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent === name);
  return /** @type {HTMLSelectElement} */ (
    document.getElementById(must(must(label).getAttribute('for')))
  );
};

/** Coverage whose dataset-wide mandi maximum is later than the commodity's own. */
const laterCoverage = {
  ...COVERAGE,
  granularities: {
    ...COVERAGE.granularities,
    mandi_daily: { ...COVERAGE.granularities.mandi_daily, last_date: DATASET_LAST },
  },
};
const withLaterDataset = (extra = {}) =>
  healthyHandlers({
    '/api/v1/coverage': () => ({
      body: { data: laterCoverage, meta: { ...META, granularity: 'coverage' } },
    }),
    ...extra,
  });

describe('"Latest available day only" uses a day the API proves for the active filters', () => {
  it("commodity on its own: the commodity's own latest day, not the later dataset maximum", async () => {
    const fetchImpl = mockFetch(withLaterDataset());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    const button = await screen.findByRole('button', {
      name: /latest available day only \(28 Mar 2024\)/i,
    });
    expect(screen.queryByRole('button', { name: /11 Jun 2025/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => {
      expect(lastMandi(fetchImpl).get('from')).toBe(ALPHA_LAST);
      expect(lastMandi(fetchImpl).get('to')).toBe(ALPHA_LAST);
    });
    expect(lastMandi(fetchImpl).get('commodity_id')).toBe(ALPHA);
    expect(lastMandi(fetchImpl).has('state_id')).toBe(false);
    // No request anywhere used the dataset maximum as its window end.
    expect(
      callsTo(fetchImpl, '/api/v1/mandi-prices').map((u) => u.searchParams.get('to')),
    ).not.toContain(DATASET_LAST);
  });

  it("a market on its own: that market's own latest day", async () => {
    const fetchImpl = mockFetch(withLaterDataset());
    renderApp('/markets', { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    const button = await screen.findByRole('button', {
      name: /latest available day only \(28 Mar 2024\)/i,
    });
    fireEvent.click(button);
    await waitFor(() => {
      expect(lastMandi(fetchImpl).get('market_id')).toBe(id(201));
      expect(lastMandi(fetchImpl).get('from')).toBe(ALPHA_LAST);
      expect(lastMandi(fetchImpl).get('to')).toBe(ALPHA_LAST);
    });
  });

  it("a market AND a commodity together: no shortcut (the market's last day may belong to another commodity)", async () => {
    const fetchImpl = mockFetch(withLaterDataset());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    expect(
      await screen.findByText(/latest day for this exact combination of filters is not available/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /latest available day only/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/latest available observation for this selection/i),
    ).not.toBeInTheDocument();
    // The "Last 90 days" reset is still there.
    expect(screen.getByRole('button', { name: 'Last 90 days' })).toBeVisible();
  });

  it('a state filter (with or without a commodity): no shortcut, and the dataset maximum is not presented as the latest', async () => {
    const fetchImpl = mockFetch(withLaterDataset());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    await screen.findByRole('button', { name: /latest available day only \(28 Mar 2024\)/i });
    fireEvent.change(select('State'), { target: { value: id(11) } });
    expect(
      await screen.findByText(/latest day for this exact combination of filters is not available/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /latest available day only/i }),
    ).not.toBeInTheDocument();
    // Commodity cleared, state kept: still no shortcut, and no "latest" claim for the dataset maximum.
    fireEvent.change(select('Commodity'), { target: { value: '' } });
    const note = await screen.findByText(
      /latest day for this exact combination of filters is not available/i,
    );
    expect(note).toHaveTextContent(/default window ends at 11 Jun 2025/);
    expect(
      screen.queryByRole('button', { name: /latest available day only/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/latest available observation for this selection/i),
    ).not.toBeInTheDocument();
  });

  it('changing the commodity drops a previously chosen single day instead of carrying it over', async () => {
    const two = [
      commodity(101, 'Testcrop Alpha', 'V', {
        mandi: { observations: 5, first_date: '2024-01-01', last_date: '2024-03-28' },
      }),
      commodity(104, 'Testcrop Delta', 'V', {
        mandi: { observations: 5, first_date: '2024-01-01', last_date: '2024-02-10' },
      }),
    ];
    const fetchImpl = mockFetch(
      withLaterDataset({ '/api/v1/commodities': () => ({ body: listBody(two, { limit: 500 }) }) }),
    );
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /latest available day only \(28 Mar 2024\)/i }),
    );
    await waitFor(() => expect(lastMandi(fetchImpl).get('from')).toBe('2024-03-28'));
    fireEvent.change(select('Commodity'), { target: { value: id(104) } });
    await screen.findByRole('button', { name: /latest available day only \(10 Feb 2024\)/i });
    await waitFor(() => {
      expect(lastMandi(fetchImpl).get('commodity_id')).toBe(id(104));
      expect(lastMandi(fetchImpl).get('to')).toBe('2024-02-10'); // the new commodity's own default window
      expect(lastMandi(fetchImpl).get('from')).toBe('2023-11-13');
    });
  });

  it("state-level view: a commodity on its own offers that commodity's state-level latest day; with a state chosen it offers none", async () => {
    const alpha = commodity(101, 'Testcrop Alpha', 'V', {
      mandi: { observations: 5, first_date: '2024-01-01', last_date: '2024-03-28' },
      state: { observations: 50, first_date: '2022-01-01', last_date: '2025-12-31' },
    });
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({ body: listBody([alpha], { limit: 500 }) }),
      }),
    );
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    fireEvent.click(screen.getByRole('tab', { name: 'State-level prices' }));
    const panel = screen.getByRole('tabpanel');
    const box = within(panel).getByRole('combobox', { name: 'Commodity' });
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('option', { name: /Testcrop Alpha/ }));
    const button = await within(panel).findByRole('button', {
      name: /latest available day only \(31 Dec 2025\)/i,
    });
    expect(within(panel).queryByRole('button', { name: /2 Jul 2026/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => {
      const last = must(callsTo(fetchImpl, '/api/v1/state-prices').at(-1)).searchParams;
      expect(last.get('from')).toBe('2025-12-31');
      expect(last.get('to')).toBe('2025-12-31');
    });
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    expect(
      await within(panel).findByText(/latest day for this state is not available/i),
    ).toBeVisible();
    expect(
      within(panel).queryByRole('button', { name: /latest available day only/i }),
    ).not.toBeInTheDocument();
  });
});

describe('single-day results use server-side cursor pagination and can all be retrieved', () => {
  /** Three server pages (2 + 2 + 1 rows) for the single day, keyed by the cursor sent. */
  function pagedDay() {
    const pages = {
      '': { rows: [301, 302], next: 'day-p2' },
      'day-p2': { rows: [303, 304], next: 'day-p3' },
      'day-p3': { rows: [305], next: null },
    };
    return {
      '/api/v1/mandi-prices': (url) => {
        const page = pages[url.searchParams.get('cursor') ?? ''];
        const rows = page.rows.map((n) =>
          observation(n, market(300 + n, `Reporter ${n}`), { observed_date: ALPHA_LAST }),
        );
        return {
          body: listBody(rows, { hasMore: page.next !== null, next: page.next, limit: 50 }),
        };
      },
    };
  }

  it('walks every page with the server cursor, keeps the same single-day window and filters, and shows each row once, in order', async () => {
    const fetchImpl = mockFetch(withLaterDataset(pagedDay()));
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    fireEvent.click(await screen.findByRole('button', { name: /latest available day only/i }));
    const names = () =>
      screen
        .getAllByRole('article')
        .filter((a) => a.textContent?.includes('Source: synthetic_source'))
        .map((a) => a.querySelector('h3')?.textContent);
    await waitFor(() => expect(names()).toEqual(['Reporter 301', 'Reporter 302']));
    expect(screen.getByText(/showing 2 observations so far; more are available/i)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    await waitFor(() => expect(names()).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    await waitFor(() => expect(names()).toHaveLength(5));

    expect(names()).toEqual([
      'Reporter 301',
      'Reporter 302',
      'Reporter 303',
      'Reporter 304',
      'Reporter 305',
    ]);
    expect(new Set(names()).size).toBe(5);
    expect(screen.getByText(/showing 5 observations: all that match/i)).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /load more observations/i }),
    ).not.toBeInTheDocument();

    const dayCalls = callsTo(fetchImpl, '/api/v1/mandi-prices').filter(
      (u) => u.searchParams.get('from') === ALPHA_LAST && u.searchParams.get('to') === ALPHA_LAST,
    );
    expect(dayCalls.map((u) => u.searchParams.get('cursor'))).toEqual([null, 'day-p2', 'day-p3']);
    for (const u of dayCalls) {
      expect(u.searchParams.get('commodity_id')).toBe(ALPHA);
      expect(u.searchParams.get('limit')).toBe('50');
    }
  });

  it('a failing later page keeps the rows already loaded and can be retried from the same cursor', async () => {
    let failOnce = true;
    const handlers = pagedDay();
    const fetchImpl = mockFetch(
      withLaterDataset({
        '/api/v1/mandi-prices': (url) => {
          if (url.searchParams.get('cursor') === 'day-p2' && failOnce) {
            failOnce = false;
            return { status: 503, body: { error: { code: 'DEPENDENCY_UNREACHABLE' } } };
          }
          return handlers['/api/v1/mandi-prices'](url);
        },
      }),
    );
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    fireEvent.click(await screen.findByRole('button', { name: /latest available day only/i }));
    fireEvent.click(await screen.findByRole('button', { name: /load more observations/i }));
    expect(await screen.findByText(/problem while reading the historical data/i)).toBeVisible();
    expect(screen.getByText('Reporter 301', { selector: 'h3' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    expect(await screen.findByText('Reporter 303', { selector: 'h3' })).toBeVisible();
    const cursors = callsTo(fetchImpl, '/api/v1/mandi-prices').map((u) =>
      u.searchParams.get('cursor'),
    );
    expect(cursors.filter((c) => c === 'day-p2')).toHaveLength(2);
  });
});

describe('changing a filter resets stale cursors and previous results', () => {
  /** Two filters' worth of pages: the cursor of one must never be sent for another. */
  const byCommodity = {
    '/api/v1/mandi-prices': (url) => {
      const commodityId = url.searchParams.get('commodity_id');
      const cursor = url.searchParams.get('cursor');
      const tag = commodityId === ALPHA ? 'A' : 'D';
      if (cursor) {
        return {
          body: listBody([observation(320, market(330, `${tag} page two`))], { limit: 50 }),
        };
      }
      return {
        body: listBody([observation(310, market(331, `${tag} page one`))], {
          hasMore: true,
          next: `${tag}-cursor`,
          limit: 50,
        }),
      };
    },
  };
  const two = [
    commodity(101, 'Testcrop Alpha', 'V', {
      mandi: { observations: 5, first_date: '2024-01-01', last_date: '2024-03-28' },
    }),
    commodity(104, 'Testcrop Delta', 'V', {
      mandi: { observations: 5, first_date: '2024-01-01', last_date: '2024-02-10' },
    }),
  ];
  const handlers = () =>
    withLaterDataset({
      ...byCommodity,
      '/api/v1/commodities': () => ({ body: listBody(two, { limit: 500 }) }),
    });

  it('commodity change: old rows disappear at once, the new request has no cursor, and the old cursor is never reused', async () => {
    const fetchImpl = mockFetch(handlers());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    expect(await screen.findByText('A page one', { selector: 'h3' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    expect(await screen.findByText('A page two', { selector: 'h3' })).toBeVisible();

    fireEvent.change(select('Commodity'), { target: { value: id(104) } });
    // Immediately: nothing of the previous commodity is shown for the new one.
    expect(screen.queryByText('A page one', { selector: 'h3' })).not.toBeInTheDocument();
    expect(screen.queryByText('A page two', { selector: 'h3' })).not.toBeInTheDocument();
    expect(await screen.findByText('D page one', { selector: 'h3' })).toBeVisible();
    const delta = callsTo(fetchImpl, '/api/v1/mandi-prices').filter(
      (u) => u.searchParams.get('commodity_id') === id(104),
    );
    expect(delta.map((u) => u.searchParams.get('cursor'))).toEqual([null]);
  });

  it('state filter change: previous results cleared and the cursor reset', async () => {
    const fetchImpl = mockFetch(handlers());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    await screen.findByText('A page one', { selector: 'h3' });
    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    await screen.findByText('A page two', { selector: 'h3' });
    fireEvent.change(select('State'), { target: { value: id(11) } });
    expect(screen.queryByText('A page two', { selector: 'h3' })).not.toBeInTheDocument();
    await waitFor(() => {
      const last = lastMandi(fetchImpl);
      expect(last.get('state_id')).toBe(id(11));
      expect(last.has('cursor')).toBe(false);
    });
    expect(await screen.findByText('A page one', { selector: 'h3' })).toBeVisible();
  });

  it('date change: previous results cleared and the cursor reset', async () => {
    const fetchImpl = mockFetch(handlers());
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    await screen.findByText('A page one', { selector: 'h3' });
    fireEvent.click(screen.getByRole('button', { name: /load more observations/i }));
    await screen.findByText('A page two', { selector: 'h3' });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-03-01' } });
    expect(screen.queryByText('A page two', { selector: 'h3' })).not.toBeInTheDocument();
    await waitFor(() => {
      const last = lastMandi(fetchImpl);
      expect(last.get('from')).toBe('2024-03-01');
      expect(last.has('cursor')).toBe(false);
    });
  });

  it('a late response for the old filter is ignored (no stale rows after the change)', async () => {
    /** @type {(value: any) => void} */
    let releaseOld = () => undefined;
    const old = new Promise((resolve) => {
      releaseOld = resolve;
    });
    let first = true;
    const fetchImpl = mockFetch(
      withLaterDataset({
        '/api/v1/commodities': () => ({ body: listBody(two, { limit: 500 }) }),
        '/api/v1/mandi-prices': (url) => {
          if (url.searchParams.get('commodity_id') === ALPHA && first) {
            first = false;
            return old; // held back
          }
          return byCommodity['/api/v1/mandi-prices'](url);
        },
      }),
    );
    renderApp(`/markets?commodity=${ALPHA}`, { fetchImpl });
    await waitFor(() => expect(callsTo(fetchImpl, '/api/v1/mandi-prices')).toHaveLength(1));
    fireEvent.change(select('Commodity'), { target: { value: id(104) } });
    expect(await screen.findByText('D page one', { selector: 'h3' })).toBeVisible();
    // The old request finally answers; it must not appear.
    releaseOld({ body: listBody([observation(399, market(399, 'STALE ROW'))], { limit: 50 }) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('STALE ROW', { selector: 'h3' })).not.toBeInTheDocument();
    expect(screen.getByText('D page one', { selector: 'h3' })).toBeVisible();
  });

  it('directory filters (state, district, district status) reset the market list and its cursor', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/markets': (url) =>
          url.searchParams.get('cursor') === 'm-2'
            ? { body: listBody([market(203, 'Page Two Mandi')], { limit: 50 }) }
            : url.searchParams.get('state_id')
              ? { body: listBody([market(204, 'Filtered Mandi')], { limit: 50 }) }
              : { body: listBody(MARKETS, { hasMore: true, next: 'm-2', limit: 50 }) },
      }),
    );
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    fireEvent.click(screen.getByRole('button', { name: /load more mandis/i }));
    await screen.findByText('Page Two Mandi', { selector: 'h3' });

    fireEvent.change(select('State'), { target: { value: id(11) } });
    expect(screen.queryByText('Page Two Mandi', { selector: 'h3' })).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic Mandi A', { selector: 'h3' })).not.toBeInTheDocument();
    expect(await screen.findByText('Filtered Mandi', { selector: 'h3' })).toBeVisible();
    const filtered = callsTo(fetchImpl, '/api/v1/markets').filter((u) =>
      u.searchParams.get('state_id'),
    );
    expect(filtered.every((u) => !u.searchParams.has('cursor'))).toBe(true);
  });

  it('state-level view: changing the commodity clears the previous list and its cursor', async () => {
    const stateCommodities = [
      commodity(101, 'Testcrop Alpha', 'V', {
        state: { observations: 9, first_date: '2022-01-01', last_date: '2026-07-02' },
      }),
      commodity(102, 'Testcrop Beta', 'V', {
        state: { observations: 9, first_date: '2022-01-01', last_date: '2026-07-02' },
      }),
    ];
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({ body: listBody(stateCommodities, { limit: 500 }) }),
        '/api/v1/state-prices': (url) => {
          const tag = url.searchParams.get('commodity_id') === id(102) ? 'Beta' : 'Alpha';
          const rows = [
            stateObservation(url.searchParams.get('cursor') ? 641 : 640, {
              commodity: {
                id: id(101),
                name: `${tag} ${url.searchParams.get('cursor') ? 'second' : 'first'} page`,
              },
            }),
          ];
          return {
            body: listBody(rows, {
              hasMore: !url.searchParams.get('cursor'),
              next: 'sp-x',
              limit: 50,
            }),
          };
        },
      }),
    );
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    fireEvent.click(screen.getByRole('tab', { name: 'State-level prices' }));
    const panel = screen.getByRole('tabpanel');
    fireEvent.change(within(panel).getByRole('combobox', { name: 'State' }), {
      target: { value: id(11) },
    });
    await within(panel).findByText('Alpha first page', { selector: 'h3' });
    fireEvent.click(within(panel).getByRole('button', { name: /load more observations/i }));
    await within(panel).findByText('Alpha second page', { selector: 'h3' });

    const box = within(panel).getByRole('combobox', { name: 'Commodity' });
    fireEvent.focus(box);
    fireEvent.click(screen.getByRole('option', { name: /Testcrop Beta/ }));
    expect(
      within(panel).queryByText('Alpha second page', { selector: 'h3' }),
    ).not.toBeInTheDocument();
    expect(
      within(panel).queryByText('Alpha first page', { selector: 'h3' }),
    ).not.toBeInTheDocument();
    expect(await within(panel).findByText('Beta first page', { selector: 'h3' })).toBeVisible();
    const beta = callsTo(fetchImpl, '/api/v1/state-prices').filter(
      (u) => u.searchParams.get('commodity_id') === id(102),
    );
    expect(beta.map((u) => u.searchParams.get('cursor'))).toEqual([null]);
  });
});
