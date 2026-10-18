import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '../app/navigation';
import { renderApp } from '../test/renderApp';

describe('Application shell', () => {
  it('exposes landmarks and a skip link', async () => {
    renderApp('/dashboard');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(await screen.findByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: /skip to main content/i })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getAllByRole('navigation').length).toBeGreaterThanOrEqual(2);
  });

  it('opens a real page from every sidebar entry and has no "Planned" labels', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    const rail = screen.getByRole('navigation', { name: 'Main' });
    const links = within(rail).getAllByRole('link');
    expect(links).toHaveLength(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      expect(links.some((link) => link.getAttribute('href') === item.path)).toBe(true);
    }
    expect(within(rail).queryByRole('button')).not.toBeInTheDocument();
    expect(rail.textContent).not.toMatch(/planned/i);
  });

  it('navigates when a sidebar entry is activated and marks the current page', async () => {
    renderApp('/dashboard');
    const rail = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(rail).getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(rail).getByRole('link', { name: /explore markets/i }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Nationwide Explorer' }),
    ).toBeVisible();
    expect(within(rail).getByRole('link', { name: /explore markets/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the mobile bottom bar to the five Stitch tabs, with Allocate as the centre action', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    const mobile = screen.getByRole('navigation', { name: 'Main (mobile)' });
    const links = within(mobile).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/dashboard',
      '/markets',
      '/allocate',
      '/assistant',
      '/profile',
    ]);
    expect(links.map((l) => l.lastElementChild?.textContent)).toEqual([
      'Dashboard',
      'Mandis',
      'Allocate',
      'AI Copilot',
      'Profile',
    ]);
  });

  it('opens the mobile menu as an accessible dialog with every page, and closes it on Escape', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    const opener = screen.getByRole('button', { name: 'Open menu' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getAllByRole('link')).toHaveLength(NAV_ITEMS.length);
    expect(dialog).toContainElement(/** @type {HTMLElement} */ (document.activeElement));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes the menu after choosing a page and shows that page', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(dialog).getByRole('link', { name: /compare mandis/i }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mandi Comparison' }),
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the menu when the backdrop is clicked', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not fake unimplemented header controls', async () => {
    renderApp('/dashboard');
    await screen.findByRole('main');
    expect(screen.getByRole('button', { name: /hindi \(not available yet\)/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /marathi \(not available yet\)/i })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /notifications \(not available yet\)/i }),
    ).toBeDisabled();
    expect(screen.getByRole('link', { name: /profile and preferences/i })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  it('does not hardcode any state, crop or mandi names in navigation', () => {
    const text = NAV_ITEMS.map((i) => `${i.label} ${i.path}`).join(' ');
    expect(text).not.toMatch(/maharashtra|punjab|potato|onion|tomato|wheat|nashik|pune/i);
  });

  it('keeps System Status reachable as a diagnostics entry', async () => {
    renderApp('/dashboard');
    const rail = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(rail).getByRole('link', { name: /system status/i })).toHaveAttribute(
      'href',
      '/status',
    );
  });
});
