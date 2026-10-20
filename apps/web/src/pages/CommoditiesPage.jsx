import { useMemo, useState } from 'react';
import { HistoricalBadge, Chip } from '../components/market/historical';
import { RegistrySelect, SearchField, Disclosure } from '../components/ui/controls';
import { DataState } from '../components/ui/DataState';
import {
  Card,
  EmptyState,
  LinkButton,
  PageHeader,
  SkeletonCard,
  UnavailableAction,
} from '../components/ui/primitives';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useCommodityCatalogue } from '../services/agri';
import { TIER_LABEL, coverageTier, formatCount, formatRange } from '../services/agri/format';

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

const PAGE = 25;

const COVERAGE_FILTERS = [
  ['all', 'Any coverage'],
  ['mandi', 'Mandi-level'],
  ['state', 'State-level only'],
  ['none', 'No price data'],
];

/** The coverage of one commodity at each granularity, kept separate. */
function CoverageLines({ commodity }) {
  const c = commodity.coverage;
  const rows = [
    ['Mandi-level daily', c.mandi_daily],
    ['State-level daily', c.state_daily],
    ['National monthly', c.national_monthly],
  ];
  return (
    <ul className="flex flex-col gap-0.5 font-label-xs text-label-xs text-on-surface-variant">
      {rows.map(([label, cov]) => (
        <li key={label}>
          <span className="font-semibold">{label}:</span>{' '}
          {cov.observations > 0
            ? `${formatCount(cov.observations)} observations, ${formatRange(cov)}`
            : 'none'}
        </li>
      ))}
    </ul>
  );
}

function CommodityCard({ commodity }) {
  const tier = coverageTier(commodity);
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-space-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-label-md text-label-md font-bold text-on-surface">{commodity.name}</h3>
        <div className="flex flex-wrap gap-1">
          {commodity.commodity_group ? <Chip>{commodity.commodity_group}</Chip> : null}
          <Chip
            icon={tier === 'mandi' ? 'storefront' : 'public'}
            tone={tier === 'mandi' ? 'neutral' : 'caution'}
          >
            {TIER_LABEL[tier]}
          </Chip>
        </div>
      </div>
      <CoverageLines commodity={commodity} />
    </article>
  );
}

