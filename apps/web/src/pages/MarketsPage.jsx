import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataQualityPanel } from '../components/market/DataQualityPanel';
import {
  Chip,
  DistrictLine,
  HistoricalBadge,
  LoadMore,
  MandiObservationCard,
  VerificationChip,
  WindowControls,
} from '../components/market/historical';
import { LatestByMandiView } from '../components/market/LatestByMandiView';
import { StatePricesView } from '../components/market/StatePricesView';
import { Dialog } from '../components/ui/Dialog';
import { MaterialIcon } from '../components/ui/MaterialIcon';
import { RegistrySelect, SearchField } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Card,
  EmptyState,
  PageHeader,
  SkeletonCard,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import {
  useCommodityCatalogue,
  useCoverage,
  useDistricts,
  useMandiObservations,
  useMarketDetail,
  useMarketDirectory,
  useStates,
} from '../services/agri';
import { addDays, formatCount, formatDate } from '../services/agri/format';
import { MAX_RANGE_DAYS, spanDays } from '../services/agri/historical';

const WINDOW_DAYS = 90;
const DISTRICT_STATUS = [
  { value: 'resolved', label: 'District resolved' },
  { value: 'unresolved', label: 'District not resolved' },
];

/** Search text, applied to the server only after the user pauses typing. */
function useDebounced(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** One market in the directory, with its verification and district status shown as the API states them. */
function MarketCard({ market, selected, onSelect }) {
  return (
    <article
      className={`flex flex-col gap-2 rounded-2xl p-space-sm shadow-sm ${
        selected ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-label-md text-label-md font-bold">{market.name}</h3>
          <p
            className={`font-label-xs text-label-xs ${selected ? 'text-on-primary-container' : 'text-on-surface-variant'}`}
          >
            {market.state.name} ·{' '}
            <DistrictLine
              district={market.district}
              district_status={market.district_status}
              source_district_label={market.source_district_label}
            />
          </p>
        </div>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`${selected ? 'Selected' : 'View prices'} for ${market.name}`}
          onClick={() => onSelect(market.id)}
          className={`min-h-[44px] shrink-0 rounded-xl px-space-md font-label-md text-label-md font-bold ${
            selected
              ? 'bg-secondary-fixed text-on-secondary-fixed'
              : 'bg-surface-container-high text-on-surface'
          }`}
        >
          {selected ? 'Selected' : 'View prices'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        <VerificationChip status={market.verification_status} />
        {market.district_status === 'unresolved' ? (
          <Chip icon="location_off" tone="caution">
            District unresolved
          </Chip>
        ) : null}
      </div>
    </article>
  );
}

/** Nationwide Market Explorer (Stitch: nationwide_market_explorer). */
export function MarketsPage() {
  useDocumentTitle('Explore markets');
  const [params] = useSearchParams();
  const [query, setQuery] = useState('');
  const search = useDebounced(query.trim());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stateId, setStateId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [districtStatus, setDistrictStatus] = useState('');
  const [commodityId, setCommodityId] = useState(params.get('commodity') ?? '');
  const [marketId, setMarketId] = useState('');
  const [view, setView] = useState('mandi');
  const [windowEdit, setWindowEdit] = useState(
    /** @type {{ from: string, to: string } | null} */ (null),
  );

  const coverage = useCoverage();
  const states = useStates();
  const districts = useDistricts(stateId);
  const catalogue = useCommodityCatalogue();
  const directory = useMarketDirectory({ stateId, districtId, districtStatus, q: search });
  const marketDetail = useMarketDetail(marketId);

  const mandiCommodities = useMemo(
    () =>
      catalogue.status === 'ready'
        ? catalogue.data.items.filter((c) => c.coverage.mandi_daily.observations > 0)
        : [],
    [catalogue],
  );
  const commodity = mandiCommodities.find((c) => c.id === commodityId) ?? null;

  // The latest day with data for the current selection: the market's own, else the commodity's,
  // else the dataset's. Nothing is assumed: while unknown, no price request is made.
  const marketLast =
    marketId && marketDetail.status === 'ready'
      ? marketDetail.data.coverage.mandi_daily.last_date
      : null;
  const commodityLast = commodity?.coverage.mandi_daily.last_date ?? null;
  const datasetLast =
    coverage.status === 'ready' ? coverage.data.coverage.granularities.mandi_daily.last_date : null;

  // The END OF THE DEFAULT WINDOW. It is only a convenient place to start looking; it is not a
  // claim that anything was observed on that day.
  const windowEnd = marketId
    ? marketLast && commodityLast && commodityLast < marketLast
      ? commodityLast
      : marketLast
    : (commodityLast ?? datasetLast);

  // The LATEST DAY, offered as a shortcut, only when the API's summary data proves it for exactly the
  // active filters: a commodity on its own (its coverage `last_date`) or a market on its own (its
  // coverage `last_date`). With a state filter, or a market AND a commodity together, the summary
  // data cannot say which day was the latest for that combination, so no shortcut is offered (a
  // wrong day would give an empty list). Nothing is guessed from the dataset-wide maximum.
  const latestDay = marketId ? (commodity ? null : marketLast) : stateId ? null : commodityLast;
  const defaultWindow = windowEnd
    ? { from: addDays(windowEnd, -(WINDOW_DAYS - 1)), to: windowEnd }
    : null;
  const win = windowEdit ?? defaultWindow;
  const windowValid = Boolean(
    win && win.from && win.to && win.from <= win.to && spanDays(win.from, win.to) <= MAX_RANGE_DAYS,
  );
  const wantsPrices = Boolean(marketId || commodityId || stateId);
  const noObservationsForMarket =
    marketId &&
    marketDetail.status === 'ready' &&
    marketDetail.data.coverage.mandi_daily.observations === 0;

  const observations = useMandiObservations(
    { marketId, commodityId, stateId, from: win?.from ?? '', to: win?.to ?? '' },
    {
      enabled: wantsPrices && windowValid && !noObservationsForMarket,
      unavailableReason: 'Choose a market, commodity or state to see historical mandi prices.',
    },
  );

  const cov = coverage.status === 'ready' ? coverage.data.coverage : null;
  const selectedMarket = directory.items.find((m) => m.id === marketId) ?? null;
  const resetSelection = () => {
    setMarketId('');
    setWindowEdit(null);
  };

  const stateOptions =
    states.status === 'ready' ? states.data.items.map((s) => ({ value: s.id, label: s.name })) : [];
  const commodityOptions = mandiCommodities.map((c) => ({ value: c.id, label: c.name }));
  const districtOptions =
    districts.status === 'ready'
      ? districts.data.items.map((d) => ({ value: d.id, label: d.name }))
      : [];

  const filterFields = (
    <>
      <RegistrySelect
        label="State"
        placeholder="All states"
        unavailable={states.status !== 'ready'}
        options={stateOptions}
        value={stateId}
        onChange={(value) => {
          setStateId(value);
          setDistrictId('');
          resetSelection();
        }}
      />
      <RegistrySelect
        label="District"
        placeholder={stateId ? 'All districts' : 'Choose a state first'}
        unavailable={districts.status !== 'ready'}
        options={districtOptions}
        value={districtId}
        onChange={(value) => {
          setDistrictId(value);
          resetSelection();
        }}
      />
      <RegistrySelect
        label="District status"
        placeholder="Any district status"
        unavailable={false}
        options={DISTRICT_STATUS}
        value={districtStatus}
        onChange={(value) => {
          setDistrictStatus(value);
          resetSelection();
        }}
      />
      <RegistrySelect
        label="Commodity"
        placeholder="All commodities"
        unavailable={catalogue.status !== 'ready'}
        options={commodityOptions}
        value={commodityId}
        onChange={(value) => {
          setCommodityId(value);
          setWindowEdit(null);
        }}
      />
    </>
  );

  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        icon="storefront"
        title="Nationwide Explorer"
        subtitle="Historical price discovery across Indian mandis, from imported historical files."
        badge={<HistoricalBadge />}
        action={
          view === 'mandi' ? (
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface"
            >
              <MaterialIcon name="tune" />
              <span className="sr-only">Open filters</span>
            </button>
          ) : undefined
        }
      />

      <div role="tablist" aria-label="Price level" className="flex flex-wrap gap-space-xs">
        {[
          ['mandi', 'Mandi prices'],
          ['latest', 'Latest by mandi'],
          ['state', 'State-level prices'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`market-tab-${value}`}
            aria-selected={view === value}
            aria-controls="market-view-panel"
            onClick={() => setView(value)}
            className={`min-h-[44px] rounded-full px-4 font-label-md text-label-md font-bold ${
              view === value
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id="market-view-panel"
        aria-labelledby={`market-tab-${view}`}
        className="flex flex-col gap-space-md"
      >
        {view === 'latest' ? (
          <LatestByMandiView
            coverage={cov}
            states={states}
            catalogue={catalogue}
            initialCommodityId={commodityId}
          />
        ) : view === 'state' ? (
          <StatePricesView coverage={cov} states={states} catalogue={catalogue} />
        ) : (
          <>
            <SearchField
              label="Search mandis by name"
              placeholder="Search mandi by name…"
              value={query}
              onChange={(value) => {
                setQuery(value);
                resetSelection();
              }}
              hint="Searches market names. Use the filters for state, district and commodity."
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
              <RegistrySelect
                label="State"
                placeholder="All states"
                unavailable={states.status !== 'ready'}
                options={stateOptions}
                value={stateId}
                onChange={(value) => {
                  setStateId(value);
                  setDistrictId('');
                  resetSelection();
                }}
              />
              <RegistrySelect
                label="Commodity"
                placeholder="All commodities"
                unavailable={catalogue.status !== 'ready'}
                options={commodityOptions}
                value={commodityId}
                onChange={(value) => {
                  setCommodityId(value);
                  setWindowEdit(null);
                }}
              />
            </div>
            {catalogue.status === 'ready' ? (
              <p className="font-label-xs text-label-xs text-on-surface-variant">
                Only {mandiCommodities.length} of {catalogue.data.items.length} commodities have
                mandi-level observations; the others have state-level data only (see Commodities).
              </p>
            ) : null}

            <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
              <div className="flex flex-col gap-space-md lg:col-span-5">
                <Card aria-labelledby="map-heading" className="flex flex-col gap-3">
                  <h2 id="map-heading" className="font-headline-sm text-headline-sm font-extrabold">
                    Coverage map
                  </h2>
                  <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl bg-surface-container-low text-center">
                    <MaterialIcon name="map" className="text-[40px] text-outline" />
                    <p className="max-w-xs px-space-md font-body-sm text-body-sm text-on-surface-variant">
                      The map needs the market directory with verified locations. No market is
                      verified yet.
                    </p>
                  </div>
                  <dl className="grid grid-cols-3 gap-2">
                    {[
                      ['Mandis (all unverified)', cov ? formatCount(cov.registry.markets) : null],
                      [
                        'Commodities with mandi prices',
                        cov ? formatCount(cov.granularities.mandi_daily.commodities) : null,
                      ],
                      ['Average turnover', null],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex flex-col rounded-xl bg-surface-container-low p-2.5 text-center"
                      >
                        <dt className="font-label-xs text-label-xs text-on-surface-variant">
                          {label}
                        </dt>
                        <dd
                          className={`font-metric-md text-metric-md ${value ? 'text-on-surface' : 'text-outline'}`}
                        >
                          {value ?? (
                            <>
                              <span aria-hidden="true">—</span>
                              <span className="sr-only">Not available</span>
                            </>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                <Card aria-labelledby="health-heading" className="flex flex-col gap-2">
                  <h2
                    id="health-heading"
                    className="font-headline-sm text-headline-sm font-extrabold"
                  >
                    Data coverage
                  </h2>
                  {cov ? (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      Historical files, not a live feed. Mandi observations run from{' '}
                      {formatDate(cov.granularities.mandi_daily.first_date)} to{' '}
                      {formatDate(cov.granularities.mandi_daily.last_date)} (
                      {formatCount(cov.granularities.mandi_daily.observations)} observations in{' '}
                      {cov.granularities.mandi_daily.states} states).{' '}
                      {formatCount(cov.geography.markets_with_unresolved_district)} mandis have a
                      district that could not be resolved.
                    </p>
                  ) : (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      {coverage.status === 'error'
                        ? coverage.reason
                        : 'Loading the coverage of the historical files…'}
                    </p>
                  )}
                  <div
                    className="h-3 w-full rounded-full bg-surface-container-high"
                    aria-hidden="true"
                  />
                </Card>
              </div>

              <section
                aria-labelledby="hubs-heading"
                className="flex flex-col gap-space-sm lg:col-span-7"
              >
                <div className="flex items-center justify-between">
                  <h2
                    id="hubs-heading"
                    className="font-headline-sm text-headline-sm font-extrabold"
                  >
                    Market hubs
                  </h2>
                  <span className="font-label-xs text-label-xs font-bold text-outline">
                    Showing {directory.items.length}
                  </span>
                </div>
                <DataState
                  state={{
                    status: directory.status,
                    data: directory.items,
                    reason: directory.reason,
                    needs: '',
                    retry: directory.retry,
                  }}
                  icon="storefront"
                  skeleton={
                    <div className="grid gap-space-sm">
                      <SkeletonCard lines={2} />
                      <SkeletonCard lines={2} />
                    </div>
                  }
                >
                  {(items) =>
                    items.length === 0 ? (
                      <EmptyState icon="search_off" message="No mandi matches these filters." />
                    ) : (
                      <div className="flex flex-col gap-space-sm">
                        {items.map((m) => (
                          <MarketCard
                            key={m.id}
                            market={m}
                            selected={m.id === marketId}
                            onSelect={(id) => {
                              setMarketId(id === marketId ? '' : id);
                              setWindowEdit(null);
                            }}
                          />
                        ))}
                        <LoadMore pager={directory} noun="mandis" />
                      </div>
                    )
                  }
                </DataState>

                <Card aria-labelledby="prices-heading" className="flex flex-col gap-space-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2
                      id="prices-heading"
                      className="font-headline-sm text-headline-sm font-extrabold"
                    >
                      Historical mandi prices
                    </h2>
                    <HistoricalBadge>Mandi-level · not live</HistoricalBadge>
                  </div>
                  <p className="font-label-xs text-label-xs text-on-surface-variant">
                    {selectedMarket ? `Market: ${selectedMarket.name}. ` : ''}
                    {commodity ? `Commodity: ${commodity.name}. ` : ''}
                    Prices are modal prices in INR per quintal; the file states no unit, so the unit
                    is an assumption. State-level prices are never used to fill missing mandi
                    prices.
                  </p>
                  {latestDay ? (
                    <p className="font-label-xs text-label-xs text-on-surface-variant">
                      Latest available observation for this selection:{' '}
                      <time dateTime={latestDay}>{formatDate(latestDay)}</time> (historical files,
                      not live).
                    </p>
                  ) : wantsPrices && windowEnd ? (
                    <p className="font-label-xs text-label-xs text-on-surface-variant">
                      The latest day for this exact combination of filters is not available from the
                      API’s summary data, so no “latest day” shortcut is offered; the default window
                      ends at <time dateTime={windowEnd}>{formatDate(windowEnd)}</time>. Set the
                      dates to look elsewhere.
                      {marketLast && commodityLast && marketLast < commodityLast
                        ? ` This mandi has no observations after ${formatDate(marketLast)} (any commodity); the latest day for ${commodity?.name} in the files is ${formatDate(commodityLast)}.`
                        : ''}
                    </p>
                  ) : null}
                  {win ? (
                    <WindowControls
                      from={win.from}
                      to={win.to}
                      onChange={setWindowEdit}
                      minDate={cov?.granularities.mandi_daily.first_date}
                      maxDate={cov?.granularities.mandi_daily.last_date}
                      latestDay={latestDay}
                      onReset={() => setWindowEdit(null)}
                    />
                  ) : null}
                  {noObservationsForMarket ? (
                    <EmptyState
                      icon="event_busy"
                      message="This mandi has no mandi-level observations in the historical files. No other price is shown in its place."
                    />
                  ) : (
                    <DataState
                      state={{
                        status: observations.status,
                        data: observations.items,
                        reason: observations.reason,
                        needs: '',
                        retry: observations.retry,
                      }}
                      icon="payments"
                      skeleton={
                        <div className="grid gap-space-sm">
                          <SkeletonCard lines={2} />
                          <SkeletonCard lines={2} />
                        </div>
                      }
                    >
                      {(rows) =>
                        rows.length === 0 ? (
                          <EmptyState
                            icon="event_busy"
                            message={`No mandi observations exist for these filters between ${formatDate(win?.from)} and ${formatDate(win?.to)}. State-level prices are not shown in their place.`}
                          />
                        ) : (
                          <div className="flex flex-col gap-space-sm">
                            {rows.map((row) => (
                              <MandiObservationCard key={row.id} row={row} />
                            ))}
                            <LoadMore pager={observations} noun="observations" />
                          </div>
                        )
                      }
                    </DataState>
                  )}
                </Card>
              </section>
            </div>

            <div className="mx-auto w-full max-w-md">
              <UnavailableAction
                icon="compare_arrows"
                reason="Comparing mandis needs verified markets and cost and forecast inputs, which do not exist yet."
              >
                Compare selected mandis (0)
              </UnavailableAction>
            </div>
          </>
        )}
      </div>

      <DataQualityPanel
        coverage={cov}
        states={states.status === 'ready' ? states.data.items : []}
      />

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
            message="Filters use the state, district and commodity registries. Districts depend on the chosen state; mandis whose district is unresolved are found with the district status filter."
          />
          {filterFields}
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
