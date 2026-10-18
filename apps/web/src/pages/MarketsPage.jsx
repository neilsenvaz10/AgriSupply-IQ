import { useState } from 'react';
import { Dialog } from '../components/ui/Dialog';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { RegistrySelect, SearchField } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Card,
  EmptyState,
  PageHeader,
  PreviewBadge,
  SkeletonCard,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMarketDirectory } from '../services/agri';

const STATS = ['Active mandis', 'Commodities', 'Average turnover'];

/** Nationwide Market Explorer (Stitch: nationwide_market_explorer). */
export function MarketsPage() {
  useDocumentTitle('Explore markets');
  const directory = useMarketDirectory();
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        icon="storefront"
        title="Nationwide Explorer"
        subtitle="Price discovery and liquidity across Indian APMC hubs, once market data is connected."
        badge={<PreviewBadge>UI preview: data unavailable</PreviewBadge>}
        action={
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-haspopup="dialog"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface"
          >
            <MaterialIcon name="tune" />
            <span className="sr-only">Open filters</span>
          </button>
        }
      />

      <SearchField
        label="Search states, mandis or commodities"
        placeholder="Search state, mandi, or commodity…"
        value={query}
        onChange={setQuery}
        hint={query.trim() ? 'Search will work once the market directory is loaded.' : undefined}
      />

      <div className="flex flex-wrap gap-space-xs" role="group" aria-label="Region">
        <button
          type="button"
          aria-pressed="true"
          className="rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md font-bold text-on-primary"
        >
          All India
        </button>
      </div>

      <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
        <RegistrySelect label="State" placeholder="All states" />
        <RegistrySelect label="Commodity" placeholder="All commodities" />
      </div>

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card aria-labelledby="map-heading" className="flex flex-col gap-3">
            <h2 id="map-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Coverage map
            </h2>
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl bg-surface-container-low text-center">
              <MaterialIcon name="map" className="text-[40px] text-outline" />
              <p className="max-w-xs px-space-md font-body-sm text-body-sm text-on-surface-variant">
                The map needs the market directory with verified locations.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {STATS.map((label) => (
                <div
                  key={label}
                  className="flex flex-col rounded-xl bg-surface-container-low p-2.5 text-center"
                >
                  <dt className="font-label-xs text-label-xs text-on-surface-variant">{label}</dt>
                  <dd className="font-metric-md text-metric-md text-outline">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">Not available</span>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card aria-labelledby="health-heading" className="flex flex-col gap-2">
            <h2 id="health-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Data feed health
            </h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Feed freshness and reliability are reported here once ingestion runs. Nothing is
              reported as live before then.
            </p>
            <div className="h-3 w-full rounded-full bg-surface-container-high" aria-hidden="true" />
          </Card>
        </div>

        <section
          aria-labelledby="hubs-heading"
          className="flex flex-col gap-space-sm lg:col-span-7"
        >
          <div className="flex items-center justify-between">
            <h2 id="hubs-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Market hubs
            </h2>
            <span className="font-label-xs text-label-xs font-bold text-outline">Showing 0</span>
          </div>
          <DataState state={directory} icon="storefront">
            {() => null}
          </DataState>
          <div className="grid gap-space-sm opacity-70" aria-hidden="true">
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </div>
        </section>
      </div>

      <div className="mx-auto w-full max-w-md">
        <UnavailableAction
          icon="compare_arrows"
          reason="Choose mandis from the directory to compare them. The directory is not available yet."
        >
          Compare selected mandis (0)
        </UnavailableAction>
      </div>

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        placement="bottom"
        id="market-filters"
      >
        <div className="flex flex-col gap-space-md">
          <EmptyState
            icon="filter_alt_off"
            message="Filters use the nationwide state, district and commodity registries, which are not available yet."
          />
          <RegistrySelect label="State" placeholder="All states" />
          <RegistrySelect label="District" placeholder="All districts" />
          <RegistrySelect label="Commodity" placeholder="All commodities" />
          <button
            type="button"
            onClick={() => setFiltersOpen(false)}
            className="min-h-[48px] rounded-xl bg-primary px-space-lg font-label-md text-label-md font-bold text-on-primary"
          >
            Close
          </button>
        </div>
      </Dialog>
    </div>
  );
}
