import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './client.js';
import { shouldRunIntegration } from './test/db.js';
import {
  expectViolation,
  insertRow,
  insertText,
  mandiRow,
  one,
  requireCanonicalSchema,
  seedBasics,
  suffix,
  withRollback,
} from './test/fixtures.js';

/**
 * Registry integrity (states, districts, markets, commodities, varieties, aliases).
 * Real PostgreSQL, application role, every test rolled back. Prerequisites: running, migrated
 * database (see database/README.md). Skipped when the database is down unless REQUIRE_DB=1.
 */
const appUrl = process.env.DATABASE_URL ?? '';

describe.runIf(shouldRunIntegration)('canonical schema: registries', () => {
  /** @type {ReturnType<typeof createDb>} */
  let app;
  beforeAll(async () => {
    app = createDb(appUrl);
    await requireCanonicalSchema(app.pool);
  });
  afterAll(async () => {
    await app?.close();
  });

  const tx = (work) => withRollback(app.pool, work);

  describe('geography', () => {
    it('stores state and union-territory kinds and rejects anything else', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const kinds = await c.query(`SELECT kind FROM states WHERE id IN ($1, $2) ORDER BY kind`, [
          b.stateId,
          b.otherStateId,
        ]);
        expect(kinds.rows.map((r) => r.kind)).toEqual(['state', 'union_territory']);
        const bad = insertText('states', { name: `X ${suffix()}`, kind: 'country' });
        expect((await expectViolation(c, bad.text, bad.values)).constraint).toBe('states_kind_ck');
      }));

    it('derives a normalised name and refuses duplicate states by that name', () =>
      tx(async (c) => {
        const tag = suffix();
        await insertRow(c, 'states', { name: `  Test   State ${tag} `, kind: 'state' });
        const stored = await one(c, `SELECT normalized_name FROM states WHERE name LIKE $1`, [
          `%${tag}%`,
        ]);
        expect(stored.normalized_name).toBe(`test state ${tag}`);
        const dup = insertText('states', { name: `TEST STATE ${tag}`, kind: 'state' });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'states_normalized_name_uq',
        );
      }));

    it('does not let a generated column be written directly', () =>
      tx(async (c) => {
        const bad = insertText('states', { name: 'A', normalized_name: 'b', kind: 'state' });
        expect((await expectViolation(c, bad.text, bad.values)).code).toBe('428C9');
      }));

    it('allows the same district name in different states but not twice in one state', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const name = `Shared District ${b.tag}`;
        await insertRow(c, 'districts', { state_id: b.stateId, name });
        await insertRow(c, 'districts', { state_id: b.otherStateId, name });
        const dup = insertText('districts', { state_id: b.stateId, name: name.toUpperCase() });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'districts_state_name_uq',
        );
      }));

    it('requires a district to reference an existing state', () =>
      tx(async (c) => {
        const bad = insertText('districts', {
          state_id: '00000000-0000-4000-8000-000000000000',
          name: 'Orphan',
        });
        expect((await expectViolation(c, bad.text, bad.values)).code).toBe('23503');
      }));

    it('keeps optional official codes unique when present and allows many without one', () =>
      tx(async (c) => {
        const tag = suffix();
        await insertRow(c, 'states', { name: `Code A ${tag}`, kind: 'state', lgd_code: `L${tag}` });
        await insertRow(c, 'states', { name: `No code 1 ${tag}`, kind: 'state' });
        await insertRow(c, 'states', { name: `No code 2 ${tag}`, kind: 'state' });
        const dup = insertText('states', {
          name: `Code B ${tag}`,
          kind: 'state',
          lgd_code: `L${tag}`,
        });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'states_lgd_code_uq',
        );
      }));
  });

  describe('markets', () => {
    it('rejects a district that belongs to a different state than the market', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const bad = insertText('markets', {
          state_id: b.otherStateId,
          district_id: b.districtId, // district of the OTHER state
          name: `Wrong-state mandi ${b.tag}`,
        });
        expect((await expectViolation(c, bad.text, bad.values)).constraint).toBe(
          'markets_district_state_fk',
        );
      }));

    it('does not require a district or coordinates', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = await insertRow(c, 'markets', {
          state_id: b.stateId,
          name: `Bare mandi ${b.tag}`,
        });
        expect(r.rows[0].district_id).toBeNull();
        expect(r.rows[0].latitude).toBeNull();
        expect(r.rows[0].longitude).toBeNull();
      }));

    it('refuses to merge two markets with the same identity, with or without a district', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const withDistrict = insertText('markets', {
          state_id: b.stateId,
          district_id: b.districtId,
          name: `TEST MANDI ${b.tag}`.toUpperCase(),
        });
        expect((await expectViolation(c, withDistrict.text, withDistrict.values)).constraint).toBe(
          'markets_identity_uq',
        );
        await insertRow(c, 'markets', { state_id: b.stateId, name: `No district ${b.tag}` });
        const noDistrict = insertText('markets', {
          state_id: b.stateId,
          name: `No  district ${b.tag}`,
        });
        expect((await expectViolation(c, noDistrict.text, noDistrict.values)).constraint).toBe(
          'markets_identity_uq',
        );
      }));

    it('lets two genuinely different markets share a name via a disambiguator, or across states', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertRow(c, 'markets', {
          state_id: b.stateId,
          district_id: b.districtId,
          name: `Test Mandi ${b.tag}`,
          disambiguator: 'north yard',
        });
        await insertRow(c, 'markets', { state_id: b.otherStateId, name: `Test Mandi ${b.tag}` });
        const count = await one(c, `SELECT count(*)::int AS n FROM markets WHERE name = $1`, [
          `Test Mandi ${b.tag}`,
        ]);
        expect(count.n).toBe(3);
      }));

    it('validates coordinates: both or neither, within range', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const base = { state_id: b.stateId };
        const cases = [
          { name: `lat only ${b.tag}`, latitude: 12.5 },
          { name: `lon only ${b.tag}`, longitude: 77.5 },
          { name: `lat range ${b.tag}`, latitude: 91, longitude: 77 },
          { name: `lon range ${b.tag}`, latitude: 12, longitude: 181 },
        ];
        for (const extra of cases) {
          const bad = insertText('markets', { ...base, ...extra });
          expect((await expectViolation(c, bad.text, bad.values)).constraint).toBe(
            'markets_coordinates_ck',
          );
        }
        await insertRow(c, 'markets', {
          ...base,
          name: `coords ok ${b.tag}`,
          latitude: 18.52,
          longitude: 73.85,
        });
      }));

    it('records a manual merge only with a target, and never into itself', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const twin = await insertRow(c, 'markets', { state_id: b.stateId, name: `Twin ${b.tag}` });
        await c.query(
          `UPDATE markets SET status = 'merged', merged_into_market_id = $2 WHERE id = $1`,
          [twin.rows[0].id, b.marketId],
        );
        const noTarget = await expectViolation(
          c,
          `UPDATE markets SET status = 'merged' WHERE id = $1`,
          [b.marketId],
        );
        expect(noTarget.constraint).toBe('markets_merge_ck');
        const self = await expectViolation(
          c,
          `UPDATE markets SET status = 'merged', merged_into_market_id = id WHERE id = $1`,
          [b.marketId],
        );
        expect(self.constraint).toBe('markets_merge_ck');
      }));
  });

  describe('commodities and varieties', () => {
    it('supports any commodity name without a built-in list', () =>
      tx(async (c) => {
        const tag = suffix();
        for (const name of [`Alpha crop ${tag}`, `Beta crop ${tag}`, `Gamma-${tag}`]) {
          await insertRow(c, 'commodities', { name, commodity_group: 'Synthetic' });
        }
        const dup = insertText('commodities', { name: `ALPHA  crop ${tag}` });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'commodities_normalized_name_uq',
        );
      }));

    it('keeps a variety name unique within its commodity only', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        await insertRow(c, 'varieties', {
          commodity_id: b.otherCommodityId,
          name: `Test Variety ${b.tag}`,
        });
        const dup = insertText('varieties', {
          commodity_id: b.commodityId,
          name: `test variety ${b.tag}`,
        });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'varieties_commodity_name_uq',
        );
      }));

    it('rejects an observation whose variety belongs to another commodity', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const bad = insertText(
          'mandi_observations',
          mandiRow(b, { commodity_id: b.otherCommodityId }),
        );
        expect((await expectViolation(c, bad.text, bad.values)).constraint).toBe(
          'mandi_obs_variety_fk',
        );
      }));

    it('accepts an unknown variety as NULL and keeps the original label', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = await insertRow(
          c,
          'mandi_observations',
          mandiRow(b, { variety_id: null, variety_label: 'Other' }),
        );
        expect(r.rows[0].variety_id).toBeNull();
        expect(r.rows[0].variety_label).toBe('Other');
        expect(
          (await c.query(`SELECT count(*)::int AS n FROM varieties WHERE name ILIKE 'other'`))
            .rows[0].n,
        ).toBe(0);
      }));
  });

  describe('source aliases', () => {
    it('scopes a label to one source and prevents a second row for the same label key', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const label = {
          source_id: b.sourceId,
          source_key: `chattisgarh|${b.tag}`,
          source_label: 'Chattisgarh',
        };
        await insertRow(c, 'state_aliases', label);
        const dup = insertText('state_aliases', label);
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'state_alias_source_key_uq',
        );
        // The same label may exist independently for another source.
        await insertRow(c, 'state_aliases', { ...label, source_id: b.otherSourceId });
      }));

    it('is unresolved by default and only becomes resolved with an entity and a timestamp', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const alias = await insertRow(c, 'state_aliases', {
          source_id: b.sourceId,
          source_key: `a|${b.tag}`,
          source_label: 'Orissa',
        });
        expect(alias.rows[0].resolution_status).toBe('unresolved');
        const bare = await expectViolation(
          c,
          `UPDATE state_aliases SET resolution_status = 'resolved' WHERE id = $1`,
          [alias.rows[0].id],
        );
        expect(bare.constraint).toBe('state_alias_resolved_ck');
        await c.query(
          `UPDATE state_aliases SET resolution_status = 'resolved', state_id = $2, resolved_at = now() WHERE id = $1`,
          [alias.rows[0].id, b.stateId],
        );
        const stray = await expectViolation(
          c,
          `UPDATE state_aliases SET resolution_status = 'ambiguous' WHERE id = $1`,
          [alias.rows[0].id],
        );
        expect(stray.constraint).toBe('state_alias_resolved_ck');
      }));

    it('can record an ambiguous market alias without choosing a market', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const r = await insertRow(c, 'market_aliases', {
          source_id: b.sourceId,
          source_key: `x|y|${b.tag}`,
          source_label: 'Pune',
          source_context: 'Maharashtra|pune',
          resolution_status: 'ambiguous',
          resolution_note: 'several yards share this label',
        });
        expect(r.rows[0].market_id).toBeNull();
      }));

    it('keeps a source code unique per source and allows many aliases without a code', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const base = { source_id: b.sourceId, source_label: 'Wheat' };
        await insertRow(c, 'commodity_aliases', {
          ...base,
          source_key: `k1|${b.tag}`,
          source_code: 'C-1',
        });
        const dup = insertText('commodity_aliases', {
          ...base,
          source_key: `k2|${b.tag}`,
          source_code: 'C-1',
        });
        expect((await expectViolation(c, dup.text, dup.values)).constraint).toBe(
          'commodity_alias_source_code_uq',
        );
        await insertRow(c, 'commodity_aliases', { ...base, source_key: `k3|${b.tag}` });
        await insertRow(c, 'commodity_aliases', { ...base, source_key: `k4|${b.tag}` });
      }));

    it('cannot resolve an alias to an entity of another type', () =>
      tx(async (c) => {
        const b = await seedBasics(c);
        const bad = insertText('market_aliases', {
          source_id: b.sourceId,
          source_key: `m|${b.tag}`,
          source_label: 'Somewhere',
          market_id: b.stateId, // a STATE id used as a market id
          resolution_status: 'resolved',
          resolved_at: new Date().toISOString(),
        });
        expect((await expectViolation(c, bad.text, bad.values)).code).toBe('23503');
      }));
  });
});
