import { describe, expect, it } from 'vitest';
import { DATASETS } from './adapters/index.js';
import { Resolver } from './resolver.js';

/** Synthetic reference geography: only what these tests need. */
const states = [
  { id: 's-mh', name: 'MAHARASHTRA', lgd: '27', kind: 'state' },
  { id: 's-ch', name: 'CHHATTISGARH', lgd: '22', kind: 'state' },
];
const districts = [{ id: 'd-nashik', stateId: 's-mh', name: 'NASHIK', lgd: '521' }];
const decisions = new Map([
  [
    'state|chattisgarh',
    { status: 'resolved', entityId: '22', note: 'reviewed decision: misspelling' },
  ],
]);
const resolver = () =>
  new Resolver({
    sourceId: 'src',
    runId: null,
    states,
    districts,
    decisions: /** @type {any} */ (decisions),
  });

/** Runs one CSV row through an adapter. */
function run(dataset, header, values, r = resolver()) {
  const { adapter } = DATASETS[dataset];
  adapter.validateHeader(header);
  const rec = { rowNumber: 1, values, columnCountMismatch: values.length !== header.length };
  return { items: adapter.process(rec, header, r), resolver: r };
}

const A_HEADER = [
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
];
const rowA = (o = {}) => {
  const v = {
    STATE: 'Maharashtra',
    'District Name': 'nashik',
    'Market Name': 'Lasalgaon(Niphad)',
    Commodity: 'Wheat',
    Variety: 'Sharbati',
    Grade: 'FAQ',
    Min_Price: '2000',
    Max_Price: '2500',
    Modal_Price: '2300',
    'Price Date': '6/6/2023',
    ...o,
  };
  return A_HEADER.map((h) => v[h]);
};

