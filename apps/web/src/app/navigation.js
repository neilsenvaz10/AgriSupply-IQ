/**
 * Application navigation model. Every entry opens a real React page.
 *
 * Several pages are UI previews: their layout is implemented from the Google Stitch designs, but
 * the data service behind them does not exist yet, so they show truthful "unavailable" states.
 * `preview` records that, so the shell can say so instead of implying a working feature.
 *
 * Paths are generic: no state, mandi or crop names are ever part of a route. Selections
 * (commodity, geography, plan) will live in URL search params when the registries exist.
 *
 * @typedef {object} NavItem
 * @property {string} id
 * @property {string} label Sidebar and menu label.
 * @property {string} icon Material Symbols ligature name.
 * @property {string} path
 * @property {'main' | 'diagnostics'} group
 * @property {boolean} preview True while the screen has no connected data service.
 * @property {{ order: number, label: string, center?: boolean } | null} tab Position in the
 *   five-entry mobile bottom bar (Stitch pattern), or null when reached through the menu.
 */

/** @type {readonly NavItem[]} */
export const NAV_ITEMS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    path: '/dashboard',
    group: 'main',
    preview: true,
    tab: { order: 1, label: 'Dashboard' },
  },
  {
    id: 'markets',
    label: 'Explore Markets',
    icon: 'storefront',
    path: '/markets',
    group: 'main',
    preview: true,
    tab: { order: 2, label: 'Mandis' },
  },
  {
    id: 'commodities',
    label: 'Commodities',
    icon: 'grass',
    path: '/commodities',
    group: 'main',
    preview: true,
    tab: null,
  },
  {
    id: 'forecast',
    label: 'Price Forecasting',
    icon: 'query_stats',
    path: '/forecast',
    group: 'main',
    preview: true,
    tab: null,
  },
  {
    id: 'compare',
    label: 'Compare Mandis',
    icon: 'compare_arrows',
    path: '/compare',
    group: 'main',
    preview: true,
    tab: null,
  },
  {
    id: 'allocate',
    label: 'Harvest Allocation',
    icon: 'pie_chart',
    path: '/allocate',
    group: 'main',
    preview: true,
    tab: { order: 3, label: 'Allocate', center: true },
  },
  {
    id: 'simulate',
    label: 'What-If Simulator',
    icon: 'tune',
    path: '/simulate',
    group: 'main',
    preview: true,
    tab: null,
  },
  {
    id: 'assistant',
    label: 'AI Copilot',
    icon: 'smart_toy',
    path: '/assistant',
    group: 'main',
    preview: true,
    tab: { order: 4, label: 'AI Copilot' },
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: 'person',
    path: '/profile',
    group: 'main',
    preview: true,
    tab: { order: 5, label: 'Profile' },
  },
  {
    id: 'status',
    label: 'System Status',
    icon: 'monitor_heart',
    path: '/status',
    group: 'diagnostics',
    preview: false,
    tab: null,
  },
];

/** Alternative path spellings that redirect to the canonical route. */
export const ROUTE_ALIASES = {
  '/forecasting': '/forecast',
  '/compare-mandis': '/compare',
  '/harvest-allocation': '/allocate',
  '/what-if': '/simulate',
  '/copilot': '/assistant',
};
