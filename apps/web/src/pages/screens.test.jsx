import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS, ROUTE_ALIASES } from '../app/navigation';
import { renderApp } from '../test/renderApp';

/** Headline and the truthful missing-data message each screen must show. */
const SCREENS = [
  [
    '/dashboard',
    'Welcome to FASALYTICS',
    'Market data will appear here once the ingestion pipeline is connected.',
  ],
  ['/markets', 'Nationwide Explorer', 'Market directory data is not available yet.'],
  ['/commodities', 'Explore Commodities', 'Commodity catalogue data is not available yet.'],
  [
    '/forecast',
    'AI Price Forecasting',
    'Forecasts are not available until the forecasting service is trained and validated.',
  ],
  [
    '/compare',
    'Mandi Comparison',
    'Mandi comparison requires verified market prices and cost inputs.',
  ],
  [
    '/allocate',
    'Optimal Harvest Distribution',
    'Allocation recommendations require verified market and forecast data.',
  ],
  [
    '/simulate',
    'What-If Decision Simulator',
    'Risk simulation is not yet connected to the intelligence engine.',
  ],
  ['/assistant', 'AI Copilot', 'AI Copilot is not yet configured.'],
];

/** Anything that would look like market data or a recommendation. */
const FABRICATED = [
  /₹\s?\d/, // a rupee amount
  /\d\s*(?:qtl|quintals?)\b/i, // a quantity of produce
  /\d+\s*%\s*(?:high\s+)?confidence/i,
  /\blive feed\b/i,
  /\bverified (?:apmc|lot)\b/i,
  /nashik|junnar|pune|solapur|indore|azadpur|kolar|khanna|ludhiana|maharashtra|punjab|karnataka/i,
  /tomato|onion|wheat|paddy|soybean|cotton|potato|basmati|chana/i,
  /rameshwar/i,
];

async function mainText(path) {
  renderApp(path);
  const main = await screen.findByRole('main');
  return { main, text: main.textContent ?? '' };
}

describe('routes', () => {
  it('opens the Dashboard as the landing page, not System Status', async () => {
    const { router } = renderApp('/');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Welcome to FASALYTICS/ }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(document.title).toBe('Dashboard | FASALYTICS');
  });

  it.each(SCREENS)(
    '%s renders a page with a single h1 and a main landmark',
    async (path, heading) => {
      renderApp(path);
      const h1 = await screen.findByRole('heading', { level: 1 });
      expect(h1).toHaveTextContent(heading);
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('main')).toBeInTheDocument();
    },
  );

  it('renders the Profile and System Status pages', async () => {
    renderApp('/profile');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Profile and preferences' }),
    ).toBeVisible();
    document.body.innerHTML = '';
    renderApp('/status');
    expect(await screen.findByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
  });

  it('has a route for every navigation entry', async () => {
    for (const item of NAV_ITEMS) {
      const { unmount } = renderApp(item.path);
      expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent(
        'Page not found',
      );
      unmount();
    }
  });

  it.each(Object.entries(ROUTE_ALIASES))('redirects %s to %s', async (from, to) => {
    const { router } = renderApp(from);
    await screen.findByRole('main');
    expect(router.state.location.pathname).toBe(to);
  });

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/definitely/not/a/page');
    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
    expect(within(main).getByRole('link', { name: /go to the dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard',
    );
  });
});

