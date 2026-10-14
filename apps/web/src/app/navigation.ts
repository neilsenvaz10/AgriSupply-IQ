/**
 * Application navigation model.
 *
 * Only features that actually exist are `available`. Planned areas are listed so the shell
 * shows the intended structure, but they are rendered as disabled, clearly-labelled entries
 * and have NO registered routes until their phase is implemented (Phase 7+).
 *
 * Paths are generic: no state, mandi or crop names are ever part of a route.
 * Selections (commodity, geography, plan) will live in URL search params later.
 */
export type NavAvailability = 'available' | 'planned';

export interface NavItem {
  id: string;
  label: string;
  /** Material Symbols ligature name. */
  icon: string;
  path: string;
  availability: NavAvailability;
  /** Shown in the mobile bottom bar (kept to five entries). */
  mobilePrimary: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'status',
    label: 'Status',
    icon: 'monitor_heart',
    path: '/status',
    availability: 'available',
    mobilePrimary: true,
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    path: '/dashboard',
    availability: 'planned',
    mobilePrimary: true,
  },
  {
    id: 'markets',
    label: 'Explore Markets',
    icon: 'storefront',
    path: '/markets',
    availability: 'planned',
    mobilePrimary: true,
  },
  {
    id: 'commodities',
    label: 'Commodities',
    icon: 'grass',
    path: '/commodities',
    availability: 'planned',
    mobilePrimary: false,
  },
  {
    id: 'forecast',
    label: 'Price Forecasting',
    icon: 'query_stats',
    path: '/forecast',
    availability: 'planned',
    mobilePrimary: false,
  },
  {
    id: 'compare',
    label: 'Compare Mandis',
    icon: 'compare_arrows',
    path: '/compare',
    availability: 'planned',
    mobilePrimary: true,
  },
  {
    id: 'allocate',
    label: 'Harvest Allocation',
    icon: 'pie_chart',
    path: '/allocate',
    availability: 'planned',
    mobilePrimary: false,
  },
  {
    id: 'simulate',
    label: 'What-If Simulator',
    icon: 'tune',
    path: '/simulate',
    availability: 'planned',
    mobilePrimary: false,
  },
  {
    id: 'assistant',
    label: 'AI Copilot',
    icon: 'smart_toy',
    path: '/assistant',
    availability: 'planned',
    mobilePrimary: true,
  },
  {
    id: 'profile',
    label: 'Profile',
    icon: 'person',
    path: '/profile',
    availability: 'planned',
    mobilePrimary: false,
  },
];