describe('dataset A: mandi-level daily prices', () => {
  it('builds a mandi observation with source labels, assumed unit basis and no arrivals', () => {
    const { items } = run('A', A_HEADER, rowA());
    expect(items).toHaveLength(1);
    const { row } = items[0].fact;
    expect(row).toMatchObject({
      observed_date: '2023-06-06',
      min_price: '2000',
      max_price: '2500',
      modal_price: '2300',
      price_currency: 'INR',
      price_unit: 'quintal',
      source_price_unit_label: null,
      unit_basis: 'assumed_from_documentation',
      arrival_quantity: null,
      arrival_unit: null,
      grade: 'FAQ',
      source_state_label: 'Maharashtra',
      source_district_label: 'nashik',
      source_market_label: 'Lasalgaon(Niphad)',
      source_commodity_label: 'Wheat',
    });
    expect(items[0].fact.qualityFlags).toEqual([]);
  });

  it('records the INR/quintal assumption explicitly, with its evidence', () => {
    const a = DATASETS.A.adapter.assumptions.find((x) => x.code === 'price_unit_inr_per_quintal');
    expect(a?.statement).toMatch(/assumption/i);
    expect(a?.evidenceReference).toMatch(/DATASET_COVERAGE/);
  });

  it.each([
    ['min above modal', { Min_Price: '2400' }, 'price_ordering_violation'],
    ['modal above max', { Modal_Price: '2600' }, 'price_ordering_violation'],
    ['negative price', { Modal_Price: '-5', Min_Price: '', Max_Price: '' }, 'negative_value'],
    ['text price', { Modal_Price: 'abc' }, 'invalid_value'],
    [
      'no price at all',
      { Min_Price: '', Max_Price: '', Modal_Price: '' },
      'missing_required_value',
    ],
    ['impossible date', { 'Price Date': '2/30/2024' }, 'invalid_date'],
    ['ISO date in a month-first file', { 'Price Date': '2024-02-10' }, 'invalid_date'],
    ['empty market', { 'Market Name': '' }, 'missing_required_value'],
    ['empty commodity', { Commodity: '' }, 'missing_required_value'],
  ])('quarantines %s, keeping the raw record', (_label, override, reason) => {
    const { items } = run('A', A_HEADER, rowA(override));
    expect(items).toHaveLength(1);
    expect(items[0].reject.reason).toBe(reason);
    expect(items[0].reject.raw['Market Name']).toBeDefined();
  });

  it('quarantines a zero price (non-positive prices are never stored)', () => {
    for (const override of [
      { Min_Price: '0', Modal_Price: '0', Max_Price: '0' },
      { Min_Price: '0', Modal_Price: '100', Max_Price: '200' },
    ]) {
      const { items } = run('A', A_HEADER, rowA(override));
      expect(items).toHaveLength(1);
      expect(items[0].reject.reason).toBe('invalid_value');
      expect(items[0].reject.detail).toMatch(/zero/);
    }
  });

  it('quarantines an unresolved state and creates no market, district or alias for the row', () => {
    const { items, resolver: r } = run('A', A_HEADER, rowA({ STATE: 'Gao' }));
    expect(items[0].reject).toMatchObject({ reason: 'unmapped_entity', detail: 'state=Gao' });
    expect(r.pending.markets).toHaveLength(0);
    expect(r.pending.commodities).toHaveLength(0);
    expect(r.unresolved.state.get('Gao')).toBe(1);
  });

  it('resolves a reviewed misspelling but does not mask the original label on the fact', () => {
    const { items } = run('A', A_HEADER, rowA({ STATE: 'Chattisgarh', 'District Name': 'raipur' }));
    expect(items[0].fact.row.source_state_label).toBe('Chattisgarh');
  });

  it('keeps an unresolved district: the market is identified by the source district label', () => {
    const r = resolver();
    run('A', A_HEADER, rowA({ 'District Name': 'palghar', 'Market Name': 'Central' }), r);
    run('A', A_HEADER, rowA({ 'District Name': 'thane', 'Market Name': 'Central' }), r);
    expect(r.pending.markets.map((m) => m.disambiguator).sort()).toEqual([
      'src-district:palghar',
      'src-district:thane',
    ]);
  });

  it('stores an unspecified variety as NULL with its label, and a named variety as a variety', () => {
    const other = run('A', A_HEADER, rowA({ Variety: 'Other' })).items[0].fact.row;
    expect(other.variety_id).toBeNull();
    expect(other.variety_label).toBe('Other');
    const named = run('A', A_HEADER, rowA({ Variety: 'Local' })).items[0].fact.row;
    expect(named.variety_id).toBeTruthy();
  });

  it('keeps the record key stable for the same labels and changes the fingerprint when a value changes', () => {
    const a = run('A', A_HEADER, rowA()).items[0].fact;
    const same = run('A', A_HEADER, rowA()).items[0].fact;
    const changed = run('A', A_HEADER, rowA({ Modal_Price: '2310' })).items[0].fact;
    expect(same.keyFields).toEqual(a.keyFields);
    expect(same.fingerprintFields).toEqual(a.fingerprintFields);
    expect(changed.keyFields).toEqual(a.keyFields);
    expect(changed.fingerprintFields).not.toEqual(a.fingerprintFields);
  });

  it('quarantines a row with the wrong number of columns (structural)', () => {
    const { items } = run('A', A_HEADER, ['Maharashtra', 'nashik']);
    expect(items[0].reject.reason).toBe('structural_error');
  });

  it('refuses a file that is not dataset A', () => {
    expect(() => DATASETS.A.adapter.validateHeader(['x', 'y'])).toThrow(/dataset A/);
  });
});

