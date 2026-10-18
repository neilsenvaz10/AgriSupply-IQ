import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { routes } from '../app/routes';
import { createApiClient } from '../services/api/client';
import { ApiClientContext } from '../services/api/context';

/**
 * Renders the real route table at `path` with a mocked API client (no network).
 *
 * @param {string} path
 * @param {{ fetchImpl?: unknown, baseUrl?: string | null }} [options]
 */
export function renderApp(path, options = {}) {
  const fetchImpl =
    options.fetchImpl ?? vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  const client = createApiClient({
    baseUrl: options.baseUrl === undefined ? 'http://api.test' : options.baseUrl,
    timeoutMs: 1000,
    fetchImpl: /** @type {typeof fetch} */ (fetchImpl),
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <ApiClientContext.Provider value={client}>
      <RouterProvider router={router} />
    </ApiClientContext.Provider>,
  );
  return { ...view, router };
}
