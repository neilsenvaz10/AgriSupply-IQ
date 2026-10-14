import { Navigate } from 'react-router-dom';
import { AppShell } from '../layouts/AppShell';
import { NotFoundPage } from '../pages/NotFoundPage';
import { StatusPage } from '../pages/StatusPage';

/**
 * Route table. Only implemented features are registered.
 * Planned areas (see navigation.js) intentionally have no routes yet, so they resolve to
 * the not-found page instead of an empty or mocked screen.
 */
export const routes = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/status" replace /> },
      { path: 'status', element: <StatusPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