const B_HEADER = [
  'source_file',
  'source_row_number',
  'report_title',
  'report_start_date',
  'report_end_date',
  'raw_column_count',
  'row_issue',
  'extra_columns_json',
  'State',
  'Commodity Group',
  'Commodity',
  'Date',
  'Date ISO',
  'Arrival Quantity',
  'Arrival Unit',
  'Modal Price',
  'Price Unit',
];
const rowB = (o = {}) => {
  const v = {
    source_file: 'r1.csv',
    source_row_number: '3',
    report_title: 'Report T',
    report_start_date: '',
    report_end_date: '',
    raw_column_count: '8',
    row_issue: '',
    extra_columns_json: '',
    State: 'Maharashtra',
    'Commodity Group': 'Vegetables',
    Commodity: 'Amaranthus',
    Date: '05-01-2023',
    'Date ISO': '2023-01-05',
    'Arrival Quantity': '2.00',
    'Arrival Unit': 'Metric Tonnes',
    'Modal Price': '4000.00',
    'Price Unit': 'Rs./Quintal',
    ...o,
  };
  return B_HEADER.map((h) => v[h]);
};

describe('dataset B: state-level daily prices and arrivals', () => {
  it('maps mass units and states them as the source did (no assumption)', () => {
    const { row, qualityFlags } = run('B', B_HEADER, rowB()).items[0].fact;
    expect(row).toMatchObject({
      observed_date: '2023-01-05',
      modal_price: '4000.00',
      price_currency: 'INR',
      price_unit: 'quintal',
      source_price_unit_label: 'Rs./Quintal',
      unit_basis: 'source_stated',
      arrival_quantity: '2.00',
      arrival_unit: 'tonne',
      source_arrival_unit_label: 'Metric Tonnes',
      source_commodity_group_label: 'Vegetables',
    });
    expect(row).not.toHaveProperty('market_id');
    expect(qualityFlags).toEqual([]);
  });

  it('keeps count units as counts: bundles and pieces are never converted to tonnes or quintals', () => {
    const bundle = run(
      'B',
      B_HEADER,
      rowB({
        'Arrival Quantity': '120',
        'Arrival Unit': 'Bundle',
        'Modal Price': '30',
        'Price Unit': 'Rs./Bundle',
      }),
    ).items[0].fact.row;
    expect(bundle).toMatchObject({
      arrival_quantity: '120',
      arrival_unit: 'bundle',
      price_unit: 'bundle',
      modal_price: '30',
    });
    const pieces = run(
      'B',
      B_HEADER,
      rowB({
        'Arrival Quantity': '900',
        'Arrival Unit': 'Nos',
        'Modal Price': '12',
        'Price Unit': 'Rs./Unit',
      }),
    ).items[0].fact.row;
    expect(pieces).toMatchObject({
      arrival_quantity: '900',
      arrival_unit: 'nos',
      price_unit: 'unit',
    });
  });

  it.each([
    ['unknown arrival unit', { 'Arrival Unit': 'Truckloads' }, 'unsupported_unit'],
    ['missing arrival unit', { 'Arrival Unit': '' }, 'unsupported_unit'],
    ['unknown price unit', { 'Price Unit': 'Rs./Sack' }, 'unsupported_unit'],
    ['negative arrival', { 'Arrival Quantity': '-3' }, 'negative_value'],
    ['negative price', { 'Modal Price': '-1' }, 'negative_value'],
    ['text arrival', { 'Arrival Quantity': 'lots' }, 'invalid_value'],
    [
      'neither arrival nor price',
      { 'Arrival Quantity': '', 'Modal Price': '' },
      'missing_required_value',
    ],
    ['bad ISO date', { 'Date ISO': '2023-02-30' }, 'invalid_date'],
    ['source flagged row_issue', { row_issue: 'expected 8 columns, found 1' }, 'structural_error'],
    ['footer "Note:" in the State column', { State: 'Note:' }, 'structural_error'],
    [
      'footer formula in the State column',
      {
        State:
          'Weighted Average Price = sum(arrival quantity * modal price) / sum arrival quantity',
      },
      'structural_error',
    ],
    ['empty State', { State: '' }, 'structural_error'],
    ['unresolved state', { State: 'Atlantis' }, 'unmapped_entity'],
  ])('quarantines %s', (_label, override, reason) => {
    const { items } = run('B', B_HEADER, rowB(override));
    expect(items[0].reject.reason).toBe(reason);
  });

  it('flags a zero arrival for review but quarantines a zero price', () => {
    const { qualityFlags } = run('B', B_HEADER, rowB({ 'Arrival Quantity': '0' })).items[0].fact;
    expect(qualityFlags).toEqual(['zero_arrival']);
    const { items } = run('B', B_HEADER, rowB({ 'Modal Price': '0' }));
    expect(items[0].reject.reason).toBe('invalid_value');
    expect(items[0].reject.detail).toMatch(/zero/);
  });

  it('accepts an arrival with no price (and a price with no arrival) without inventing the missing value', () => {
    const noPrice = run('B', B_HEADER, rowB({ 'Modal Price': '', 'Price Unit': '' })).items[0].fact
      .row;
    expect(noPrice).toMatchObject({ modal_price: null, price_currency: null, price_unit: null });
    const noArrival = run('B', B_HEADER, rowB({ 'Arrival Quantity': '', 'Arrival Unit': '' }))
      .items[0].fact.row;
    expect(noArrival).toMatchObject({ arrival_quantity: null, arrival_unit: null });
  });

  it('gives overlapping reports the same key and fingerprint, so identical values are exact duplicates', () => {
    const one = run(
      'B',
      B_HEADER,
      rowB({ report_title: 'Report 1', source_file: 'r1.csv', source_row_number: '3' }),
    ).items[0].fact;
    const two = run(
      'B',
      B_HEADER,
      rowB({ report_title: 'Report 2', source_file: 'r2.csv', source_row_number: '99' }),
    ).items[0].fact;
    expect(two.keyFields).toEqual(one.keyFields);
    expect(two.fingerprintFields).toEqual(one.fingerprintFields);
    expect(two.row.source_report_label).not.toBe(one.row.source_report_label); // the original line stays traceable
    expect(two.row.source_report_label).toContain('r2.csv#99');
  });

  it('gives a different fingerprint, same key, when the overlapping report disagrees (a conflict)', () => {
    const one = run('B', B_HEADER, rowB()).items[0].fact;
    const two = run('B', B_HEADER, rowB({ 'Modal Price': '4100.00' })).items[0].fact;
    expect(two.keyFields).toEqual(one.keyFields);
    expect(two.fingerprintFields).not.toEqual(one.fingerprintFields);
  });
});

