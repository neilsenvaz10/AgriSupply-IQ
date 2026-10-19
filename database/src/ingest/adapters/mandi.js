import { normalizeLabel, parseMonthFirstDate } from '../util.js';
import { cells, checkPrices, numKey, rejection, requireHeader } from './common.js';

/**
 * Dataset A: mandi-level daily prices (market x commodity x variety x grade x day).
 * No arrivals and no market identifiers exist in the file, so markets are identified by their
 * source labels (state, district, market) and created as `unverified`. The file states no price
 * unit or currency: INR per quintal is an ASSUMPTION from the project documentation (recorded in
 * source_assumptions and as unit_basis `assumed_from_documentation` on every row).
 *
 * @type {import('../framework.js').Adapter}
 */
export const mandiAdapter = {
  dataset: 'A',
  factType: 'mandi_price',
  source: {
    code: 'mandi_daily_prices_historical',
    name: 'Mandi-level daily prices (historical file)',
    sourceType: 'historical_file',
    publisher: null,
    description:
      'Daily min, max and modal prices per market, commodity, variety and grade. Columns: STATE, District Name, Market Name, Commodity, Variety, Grade, Min_Price, Max_Price, Modal_Price, Price Date. No arrivals; no market identifiers.',
    endpointReference: null,
  },
  assumptions: [
    {
      code: 'price_unit_inr_per_quintal',
      statement:
        'The file states no price unit or currency. Prices are taken as Indian rupees (INR) per quintal. This is an assumption, not a fact stated by the source.',
      evidenceReference:
        "docs/data-sources/DATASET_COVERAGE.md (section 1: dataset A prices in rupees per quintal) and the project owner's Milestone 2.2 instruction; not stated in the source file",
    },
    {
      code: 'price_date_month_first',
      statement: 'Price Date is read as month/day/year (M/D/YYYY).',
      evidenceReference:
        'docs/data-sources/DATASET_COVERAGE.md section 2 (440,211 rows have a second field above 12; none have a first field above 12)',
    },
  ],
  validateHeader(header) {
    requireHeader(
      header,
      [
        'STATE',
        'District Name',
        'Market Name',
        'Commodity',
        'Variety',
        'Grade',
        'Min_Price',
        'Max_Price',
        'Modal_Price',
        'Price Date',
      ],
      'A',
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
    const [stateLabel, districtLabel, marketLabel, commodityLabel] = [
      get('STATE'),
      get('District Name'),
      get('Market Name'),
      get('Commodity'),
    ];
    for (const [name, value] of [
      ['STATE', stateLabel],
      ['District Name', districtLabel],
      ['Market Name', marketLabel],
      ['Commodity', commodityLabel],
    ]) {
      if (!value) return [rejection('missing_required_value', `${name} is empty`, header, rec)];
    }
    const date = parseMonthFirstDate(get('Price Date'));
    if (!date)
      return [rejection('invalid_date', 'Price Date is not a real M/D/YYYY date', header, rec)];
    const prices = checkPrices({
      min: get('Min_Price'),
      max: get('Max_Price'),
      modal: get('Modal_Price'),
    });
    if ('reject' in prices)
      return [rejection(prices.reject.reason, prices.reject.detail, header, rec)];

    // Identity resolution comes last, so no registry or alias row is created for an invalid record.
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
    const district = resolver.district(state, stateLabel, districtLabel);
    if (district.status !== 'resolved')
      resolver.noteUnresolved('district', `${stateLabel} / ${districtLabel}`);
    const marketId = resolver.market({ stateId: state.stateId }, district, {
      state: stateLabel,
      district: districtLabel,
      market: marketLabel,
    });
    const commodityId = resolver.commodity(commodityLabel);
    const varietyLabel = get('Variety');
    const varietyId = resolver.variety(commodityId, commodityLabel, varietyLabel);
    const grade = get('Grade') || null;
    const v = prices.values;
    return [
      {
        fact: {
          row: {
            market_id: marketId,
            commodity_id: commodityId,
            variety_id: varietyId,
            variety_label: varietyLabel || null,
            grade,
            observed_date: date,
            min_price: v.min?.value ?? null,
            max_price: v.max?.value ?? null,
            modal_price: v.modal?.value ?? null,
            price_currency: 'INR',
            price_unit: 'quintal',
            source_price_unit_label: null,
            unit_basis: 'assumed_from_documentation',
            arrival_quantity: null,
            arrival_unit: null,
            source_arrival_unit_label: null,
            source_state_label: stateLabel,
            source_district_label: districtLabel,
            source_market_label: marketLabel,
            source_commodity_label: commodityLabel,
          },
          // The record key is built from the SOURCE labels, so it is stable if the registry changes.
          keyFields: [
            normalizeLabel(stateLabel),
            normalizeLabel(districtLabel),
            normalizeLabel(marketLabel),
            normalizeLabel(commodityLabel),
            normalizeLabel(varietyLabel),
            normalizeLabel(grade),
            date,
          ],
          fingerprintFields: [
            stateLabel,
            districtLabel,
            marketLabel,
            commodityLabel,
            varietyLabel,
            grade,
            date,
            numKey(v.min),
            numKey(v.max),
            numKey(v.modal),
          ],
          qualityFlags: prices.flags,
        },
      },
    ];
  },
};
