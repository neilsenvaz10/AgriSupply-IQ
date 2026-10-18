import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { NAV_ITEMS } from '../app/navigation';
import { Dialog } from '../components/ui/Dialog';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { NavEntry } from './NavEntry';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary';

/** @param {{ variant: string, onNavigate?: () => void }} props */
function NavList({ variant, onNavigate = undefined }) {
  const main = NAV_ITEMS.filter((item) => item.group === 'main');
  const diagnostics = NAV_ITEMS.filter((item) => item.group === 'diagnostics');
  return (
    <>
      <ul className="flex flex-col gap-space-xs">
        {main.map((item) => (
          <li key={item.id}>
            <NavEntry item={item} variant={variant} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
      <p className="mb-space-xs mt-space-md px-space-sm font-label-xs text-label-xs font-bold uppercase tracking-wider text-on-surface-variant">
        Diagnostics
      </p>
      <ul className="flex flex-col gap-space-xs">
        {diagnostics.map((item) => (
          <li key={item.id}>
            <NavEntry item={item} variant={variant} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Responsive application shell (Stitch header and bottom bar, adapted for larger screens).
 *  - Mobile (< md): top bar with menu button, five-tab bottom bar, drawer with every page.
 *  - Desktop (>= md): top bar and a fixed 260 px sidebar (width from DESIGN.md).
 * The language switch, notifications and sign-in are not implemented, so they are disabled and
 * say so; nothing here shows a fake alert, name or avatar.
 */
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const tabs = NAV_ITEMS.filter((item) => item.tab).sort(
    (a, b) => (a.tab?.order ?? 0) - (b.tab?.order ?? 0),
  );

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-space-md focus:top-space-md focus:z-[80] focus:rounded-xl focus:bg-primary focus:px-space-md focus:py-space-sm focus:text-on-primary"
      >
        Skip to main content
      </a>

      <header className="fixed inset-x-0 top-0 z-50 bg-surface/90 pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-space-sm px-gutter-mobile md:px-margin">
          <div className="flex min-w-0 items-center gap-space-sm">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-on-surface md:hidden ${focusRing}`}
            >
              <MaterialIcon name="menu" />
            </button>
            <Link
              to="/dashboard"
              className={`flex min-w-0 items-center gap-space-sm rounded-xl ${focusRing}`}
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary"
                aria-hidden="true"
              >
                <MaterialIcon name="eco" className="text-[24px]" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-headline-sm text-headline-sm font-extrabold leading-tight tracking-tight text-primary">
                  FASALYTICS
                </span>
                <span className="font-label-xs text-label-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  Smarter selling
                </span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-space-xs">
            <div
              role="group"
              aria-label="Language"
              className="hidden items-center rounded-full bg-surface-container-high p-0.5 font-label-xs text-label-xs sm:flex"
            >
              <button
                type="button"
                aria-pressed="true"
                className="rounded-full bg-primary px-2.5 py-1 font-bold text-on-primary"
              >
                EN
              </button>
              <button
                type="button"
                disabled
                title="Hindi is not available yet"
                aria-label="Hindi (not available yet)"
                className="cursor-not-allowed rounded-full px-2.5 py-1 text-outline"
              >
                हि
              </button>
              <button
                type="button"
                disabled
                title="Marathi is not available yet"
                aria-label="Marathi (not available yet)"
                className="cursor-not-allowed rounded-full px-2.5 py-1 text-outline"
              >
                म
              </button>
            </div>
            <button
              type="button"
              disabled
              title="Notifications are not available yet"
              aria-label="Notifications (not available yet)"
              className="flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-full text-outline"
            >
              <MaterialIcon name="notifications" />
            </button>
            <Link
              to="/profile"
              aria-label="Profile and preferences"
              className={`flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed text-on-primary-fixed ${focusRing}`}
            >
              <MaterialIcon name="person" />
            </Link>
          </div>
        </div>
      </header>

      <aside
        aria-label="Primary navigation"
        className="fixed bottom-0 left-0 top-16 z-40 hidden w-[260px] overflow-y-auto bg-surface-container-low px-space-sm py-space-md md:block"
      >
        <nav aria-label="Main">
          <NavList variant="rail" />
        </nav>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[1600px] px-gutter-mobile pb-32 pt-24 md:pb-space-xl md:pl-[calc(260px+2rem)] md:pr-margin"
      >
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <nav
        aria-label="Main (mobile)"
        className="fixed inset-x-0 bottom-0 z-50 bg-surface/95 pb-safe shadow-[0_-2px_12px_rgba(0,0,0,0.05)] backdrop-blur-xl md:hidden"
      >
        <ul className="flex h-16 items-end justify-around gap-space-xs px-space-xs">
          {tabs.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-1 items-end">
              <NavEntry item={item} variant="tab" />
            </li>
          ))}
        </ul>
      </nav>

      <Dialog
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Menu"
        placement="left"
        id="menu"
      >
        <nav aria-label="All pages">
          <NavList variant="menu" onNavigate={() => setMenuOpen(false)} />
        </nav>
      </Dialog>
    </div>
  );
}
