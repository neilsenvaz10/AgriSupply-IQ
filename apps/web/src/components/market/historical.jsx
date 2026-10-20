import { MaterialIcon } from '../ui/MaterialIcon';
import { describePrice, formatCount, formatDate, formatRupees } from '../../services/agri/format';
import { MAX_RANGE_DAYS, spanDays } from '../../services/agri/historical';

/**
 * Presentational pieces for historical market records. They use the existing Stitch tokens and
 * pill/card shapes, and render exactly what the API returned: labels, units, verification status
 * and geographic uncertainty are shown, never hidden or improved.
 */

/** Pill stating that data is a historical snapshot. Same shape as the "UI preview" pill. */
export function HistoricalBadge({ children = 'Historical data · not live' }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-secondary-container px-2.5 py-1 font-label-xs text-label-xs font-bold uppercase tracking-wide text-on-secondary-container">
      <MaterialIcon name="history" className="text-[14px]" />
      {children}
    </span>
  );
}

/** Small neutral chip. */
export function Chip({ icon = '', children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-surface-container-high text-on-surface-variant',
    caution: 'bg-tertiary-fixed text-on-tertiary-fixed-variant',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-label-xs text-label-xs font-semibold ${tones[tone]}`}
    >
      {icon ? <MaterialIcon name={icon} className="text-[13px]" /> : null}
      {children}
    </span>
  );
}

/** Market verification status exactly as the API states it (today: always "unverified"). */
export function VerificationChip({ status }) {
  const verified = status === 'verified';
  return (
    <Chip icon={verified ? 'verified' : 'help'} tone={verified ? 'neutral' : 'caution'}>
      {verified ? 'Verified market' : 'Unverified market'}
    </Chip>
  );
}

/**
 * District line for a market: the resolved district, or the unresolved label exactly as the source
 * file wrote it.
 *
 * @param {{ district: { name: string } | null, district_status: string, source_district_label?: string | null }} props
 */
export function DistrictLine({ district, district_status, source_district_label = null }) {
  if (district && district_status === 'resolved') {
    return <span>District: {district.name}</span>;
  }
  return (
    <span>
      District not resolved
      {source_district_label ? <> · source label “{source_district_label}”</> : null}
    </span>
  );
}

/** Flags a state mapping that is provisional, and shows the label the source used. */
export function StateMappingNote({ state, sourceLabel }) {
  const provisional = state.mapping_status === 'provisional';
  const differs =
    sourceLabel && sourceLabel.trim().toLowerCase() !== String(state.name).trim().toLowerCase();
  if (!provisional && !differs) return null;
  return (
    <Chip icon={provisional ? 'rule' : 'label'} tone={provisional ? 'caution' : 'neutral'}>
      {provisional ? 'Provisional state mapping' : 'Source label'}: “{sourceLabel}”
    </Chip>
  );
}

/**
 * One historical mandi observation (card). Shows the original unit and whether that unit is an
 * assumption, the observation date, the market identity with its verification status and the
 * source.
 *
 * @param {{ row: any }} props
 */
export function MandiObservationCard({ row }) {
  const price = describePrice(row);
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-space-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="break-words font-label-md text-label-md font-bold text-on-surface">
            {row.market.name}
          </h3>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            {row.commodity.name}
            {row.variety?.label ? ` · ${row.variety.label}` : ''}
            {row.grade ? ` · grade ${row.grade}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-metric-md text-metric-md font-bold text-on-surface">{price.amount}</p>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            modal price {price.unit}
            {price.assumed ? ' (unit assumed)' : ''}
          </p>
        </div>
      </div>
      <p className="font-label-xs text-label-xs text-on-surface-variant">
        Min {formatRupees(row.min_price)} · Max {formatRupees(row.max_price)} · Observed{' '}
        <time dateTime={row.observed_date}>{formatDate(row.observed_date)}</time>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
        <VerificationChip status={row.market.verification_status} />
        <StateMappingNote state={row.state} sourceLabel={row.source_labels.state} />
        <span>
          {row.state.name} ·{' '}
          <DistrictLine
            district={row.district}
            district_status={row.market.district_status}
            source_district_label={
              row.market.district_status === 'unresolved' ? row.source_labels.district : null
            }
          />
        </span>
      </div>
      <p className="font-label-xs text-label-xs text-outline">
        Source: {row.provenance.source_code} · file row {row.provenance.source_row_number} ·
        historical record, not a live price
      </p>
    </article>
  );
}