describe('missing-data states', () => {
  it.each(SCREENS)(
    '%s says plainly that its data is unavailable',
    async (path, _heading, message) => {
      const { text } = await mainText(path);
      expect(text).toContain(message);
    },
  );

  it.each(SCREENS)('%s is labelled as a UI preview, not a working feature', async (path) => {
    const { text } = await mainText(path);
    expect(text).toMatch(/ui preview|not configured|not available/i);
  });

  it('shows the Not Found message and still keeps navigation available', async () => {
    renderApp('/nope');
    await screen.findByRole('main');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('no fabricated agricultural values', () => {
  it.each([...SCREENS.map(([path]) => path), '/profile'])(
    '%s shows no prices, quantities, confidence scores, places, crops or personal names',
    async (path) => {
      const { text } = await mainText(path);
      for (const pattern of FABRICATED) expect(text).not.toMatch(pattern);
    },
  );

  it('offers no selectable commodity, state or market options (the registry is not loaded)', async () => {
    for (const path of [
      '/dashboard',
      '/markets',
      '/commodities',
      '/forecast',
      '/compare',
      '/allocate',
      '/simulate',
      '/profile',
    ]) {
      const { unmount } = renderApp(path);
      await screen.findByRole('main');
      for (const select of screen.getAllByRole('combobox')) {
        expect(select).toBeDisabled();
        expect(within(select).getAllByRole('option')).toHaveLength(1);
      }
      unmount();
    }
  });

  it('does not call the API for agricultural data (the browser only talks to Express health)', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('offline')));
    renderApp('/dashboard', { fetchImpl });
    await screen.findByRole('main');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('unavailable actions do not pretend to succeed', () => {
  const DISABLED = [
    ['/markets', /compare selected mandis/i],
    ['/commodities', /explore mandis for selected commodity/i],
    ['/forecast', /set price alert/i],
    ['/compare', /lock rate and route/i],
    ['/compare', /split allocation/i],
    ['/allocate', /accept and generate gate passes/i],
    ['/simulate', /run full multi-mandi optimization/i],
  ];

  it.each(DISABLED)('%s: "%s" is disabled and explains why', async (path, name) => {
    renderApp(/** @type {string} */ (path));
    const button = await screen.findByRole('button', { name: /** @type {RegExp} */ (name) });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent?.length ?? 0).toBeGreaterThan(10);
    fireEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/successfully|booked|booking confirmed|driver assigned/i),
    ).not.toBeInTheDocument();
  });

  it('keeps Send disabled in the AI Copilot, and sending never produces an answer', async () => {
    renderApp('/assistant');
    const send = await screen.findByRole('button', { name: /send \(not available\)/i });
    expect(send).toBeDisabled();
    const input = screen.getByRole('textbox', { name: /ask the ai copilot/i });
    fireEvent.change(input, { target: { value: 'Which mandi is best?' } });
    fireEvent.submit(/** @type {HTMLFormElement} */ (input.closest('form')));
    expect(screen.queryByText(/recommend|best mandi is|you should/i)).not.toBeInTheDocument();
    expect(within(screen.getByRole('log')).queryAllByRole('article')).toHaveLength(0);
  });
});

describe('working frontend interactions', () => {
  it('Market Explorer: search keeps its input state and says it cannot search yet', async () => {
    renderApp('/markets');
    const search = await screen.findByRole('searchbox', {
      name: /search states, mandis or commodities/i,
    });
    fireEvent.change(search, { target: { value: 'abc' } });
    expect(search).toHaveValue('abc');
    expect(screen.getByText(/search will work once the market directory is loaded/i)).toBeVisible();
  });

  it('Market Explorer: the filter panel opens as a dialog and closes with Escape', async () => {
    renderApp('/markets');
    const opener = await screen.findByRole('button', { name: /open filters/i });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(3);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('Market Explorer: the filter panel closes with its Close button', async () => {
    renderApp('/markets');
    fireEvent.click(await screen.findByRole('button', { name: /open filters/i }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close/i })[0]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Forecast: the horizon selector switches between options', async () => {
    renderApp('/forecast');
    const group = await screen.findByRole('group', { name: 'Forecast horizon' });
    expect(within(group).getByRole('radio', { name: /7-day/i })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: /1-day/i }));
    expect(within(group).getByRole('radio', { name: /1-day/i })).toBeChecked();
    expect(within(group).getByRole('radio', { name: /7-day/i })).not.toBeChecked();
  });

  it('Commodities: the readiness index accordion expands and collapses', async () => {
    renderApp('/commodities');
    await screen.findByRole('main');
    const summary = screen.getByText('Algorithmic readiness index').closest('summary');
    const details = /** @type {HTMLDetailsElement} */ (summary?.parentElement);
    expect(details.open).toBe(true);
    fireEvent.click(/** @type {HTMLElement} */ (summary));
    // jsdom toggles the attribute on summary click.
    expect(details.open).toBe(false);
    expect(screen.getByText('Full Intelligence')).toBeInTheDocument();
  });

  it('Compare: accepts a quantity and sort choice as inputs only', async () => {
    renderApp('/compare');
    const quantity = await screen.findByRole('spinbutton', { name: /quantity/i });
    fireEvent.change(quantity, { target: { value: '12' } });
    expect(quantity).toHaveValue(12);
    fireEvent.click(screen.getByRole('radio', { name: /shortest distance/i }));
    expect(screen.getByRole('radio', { name: /shortest distance/i })).toBeChecked();
  });

  it('Allocate: the strategy toggle changes selection without producing results', async () => {
    renderApp('/allocate');
    const group = await screen.findAllByRole('group', { name: 'Allocation strategy' });
    const radios = within(group[0]).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    fireEvent.click(within(group[0]).getByRole('radio', { name: /aggressive/i }));
    expect(within(group[0]).getByRole('radio', { name: /aggressive/i })).toBeChecked();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it('Simulator: presets and sliders move levers, Reset restores the baseline, no payout appears', async () => {
    renderApp('/simulate');
    const freight = await screen.findByRole('slider', { name: /freight/i });
    const reset = screen.getByRole('button', { name: /reset to baseline/i });
    expect(freight).toHaveValue('0');
    expect(reset).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /fuel hike/i }));
    expect(freight).toHaveValue('20');
    expect(reset).toBeEnabled();

    fireEvent.change(screen.getByRole('slider', { name: /storage/i }), { target: { value: '3' } });
    expect(screen.getByRole('slider', { name: /storage/i })).toHaveValue('3');

    fireEvent.click(reset);
    expect(freight).toHaveValue('0');
    expect(screen.getByRole('slider', { name: /storage/i })).toHaveValue('0');
    expect(document.body.textContent).not.toMatch(/₹/);
  });

  it('AI Copilot: suggested questions fill the input without sending anything', async () => {
    renderApp('/assistant');
    const chip = await screen.findByRole('button', {
      name: /which mandi gives the highest profit today/i,
    });
    fireEvent.click(chip);
    expect(screen.getByRole('textbox', { name: /ask the ai copilot/i })).toHaveValue(
      'Which mandi gives the highest profit today?',
    );
  });

  it('Dashboard links are real navigation, not fake actions', async () => {
    renderApp('/dashboard');
    fireEvent.click(await screen.findByRole('link', { name: /open mandi comparison/i }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mandi Comparison' }),
    ).toBeVisible();
  });
});

describe('accessibility basics', () => {
  it.each(SCREENS)('%s labels every form control', async (path) => {
    renderApp(path);
    await screen.findByRole('main');
    for (const control of [
      ...screen.queryAllByRole('combobox'),
      ...screen.queryAllByRole('textbox'),
      ...screen.queryAllByRole('searchbox'),
      ...screen.queryAllByRole('slider'),
      ...screen.queryAllByRole('spinbutton'),
    ]) {
      expect(control).toHaveAccessibleName();
    }
  });

  it.each(SCREENS)('%s names every button', async (path) => {
    renderApp(path);
    await screen.findByRole('main');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAccessibleName();
  });

  it('never skips heading levels inside page content', async () => {
    for (const [path] of SCREENS) {
      const { unmount } = renderApp(path);
      const main = await screen.findByRole('main');
      const levels = within(main)
        .getAllByRole('heading')
        .map((h) => Number(h.tagName.slice(1)));
      for (let i = 1; i < levels.length; i += 1) {
        expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
      }
      unmount();
    }
  });
});
