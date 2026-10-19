import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { decisionsForSource, loadDecisions } from './registry/decisions.js';
import { readReferenceSet } from './registry/lgd.js';
import { resolverFromReference } from './registry/memory.js';
import { sha256 } from './util.js';

const REFERENCE = fileURLToPath(new URL('../../reference/lgd', import.meta.url));
const ALIASES = fileURLToPath(new URL('../../reference/aliases', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'fasalytics-registry-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A copy of the real reference set that tests may damage. */
function copyReference(name) {
  const dir = join(work, name);
  cpSync(REFERENCE, dir, { recursive: true });
  return dir;
}

describe('LGD reference set (provisional, December 2022)', () => {
  it('is verified against its manifest and says plainly that it is provisional', async () => {
    const ref = await readReferenceSet(REFERENCE);
    expect(ref.manifest.status).toBe('provisional-historical');
    expect(ref.manifest.referenceDate).toBe('2022-12');
    expect(ref.manifest.licence.name).toMatch(/GODL/);
    expect(ref.manifest.retrievedAt).toMatch(/^2026-10-18T/);
    expect(ref.manifest.authority.mirror).toMatch(/github\.com\/planemad/);
    expect(ref.manifest.statusNote).toMatch(/NOT a verified current/);
    for (const f of ref.manifest.files) {
      expect(f.url).toMatch(/^https:\/\/raw\.githubusercontent\.com\//);
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('parses 36 states/UTs and 763 districts with no problem rows', async () => {
    const ref = await readReferenceSet(REFERENCE);
    expect(ref.states).toHaveLength(36);
    expect(ref.districts).toHaveLength(763);
    expect(ref.problems).toEqual([]);
    expect(ref.states.filter((s) => s.kind === 'union_territory')).toHaveLength(8);
    expect(new Set(ref.states.map((s) => s.code)).size).toBe(36);
    for (const d of ref.districts)
      expect(ref.states.some((s) => s.code === d.stateCode)).toBe(true);
  });

  it('does not contain the original sources of the mirror beyond the two approved files', () => {
    const manifest = JSON.parse(readFileSync(join(REFERENCE, 'manifest.json'), 'utf8'));
    expect(manifest.files.map((f) => f.name).sort()).toEqual(['1-state.csv', '2-district.csv']);
  });

  it('detects a file that changed after the manifest was written', async () => {
    const dir = copyReference('tampered');
    writeFileSync(
      join(dir, '1-state.csv'),
      readFileSync(join(dir, '1-state.csv'), 'utf8') + '99,99,1,ATLANTIS,ATLANTIS,,,S\n',
    );
    await expect(readReferenceSet(dir)).rejects.toThrow(/does not match the SHA-256/);
  });

  it('refuses a manifest with missing provenance or an unknown format or status', async () => {
    const dir = copyReference('badmanifest');
    const manifestPath = join(dir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const [patch, message] of [
      [{ licence: undefined }, /licence/],
      [{ retrievedAt: undefined }, /retrievedAt/],
      [{ format: 'mystery-v9' }, /unknown reference format/],
      [{ status: 'trusted' }, /status must be/],
    ]) {
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...patch }));
      await expect(readReferenceSet(dir)).rejects.toThrow(message);
    }
  });

  it('reports malformed, duplicate and orphan rows as problems instead of loading them', async () => {
    const dir = join(work, 'dirty');
    mkdirSync(dir);
    const states =
      'S.No.,State Code,State Version,State Name,State Name,Census 2001 Code,Census 2011 Code,State or UT\n1,27,1,MAHARASHTRA,MAHARASHTRA,27,27,S\n2,27,1,MAHARASHTRA AGAIN,MAHARASHTRA AGAIN,27,27,S\n3,,1,NOCODE,NOCODE,,,S\n4,9,1,UP,UP,9,9,Q\n';
    const districts =
      '"State Code","State Name","District Code","District Name","Census 2001 Code","Census 2011 Code"\n27,MAHARASHTRA,521,NASHIK,,\n27,MAHARASHTRA,522,Nashik,,\n27,MAHARASHTRA,521,DUPCODE,,\n88,UNKNOWN,700,GHOST,,\n';
    writeFileSync(join(dir, 's.csv'), states);
    writeFileSync(join(dir, 'd.csv'), districts);
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        referenceSet: 'dirty',
        format: 'lgd-mirror-v1',
        status: 'provisional-historical',
        referenceDate: '2022-12',
        licence: { name: 'x' },
        retrievedAt: '2026-01-01T00:00:00Z',
        files: [
          { role: 'states', name: 's.csv', sha256: sha256(states), bytes: states.length },
          { role: 'districts', name: 'd.csv', sha256: sha256(districts), bytes: districts.length },
        ],
      }),
    );
    const ref = await readReferenceSet(dir);
    expect(ref.states.map((s) => s.code)).toEqual(['27']);
    expect(ref.districts.map((d) => d.code)).toEqual(['521']);
    expect(ref.problems.map((p) => p.reason).sort()).toEqual([
      'district names an unknown state code',
      'duplicate district code or name within a state',
      'duplicate district code or name within a state',
      'duplicate state code',
      'malformed state row',
      'malformed state row',
    ]);
  });

  it('builds an in-memory resolver whose states and districts come only from the reference', async () => {
    const ref = await readReferenceSet(REFERENCE);
    const r = resolverFromReference(ref, new Map());
    const mh = r.state('maharashtra');
    expect(mh.status).toBe('resolved');
    expect(r.district(mh, 'maharashtra', 'nashik').status).toBe('resolved');
    expect(r.district(mh, 'maharashtra', 'a district created in 2024').status).toBe('unresolved');
    expect(r.state('Atlantis').status).toBe('unresolved');
  });
});