/**
 * "Load more" control for a cursor-paginated list, with the loaded count and a retryable error.
 *
 * @param {{ pager: { items: unknown[], pagination: { has_more: boolean } | null, loadingMore: boolean, moreError: string, loadMore: () => void }, noun: string }} props
 */
export function LoadMore({ pager, noun }) {
  const more = pager.pagination?.has_more === true;
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="font-label-xs text-label-xs text-on-surface-variant" aria-live="polite">
        Showing {pager.items.length} {noun}
        {more ? ' so far; more are available' : ': all that match'}
      </p>
      {pager.moreError ? (
        <p role="alert" className="font-label-xs text-label-xs text-error">
          {pager.moreError}
        </p>
      ) : null}
      {more ? (
        <button
          type="button"
          onClick={pager.loadMore}
          disabled={pager.loadingMore}
          className="min-h-[44px] rounded-xl bg-surface-container-high px-space-lg font-label-md text-label-md font-bold text-on-surface disabled:opacity-60"
        >
          {pager.loadingMore ? 'Loading…' : `Load more ${noun}`}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Plots historical observations as given: one point per observation, joined in date order. No
 * smoothing, no trend line, no change figure, no projection.
 *
 * @param {{ points: Array<{ id: string, date: string, value: number }>, unitLabel: string }} props
 */
export function PriceSeriesChart({ points, unitLabel }) {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = Date.parse(`${sorted[0].date}T00:00:00Z`);
  const t1 = Date.parse(`${sorted[sorted.length - 1].date}T00:00:00Z`);
  const values = sorted.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (date) =>
    t1 === t0 ? 160 : ((Date.parse(`${date}T00:00:00Z`) - t0) / (t1 - t0)) * 320;
  const y = (v) => (hi === lo ? 60 : 110 - ((v - lo) / (hi - lo)) * 100);
  const path = sorted
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(' ');
  return (
    <figure className="flex flex-col gap-1">
      <div
        className="relative h-40 w-full pt-2"
        role="img"
        aria-label={`Historical modal prices, ${sorted.length} observations from ${formatDate(sorted[0].date)} to ${formatDate(sorted[sorted.length - 1].date)}, between ${formatRupees(lo)} and ${formatRupees(hi)} ${unitLabel}`}
      >
        <svg
          className="h-full w-full overflow-visible"
          preserveAspectRatio="none"
          viewBox="0 0 320 120"
          aria-hidden="true"
        >
          {[20, 60, 100].map((gy) => (
            <line
              key={gy}
              x1="0"
              x2="320"
              y1={gy}
              y2={gy}
              stroke="#e1e3e1"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
          ))}
          {sorted.length > 1 ? (
            <path
              d={path}
              fill="none"
              stroke="#004c22"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {sorted.map((p) => (
            <circle key={p.id} cx={x(p.date)} cy={y(p.value)} r="2.5" fill="#004c22" />
          ))}
        </svg>
      </div>
      <figcaption className="flex justify-between font-label-xs text-label-xs text-on-surface-variant">
        <span>{formatDate(sorted[0].date)}</span>
        <span>
          {formatRupees(lo)} to {formatRupees(hi)} {unitLabel}
        </span>
        <span>{formatDate(sorted[sorted.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * One historical STATE-level observation: a price and arrival for a state as a whole. It is shown
 * with its own label so it can never be mistaken for a mandi price. Units are shown exactly as the
 * source stated them (the original label and the unit code); arrivals are never converted, and
 * count units (bundle, nos, unit) carry an explicit "not convertible to weight" note.
 *
 * @param {{ row: any }} props
 */
export function StateObservationCard({ row }) {
  const countUnit = row.price_unit_dimension === 'count' || row.arrival_unit_dimension === 'count';
  return (
    <article className="flex flex-col gap-2 rounded-2xl bg-surface-container-lowest p-space-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="break-words font-label-md text-label-md font-bold text-on-surface">
            {row.commodity.name}
          </h3>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            {row.state.name} (state as a whole)
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-metric-md text-metric-md font-bold text-on-surface">
            {formatRupees(row.modal_price)}
          </p>
          <p className="font-label-xs text-label-xs text-on-surface-variant">
            modal price per {row.price_unit}
            {row.source_price_unit_label ? ` (source unit “${row.source_price_unit_label}”)` : ''}
          </p>
        </div>
      </div>
      <p className="font-label-xs text-label-xs text-on-surface-variant">
        {row.arrival_quantity === null || row.arrival_quantity === undefined
          ? 'Arrival: not reported'
          : `Arrival: ${formatCount(row.arrival_quantity)} ${row.source_arrival_unit_label ?? row.arrival_unit} (original unit, not converted)`}
        {' · '}Observed <time dateTime={row.observed_date}>{formatDate(row.observed_date)}</time>
      </p>
      <div className="flex flex-wrap items-center gap-1.5 font-label-xs text-label-xs text-on-surface-variant">
        <Chip icon="public">State-level observation · not a mandi price</Chip>
        <StateMappingNote state={row.state} sourceLabel={row.source_labels.state} />
        {countUnit ? (
          <Chip icon="straighten" tone="caution">
            Count unit · not convertible to weight
          </Chip>
        ) : null}
      </div>
      <p className="font-label-xs text-label-xs text-outline">
        Source: {row.provenance.source_code}
        {row.source_labels.report ? ` · report “${row.source_labels.report}”` : ''} · historical
        record, not a live price
      </p>
    </article>
  );
}

/**
 * Date window controls for the observation lists. The window is capped at one year, like the API.
 * "Latest day only" narrows the window to the latest available day (`latestDay`); it lists only the
 * rows observed on that date. It is not live data and not a ranking.
 *
 * @param {{ from: string, to: string, onChange: (w: { from: string, to: string }) => void,
 *   minDate?: string | null, maxDate?: string | null, latestDay?: string | null,
 *   onReset?: () => void }} props
 */
export function WindowControls({
  from,
  to,
  onChange,
  minDate,
  maxDate,
  latestDay = null,
  onReset,
}) {
  const tooLong = from && to && spanDays(from, to) > MAX_RANGE_DAYS;
  const reversed = from && to && from > to;
  const latestOnly = Boolean(latestDay && from === latestDay && to === latestDay);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-space-sm">
        {[
          ['From', 'from', from],
          ['To', 'to', to],
        ].map(([label, key, value]) => (
          <label
            key={key}
            className="flex flex-col gap-1 font-label-xs text-label-xs font-bold uppercase tracking-wider text-on-surface-variant"
          >
            {label}
            <input
              type="date"
              value={value}
              min={minDate ?? undefined}
              max={maxDate ?? undefined}
              onChange={(event) => onChange({ from, to, [key]: event.target.value })}
              className="min-h-[48px] w-full rounded-xl bg-surface-container-lowest px-3 font-label-md text-label-md normal-case text-on-surface shadow-sm"
            />
          </label>
        ))}
      </div>
      {tooLong || reversed ? (
        <p role="alert" className="font-label-xs text-label-xs text-error">
          {reversed
            ? '“From” must not be after “To”.'
            : `Choose a window of at most ${MAX_RANGE_DAYS} days.`}
        </p>
      ) : null}
      {latestDay || onReset ? (
        <div className="flex flex-wrap items-center gap-space-xs">
          {latestDay ? (
            <button
              type="button"
              aria-pressed={latestOnly}
              onClick={() => onChange({ from: latestDay, to: latestDay })}
              className={`min-h-[44px] rounded-full px-4 font-label-md text-label-md font-bold ${
                latestOnly
                  ? 'bg-primary-container text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Latest available day only ({formatDate(latestDay)})
            </button>
          ) : null}
          {onReset ? (
            <button
              type="button"
              onClick={onReset}
              className="min-h-[44px] rounded-full bg-surface-container-high px-4 font-label-md text-label-md font-bold text-on-surface-variant"
            >
              Last 90 days
            </button>
          ) : null}
        </div>
      ) : null}
      {latestOnly ? (
        <p className="font-label-xs text-label-xs text-on-surface-variant">
          Only rows observed on {formatDate(latestDay)}, the latest day in the historical files for
          this selection. It is the latest available, not live, and it is not a ranking.
        </p>
      ) : null}
    </div>
  );
}