const C_HEADER = [
  'month',
  'commodity_name',
  'avg_modal_price',
  'avg_min_price',
  'avg_max_price',
  'state_name',
  'district_name',
  'calculationType',
  'change',
];
const rowC = (o = {}) => {
  const v = {
    month: '2025-03-01',
    commodity_name: 'Maize',
    avg_modal_price: '2341.58',
    avg_min_price: '2191.23',
    avg_max_price: '2402.98',
    state_name: 'India',
    district_name: 'All',
    calculationType: 'Monthly',
    change: '-14.43',
    ...o,
  };
  return C_HEADER.map((h) => v[h]);
};

describe('dataset C: national monthly commodity prices', () => {
  it('keeps the national monthly grain, the assumed unit, and the unconfirmed change column as reported', () => {
    const { row } = run('C', C_HEADER, rowC()).items[0].fact;
    expect(row).toMatchObject({
      period_month: '2025-03-01',
      avg_modal_price: '2341.58',
      price_unit: 'quintal',
      unit_basis: 'assumed_from_documentation',
      source_price_unit_label: null,
      source_reported_change: '-14.43',
      source_calculation_type: 'Monthly',
    });
    expect(row).not.toHaveProperty('market_id');
    expect(row).not.toHaveProperty('state_id');
    expect(row).not.toHaveProperty('observed_date');
  });

  it('stores a blank change as NULL (never 0) and documents that it is unconfirmed', () => {
    expect(
      run('C', C_HEADER, rowC({ change: '' })).items[0].fact.row.source_reported_change,
    ).toBeNull();
    const codes = DATASETS.C.adapter.assumptions.map((a) => a.code);
    expect(codes).toContain('change_column_meaning_unconfirmed');
  });

  it.each([
    ['a state-level row', { state_name: 'Maharashtra' }, 'invalid_value'],
    ['a district-level row', { district_name: 'Nashik' }, 'invalid_value'],
    ['a non-monthly row', { calculationType: 'Daily' }, 'invalid_value'],
    ['a mid-month period', { month: '2025-03-15' }, 'invalid_date'],
    ['an impossible month', { month: '2025-13-01' }, 'invalid_date'],
    ['averages out of order', { avg_min_price: '2500' }, 'price_ordering_violation'],
    ['a negative average', { avg_modal_price: '-1' }, 'negative_value'],
    ['an empty commodity', { commodity_name: '' }, 'missing_required_value'],
  ])('quarantines %s', (_label, override, reason) => {
    expect(run('C', C_HEADER, rowC(override)).items[0].reject.reason).toBe(reason);
  });
});

