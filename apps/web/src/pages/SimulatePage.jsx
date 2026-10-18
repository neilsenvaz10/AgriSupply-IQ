import { useId, useState } from 'react';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { RegistrySelect } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Breadcrumbs,
  Card,
  PageHeader,
  PreviewBadge,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScenarioResult } from '../services/agri';

/**
 * Lever definitions. The ranges are input limits of the control, not market data. A lever value is
 * a hypothetical the user chooses; it is never turned into a price or payout in the browser.
 */
const LEVERS = [
  {
    id: 'freight',
    label: 'Freight / diesel tariff',
    icon: 'local_shipping',
    min: -15,
    max: 25,
    minLabel: 'Subsidy',
    maxLabel: 'Extreme hike',
  },
  {
    id: 'price',
    label: 'Mandi spot price shift',
    icon: 'trending_down',
    min: -20,
    max: 15,
    minLabel: 'Crash',
    maxLabel: 'Rally',
  },
  {
    id: 'storage',
    label: 'Storage and moisture decay',
    icon: 'warehouse',
    min: 0,
    max: 7,
    minLabel: 'Direct sale',
    maxLabel: 'Warehouse max',
    unit: 'days',
  },
];

/** Scenario presets set lever positions only (they are not data). */
const PRESETS = [
  { id: 'fuel', label: 'Fuel hike', icon: 'local_gas_station', values: { freight: 20 } },
  { id: 'crash', label: 'Price crash', icon: 'trending_down', values: { price: -10 } },
  { id: 'hold', label: 'Hold in storage', icon: 'warehouse', values: { storage: 5 } },
];

const BASELINE = { freight: 0, price: 0, storage: 0 };

function formatValue(lever, value) {
  if (lever.unit === 'days') return `${value} ${value === 1 ? 'day' : 'days'}`;
  return `${value > 0 ? '+' : ''}${value}%`;
}

function Lever({ lever, value, onChange }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="flex items-center gap-2 font-label-md text-label-md font-bold"
        >
          <MaterialIcon name={lever.icon} className="text-[20px] text-primary" />
          {lever.label}
        </label>
        <output
          htmlFor={id}
          className="rounded-lg bg-surface-container-high px-2 py-1 font-label-md text-label-md font-bold tabular-nums"
        >
          {formatValue(lever, value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={lever.min}
        max={lever.max}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-valuetext={formatValue(lever, value)}
        className="h-2 w-full cursor-pointer accent-primary"
      />
      <div className="flex justify-between font-label-xs text-label-xs text-on-surface-variant">
        <span>
          {formatValue(lever, lever.min)} ({lever.minLabel})
        </span>
        <span>
          {formatValue(lever, lever.max)} ({lever.maxLabel})
        </span>
      </div>
    </div>
  );
}

/** What-If Decision Simulator (Stitch: what_if_market_simulator). */
export function SimulatePage() {
  useDocumentTitle('What-if simulator');
  const result = useScenarioResult();
  const [levers, setLevers] = useState(BASELINE);
  const changed = Object.keys(BASELINE).some((key) => levers[key] !== BASELINE[key]);

  const setLever = (id, value) => setLevers((current) => ({ ...current, [id]: value }));
  const applyPreset = (preset) => setLevers({ ...BASELINE, ...preset.values });

  return (
    <div className="flex flex-col gap-space-md">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', to: '/dashboard' },
          { label: 'Plan' },
          { label: 'What-if simulator' },
        ]}
      />
      <PageHeader
        icon="tune"
        title="What-If Decision Simulator"
        subtitle="Test freight, price and storage changes on a harvest plan before dispatch."
        badge={<PreviewBadge>UI preview: simulation not connected</PreviewBadge>}
      />

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-6">
          <Card aria-labelledby="baseline-heading" className="flex flex-col gap-3">
            <h2 id="baseline-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Baseline harvest lot
            </h2>
            <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
              <RegistrySelect label="Commodity" placeholder="Select a commodity" />
              <RegistrySelect label="Route" placeholder="Select an origin and market" />
            </div>
            <div className="rounded-xl bg-surface-container-low p-space-sm">
              <p className="font-label-xs text-label-xs font-bold uppercase text-on-surface-variant">
                Current baseline realization
              </p>
              <p className="font-metric-xl-mobile text-metric-xl-mobile text-outline">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Not available</span>
              </p>
            </div>
          </Card>

          <section aria-labelledby="presets-heading" className="flex flex-col gap-space-xs">
            <h2
              id="presets-heading"
              className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant"
            >
              Quick scenario presets
            </h2>
            <div className="flex flex-wrap gap-space-xs">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-surface-container-high px-4 font-label-md text-label-md text-on-surface"
                >
                  <MaterialIcon name={preset.icon} className="text-[18px]" />
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          <Card aria-labelledby="levers-heading" className="flex flex-col gap-space-md">
            <h2 id="levers-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Scenario levers
            </h2>
            {LEVERS.map((lever) => (
              <Lever
                key={lever.id}
                lever={lever}
                value={levers[lever.id]}
                onChange={(value) => setLever(lever.id, value)}
              />
            ))}
          </Card>
        </div>

        <div className="flex flex-col gap-space-md lg:col-span-6">
          <Card aria-labelledby="impact-heading" className="flex flex-col gap-3">
            <h2 id="impact-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Payout impact analysis
            </h2>
            <DataState state={result} icon="balance">
              {() => null}
            </DataState>
            <p className="font-label-xs text-label-xs text-on-surface-variant">
              Your chosen levers are shown on the left only. They are not converted into a payout
              because no simulation engine is connected.
            </p>
          </Card>

          <UnavailableAction icon="bolt" reason="Multi-mandi optimization is not available yet.">
            Run full multi-mandi optimization
          </UnavailableAction>
          <button
            type="button"
            onClick={() => setLevers(BASELINE)}
            disabled={!changed}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-surface-container-high px-space-lg font-label-md text-label-md font-bold text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MaterialIcon name="restart_alt" className="text-[18px]" />
            Reset to baseline
          </button>
        </div>
      </div>
    </div>
  );
}