/** Explore Commodities (Stitch: all_crop_commodity_explorer). */
export function CommoditiesPage() {
  useDocumentTitle('Commodities');
  const catalogue = useCommodityCatalogue();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [coverage, setCoverage] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [shown, setShown] = useState(PAGE);

  const items = useMemo(
    () => (catalogue.status === 'ready' ? catalogue.data.items : []),
    [catalogue],
  );
  const groups = useMemo(
    () => [...new Set(items.map((c) => c.commodity_group).filter(Boolean))].sort(),
    [items],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q)) &&
        (!group || c.commodity_group === group) &&
        (coverage === 'all' || coverageTier(c) === coverage),
    );
  }, [items, query, group, coverage]);
  const counts = useMemo(() => {
    const out = { mandi: 0, state: 0, national: 0, none: 0 };
    for (const c of items) out[coverageTier(c)] += 1;
    return out;
  }, [items]);
  const selected = items.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader
        icon="grass"
        title="Explore Commodities"
        subtitle="All-India agricultural commodity directory and observed price coverage."
        badge={<HistoricalBadge />}
      />

      <SearchField
        label="Search commodities"
        placeholder="Search commodities across India…"
        value={query}
        onChange={(value) => {
          setQuery(value);
          setShown(PAGE);
        }}
        hint={
          catalogue.status === 'ready' && query.trim()
            ? `${filtered.length} of ${items.length} commodities match`
            : undefined
        }
      />

      <div className="flex flex-wrap gap-space-xs" role="group" aria-label="Category">
        {[['', 'All crops'], ...groups.map((g) => [g, g])].map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={group === value}
            onClick={() => {
              setGroup(value);
              setShown(PAGE);
            }}
            className={`rounded-full px-4 py-2 font-label-md text-label-md font-bold ${
              group === value
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {label}
          </button>
        ))}
        {catalogue.status !== 'ready' ? (
          <span className="self-center font-label-xs text-label-xs text-on-surface-variant">
            Categories load from the commodity catalogue.
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-space-xs" role="group" aria-label="Observed coverage">
        {COVERAGE_FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={coverage === value}
            onClick={() => {
              setCoverage(value);
              setShown(PAGE);
            }}
            className={`rounded-full px-4 py-2 font-label-md text-label-md font-bold ${
              coverage === value
                ? 'bg-primary-container text-on-primary'
                : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-space-md lg:grid-cols-12">
        <div className="flex flex-col gap-space-md lg:col-span-5">
          <Card aria-labelledby="spotlight-heading" className="flex flex-col gap-3">
            <h2 id="spotlight-heading" className="font-headline-sm text-headline-sm font-extrabold">
              Spotlight
            </h2>
            {selected ? (
              <div className="flex flex-col gap-2">
                <p className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  {selected.name}
                </p>
                <Chip
                  icon="storefront"
                  tone={coverageTier(selected) === 'mandi' ? 'neutral' : 'caution'}
                >
                  {TIER_LABEL[coverageTier(selected)]}
                </Chip>
                <CoverageLines commodity={selected} />
                <p className="font-label-xs text-label-xs text-on-surface-variant">
                  Historical files only; coverage is what was observed, not a statement about
                  forecasting eligibility.
                </p>
              </div>
            ) : (
              <EmptyState
                icon="grass"
                message="A commodity spotlight appears once a commodity is selected from the catalogue."
              />
            )}
            <RegistrySelect
              label="Commodity"
              placeholder="Select a commodity"
              unavailable={catalogue.status !== 'ready'}
              options={items.map((c) => ({ value: c.id, label: c.name }))}
              value={selectedId}
              onChange={setSelectedId}
            />
          </Card>

          <Disclosure title="Algorithmic readiness index" icon="verified" defaultOpen>
            <p>
              Every commodity and market series will be assigned a capability tier from measurable
              criteria (history, continuity, freshness) and backtesting, never from a whitelist. No
              tier has been assigned yet: the coverage shown here is observed history only and says
              nothing about forecasting eligibility.
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
            <span className="font-label-xs text-label-xs font-bold text-outline">
              Showing {Math.min(shown, filtered.length)} of {items.length}
            </span>
          </div>
          <DataState
            state={catalogue}
            icon="grass"
            skeleton={
              <div className="grid gap-space-sm">
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
                <SkeletonCard lines={1} />
              </div>
            }
          >
            {(data) => (
              <div className="flex flex-col gap-space-sm">
                <p className="font-label-xs text-label-xs text-on-surface-variant">
                  {formatCount(counts.mandi)} of {formatCount(data.items.length)} commodities have
                  mandi-level observations; {formatCount(counts.state)} have state-level
                  observations only
                  {counts.national ? `; ${formatCount(counts.national)} national monthly only` : ''}
                  ; {formatCount(counts.none)} have no price observations. State-level data is never
                  shown as mandi-level.
                </p>
                {data.truncated ? (
                  <p role="alert" className="font-label-xs text-label-xs text-error">
                    The catalogue is larger than one page; only the first page is shown.
                  </p>
                ) : null}
                {filtered.length === 0 ? (
                  <EmptyState icon="search_off" message="No commodity matches these filters." />
                ) : (
                  filtered.slice(0, shown).map((c) => <CommodityCard key={c.id} commodity={c} />)
                )}
                {shown < filtered.length ? (
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE)}
                    className="min-h-[44px] self-center rounded-xl bg-surface-container-high px-space-lg font-label-md text-label-md font-bold text-on-surface"
                  >
                    Show more commodities
                  </button>
                ) : null}
              </div>
            )}
          </DataState>
        </section>
      </div>

      <div className="mx-auto w-full max-w-md">
        {selected && coverageTier(selected) === 'mandi' ? (
          <LinkButton to={`/markets?commodity=${selected.id}`} icon="storefront" className="w-full">
            Explore mandis for selected commodity
          </LinkButton>
        ) : (
          <UnavailableAction
            icon="storefront"
            reason={
              selected
                ? 'This commodity has no mandi-level observations, so there are no mandis to explore for it.'
                : catalogue.status === 'ready'
                  ? 'Select a commodity with mandi-level observations first.'
                  : 'Select a commodity first. The catalogue is not loaded yet.'
            }
          >
            Explore mandis for selected commodity
          </UnavailableAction>
        )}
      </div>
    </div>
  );
}