const D_HEADER = ['Crop', 'January-2013', 'February-2013', 'January-2014'];

describe('dataset D: wholesale price index', () => {
  it('unpivots month-year columns into index observations on the first day of each month', () => {
    const { items } = run('D', D_HEADER, ['Bajra', '131.60', '132.30', '125.00']);
    expect(items.map((i) => i.fact.row.period_month)).toEqual([
      '2013-01-01',
      '2013-02-01',
      '2014-01-01',
    ]);
    expect(items.map((i) => i.fact.row.index_value)).toEqual(['131.60', '132.30', '125.00']);
  });

  it('produces index rows only: no currency, unit, price or market field', () => {
    const { row } = run('D', D_HEADER, ['Bajra', '131.60', '132.30', '125.00']).items[0].fact;
    expect(Object.keys(row).sort()).toEqual(['index_value', 'period_month', 'series_id']);
    expect(DATASETS.D.adapter.factType).toBe('wpi_index');
  });

  it('skips an empty cell (a missing month is absent, never filled) and quarantines bad cells', () => {
    const { items } = run('D', D_HEADER, ['Bajra', '131.60', '', 'n/a']);
    expect(items).toHaveLength(2);
    expect(items[0].fact).toBeDefined();
    expect(items[1].reject).toMatchObject({
      reason: 'invalid_value',
      raw: { item: 'Bajra', column: 'January-2014', value: 'n/a' },
    });
  });

  it('rejects zero and negative index values', () => {
    const { items } = run('D', D_HEADER, ['Bajra', '0', '-3', '5']);
    expect(items.map((i) => i.reject?.reason)).toEqual([
      'invalid_value',
      'negative_value',
      undefined,
    ]);
  });

  it('shares one series per item and never links an item to the commodity registry', () => {
    const { resolver: r } = run('D', D_HEADER, ['Wheat Atta', '1', '2', '3']);
    expect(r.pending.wpiSeries).toHaveLength(1);
    expect(r.pending.commodities).toHaveLength(0);
  });

  it('rejects a file whose columns are not Month-Year or whose first column is not Crop', () => {
    expect(() => DATASETS.D.adapter.validateHeader(['Item', 'January-2013'])).toThrow(/Crop/);
    expect(() => DATASETS.D.adapter.validateHeader(['Crop', 'Q1-2013'])).toThrow(/Month-Year/);
  });

  it('quarantines an item row that has the wrong number of cells', () => {
    expect(run('D', D_HEADER, ['Bajra', '1']).items[0].reject.reason).toBe('structural_error');
  });
});

describe('granularity is never mixed between adapters', () => {
  it('routes each dataset to its own fact type', () => {
    expect(
      Object.fromEntries(Object.entries(DATASETS).map(([k, v]) => [k, v.adapter.factType])),
    ).toEqual({
      D: 'wpi_index',
      C: 'national_commodity_price',
      A: 'mandi_price',
      B: 'state_observation',
    });
  });
  it('imports in the order D, C, A, B', () => {
    expect(Object.keys(DATASETS)).toEqual(['D', 'C', 'A', 'B']);
  });
});
