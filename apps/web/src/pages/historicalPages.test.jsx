import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../app/navigation';
import {
  COMMODITIES,
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
} from '../test/historicalFixtures';
import { must, up } from '../test/must';
import { renderApp } from '../test/renderApp';

/**
 * Screens that read the historical market API, driven by a mocked fetch serving SYNTHETIC fixtures
 * (see test/historicalFixtures.js). They prove request construction, loading / empty / error
 * states, pagination, filters, historical labelling, geographic uncertainty and unit display.
 */

/** @param {ReturnType<typeof mockFetch>} fetchImpl @param {string} pathname */
const callsTo = (fetchImpl, pathname) =>
  fetchImpl.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === pathname);

const MANDI_ALPHA = id(101);

/** The select whose label is `name`. */
function selectLabelled(name) {
  const label = [...document.querySelectorAll('label')].find((l) => l.textContent === name);
  return /** @type {HTMLSelectElement} */ (
    document.getElementById(must(must(label).getAttribute('for')))
  );
}
function choose(select, value) {
  fireEvent.change(select, { target: { value } });
}

describe('Dashboard (historical mandi prices)', () => {
  it('shows a loading state, then requests the latest observation day of the default commodity', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/dashboard', { fetchImpl });
    expect(await screen.findAllByRole('status', { name: 'Loading' })).not.toHaveLength(0);
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });

    const latest = callsTo(fetchImpl, '/api/v1/mandi-prices')[0];
    expect(latest.searchParams.get('commodity_id')).toBe(MANDI_ALPHA);
    // The commodity's own latest day (from the catalogue's coverage), both ends of the window.
    expect(latest.searchParams.get('from')).toBe('2024-03-28');
    expect(latest.searchParams.get('to')).toBe('2024-03-28');
    expect(latest.searchParams.get('limit')).toBe('100');
  });

  it('says the latest-day card lists only the mandis that reported on that date, not all mandis and not a ranking', async () => {
    renderApp('/dashboard', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const section = up(screen.getByRole('heading', { name: 'Historical mandi prices' }), 'section');
    expect(section.textContent).toMatch(
      /Only the mandis that reported Testcrop Alpha on 28 Mar 2024, its latest day: not all mandis, and not a ranking/,
    );
    expect(section.textContent).toMatch(/28 Mar 2024/);
    expect(section.textContent).not.toMatch(/\btop\b|\bbest\b|\branked\b(?! by net)/i);
    expect(section.textContent).toMatch(/Ranking mandis by net realization is not shown/);
  });

  it('only offers commodities that have mandi-level observations, and says which is shown', async () => {
    renderApp('/dashboard', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const select = selectLabelled('Commodity');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Select a commodity',
      'Testcrop Alpha',
    ]);
    expect(
      screen.getByText(/showing the commodity with the most mandi observations/i),
    ).toBeVisible();
  });

  it('shows actual names, modal price with its original unit, date, source and historical labels', async () => {
    renderApp('/dashboard', { fetchImpl: mockFetch(healthyHandlers()) });
    const card = up(await screen.findByText('Synthetic Mandi A', { selector: 'h3' }), 'article');
    expect(within(card).getByText('₹2,000')).toBeVisible();
    expect(card.textContent).toMatch(/modal price per quintal \(unit assumed\)/);
    expect(card.textContent).toMatch(/Observed 28 Mar 2024/);
    expect(card.textContent).toMatch(/Min ₹1,900 · Max ₹2,100/);
    expect(card.textContent).toMatch(/Source: synthetic_source/);
    expect(card.textContent).toMatch(/historical record, not a live price/);
    const main = screen.getByRole('main');
    expect(main.textContent).toMatch(/not a live feed/);
    expect(main.textContent).toMatch(/Historical data to 28 Mar 2024/);
    expect(main.textContent).toMatch(/Historical records from imported files/);
  });

  it('shows no change, trend, ranking or forecast figures, and keeps the recommendation unavailable', async () => {
    renderApp('/dashboard', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const text = screen.getByRole('main').textContent;
    expect(text).not.toMatch(/[+-]\s?\d+(\.\d+)?\s?%/);
    expect(text).not.toMatch(/\btrending\b|\bup \d|\bdown \d|\bforecast(ed)? price\b/i);
    expect(text).toMatch(/No recommendation yet/);
    expect(text).toMatch(/Not available/);
    expect(text).toMatch(/Mandi comparison requires verified market prices and cost inputs/);
    expect(text).toMatch(/Ranking mandis by net realization is not shown/);
  });

  it('lists only mandis that reported on that day and plots a chosen mandi from its own observations', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/mandi-prices': (url) =>
          url.searchParams.get('market_id')
            ? {
                body: listBody(
                  [
                    observation(401, MARKETS[0], {
                      observed_date: '2024-02-01',
                      modal_price: 1800,
                    }),
                    observation(402, MARKETS[0], {
                      observed_date: '2024-03-28',
                      modal_price: 2000,
                    }),
                  ],
                  { limit: 500 },
                ),
              }
            : { body: listBody([observation(301, MARKETS[0]), observation(302, MARKETS[1])]) },
      }),
    );
    renderApp('/dashboard', { fetchImpl });
    await screen.findByText('Synthetic Mandi B', { selector: 'h3' });
    const market = selectLabelled('Market or mandi');
    expect([...market.options].map((o) => o.textContent)).toEqual([
      'Select a market',
      'Synthetic Mandi A',
      'Synthetic Mandi B',
    ]);
    choose(market, id(201));
    const chart = await screen.findByRole('img', {
      name: /historical modal prices, 2 observations/i,
    });
    expect(chart).toHaveAccessibleName(/between ₹1,800 and ₹2,000/);
    const series = must(
      callsTo(fetchImpl, '/api/v1/mandi-prices').find((u) => u.searchParams.get('market_id')),
    );
    expect(series.searchParams.get('market_id')).toBe(id(201));
    expect(series.searchParams.get('commodity_id')).toBe(MANDI_ALPHA);
    expect(series.searchParams.get('to')).toBe('2024-03-28');
    expect(series.searchParams.get('from')).toBe('2023-12-30'); // 90 days ending 2024-03-28
    expect(screen.getByText(/no trend, change or forecast is shown/i)).toBeVisible();
  });

  it('shows an error state with a working retry when the prices cannot be loaded', async () => {
    let fail = true;
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/mandi-prices': () =>
          fail
            ? { status: 500, body: { error: { code: 'INTERNAL_ERROR' } } }
            : { body: listBody([observation(301, MARKETS[0])]) },
      }),
    );
    renderApp('/dashboard', { fetchImpl });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load this data/i);
    expect(alert).toHaveTextContent(/problem while reading the historical data/i);
    expect(screen.queryByText('Synthetic Mandi A', { selector: 'h3' })).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Synthetic Mandi A', { selector: 'h3' })).toBeVisible();
  });

  it('shows an explicit empty state when the commodity has no observation on its latest day', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({ '/api/v1/mandi-prices': () => ({ body: listBody([]) }) }),
    );
    renderApp('/dashboard', { fetchImpl });
    expect(
      await screen.findByText(/no mandi observations exist for this commodity on its latest day/i),
    ).toBeVisible();
  });

  it('keeps the widgets and says so when no commodity has mandi-level data (no placeholders invented)', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({
          body: listBody([COMMODITIES[1], COMMODITIES[2]], { limit: 500 }),
        }),
      }),
    );
    renderApp('/dashboard', { fetchImpl });
    expect(
      await screen.findByText(/no commodity with mandi-level observations is available/i),
    ).toBeVisible();
    expect(screen.getByRole('img', { name: /select a mandi to plot/i })).toBeInTheDocument();
    expect(callsTo(fetchImpl, '/api/v1/mandi-prices')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Price trajectory' })).toBeVisible();
  });

  it('flags a provisional state mapping and shows differing source labels', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/mandi-prices': () => ({
          body: listBody([
            observation(301, MARKETS[0], {
              state: {
                id: id(11),
                name: 'SYNTHETIC KERALA',
                mapping_status: 'provisional',
                mapping_note: 'x',
              },
              source_labels: { state: 'Keralam', district: 'd', market: 'm', commodity: 'c' },
            }),
            observation(302, MARKETS[1], {
              source_labels: {
                state: 'Old Name',
                district: 'oddly spelled district',
                market: 'm',
                commodity: 'c',
              },
            }),
          ]),
        }),
      }),
    );
    renderApp('/dashboard', { fetchImpl });
    await screen.findByText(/provisional state mapping/i);
    expect(screen.getByText(/provisional state mapping: “Keralam”/i)).toBeVisible();
    expect(screen.getByText(/source label: “Old Name”/i)).toBeVisible();
  });

  it('shows the original unit and omits the "assumed" note when the source states the unit', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/mandi-prices': () => ({
          body: listBody([
            observation(301, MARKETS[0], {
              price_unit: 'bundle',
              unit_basis: 'source_stated',
              source_price_unit_label: 'Rs./Bundle',
            }),
          ]),
        }),
      }),
    );
    renderApp('/dashboard', { fetchImpl });
    const card = up(await screen.findByText('Synthetic Mandi A', { selector: 'h3' }), 'article');
    expect(card.textContent).toMatch(/modal price per bundle/);
    expect(card.textContent).not.toMatch(/unit assumed/);
  });
});

