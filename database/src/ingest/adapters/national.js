import { normalizeLabel, parseDecimal, parseIsoDate } from '../util.js';
import { cells, checkPrices, numKey, rejection, requireHeader } from './common.js';

/**
 * Dataset C: national monthly commodity prices (monthly averages for India).
 * The file states no unit or currency: INR per quintal is an ASSUMPTION taken from the project
 * documentation, recorded in source_assumptions and on every row as unit_basis
 * `assumed_from_documentation`. The `change` column's meaning is unconfirmed: it is stored
 * unchanged as `source_reported_change` and must not be used for modelling.
 *
 * @type {import('../framework.js').Adapter}
 */
export const nationalAdapter = {
  dataset: 'C',
  factType: 'national_commodity_price',
  source: {
    code: 'national_monthly_prices_historical',
    name: 'National monthly commodity prices (historical file)',
    sourceType: 'historical_file',
    publisher: null,
    description:
      'Monthly average prices for India by commodity. Columns: month, commodity_name, avg_modal_price, avg_min_price, avg_max_price, state_name, district_name, calculationType, change.',
    endpointReference: null,
  },
  assumptions: [
    {
      code: 'price_unit_inr_per_quintal',
      statement:
        'The file states no price unit or currency. Prices are taken as Indian rupees (INR) per quintal. This is an assumption, not a fact stated by the source.',
      evidenceReference:
        "docs/data-sources/DATASET_COVERAGE.md (dataset C description) and the project owner's Milestone 2.2 instruction; not stated in the source file",
    },
    {
      code: 'change_column_meaning_unconfirmed',
      statement:
        'The meaning of the "change" column (absolute or percentage, and its base) is unconfirmed. It is stored as reported and must not be used for modelling.',
      evidenceReference:
        'docs/data-sources/DATASET_COVERAGE.md; database/docs/CANONICAL_SCHEMA.md section 12',
    },
  ],
  validateHeader(header) {
    requireHeader(
      header,
      [
        'month',
        'commodity_name',
        'avg_modal_price',
        'avg_min_price',
        'avg_max_price',
        'state_name',
        'district_name',
        'calculationType',
        'change',
      ],
      'C',
    );
  },
  process(rec, header, resolver) {
    if (rec.columnCountMismatch)
      return [
        rejection(
          'structural_error',
          `expected ${header.length} columns, found ${rec.values.length}`,
          header,
          rec,
        ),
      ];
    const get = cells(header, rec);
    if (
      get('state_name') !== 'India' ||
      get('district_name') !== 'All' ||
      get('calculationType') !== 'Monthly'
    ) {
      return [
        rejection(
          'invalid_value',
          'row is not a national (India / All) monthly record',
          header,
          rec,
        ),
      ];
    }
    const label = get('commodity_name');
    if (!label)
      return [rejection('missing_required_value', 'commodity_name is empty', header, rec)];
    const month = parseIsoDate(get('month'));
    if (!month)
      return [rejection('invalid_date', 'month is not a real YYYY-MM-DD date', header, rec)];
    if (!month.endsWith('-01'))
      return [
        rejection(
          'invalid_date',
          'a monthly period must be the first day of the month',
          header,
          rec,
        ),
      ];
    const prices = checkPrices({
      min: get('avg_min_price'),
      max: get('avg_max_price'),
      modal: get('avg_modal_price'),
    });
    if ('reject' in prices)
      return [rejection(prices.reject.reason, prices.reject.detail, header, rec)];
    const change = parseDecimal(get('change'));
    if ('invalid' in change)
      return [rejection('invalid_value', 'change is not a number', header, rec)];
    const commodityId = resolver.commodity(label);
    const v = prices.values;
    return [
      {
        fact: {
          row: {
            commodity_id: commodityId,
            period_month: month,
            avg_min_price: v.min?.value ?? null,
            avg_max_price: v.max?.value ?? null,
            avg_modal_price: v.modal?.value ?? null,
            price_currency: 'INR',
            price_unit: 'quintal',
            source_price_unit_label: null,
            unit_basis: 'assumed_from_documentation',
            source_reported_change: 'blank' in change ? null : change.value,
            source_calculation_type: 'Monthly',
            source_commodity_label: label,
          },
          keyFields: [normalizeLabel(label), month, 'monthly'],
          fingerprintFields: [
            label,
            month,
            numKey(v.min),
            numKey(v.max),
            numKey(v.modal),
            'blank' in change ? null : String(change.number),
          ],
          qualityFlags: prices.flags,
        },
      },
    ];
  },
};
