/**
 * Display helpers for historical market records. They only FORMAT values the API returned; they
 * never convert units, compute changes or fill gaps.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** @param {number | null | undefined} value */
export function formatRupees(value) {
  return value === null || value === undefined ? '—' : `₹${NUMBER.format(value)}`;
}

/**
 * ISO date (YYYY-MM-DD) as "6 Jun 2023". Pure string handling, so no time zone can shift the day.
 *
 * @param {string | null | undefined} iso
 */
export function formatDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/** @param {string | null | undefined} iso first day of a month */
export function formatMonth(iso) {
  const m = iso ? /^(\d{4})-(\d{2})/.exec(iso) : null;
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—';
}

/**
 * "6 Jun 2023 to 11 Jun 2025", or "no observations".
 *
 * @param {{ first_date: string | null, last_date: string | null } | undefined} cov
 */
export function formatRange(cov) {
  if (!cov || !cov.first_date || !cov.last_date) return 'no observations';
  return cov.first_date === cov.last_date
    ? formatDate(cov.first_date)
    : `${formatDate(cov.first_date)} to ${formatDate(cov.last_date)}`;
}

/** @param {number | null | undefined} n */
export const formatCount = (n) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-IN').format(n);

/**
 * The price and its ORIGINAL unit, plus an explicit note when the unit is an assumption of the
 * dataset documentation rather than something the source file states.
 *
 * @param {{ modal_price: number | null, price_unit: string, unit_basis: string }} row
 */
export function describePrice(row) {
  return {
    amount: formatRupees(row.modal_price),
    unit: `per ${row.price_unit}`,
    assumed: row.unit_basis === 'assumed_from_documentation',
  };
}

/**
 * How a commodity is covered by the data. The tiers are never merged: a state-level observation is
 * not a mandi price.
 *
 * @param {{ coverage: { mandi_daily: { observations: number }, state_daily: { observations: number }, national_monthly: { observations: number } } }} commodity
 * @returns {'mandi' | 'state' | 'national' | 'none'}
 */
export function coverageTier(commodity) {
  const c = commodity.coverage;
  if (c.mandi_daily.observations > 0) return 'mandi';
  if (c.state_daily.observations > 0) return 'state';
  if (c.national_monthly.observations > 0) return 'national';
  return 'none';
}

export const TIER_LABEL = Object.freeze({
  mandi: 'Mandi-level observations',
  state: 'State-level observations only',
  national: 'National monthly observations only',
  none: 'No price observations',
});

/**
 * Adds days to an ISO date (UTC arithmetic, so no time zone can shift the day).
 *
 * @param {string} iso YYYY-MM-DD
 * @param {number} days
 */
export function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}