describe('Market Explorer (historical mandi prices)', () => {
  it('lists the real directory with unverified status and unresolved districts exactly as labelled', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets', { fetchImpl });
    expect(await screen.findAllByRole('status', { name: 'Loading' })).not.toHaveLength(0);
    const a = up(await screen.findByText('Synthetic Mandi A', { selector: 'h3' }), 'article');
    const b = up(screen.getByText('Synthetic Mandi B', { selector: 'h3' }), 'article');
    expect(within(a).getByText('Unverified market')).toBeVisible();
    expect(a.textContent).toMatch(/District: SYNTHETIC DISTRICT/);
    expect(within(b).getByText('Unverified market')).toBeVisible();
    expect(within(b).getByText('District unresolved')).toBeVisible();
    expect(b.textContent).toMatch(/District not resolved · source label “oddly spelled district”/);
    expect(screen.getByRole('main').textContent).toMatch(/Mandis \(all unverified\)/);
    const first = callsTo(fetchImpl, '/api/v1/markets')[0];
    expect(first.searchParams.get('limit')).toBe('50');
  });

  it('uses server-side pagination: Load more sends the cursor and appends the next page', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/markets': (url) =>
          url.searchParams.get('cursor') === 'cursor-2'
            ? { body: listBody([market(203, 'Synthetic Mandi C')], { limit: 50 }) }
            : { body: listBody(MARKETS, { limit: 50, hasMore: true, next: 'cursor-2' }) },
      }),
    );
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    expect(screen.getByText(/showing 2 mandis so far; more are available/i)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /load more mandis/i }));
    expect(await screen.findByText('Synthetic Mandi C', { selector: 'h3' })).toBeVisible();
    expect(screen.getByText('Synthetic Mandi A', { selector: 'h3' })).toBeVisible();
    expect(screen.getByText(/showing 3 mandis: all that match/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /load more mandis/i })).not.toBeInTheDocument();
    const calls = callsTo(fetchImpl, '/api/v1/markets');
    expect(calls.map((u) => u.searchParams.get('cursor'))).toEqual([null, 'cursor-2']);
  });

  it('filters by state, then district (which depends on the state), district status and search text', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets', { fetchImpl });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    fireEvent.click(screen.getByRole('button', { name: /open filters/i }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    const inDialog = (name) => {
      const label = [...dialog.querySelectorAll('label')].find((l) => l.textContent === name);
      return /** @type {HTMLSelectElement} */ (
        dialog.querySelector(`#${CSS.escape(must(must(label).getAttribute('for')))}`)
      );
    };

    // The district filter is unavailable until a state is chosen.
    expect(inDialog('District')).toBeDisabled();
    expect(callsTo(fetchImpl, '/api/v1/districts')).toHaveLength(0);
    choose(inDialog('State'), id(11));
    await waitFor(() => expect(inDialog('District')).toBeEnabled());
    expect(callsTo(fetchImpl, '/api/v1/districts')[0].searchParams.get('state_id')).toBe(id(11));
    await waitFor(() =>
      expect(must(callsTo(fetchImpl, '/api/v1/markets').at(-1)).searchParams.get('state_id')).toBe(
        id(11),
      ),
    );

    choose(inDialog('District'), id(31));
    await waitFor(() =>
      expect(
        must(callsTo(fetchImpl, '/api/v1/markets').at(-1)).searchParams.get('district_id'),
      ).toBe(id(31)),
    );
    choose(inDialog('District status'), 'unresolved');
    await waitFor(() =>
      expect(
        must(callsTo(fetchImpl, '/api/v1/markets').at(-1)).searchParams.get('district_status'),
      ).toBe('unresolved'),
    );

    // Changing the state clears the district.
    choose(inDialog('State'), id(12));
    expect(inDialog('District').value).toBe('');
    await waitFor(() => {
      const last = must(callsTo(fetchImpl, '/api/v1/markets').at(-1)).searchParams;
      expect(last.get('state_id')).toBe(id(12));
      expect(last.has('district_id')).toBe(false);
    });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close/i })[0]);

    fireEvent.change(screen.getByRole('searchbox', { name: /search mandis by name/i }), {
      target: { value: ' rampur ' },
    });
    await waitFor(() =>
      expect(must(callsTo(fetchImpl, '/api/v1/markets').at(-1)).searchParams.get('q')).toBe(
        'rampur',
      ),
    );
  });

  it("shows the mandi prices of a chosen market, within the market's own latest 90 days", async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/markets', { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    expect(await screen.findAllByText('28 Mar 2024')).not.toHaveLength(0);
    expect(callsTo(fetchImpl, `/api/v1/markets/${id(201)}`)).toHaveLength(1);
    const prices = must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1));
    expect(prices.searchParams.get('market_id')).toBe(id(201));
    expect(prices.searchParams.get('to')).toBe('2024-03-28');
    expect(prices.searchParams.get('from')).toBe('2023-12-30');
    expect(screen.getByRole('button', { name: /selected for synthetic mandi a/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says clearly when no mandi observations exist for the filters, and never substitutes state prices', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({ '/api/v1/mandi-prices': () => ({ body: listBody([]) }) }),
    );
    renderApp('/markets', { fetchImpl });
    fireEvent.click(
      await screen.findByRole('button', { name: /view prices for synthetic mandi a/i }),
    );
    const empty = await screen.findByText(/no mandi observations exist for these filters between/i);
    expect(empty).toHaveTextContent(/state-level prices are not shown in their place/i);
    expect(callsTo(fetchImpl, '/api/v1/state-prices')).toHaveLength(0);
  });

  it('says so, and requests no prices, for a market that has no mandi observations at all', async () => {
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
            meta: META,
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
    expect(callsTo(fetchImpl, '/api/v1/mandi-prices')).toHaveLength(0);
  });

  it('shows an error state when the directory cannot be loaded, and recovers on retry', async () => {
    let fail = true;
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/markets': () =>
          fail
            ? { status: 503, body: { error: { code: 'DEPENDENCY_UNREACHABLE' } } }
            : { body: listBody(MARKETS) },
      }),
    );
    renderApp('/markets', { fetchImpl });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load this data/i);
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Synthetic Mandi A', { selector: 'h3' })).toBeVisible();
  });

  it('shows an explicit empty directory state for filters that match nothing', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({ '/api/v1/markets': () => ({ body: listBody([]) }) }),
    );
    renderApp('/markets', { fetchImpl });
    expect(await screen.findByText(/no mandi matches these filters/i)).toBeVisible();
  });

  it('offers only the commodities with mandi data and says the rest are state-level only', async () => {
    renderApp('/markets', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const select = selectLabelled('Commodity');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'All commodities',
      'Testcrop Alpha',
    ]);
    expect(
      screen.getByText(/only 1 of 3 commodities have mandi-level observations; the others/i),
    ).toBeVisible();
  });

  it('preselects the commodity from the Commodities page link and requests its prices', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp(`/markets?commodity=${MANDI_ALPHA}`, { fetchImpl });
    await screen.findAllByText('28 Mar 2024');
    expect(selectLabelled('Commodity').value).toBe(MANDI_ALPHA);
    const prices = must(callsTo(fetchImpl, '/api/v1/mandi-prices').at(-1));
    expect(prices.searchParams.get('commodity_id')).toBe(MANDI_ALPHA);
  });

  it('rejects an over-long date window locally and sends no request for it', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp(`/markets?commodity=${MANDI_ALPHA}`, { fetchImpl });
    await screen.findAllByText('28 Mar 2024');
    const before = callsTo(fetchImpl, '/api/v1/mandi-prices').length;
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2022-01-01' } });
    expect(await screen.findByText(/choose a window of at most 366 days/i)).toBeVisible();
    expect(callsTo(fetchImpl, '/api/v1/mandi-prices')).toHaveLength(before);
  });

  it('labels the mandi price list as historical, mandi-level and unit-assumed', async () => {
    renderApp('/markets', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Synthetic Mandi A', { selector: 'h3' });
    const text = screen.getByRole('main').textContent;
    expect(text).toMatch(/Historical data · not live/i);
    expect(text).toMatch(/Mandi-level · not live/i);
    expect(text).toMatch(/INR per quintal; the file states no unit, so the unit is an assumption/);
    expect(text).toMatch(/State-level prices are never used to fill missing mandi prices/);
  });
});

