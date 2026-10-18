import { Navigate } from 'react-router-dom';
import { RouteError } from '../components/ui/ErrorBoundary';
import { AppShell } from '../layouts/AppShell';
import { AllocatePage } from '../pages/AllocatePage';
import { AssistantPage } from '../pages/AssistantPage';
import { CommoditiesPage } from '../pages/CommoditiesPage';
import { ComparePage } from '../pages/ComparePage';
import { DashboardPage } from '../pages/DashboardPage';
import { ForecastPage } from '../pages/ForecastPage';
import { MarketsPage } from '../pages/MarketsPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProfilePage } from '../pages/ProfilePage';
import { SimulatePage } from '../pages/SimulatePage';
import { StatusPage } from '../pages/StatusPage';
import { ROUTE_ALIASES } from './navigation';

/**
 * Route table. The Dashboard is the landing page; every navigation entry opens a real page.
 * Most pages are UI previews whose data services do not exist yet (see navigation.js).
 * System Status stays available as the diagnostics screen. Unknown paths show a not-found page.
 */
export const routes = [
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'markets', element: <MarketsPage /> },
      { path: 'commodities', element: <CommoditiesPage /> },
      { path: 'forecast', element: <ForecastPage /> },
      { path: 'compare', element: <ComparePage /> },
      { path: 'allocate', element: <AllocatePage /> },
      { path: 'simulate', element: <SimulatePage /> },
      { path: 'assistant', element: <AssistantPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'status', element: <StatusPage /> },
      ...Object.entries(ROUTE_ALIASES).map(([from, to]) => ({
        path: from.slice(1),
        element: <Navigate to={to} replace />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