describe('reviewed alias decisions', () => {
  it('loads the committed state decisions, each with a reviewer note, and Gao stays unresolved', async () => {
    const all = await loadDecisions(ALIASES);
    const forSource = decisionsForSource(all, 'mandi_daily_prices_historical');
    expect(forSource.get('state|gao')).toMatchObject({ status: 'unresolved', entityId: null });
    expect(forSource.get('state|orissa')).toMatchObject({ status: 'resolved', entityId: '21' });
    for (const v of forSource.values()) expect(v.note).toMatch(/^reviewed decision: .+/);
  });

  it('every committed state decision that resolves points at a state code in the reference', async () => {
    const ref = await readReferenceSet(REFERENCE);
    const codes = new Set(ref.states.map((s) => s.code));
    const all = await loadDecisions(ALIASES);
    for (const [key, d] of all)
      if (key.startsWith('state|') && d.entityId) expect(codes.has(d.entityId), key).toBe(true);
  });

  it('prefers a source-specific decision over a wildcard one', () => {
    const all = new Map([
      ['state|*|x', { status: 'resolved', entityId: '1', note: 'wild' }],
      ['state|src_a|x', { status: 'unresolved', entityId: null, note: 'specific' }],
    ]);
    expect(decisionsForSource(all, 'src_a').get('state|x').note).toBe('specific');
    expect(decisionsForSource(all, 'src_b').get('state|x').note).toBe('wild');
  });

  it('refuses malformed decision files', async () => {
    const dir = join(work, 'decisions');
    mkdirSync(dir);
    const header = 'source_code,source_label,context,decision,target_code,note\n';
    const cases = [
      [header + '*,X,,resolved,,because\n', /needs a target_code/],
      [header + '*,X,,unresolved,5,because\n', /only "resolved" may have a target_code/],
      [header + '*,X,,resolved,5,\n', /note explaining the decision is required/],
      [header + '*,X,,maybe,,why\n', /unknown decision/],
      [header + '*,X,,unresolved,,a\n*,x ,,unresolved,,b\n', /duplicate decision/],
      ['source_code,source_label\n', /missing the "context" column/],
    ];
    for (const [content, message] of cases) {
      writeFileSync(join(dir, 'state-aliases.csv'), /** @type {string} */ (content));
      await expect(loadDecisions(dir)).rejects.toThrow(message);
    }
  });

  it('has no district decisions yet: nothing is mapped without evidence', async () => {
    expect(existsSync(join(ALIASES, 'district-aliases.csv'))).toBe(true);
    const all = await loadDecisions(ALIASES);
    expect([...all.keys()].filter((k) => k.startsWith('district|'))).toEqual([]);
  });
});