describe('Commodities (real catalogue, coverage tiers)', () => {
  it('distinguishes mandi-level, state-level-only and no-observation commodities and never implies all have mandi data', async () => {
    renderApp('/commodities', { fetchImpl: mockFetch(healthyHandlers()) });
    expect(await screen.findAllByRole('status', { name: 'Loading' })).not.toHaveLength(0);
    const alpha = up(await screen.findByText('Testcrop Alpha', { selector: 'h3' }), 'article');
    const beta = up(screen.getByText('Testcrop Beta', { selector: 'h3' }), 'article');
    const gamma = up(screen.getByText('Testcrop Gamma', { selector: 'h3' }), 'article');
    expect(within(alpha).getByText('Mandi-level observations')).toBeVisible();
    expect(within(beta).getByText('State-level observations only')).toBeVisible();
    expect(within(gamma).getByText('No price observations')).toBeVisible();
    const summary = screen.getByText(/commodities have mandi-level observations/i);
    expect(summary).toHaveTextContent(
      /1 of 3 commodities have mandi-level observations; 1 have state-level observations only; 1 have no price observations/,
    );
    expect(summary).toHaveTextContent(/state-level data is never shown as mandi-level/i);
  });

  it('shows observation counts and date ranges per granularity, separately', async () => {
    renderApp('/commodities', { fetchImpl: mockFetch(healthyHandlers()) });
    const alpha = up(await screen.findByText('Testcrop Alpha', { selector: 'h3' }), 'article');
    expect(alpha.textContent).toMatch(
      /Mandi-level daily: 120 observations, 2 Jan 2024 to 28 Mar 2024/,
    );
    expect(alpha.textContent).toMatch(
      /State-level daily: 900 observations, 1 Jan 2022 to 2 Jul 2026/,
    );
    expect(alpha.textContent).toMatch(/National monthly: none/);
    const gamma = up(screen.getByText('Testcrop Gamma', { selector: 'h3' }), 'article');
    expect(gamma.textContent).toMatch(/Mandi-level daily: none/);
  });

  it('filters by category, by coverage tier and by search text, all from the loaded catalogue', async () => {
    renderApp('/commodities', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Testcrop Alpha', { selector: 'h3' });
    const names = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names()).toEqual(['Testcrop Alpha', 'Testcrop Beta', 'Testcrop Gamma']);

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Category' })).getByRole('button', {
        name: 'Pulses',
      }),
    );
    expect(names()).toEqual(['Testcrop Beta', 'Testcrop Gamma']);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Observed coverage' })).getByRole('button', {
        name: 'State-level only',
      }),
    );
    expect(names()).toEqual(['Testcrop Beta']);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Category' })).getByRole('button', {
        name: 'All crops',
      }),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Observed coverage' })).getByRole('button', {
        name: 'Any coverage',
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: /search commodities/i }), {
      target: { value: 'gamma' },
    });
    expect(names()).toEqual(['Testcrop Gamma']);
    expect(screen.getByText(/1 of 3 commodities match/i)).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: /search commodities/i }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText(/no commodity matches these filters/i)).toBeVisible();
  });

  it('keeps similar commodity names separate (nothing is merged silently)', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({
          body: listBody(
            [
              commodity(111, 'Barley (Jau)', 'Cereals', {
                national: { observations: 3, first_date: '2020-01-01', last_date: '2020-03-01' },
              }),
              commodity(112, 'Barley(Jau)', 'Cereals', {
                state: { observations: 5, first_date: '2024-01-01', last_date: '2024-01-05' },
              }),
            ],
            { limit: 500 },
          ),
        }),
      }),
    );
    renderApp('/commodities', { fetchImpl });
    expect(await screen.findByText('Barley (Jau)', { selector: 'h3' })).toBeVisible();
    expect(screen.getByText('Barley(Jau)', { selector: 'h3' })).toBeVisible();
  });

  it('spotlights a commodity through the searchable selector, and links to its mandis only when it has mandi-level data', async () => {
    renderApp('/commodities', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Testcrop Alpha', { selector: 'h3' });
    const spotlight = up(screen.getByRole('heading', { name: 'Spotlight' }), 'section');
    const box = within(spotlight).getByRole('combobox', { name: 'Commodity' });

    // Nothing selected: disabled, with a reason.
    expect(
      screen.getByRole('button', { name: /explore mandis for selected commodity/i }),
    ).toBeDisabled();

    // Search by name; the option carries its coverage information.
    fireEvent.change(box, { target: { value: 'beta' } });
    const beta = within(spotlight).getByRole('option', { name: /Testcrop Beta/ });
    expect(beta).toHaveTextContent(/State-level observations only: 900 state-level observations/);
    fireEvent.click(beta);
    expect(box).toHaveValue('Testcrop Beta');
    expect(
      screen.getByText(/has no mandi-level observations, so there are no mandis to explore/i),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /explore mandis for selected commodity/i }),
    ).not.toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'alpha' } });
    const alpha = within(spotlight).getByRole('option', { name: /Testcrop Alpha/ });
    expect(alpha).toHaveTextContent(/Mandi-level observations: 120 mandi observations/);
    fireEvent.click(alpha);
    expect(
      screen.getByRole('link', { name: /explore mandis for selected commodity/i }),
    ).toHaveAttribute('href', `/markets?commodity=${MANDI_ALPHA}`);
    expect(spotlight.textContent).toMatch(/not a statement about forecasting eligibility/i);

    // Clearing the selection returns to the empty spotlight.
    fireEvent.click(within(spotlight).getByRole('button', { name: /clear commodity/i }));
    expect(box).toHaveValue('');
    expect(
      screen.getByRole('button', { name: /explore mandis for selected commodity/i }),
    ).toBeDisabled();
  });

  it('shows more of a long catalogue in steps', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      commodity(500 + i, `Testcrop ${String(i).padStart(2, '0')}`, 'Others', {}),
    );
    const fetchImpl = mockFetch(
      healthyHandlers({ '/api/v1/commodities': () => ({ body: listBody(many, { limit: 500 }) }) }),
    );
    renderApp('/commodities', { fetchImpl });
    await screen.findByText('Testcrop 00', { selector: 'h3' });
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(25);
    expect(screen.getByText('Showing 25 of 30')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /show more commodities/i }));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(30);
  });

  it('shows an error state when the catalogue cannot be loaded, and requests it once with limit 500', async () => {
    let fail = true;
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () =>
          fail ? { status: 500, body: {} } : { body: listBody(COMMODITIES, { limit: 500 }) },
      }),
    );
    renderApp('/commodities', { fetchImpl });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load this data/i);
    fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Testcrop Alpha', { selector: 'h3' })).toBeVisible();
    expect(callsTo(fetchImpl, '/api/v1/commodities')[0].searchParams.get('limit')).toBe('500');
  });

  it('labels the page as historical data and does not claim forecasting eligibility', async () => {
    renderApp('/commodities', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByText('Testcrop Alpha', { selector: 'h3' });
    const text = screen.getByRole('main').textContent;
    expect(text).toMatch(/Historical data · not live/i);
    expect(text).toMatch(/No tier has been assigned yet/);
    expect(text).toMatch(/nothing about forecasting eligibility/);
  });
});

