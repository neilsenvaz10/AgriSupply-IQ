import { useState } from 'react';
import { RegistrySelect, SegmentedControl, Disclosure } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Breadcrumbs,
  Card,
  LinkButton,
  PageHeader,
  PreviewBadge,
  SkeletonCard,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useHarvestAllocation } from '../services/agri';

const STRATEGIES = [
  { value: 'conservative', label: 'Conservative', caption: 'Safest' },
  { value: 'balanced', label: 'Balanced', caption: 'Middle path' },
  { value: 'aggressive', label: 'Aggressive', caption: 'Max profit' },
];

const KPIS = [
  { label: 'Total net realized earnings', icon: 'currency_rupee' },
  { label: 'Crash-risk exposure', icon: 'shield' },
  { label: 'Logistics and waste', icon: 'local_shipping' },
];

/** Smart Harvest Allocation (Stitch: smart_harvest_allocation). */
export function AllocatePage() {
  useDocumentTitle('Harvest allocation');
  const allocation = useHarvestAllocation();
  const [strategy, setStrategy] = useState('balanced');

  return (
    <div className="flex flex-col gap-space-md">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: 'Plan' },
          { label: 'Harvest allocation' },
        ]}
      />
      <PageHeader
        icon="pie_chart"
        title="Optimal Harvest Distribution"
        subtitle="Split a harvest across mandis to protect net returns from a single-market glut."
        badge={<PreviewBadge>UI preview: data unavailable</PreviewBadge>}
      />

      <Card aria-labelledby="lot-heading" className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
        <h2 id="lot-heading" className="sr-only">
          Harvest lot
        </h2>
        <RegistrySelect label="Commodity" placeholder="Select a commodity" />
        <RegistrySelect label="Farm location" placeholder="Select an origin" />
      </Card>

      <section aria-labelledby="strategy-heading" className="flex flex-col gap-space-xs">
        <h2
          id="strategy-heading"
          className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant"
        >
          Allocation strategy
        </h2>
        <SegmentedControl
          label="Allocation strategy"
          name="strategy"
          options={STRATEGIES}
          value={strategy}
          onChange={setStrategy}
        />
        <p className="font-label-xs text-label-xs text-on-surface-variant">
          Your choice is kept for when the allocation engine is connected. It does not change
          anything yet.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card aria-labelledby="split-heading" className="flex flex-col items-center gap-3">
            <h2
              id="split-heading"
              className="self-start font-headline-sm text-headline-sm font-extrabold"
            >
              Dispatch split
            </h2>
            <div
              className="relative h-40 w-40"
              role="img"
              aria-label="Allocation chart: no allocation available"
            >
              <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#eceeec" strokeWidth="5" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center font-label-md text-label-md text-outline">
                —<span className="font-label-xs text-label-xs">no allocation</span>
              </div>
            </div>
            <DataState state={allocation} icon="pie_chart">
              {() => null}
            </DataState>
          </Card>

          <dl className="grid grid-cols-1 gap-space-sm sm:grid-cols-3 lg:grid-cols-1">
            {KPIS.map((kpi) => (
              <div
                key={kpi.label}
                className="flex flex-col rounded-2xl bg-surface-container-lowest p-4 shadow-sm"
              >
                <dt className="font-label-xs text-label-xs font-bold uppercase text-on-surface-variant">
                  {kpi.label}
                </dt>
                <dd className="font-metric-lg text-metric-lg text-outline">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">Not available</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <section
          aria-labelledby="allocations-heading"
          className="flex flex-col gap-space-sm lg:col-span-7"
        >
          <h2 id="allocations-heading" className="font-headline-sm text-headline-sm font-extrabold">
            Mandi allocations
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Per-mandi quantities, with gross value, transport, spoilage and net return, appear here
            as adjustable sliders once an allocation exists.
          </p>
          <div className="grid gap-space-sm opacity-70" aria-hidden="true">
            <SkeletonCard lines={3} />
            <SkeletonCard lines={3} />
          </div>
          <Disclosure title="Why this allocation?" icon="lightbulb">
            <p>
              Each recommended split will come with plain-language reasons tied to the verified data
              it used. No explanation is shown without an allocation behind it.
            </p>
          </Disclosure>
        </section>
      </div>

      <div className="mx-auto grid w-full max-w-2xl grid-cols-1 gap-space-sm sm:grid-cols-2">
        <UnavailableAction
          icon="qr_code_2"
          reason="Requires a computed allocation. Gate passes are not available."
        >
          Accept and generate gate passes
        </UnavailableAction>
        <LinkButton to="/simulate" variant="tonal" icon="science">
          Simulate what-if scenarios
        </LinkButton>
      </div>
    </div>
  );
}
