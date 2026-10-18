import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../app/routes';
import { createApiClient } from '../services/api/client';
import { ApiClientContext } from '../services/api/context';

/**
 * @param {string} path
 * @param {unknown} fetchImpl A mocked fetch (typed loosely so tests can pass any mock).
 * @param {string | null} [baseUrl]
 */
function renderAt(path, fetchImpl, baseUrl = 'http://api.test') {
  const client = createApiClient({
    baseUrl,
    timeoutMs: 1000,
    fetchImpl: /** @type {typeof fetch} */ (fetchImpl),
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <ApiClientContext.Provider value={client}>
      <RouterProvider router={router} />
    </ApiClientContext.Provider>,
  );
}
const unreachable = () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

describe('Status page', () => {
  it('is available at /status as the diagnostics screen', async () => {
    renderAt('/status', unreachable());
    expect(await screen.findByRole('heading', { level: 1, name: 'System status' })).toBeVisible();
    expect(document.title).toBe('System status | FASALYTICS');
  });
  it('shows a loading state while the health check is pending', () => {
    const pending = vi.fn(() => new Promise(() => undefined));
    renderAt('/status', pending);
    expect(screen.getByRole('status')).toHaveTextContent('Checking');
    expect(screen.getByRole('button', { name: /check again/i })).toBeDisabled();
  });
  it('reports an unreachable API honestly and never claims a connection', async () => {
    renderAt('/status', unreachable());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('API unreachable');
    expect(screen.getByRole('status')).toHaveTextContent('Not connected');
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check again/i })).toBeEnabled();
  });
  it('shows the HTTP status when the API answers with an error', async () => {
    const failing = vi.fn(() => Promise.resolve(new Response('boom', { status: 500 })));
    renderAt('/status', failing);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 500');
  });
  it('reports a configuration problem when no base URL is set', async () => {
    const fetchImpl = vi.fn();
    renderAt('/status', fetchImpl, null);
    expect(await screen.findByRole('alert')).toHaveTextContent('API address not configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('shows a connected state only when the API really returns a valid health payload', async () => {
    const healthy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', service: 'api', version: '0.0.1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    renderAt('/status', healthy);
    expect(await screen.findByText('Connected')).toBeVisible();
    expect(screen.getByText(/Service: api/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('can re-run the check after a failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    renderAt('/status', fetchImpl);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(await screen.findByText('Connected')).toBeVisible();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('does not render any market data, prices or forecasts', async () => {
    renderAt('/status', unreachable());
    await screen.findByRole('alert');
    const main = screen.getByRole('main');
    expect(main.textContent ?? '').not.toMatch(/₹|\/\s*Qtl|quintal|forecast|confidence/i);
  });
  it('renders a not-found page for unknown routes', async () => {
    renderAt('/no-such-page', unreachable());
    const main = await screen.findByRole('main');
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
  });
});
