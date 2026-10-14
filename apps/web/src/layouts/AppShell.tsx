import { Outlet } from 'react-router-dom';
import { NAV_ITEMS } from '../app/navigation';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { NavEntry } from './NavEntry';

/**
 * Responsive application shell.
 *  - Mobile (< md): top bar + bottom tab bar (5 entries).
 *  - Desktop (>= md): top bar + fixed 260 px navigation rail (width from DESIGN.md).
 * Visual language follows the Stitch exports (tokens in tailwind.config.ts); no Stitch
 * HTML or remote assets are used.
 */
export function AppShell() {
  const mobileItems = NAV_ITEMS.filter((item) => item.mobilePrimary);

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-space-md focus:top-space-md focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-space-md focus:py-space-sm focus:text-on-primary"
      >
        Skip to main content
      </a>

      <header className="fixed inset-x-0 top-0 z-50 bg-surface/90 pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-space-sm px-gutter-mobile md:px-margin">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary"
            aria-hidden="true"
          >
            <MaterialIcon name="eco" className="text-[24px]" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="font-headline-sm text-headline-sm font-extrabold leading-tight tracking-tight text-primary">
              FASALYTICS
            </span>
            <span className="font-label-xs text-label-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Market &amp; risk intelligence
            </span>
          </div>
        </div>
      </header>

      <aside
        aria-label="Primary navigation"
        className="fixed bottom-0 left-0 top-16 z-40 hidden w-[260px] overflow-y-auto bg-surface-container-low px-space-sm py-space-md md:block"
      >
        <nav aria-label="Main">
          <ul className="flex flex-col gap-space-xs">
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <NavEntry item={item} variant="rail" />
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[1600px] px-gutter-mobile pb-28 pt-24 md:pb-space-xl md:pl-[calc(260px+2rem)] md:pr-margin"
      >
        <Outlet />
      </main>

      <nav
        aria-label="Main (mobile)"
        className="fixed inset-x-0 bottom-0 z-50 bg-surface/95 pb-safe shadow-[0_-2px_12px_rgba(0,0,0,0.05)] backdrop-blur-xl md:hidden"
      >
        <ul className="flex items-stretch justify-around gap-space-xs px-space-xs py-1">
          {mobileItems.map((item) => (
            <li key={item.id} className="flex min-w-0 flex-1">
              <NavEntry item={item} variant="tab" />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