describe('historical data integrity across the integrated pages', () => {
  it('only ever sends GET requests to /api/v1 historical endpoints and never to state-level prices', async () => {
    for (const path of ['/dashboard', '/markets', '/commodities']) {
      const fetchImpl = mockFetch(healthyHandlers());
      const { unmount } = renderApp(path, { fetchImpl });
      await screen.findByRole('main');
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      for (const [url, init] of fetchImpl.mock.calls) {
        const u = new URL(String(url));
        expect(init.method).toBe('GET');
        expect(u.origin).toBe('http://api.test');
        expect(u.pathname).toMatch(
          /^\/api\/v1\/(coverage|commodities|states|districts|markets|mandi-prices)(\/|$)/,
        );
        expect(u.pathname).not.toMatch(/state-prices|forecast|prices\/live/);
      }
      unmount();
    }
  });

  it('refuses to display a response that claims to be live', async () => {
    const fetchImpl = mockFetch(
      healthyHandlers({
        '/api/v1/commodities': () => ({
          body: { ...listBody(COMMODITIES, { limit: 500 }), meta: { ...META, is_live: true } },
        }),
      }),
    );
    renderApp('/commodities', { fetchImpl });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/unexpected format, so it was not displayed/i);
    expect(screen.queryByText('Testcrop Alpha')).not.toBeInTheDocument();
  });

  it('invents no values when the API is unreachable: every integrated page shows an error, not data', async () => {
    for (const path of ['/dashboard', '/markets', '/commodities']) {
      const { unmount } = renderApp(path); // default fetch rejects (network failure)
      const alerts = await screen.findAllByRole('alert');
      expect(alerts.length).toBeGreaterThan(0);
      const text = screen.getByRole('main').textContent;
      expect(text).not.toMatch(/₹\s?\d/);
      unmount();
    }
  });

  it('keeps the data-free pages free of API calls and fabricated figures', async () => {
    const fetchImpl = mockFetch(healthyHandlers());
    renderApp('/forecast', { fetchImpl });
    await screen.findByRole('main');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole('main').textContent).not.toMatch(/₹\s?\d/);
  });
});

describe('responsive navigation regression on the integrated pages', () => {
  it.each(['/dashboard', '/markets', '/commodities'])(
    '%s keeps the sidebar, the five-tab mobile bar and the menu button',
    async (path) => {
      renderApp(path, { fetchImpl: mockFetch(healthyHandlers()) });
      await screen.findByRole('main');
      const rail = screen.getByRole('navigation', { name: 'Main' });
      expect(within(rail).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
      const mobile = screen.getByRole('navigation', { name: 'Main (mobile)' });
      expect(
        within(mobile)
          .getAllByRole('link')
          .map((l) => l.getAttribute('href')),
      ).toEqual(['/dashboard', '/markets', '/allocate', '/assistant', '/profile']);
      expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    },
  );

  it('keeps the page content in the same responsive grid classes as the Stitch layout', async () => {
    renderApp('/markets', { fetchImpl: mockFetch(healthyHandlers()) });
    await screen.findByRole('main');
    const grid = must(document.querySelector('.lg\\:grid-cols-12'));
    expect(grid.querySelector('.lg\\:col-span-5')).not.toBeNull();
    expect(grid.querySelector('.lg\\:col-span-7')).not.toBeNull();
  });
});
