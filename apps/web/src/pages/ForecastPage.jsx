import { useState } from 'react';
import { RegistrySelect, SegmentedControl, Disclosure } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Breadcrumbs,
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  PreviewBadge,
  Skeleton,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useForecast } from '../services/agri';

const HORIZONS = [
  { value: '1', label: '1-day', caption: 'ahead' },
  { value: '3', label: '3-day', caption: 'ahead' },
  { value: '7', label: '7-day', caption: 'trajectory' },
];

/** AI Price Forecasting (Stitch: ai_price_forecasting). */
export function ForecastPage() {
  useDocumentTitle('Price forecasting');
  const forecast = useForecast();
  const [horizon, setHorizon] = useState('7');

  return (
    <div className="flex flex-col gap-space-md">
      <Breadcrumbs
        items={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Price forecasting' }]}
      />
      <PageHeader
        icon="query_stats"
        title="AI Price Forecasting"
        subtitle="1 to 7 day price outlook for one commodity at one market, with its uncertainty."
        badge={
          <>
            <PreviewBadge>UI preview</PreviewBadge>
            <span className="inline-flex items-center rounded-full bg-surface-container-high px-2.5 py-1 font-label-xs text-label-xs font-bold text-on-surface-variant">
              No model loaded
            </span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-4">
          <Card aria-labelledby="selection-heading" className="flex flex-col gap-space-sm">
            <h2 id="selection-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Selection
            </h2>
            <RegistrySelect label="Commodity" placeholder="Select a commodity" />
            <RegistrySelect label="Market" placeholder="Select a market" />
            <SegmentedControl
              label="Forecast horizon"
              name="horizon"
              options={HORIZONS}
              value={horizon}
              onChange={setHorizon}
            />
          </Card>
        </div>

        <div className="flex flex-col gap-space-md lg:col-span-8">
          <Card aria-labelledby="projection-heading" className="flex flex-col gap-3">
            <h2
              id="projection-heading"
              className="font-headline-sm text-headline-sm font-extrabold"
            >
              Projected modal price
            </h2>
            <DataState
              state={forecast}
              icon="query_stats"
              skeleton={<Skeleton className="h-32 w-full" />}
            >
              {() => null}
            </DataState>
          </Card>

          <Card aria-labelledby="curve-heading" className="flex flex-col gap-3">
            <h2 id="curve-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Price trajectory curve
            </h2>
            <div
              className="relative h-44 w-full"
              role="img"
              aria-label="Forecast chart: no data available"
            >
              <svg
                className="h-full w-full"
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
                No forecast to plot
              </p>
            </div>
            <p className="font-label-xs text-label-xs text-on-surface-variant">
              The curve will show past observations and the forecast with its uncertainty band for
              the selected {horizon}-day horizon.
            </p>
          </Card>

          <EmptyState
            icon="tune"
            title="Key predictive drivers"
            message="Drivers (arrivals, logistics, weather) are listed here only when a validated forecast explains them."
          />

          <Disclosure title="How forecast eligibility works" icon="verified">
            <p>
              A market forecast is offered only for a series with sufficient historical data,
              adequate freshness and passing rolling-origin backtests against a baseline. Series
              that do not qualify show a lower capability tier or "unavailable" instead of a number.
              No model is trained or connected yet.
            </p>
          </Disclosure>

          <div className="grid grid-cols-1 gap-space-sm sm:grid-cols-2">
            <LinkButton to="/compare" icon="compare_arrows" variant="primary">
              Compare mandis
            </LinkButton>
            <UnavailableAction
              icon="notifications_active"
              variant="tonal"
              reason="Price alerts are not available yet."
            >
              Set price alert
            </UnavailableAction>
          </div>
        </div>
      </div>
    </div>
  );
}
