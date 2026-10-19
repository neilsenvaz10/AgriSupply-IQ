import { describe, expect, it } from 'vitest';
import { Resolver } from './resolver.js';

/** Synthetic reference: two states that both have a district called "Aurangabad". */
const states = [
  { id: 's-mh', name: 'MAHARASHTRA', lgd: '27', kind: 'state' },
  { id: 's-br', name: 'BIHAR', lgd: '10', kind: 'state' },
  { id: 's-ch', name: 'CHHATTISGARH', lgd: '22', kind: 'state' },
];
const districts = [
  { id: 'd-mh-a', stateId: 's-mh', name: 'AURANGABAD', lgd: '519' },
  { id: 'd-br-a', stateId: 's-br', name: 'AURANGABAD', lgd: '216' },
  { id: 'd-mh-n', stateId: 's-mh', name: 'NASHIK', lgd: '521' },
];
const decisions = new Map([
  [
    'state|chattisgarh',
    { status: 'resolved', entityId: '22', note: 'reviewed decision: misspelling' },
  ],
  ['state|gao', { status: 'unresolved', entityId: null, note: 'reviewed decision: not assumed' }],
  [
    'state|border',
    { status: 'ambiguous', entityId: null, note: 'reviewed decision: two candidates' },
  ],
  [
    'state|bogus',
    { status: 'resolved', entityId: '99', note: 'reviewed decision: points at a missing code' },
  ],
]);

const make = () =>
  new Resolver({
    sourceId: 'src',
    runId: 'run',
    states,
    districts,
    decisions: /** @type {any} */ (decisions),
  });

describe('state resolution', () => {
  it('resolves an exact normalised match (case and whitespace only) and records an alias', () => {
    const r = make();
    expect(r.state('  maharashtra ')).toMatchObject({ status: 'resolved', stateId: 's-mh' });
    expect(r.pending.aliases).toHaveLength(1);
    expect(r.pending.aliases[0]).toMatchObject({
      table: 'state_aliases',
      status: 'resolved',
      label: 'maharashtra',
    });
  });

  it('resolves through a reviewed decision, with the reviewer note on the alias', () => {
    const r = make();
    expect(r.state('Chattisgarh')).toMatchObject({ status: 'resolved', stateId: 's-ch' });
    expect(r.pending.aliases[0].note).toMatch(/reviewed decision/);
  });

  it('does NOT fuzzy-match a misspelling that has no decision', () => {
    const r = make();
    expect(r.state('Maharastra')).toMatchObject({ status: 'unresolved', stateId: null });
    expect(r.state('Bihar ')).toMatchObject({ status: 'resolved' });
  });

  it('keeps unresolved and ambiguous decisions unresolved, never guessing a target', () => {
    const r = make();
    expect(r.state('Gao')).toMatchObject({ status: 'unresolved', stateId: null });
    expect(r.state('Border')).toMatchObject({ status: 'ambiguous', stateId: null });
  });

  it('refuses a decision whose target is not in the loaded registry', () => {
    const r = make();
    const out = r.state('Bogus');
    expect(out).toMatchObject({ status: 'unresolved', stateId: null });
    expect(r.pending.aliases[0].note).toMatch(/not in the loaded registry/);
  });

  it('records each distinct label once and answers repeats from the cache', () => {
    const r = make();
    r.state('Bihar');
    r.state('BIHAR');
    r.state('bihar ');
    expect(r.pending.aliases).toHaveLength(1);
  });
});

