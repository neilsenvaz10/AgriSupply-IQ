import { normalizeLabel, parseDecimal, parseIsoDate } from '../util.js';
import { cells, rejection, requireHeader } from './common.js';

/**
 * Dataset B: state-level daily modal price and arrival (state x commodity x day), merged from many
 * report files. Units ARE stated per row; they are mapped, never converted:
 *   arrival  Metric Tonnes -> tonne (mass)   Nos -> nos (count)   Bundle -> bundle (count)
 *   price    Rs./Quintal   -> INR per quintal   Rs./Bundle -> INR per bundle   Rs./Unit -> INR per unit
 * Counts (nos, bundle) are NOT mass and are never turned into tonnes or quintals.
 *
 * Footer text in the State column ("Note:", the weighted-average formula) and rows the earlier
 * preprocessing flagged with `row_issue` are quarantined. Overlapping reports produce the same
 * state/commodity/day more than once: identical values are exact duplicates, differing values
 * are conflicts.
 */

const ARRIVAL_UNITS = { 'Metric Tonnes': 'tonne', Nos: 'nos', Bundle: 'bundle' };
const PRICE_UNITS = { 'Rs./Quintal': 'quintal', 'Rs./Bundle': 'bundle', 'Rs./Unit': 'unit' };

/** @type {import('../framework.js').Adapter} */
export const stateAdapter = {
  dataset: 'B',
  factType: 'state_observation',
  source: {
    code: 'state_daily_prices_arrivals_historical',
    name: 'State-level daily prices and arrivals (merged report files)',
    sourceType: 'historical_file',
    publisher: null,
    description:
      'State x commodity x day modal price and arrival quantity, merged from report files. Units are stated per row. Contains footer text and structurally broken rows (flagged by row_issue).',
    endpointReference: null,
  },
  assumptions: [
    {
      code: 'state_arrivals_are_not_mandi_arrivals',
      statement:
        'Arrival quantities are state-level totals as reported. They are never attributed to any market.',
      evidenceReference:
        'docs/data-sources/DATASET_COVERAGE.md section 1 (dataset B is state level)',
    },
  ],
  validateHeader(header) {
    requireHeader(
      header,
      [
        'source_file',
        'source_row_number',
        'report_title',
        'row_issue',
        'State',
        'Commodity Group',
        'Commodity',
        'Date ISO',
        'Arrival Quantity',
        'Arrival Unit',
        'Modal Price',
        'Price Unit',
      ],
      'B',
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
    const issue = get('row_issue');
    if (issue) return [rejection('structural_error', `source row_issue: ${issue}`, header, rec)];
    const stateLabel = get('State');
    if (!stateLabel || stateLabel === 'Note:' || stateLabel.startsWith('Weighted Average Price')) {
      return [
        rejection(
          'structural_error',
          'footer or explanatory text (or nothing) in the State column',
          header,
          rec,
        ),
      ];
    }
    const commodityLabel = get('Commodity');
    if (!commodityLabel)
      return [rejection('missing_required_value', 'Commodity is empty', header, rec)];
    const date = parseIsoDate(get('Date ISO'));
    if (!date)
      return [rejection('invalid_date', 'Date ISO is not a real YYYY-MM-DD date', header, rec)];

    const arrivalUnitLabel = get('Arrival Unit');
    const priceUnitLabel = get('Price Unit');
    const arrival = parseDecimal(get('Arrival Quantity'));
    const modal = parseDecimal(get('Modal Price'));
    if ('invalid' in arrival)
      return [rejection('invalid_value', 'Arrival Quantity is not a number', header, rec)];
    if ('invalid' in modal)
      return [rejection('invalid_value', 'Modal Price is not a number', header, rec)];
    if (!('blank' in arrival) && arrival.number < 0)
      return [rejection('negative_value', 'Arrival Quantity is negative', header, rec)];
    if (!('blank' in modal) && modal.number < 0)
      return [rejection('negative_value', 'Modal Price is negative', header, rec)];
    if (!('blank' in modal) && modal.number === 0)
      return [
        rejection(
          'invalid_value',
          'Modal Price is zero (non-positive prices are quarantined)',
          header,
          rec,
        ),
      ];
    if ('blank' in arrival && 'blank' in modal)
      return [
        rejection(
          'missing_required_value',
          'neither an arrival nor a price is present',
          header,
          rec,
        ),
      ];
    const arrivalUnit = ARRIVAL_UNITS[/** @type {keyof typeof ARRIVAL_UNITS} */ (arrivalUnitLabel)];
    const priceUnit = PRICE_UNITS[/** @type {keyof typeof PRICE_UNITS} */ (priceUnitLabel)];
    if (!('blank' in arrival) && !arrivalUnit)
      return [
        rejection(
          'unsupported_unit',
          `arrival unit "${arrivalUnitLabel}" is missing or unsupported`,
          header,
          rec,
        ),
      ];
    if (!('blank' in modal) && !priceUnit)
      return [
        rejection(
          'unsupported_unit',
          `price unit "${priceUnitLabel}" is missing or unsupported`,
          header,
          rec,
        ),
      ];

    const state = resolver.state(stateLabel);
    if (state.status !== 'resolved' || !state.stateId) {
      resolver.noteUnresolved('state', stateLabel);
      return [
        rejection(
          state.status === 'ambiguous' ? 'ambiguous_entity' : 'unmapped_entity',
          `state=${stateLabel}`,
          header,
          rec,
        ),
      ];
    }
    const group = get('Commodity Group') || null;
    const commodityId = resolver.commodity(commodityLabel, group);
    /** @type {string[]} */
    const flags = [];
    if (!('blank' in arrival) && arrival.number === 0) flags.push('zero_arrival');
    const hasArrival = !('blank' in arrival);
    const hasPrice = !('blank' in modal);
    return [
      {
        fact: {
          row: {
            state_id: state.stateId,
            commodity_id: commodityId,
            observed_date: date,
            min_price: null,
            max_price: null,
            modal_price: hasPrice ? modal.value : null,
            price_currency: hasPrice ? 'INR' : null,
            price_unit: hasPrice ? priceUnit : null,
            source_price_unit_label: hasPrice ? priceUnitLabel : null,
            unit_basis: 'source_stated',
            arrival_quantity: hasArrival ? arrival.value : null,
            arrival_unit: hasArrival ? arrivalUnit : null,
            source_arrival_unit_label: hasArrival ? arrivalUnitLabel : null,
            source_state_label: stateLabel,
            source_commodity_label: commodityLabel,
            source_commodity_group_label: group,
            // Report title plus the original report file and its row, so the exact source line is traceable.
            source_report_label: `${get('report_title')} | ${get('source_file')}#${get('source_row_number')}`,
          },
          keyFields: [normalizeLabel(stateLabel), normalizeLabel(commodityLabel), date],
          fingerprintFields: [
            stateLabel,
            commodityLabel,
            group,
            date,
            hasPrice ? String(modal.number) : null,
            priceUnitLabel || null,
            hasArrival ? String(arrival.number) : null,
            arrivalUnitLabel || null,
          ],
          qualityFlags: flags,
        },
      },
    ];
  },
};
