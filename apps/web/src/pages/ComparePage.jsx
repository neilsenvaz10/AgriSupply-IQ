import { useState } from 'react';
import { RegistrySelect, SegmentedControl, Disclosure } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Breadcrumbs,
  Card,
  EmptyState,
  PageHeader,
  PreviewBadge,
  SkeletonCard,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useMandiComparison } from '../services/agri';

const SORTS = [
  { value: 'net', label: 'Highest net return' },
  { value: 'distance', label: 'Shortest distance' },
  { value: 'risk', label: 'Lowest risk' },
  { value: 'window', label: 'Best window' },
];

/** Mandi Comparison and Arbitrage (Stitch: smart_mandi_comparison). */
export function ComparePage() {
  useDocumentTitle('Compare mandis');
  const comparison = useMandiComparison();
  const [sort, setSort] = useState('net');
  const [quantity, setQuantity] = useState('');

  return (
    <div className="flex flex-col gap-space-md">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: 'Plan' },
          { label: 'Compare mandis' },
        ]}
      />
      <PageHeader
        icon="compare_arrows"
        title="Mandi Comparison"
        subtitle="Compare mandis by net realization after transport, fees and spoilage."
        badge={<PreviewBadge>UI preview: data unavailable</PreviewBadge>}
      />

      <Card
        aria-labelledby="context-heading"
        className="grid grid-cols-1 gap-space-sm sm:grid-cols-3"
      >
        <h2 id="context-heading" className="sr-only">
          Comparison inputs
        </h2>
        <RegistrySelect label="Commodity" placeholder="Select a commodity" />
        <div className="flex flex-col gap-1">
          <label
            htmlFor="compare-quantity"
            className="font-label-xs text-label-xs font-bold uppercase tracking-wider text-on-surface-variant"
          >
            Quantity (quintals)
          </label>
          <input
            id="compare-quantity"
            type="number"
            inputMode="decimal"
            min="0"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder="Enter quantity"
            className="min-h-[48px] w-full rounded-xl bg-surface-container-lowest px-3 font-label-md text-label-md shadow-sm"
          />
        </div>
        <RegistrySelect label="Farm location" placeholder="Select an origin" />
      </Card>

      <SegmentedControl
        label="Sort mandis by"
        name="sort"
        options={SORTS}
        value={sort}
        onChange={setSort}
        compact
      />

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <section
          aria-labelledby="ranked-heading"
          className="flex flex-col gap-space-sm lg:col-span-7"
        >
          <h2 id="ranked-heading" className="font-headline-sm text-headline-sm font-extrabold">
            Ranked mandis
          </h2>
          <DataState state={comparison} icon="compare_arrows">
            {() => null}
          </DataState>
          <div className="grid gap-space-sm opacity-70" aria-hidden="true">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
        </section>

        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card aria-labelledby="matrix-heading" className="flex flex-col gap-3">
            <h2 id="matrix-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Arbitrage matrix
            </h2>
            <EmptyState
              icon="table_chart"
              message="A side-by-side table of gross rate, freight, spoilage, net return and risk appears when mandis can be compared."
            />
          </Card>
          <Card aria-labelledby="route-heading" className="flex flex-col gap-3">
            <h2 id="route-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Route map
            </h2>
            <EmptyState
              icon="route"
              message="Routes need verified market locations and a freight cost source."
            />
          </Card>
          <Disclosure title="Assumptions" icon="rule">
            <p>
              Net realization will be gross value minus modelled transport, mandi fees and spoilage.
              Every assumption will be shown with its source and date. Nothing is computed until
              verified inputs exist.
            </p>
          </Disclosure>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-space-sm sm:grid-cols-2">
        <UnavailableAction
          icon="local_shipping"
          reason="Booking and rate locking are not available. No freight service is connected."
        >
          Lock rate and route
        </UnavailableAction>
        <UnavailableAction
          icon="pie_chart"
          variant="tonal"
          reason="Splitting a lot needs the allocation engine."
        >
          Split allocation
        </UnavailableAction>
      </div>
    </div>
  );
}
