import { MaterialIcon } from '../components/ui/MaterialIcon';
import {
  Card,
  EmptyState,
  InfoBanner,
  LinkButton,
  PreviewBadge,
  Skeleton,
  SkeletonCard,
} from '../components/ui/primitives';
import { RegistrySelect } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useDashboardOverview, useMandiComparison } from '../services/agri';

/** Empty donut ring (Stitch allocation teaser) with no segments: nothing has been allocated. */
function EmptyDonut() {
  return (
    <div className="relative h-20 w-20 shrink-0" aria-hidden="true">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="14" fill="none" stroke="#eceeec" strokeWidth="5" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-label-md text-label-md font-bold text-outline">
        —
      </div>
    </div>
  );
}

/** Empty chart frame (Stitch trajectory chart) with grid lines only, no series. */
function EmptyChart() {
  return (
    <div
      className="relative h-40 w-full pt-2"
      role="img"
      aria-label="Price chart: no data available"
    >
      <svg
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 320 120"
        aria-hidden="true"
      >
        {[20, 60, 100].map((y) => (
          <line
            key={y}
            x1="0"
            x2="320"
            y1={y}
            y2={y}
            stroke="#e1e3e1"
            strokeDasharray="3 3"
            strokeWidth="1"
          />
        ))}
      </svg>
      <p className="absolute inset-0 flex items-center justify-center px-space-md text-center font-label-md text-label-md text-on-surface-variant">
        No price history to plot
      </p>
    </div>
  );
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const overview = useDashboardOverview();
  const comparison = useMandiComparison();

  return (
    <div className="flex flex-col gap-space-md">
      <section aria-labelledby="page-title" className="flex flex-col gap-space-xs">
        <div className="flex flex-wrap items-center justify-between gap-space-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2.5 py-1 font-label-xs text-label-xs font-semibold text-on-surface-variant shadow-sm">
            <MaterialIcon name="location_on" className="text-[15px] text-outline" />
            Location not set
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-high px-2 py-0.5 font-label-xs text-label-xs font-medium text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-outline" aria-hidden="true" />
            Data feed: not connected
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-space-sm">
          <div>
            <h1
              id="page-title"
              className="font-headline-lg-mobile text-headline-lg-mobile tracking-tight text-on-surface md:text-headline-lg"
            >
              राम राम! <span aria-hidden="true">🌾</span> Welcome to FASALYTICS
            </h1>
            <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">
              Your selling decisions will be planned here: where, when and how much to sell.
            </p>
          </div>
          <PreviewBadge />
        </div>
      </section>

      <InfoBanner icon="notifications_off">
        Weather and transport alerts will appear here when an alert source is connected.
      </InfoBanner>

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-7">
          {/* Selected commodity & harvest lot (Stitch crop chips + lot strip) */}
          <section aria-labelledby="commodity-heading" className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <h2
                id="commodity-heading"
                className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant"
              >
                Selected commodity
              </h2>
              <span className="flex items-center gap-0.5 font-label-xs text-label-xs font-semibold text-outline">
                Edit lot <MaterialIcon name="tune" className="text-[14px]" />
              </span>
            </div>
            <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
              <RegistrySelect label="Commodity" placeholder="Select a commodity" />
              <RegistrySelect label="Market or mandi" placeholder="Select a market" />
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-surface-container-low p-2.5 font-label-xs text-label-xs text-on-surface-variant">
              <MaterialIcon name="inventory_2" className="text-[16px] text-outline" />
              <span>Harvest lot: not set. Quantity and grade will be entered here.</span>
            </div>
          </section>

          {/* Recommendation card (Stitch hero), without any invented recommendation */}
          <section
            aria-labelledby="recommendation-heading"
            className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary-container to-secondary p-5 text-on-primary shadow-xl"
          >
            <div
              className="pointer-events-none absolute -bottom-8 -right-8 h-44 w-44 rounded-full bg-secondary-fixed/10 blur-2xl"
              aria-hidden="true"
            />
            <div className="relative z-10 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-fixed px-3 py-1 font-label-xs text-label-xs font-extrabold tracking-wide text-on-secondary-fixed shadow-sm">
                  <MaterialIcon name="auto_awesome" className="text-[15px]" />
                  RECOMMENDATION
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 font-label-xs text-label-xs font-bold text-emerald-200">
                  Not available
                </span>
              </div>
              <div>
                <h2
                  id="recommendation-heading"
                  className="font-headline-lg-mobile text-headline-lg-mobile font-extrabold leading-tight text-white"
                >
                  No recommendation yet
                </h2>
                <p className="mt-1.5 font-body-sm text-body-sm leading-snug text-emerald-100/90">
                  Recommendations require verified market and forecast data. None is shown until
                  those exist, and none is ever estimated without them.
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-xl bg-black/25 p-3.5">
                <div className="flex flex-col">
                  <span className="font-label-xs text-label-xs font-semibold uppercase text-emerald-200">
                    Expected net payout
                  </span>
                  <span className="font-headline-display-mobile text-headline-display-mobile font-extrabold tracking-tight text-white">
                    —
                  </span>
                  <span className="font-label-xs text-label-xs text-emerald-200/80">
                    Needs prices, forecasts and costs
                  </span>
                </div>
              </div>
              <LinkButton to="/compare" variant="secondary" icon="arrow_forward">
                Open mandi comparison
              </LinkButton>
            </div>
          </section>

          {/* Price trajectory (Stitch chart card) */}
          <Card aria-labelledby="trajectory-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col">
                <h2
                  id="trajectory-heading"
                  className="font-headline-sm text-headline-sm font-extrabold text-on-surface"
                >
                  Price trajectory
                </h2>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  Price per quintal across selected mandis
                </span>
              </div>
            </div>
            <DataState state={overview} skeleton={<Skeleton className="h-40 w-full" />}>
              {() => null}
            </DataState>
            <EmptyChart />
          </Card>
        </div>

        <div className="flex flex-col gap-space-md lg:col-span-5">
          {/* Top mandi comparison (Stitch card stack) */}
          <section aria-labelledby="mandis-heading" className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <h2
                  id="mandis-heading"
                  className="font-headline-sm text-headline-sm font-extrabold text-on-surface"
                >
                  Top mandi comparison
                </h2>
                <span className="font-label-xs text-label-xs text-on-surface-variant">
                  Ranked by net in-hand realization
                </span>
              </div>
              <span className="font-label-xs text-label-xs font-bold uppercase tracking-wider text-outline">
                None available
              </span>
            </div>
            <EmptyState icon="storefront" message={comparison.reason} />
            <div className="grid gap-space-xs opacity-70" aria-hidden="true">
              <SkeletonCard lines={2} />
              <SkeletonCard lines={2} />
            </div>
          </section>

          {/* Allocation teaser (Stitch) */}
          <section
            aria-labelledby="allocation-heading"
            className="flex flex-col gap-3.5 rounded-2xl bg-gradient-to-b from-surface-container-low to-surface-container p-4 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <MaterialIcon name="pie_chart" className="text-[24px] text-primary" />
              <h2
                id="allocation-heading"
                className="font-headline-sm text-headline-sm font-extrabold text-on-surface"
              >
                Smart allocation plan
              </h2>
            </div>
            <div className="flex items-center gap-4 rounded-xl bg-surface-container-lowest p-3">
              <EmptyDonut />
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                No allocation yet. A split across mandis appears here once verified market and
                forecast data exist.
              </p>
            </div>
            <LinkButton to="/allocate" icon="tune">
              Open harvest allocation
            </LinkButton>
          </section>
        </div>
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center font-label-xs text-label-xs text-on-surface-variant">
        <MaterialIcon name="info" className="text-[14px]" />
        UI preview: no market data is connected, and nothing on this page is a price or a forecast.
      </p>
    </div>
  );
}
