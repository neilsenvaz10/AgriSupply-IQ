/**
 * Fixed statements the historical market API makes about its data. They mirror the decisions
 * recorded in database/reports/milestone-2.2/alias-review.md and database/docs/INGESTION.md; they
 * are constants (not database values) because the database does not store a "provisional" flag.
 */

export const GRANULARITY = Object.freeze({
  MANDI: 'mandi_daily',
  STATE: 'state_daily',
  NATIONAL: 'national_monthly',
  WPI: 'wpi_monthly_index',
});

export const DATA_STATUS = Object.freeze({
  data_status: 'historical_snapshot',
  is_live: false,
  notice:
    'Historical records loaded from static files. They are not live or current market data, and nothing here is a forecast.',
});

/** Lower-cased, trimmed state labels whose mapping is provisional pending authoritative confirmation. */
export const PROVISIONAL_STATE_LABELS = new Map([
  [
    'keralam',
    'Mapped to Kerala by a reviewed decision. The official rename (Kerala (Alteration of Name) Act 2026) is known only from press reports; the gazette was not retrieved and the 2022 reference lists KERALA. Confirm before treating as verified.',
  ],
]);

export const GEOGRAPHY_REFERENCE = Object.freeze({
  reference_set: 'lgd-github-mirror-2022-12',
  status: 'provisional-historical',
  note: 'A third-party mirror of the Local Government Directory as of December 2022. It is not a verified current registry.',
});

export const MARKET_VERIFICATION_NOTE =
  'Market identities are created from source labels. No authoritative market list exists, so every market is "unverified".';

export const UNIT_NOTES = Object.freeze({
  mandi_daily:
    'Prices are assumed to be INR per quintal (unit_basis "assumed_from_documentation"); the source file states no unit.',
  national_monthly:
    'Prices are assumed to be INR per quintal (unit_basis "assumed_from_documentation"); the source file states no unit. The source "change" value is unconfirmed and not for modelling.',
  state_daily:
    'Units are stated by the source per row and are mixed (quintal, bundle and unit for prices; tonne, bundle and nos for arrivals). Count units are never converted to mass.',
  wpi_monthly_index: 'Index values with no currency or unit. They are not prices.',
});

/**
 * @param {string | null | undefined} label source state label as written in the file
 * @returns {{ status: 'resolved' | 'provisional', note: string | null }}
 */
export function stateMappingStatus(label) {
  const note = PROVISIONAL_STATE_LABELS.get(
    String(label ?? '')
      .trim()
      .toLowerCase(),
  );
  return note ? { status: 'provisional', note } : { status: 'resolved', note: null };
}

/** @param {string | number | null | undefined} v */
export const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Dates come from `pg` as strings when the type parser is set, otherwise as Date objects. */
export const day = (/** @type {string | Date | null} */ v) =>
  v === null || v === undefined
    ? null
    : typeof v === 'string'
      ? v.slice(0, 10)
      : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