describe('district resolution', () => {
  it('resolves only inside the already-resolved state, so a shared name never crosses states', () => {
    const r = make();
    const mh = r.state('Maharashtra');
    const br = r.state('Bihar');
    expect(r.district(mh, 'Maharashtra', 'aurangabad')).toMatchObject({
      status: 'resolved',
      districtId: 'd-mh-a',
    });
    expect(r.district(br, 'Bihar', 'aurangabad')).toMatchObject({
      status: 'resolved',
      districtId: 'd-br-a',
    });
  });

  it('leaves a district absent from the reference unresolved (never invents one)', () => {
    const r = make();
    const mh = r.state('Maharashtra');
    expect(r.district(mh, 'Maharashtra', 'Palghar')).toMatchObject({
      status: 'unresolved',
      districtId: null,
    });
    expect(r.pending.aliases.at(-1)).toMatchObject({
      table: 'district_aliases',
      status: 'unresolved',
    });
  });

  it('does not resolve a district when its state is unresolved', () => {
    const r = make();
    const bad = r.state('Gao');
    expect(r.district(bad, 'Gao', 'Nashik')).toEqual({ status: 'unresolved', districtId: null });
    expect(r.pending.aliases.filter((a) => a.table === 'district_aliases')).toHaveLength(0);
  });

  it('scopes the alias to the source state label, so equal labels under different states stay separate', () => {
    const r = make();
    const mh = r.state('Maharashtra');
    const br = r.state('Bihar');
    r.district(mh, 'Maharashtra', 'aurangabad');
    r.district(br, 'Bihar', 'aurangabad');
    const keys = r.pending.aliases.filter((a) => a.table === 'district_aliases').map((a) => a.key);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('market identity', () => {
  it('never merges markets that share a name in different districts', () => {
    const r = make();
    const mh = r.state('Maharashtra');
    const d1 = r.district(mh, 'Maharashtra', 'nashik'); // resolved
    const d2 = r.district(mh, 'Maharashtra', 'palghar'); // unresolved
    const a = r.market({ stateId: 's-mh' }, d1, {
      state: 'Maharashtra',
      district: 'nashik',
      market: 'Central Mandi',
    });
    const b = r.market({ stateId: 's-mh' }, d2, {
      state: 'Maharashtra',
      district: 'palghar',
      market: 'Central Mandi',
    });
    const c = r.market(
      { stateId: 's-mh' },
      { districtId: null },
      { state: 'Maharashtra', district: 'thane', market: 'Central Mandi' },
    );
    expect(new Set([a, b, c]).size).toBe(3);
    expect(r.pending.markets).toHaveLength(3);
  });

  it('puts the source district label into the identity only when the district is unresolved', () => {
    const r = make();
    const mh = r.state('Maharashtra');
    r.market({ stateId: 's-mh' }, r.district(mh, 'Maharashtra', 'nashik'), {
      state: 'Maharashtra',
      district: 'nashik',
      market: 'A',
    });
    r.market({ stateId: 's-mh' }, r.district(mh, 'Maharashtra', 'palghar'), {
      state: 'Maharashtra',
      district: 'palghar',
      market: 'B',
    });
    const [resolved, unresolved] = r.pending.markets;
    expect(resolved).toMatchObject({ districtId: 'd-mh-n', disambiguator: '' });
    expect(unresolved).toMatchObject({ districtId: null, disambiguator: 'src-district:palghar' });
  });

  it('returns the same market for the same source labels, in any case', () => {
    const r = make();
    const labels = { state: 'Maharashtra', district: 'nashik', market: 'Lasalgaon(Niphad)' };
    const d = r.district(r.state('Maharashtra'), 'Maharashtra', 'nashik');
    const first = r.market({ stateId: 's-mh' }, d, labels);
    const again = r.market({ stateId: 's-mh' }, d, { ...labels, market: 'LASALGAON(NIPHAD)' });
    expect(again).toBe(first);
    expect(r.pending.markets).toHaveLength(1);
  });

  it('marks created markets as alias-resolved, with a note saying they are unverified', () => {
    const r = make();
    const d = r.district(r.state('Maharashtra'), 'Maharashtra', 'nashik');
    r.market({ stateId: 's-mh' }, d, { state: 'Maharashtra', district: 'nashik', market: 'X' });
    const alias = r.pending.aliases.find((a) => a.table === 'market_aliases');
    expect(alias).toMatchObject({ status: 'resolved' });
    expect(alias?.note).toMatch(/unverified/);
  });
});

describe('commodities and varieties', () => {
  it('creates a commodity per exact label and reuses an exact normalised match', () => {
    const r = make();
    const a = r.commodity('Wheat');
    expect(r.commodity('  wheat ')).toBe(a);
    expect(r.commodity('Wheat Atta')).not.toBe(a);
    expect(r.pending.commodities).toHaveLength(2);
  });

  it('does not merge labels that differ by punctuation', () => {
    const r = make();
    expect(r.commodity('Banana - Green')).not.toBe(r.commodity('Banana Green'));
  });

  it('stores the source commodity group on creation only', () => {
    const r = make();
    r.commodity('Amaranthus', 'Vegetables');
    r.commodity('amaranthus', 'Other');
    expect(r.pending.commodities).toEqual([expect.objectContaining({ group: 'Vegetables' })]);
  });

  it('treats "Other" and blank varieties as unspecified (NULL), but "Local" as a real variety', () => {
    const r = make();
    const c = r.commodity('Potato');
    expect(r.variety(c, 'Potato', 'Other')).toBeNull();
    expect(r.variety(c, 'Potato', '')).toBeNull();
    expect(r.variety(c, 'Potato', ' other ')).toBeNull();
    const local = r.variety(c, 'Potato', 'Local');
    expect(local).toBeTruthy();
    expect(r.variety(c, 'Potato', 'LOCAL')).toBe(local);
    expect(r.pending.varieties).toHaveLength(1);
  });

  it('keeps a variety under its own commodity: the same name under two commodities is two varieties', () => {
    const r = make();
    const a = r.variety(r.commodity('Potato'), 'Potato', 'Local');
    const b = r.variety(r.commodity('Onion'), 'Onion', 'Local');
    expect(a).not.toBe(b);
  });
});

describe('transaction bookkeeping', () => {
  it('rollback forgets everything created since the last commit', () => {
    const r = make();
    r.commodity('Wheat');
    r.commit();
    const second = r.commodity('Rice');
    expect(r.pending.commodities).toHaveLength(1);
    r.rollback();
    expect(r.pending.commodities).toHaveLength(0);
    expect(r.commodity('Rice')).not.toBe(second); // forgotten, so a fresh id is made
    expect(r.commodity('Wheat')).toBeTruthy();
  });

  it('commit keeps entries but clears the pending lists', () => {
    const r = make();
    const id = r.commodity('Wheat');
    r.commit();
    expect(r.pending.commodities).toHaveLength(0);
    expect(r.commodity('Wheat')).toBe(id);
    expect(r.pending.commodities).toHaveLength(0);
  });

  it('assigns WPI series once per normalised label', () => {
    const r = make();
    const id = r.wpiSeriesId('Bajra');
    expect(r.wpiSeriesId(' bajra ')).toBe(id);
    expect(r.pending.wpiSeries).toHaveLength(1);
  });
});
