import { useState } from 'react';
import { RegistrySelect, SearchField, Disclosure } from '../components/ui/controls';
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
import { useCommodityCatalogue } from '../services/agri';

/** Capability tiers from PROJECT.md §4.2.1: assigned per series from measurable evidence. */
const TIERS = [
  ['Full Intelligence', 'Validated mandi-level forecasts and decision support.'],
  [
    'Limited Intelligence',
    'Historical mandi data exists, but quality or coverage is not enough for validated forecasts.',
  ],
  [
    'State-Level Intelligence',
    'Only state-level observations exist; shown as state analysis, never as mandi-level.',
  ],
  ['Insufficient Data', 'Not enough verified observations.'],
];

/** Explore Commodities (Stitch: all_crop_commodity_explorer). */
export function CommoditiesPage() {
  useDocumentTitle('Commodities');
  const catalogue = useCommodityCatalogue();
  const [query, setQuery] = useState('');

  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        icon="grass"
        title="Explore Commodities"
        subtitle="All-India agricultural commodity directory and forecasting eligibility."
        badge={<PreviewBadge>UI preview: data unavailable</PreviewBadge>}
      />

      <SearchField
        label="Search commodities"
        placeholder="Search commodities across India…"
        value={query}
        onChange={setQuery}
        hint={query.trim() ? 'Search will work once the commodity catalogue is loaded.' : undefined}
      />

      <div className="flex flex-wrap gap-space-xs" role="group" aria-label="Category">
        <button
          type="button"
          aria-pressed="true"
          className="rounded-full bg-primary-container px-4 py-2 font-label-md text-label-md font-bold text-on-primary"
        >
          All crops
        </button>
        <span className="self-center font-label-xs text-label-xs text-on-surface-variant">
          Categories load from the commodity catalogue.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card aria-labelledby="spotlight-heading" className="flex flex-col gap-3">
            <h2 id="spotlight-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Spotlight
            </h2>
            <EmptyState
              icon="grass"
              message="A commodity spotlight appears once a commodity is selected from the catalogue."
            />
            <RegistrySelect label="Commodity" placeholder="Select a commodity" />
          </Card>

          <Disclosure title="Algorithmic readiness index" icon="verified" defaultOpen>
            <p>
              Every commodity and market series is assigned a capability tier from measurable
              criteria (history, continuity, freshness) and backtesting, never from a whitelist. No
              tier has been assigned yet because no data has been ingested.
            </p>
            <ul className="mt-space-sm flex flex-col gap-space-xs">
              {TIERS.map(([name, meaning]) => (
                <li key={name} className="rounded-xl bg-surface-container-lowest p-space-sm">
                  <span className="font-label-md text-label-md font-bold text-on-surface">
                    {name}
                  </span>
                  <span className="block">{meaning}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>

        <section
          aria-labelledby="catalogue-heading"
          className="flex flex-col gap-space-sm lg:col-span-7"
        >
          <div className="flex items-center justify-between">
            <h2 id="catalogue-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Nationwide commodities
            </h2>
            <span className="font-label-xs text-label-xs font-bold text-outline">Showing 0</span>
          </div>
          <DataState state={catalogue} icon="grass">
            {() => null}
          </DataState>
          <div className="grid gap-space-sm opacity-70" aria-hidden="true">
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
            <SkeletonCard lines={1} />
          </div>
        </section>
      </div>

      <div className="mx-auto w-full max-w-md">
        <UnavailableAction
          icon="storefront"
          reason="Select a commodity first. The catalogue is not available yet."
        >
          Explore mandis for selected commodity
        </UnavailableAction>
      </div>
    </div>
  );
}
