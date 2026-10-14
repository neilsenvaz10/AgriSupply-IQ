import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '../app/navigation';
import { routes } from '../app/routes';
import { createApiClient } from '../services/api/client';
import { ApiClientContext } from '../services/api/context';

function renderShell() {
  const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  const client = createApiClient({
    baseUrl: 'http://api.test',
    timeoutMs: 1000,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  const router = createMemoryRouter(routes, { initialEntries: ['/status'] });
  return render(
    <ApiClientContext.Provider value={client}>
      <RouterProvider router={router} />
    </ApiClientContext.Provider>,
  );
}

describe('Application shell', () => {
  it('exposes landmarks and a skip link', async () => {
    renderShell();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(await screen.findByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getAllByRole('navigation').length).toBeGreaterThanOrEqual(1);
  });

  it('offers a working link only for implemented features', async () => {
    renderShell();
    await screen.findByRole('main');

    const rail = screen.getByRole('navigation', { name: 'Main' });
    const links = within(rail).getAllByRole('link');
    expect(links).toHaveLength(NAV_ITEMS.filter((i) => i.availability === 'available').length);
    expect(links[0]).toHaveAttribute('href', '/status');
  });

  it('renders every planned feature as a disabled, clearly labelled control', async () => {
    renderShell();
    await screen.findByRole('main');

    const rail = screen.getByRole('navigation', { name: 'Main' });
    const planned = NAV_ITEMS.filter((i) => i.availability === 'planned');
    expect(planned.length).toBeGreaterThan(0);

    for (const item of planned) {
      const control = within(rail).getByRole('button', { name: new RegExp(item.label, 'i') });
      expect(control).toBeDisabled();
      expect(control).toHaveAttribute('aria-disabled', 'true');
      expect(control).toHaveTextContent(/planned/i);
    }
  });

  it('keeps the mobile bar to at most five entries', async () => {
    renderShell();
    await screen.findByRole('main');
    const mobile = screen.getByRole('navigation', { name: 'Main (mobile)' });
    expect(within(mobile).getAllByRole('listitem').length).toBeLessThanOrEqual(5);
  });

  it('does not hardcode any state, crop or mandi names in navigation', () => {
    const text = NAV_ITEMS.map((i) => `${i.label} ${i.path}`).join(' ');
    expect(text).not.toMatch(/maharashtra|punjab|potato|onion|tomato|wheat|nashik|pune/i);
  });
});
