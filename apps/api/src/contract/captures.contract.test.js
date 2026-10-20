import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { document } from '../test/openapi.js';
import { createSchemaValidator, documentedResponse } from '../test/openapiSchema.js';

/**
 * Contract validation: every captured REAL response (docs/api/examples/real and the frontend's
 * versioned captures in apps/web/src/test/contract/v1) must satisfy the response schema that
 * docs/api/express.openapi.json documents for its request. Ajv (JSON Schema 2020-12) does the
 * checking. No database and no network are needed, so this runs in CI on every change.
 *
 * It fails when a field a response carries is missing or has the wrong type, when an envelope or
 * pagination block does not match, when a response does not declare itself historical
 * (meta.is_live must be false), and when the document changes incompatibly (a capture no longer
 * validates). The negative tests below prove each of those is detected.
 */

const here = (/** @type {string} */ rel) => fileURLToPath(new URL(rel, import.meta.url));
const DIRS = [
  { dir: here('../../../../docs/api/examples/real/'), label: 'docs/api/examples/real' },
  { dir: here('../../../web/src/test/contract/v1/'), label: 'apps/web/src/test/contract/v1' },
];

/** @typedef {{ label: string, file: string, request: string, status: number, body: any }} Capture */

/** @returns {Capture[]} */
function loadCaptures() {
  /** @type {Capture[]} */
  const out = [];
  for (const { dir, label } of DIRS) {
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.json') && f !== 'manifest.json',
    )) {
      const doc = JSON.parse(readFileSync(`${dir}${file}`, 'utf8'));
      out.push({
        label,
        file,
        request: String(doc.request).replace(/^GET /, ''),
        status: doc.status ?? 200,
        body: doc.response,
      });
    }
  }
  return out;
}

const captures = loadCaptures();
const validator = createSchemaValidator();
const pathOf = (/** @type {string} */ request) => request.split('?')[0];
/** @param {Capture} c */
const schemaNameFor = (c) =>
  documentedResponse('GET', pathOf(c.request), c.status)?.schemaRef ?? null;
const clone = (/** @type {any} */ v) => JSON.parse(JSON.stringify(v));
/** @param {Capture} c @param {any} body */
const verdict = (c, body) => validator.check(/** @type {string} */ (schemaNameFor(c)), body);

describe('captured real responses satisfy the OpenAPI document', () => {
  it('finds the captures it is supposed to validate', () => {
    expect(captures.length).toBeGreaterThanOrEqual(25);
    expect(new Set(captures.map((c) => c.label)).size).toBe(2);
  });

  it.each(captures.map((c) => [`${c.label}/${c.file}`, c]))(
    '%s validates against its documented response schema',
    (_name, c) => {
      expect(
        documentedResponse('GET', pathOf(c.request), c.status),
        `${c.request} is not documented`,
      ).not.toBeNull();
      expect(schemaNameFor(c), `${c.request} (${c.status}) has no response schema`).not.toBeNull();
      const result = verdict(c, c.body);
      expect(result.errors).toEqual([]);
    },
  );

  it('covers every endpoint the frontend uses (a captured example exists for each)', () => {
    const covered = new Set(
      captures.map((c) => documentedResponse('GET', pathOf(c.request), c.status)?.template),
    );
    for (const template of [
      '/api/v1/states',
      '/api/v1/commodities',
      '/api/v1/markets',
      '/api/v1/markets/{id}',
      '/api/v1/mandi-prices',
      '/api/v1/mandi-prices/latest',
      '/api/v1/state-prices',
      '/api/v1/coverage',
      '/api/v1/sources',
      '/api/v1/geography/unresolved',
    ]) {
      expect(covered.has(template), `no captured example for ${template}`).toBe(true);
    }
  });

  it('every successful capture declares itself a historical snapshot (is_live false)', () => {
    for (const c of captures.filter((x) => x.status === 200)) {
      expect(c.body.meta?.is_live, `${c.label}/${c.file}`).toBe(false);
      expect(c.body.meta?.data_status, `${c.label}/${c.file}`).toBe('historical_snapshot');
    }
  });

  it('the captures hold no credentials, hosts or private data', () => {
    const text = JSON.stringify(captures.map((c) => c.body));
    expect(text).not.toMatch(
      /postgres(ql)?:\/\/|password|secret|api[_-]?key|bearer |localhost|127\.0\.0\.1/i,
    );
  });
});

describe('the validator detects incompatible responses and contract changes', () => {
  const latest = /** @type {Capture} */ (
    captures.find((c) => c.file === 'mandi-prices-latest.json' && c.label.startsWith('apps/web'))
  );
  const mandi = /** @type {Capture} */ (
    captures.find((c) => c.file === 'mandi-prices.json' && c.label.startsWith('apps/web'))
  );
  const markets = /** @type {Capture} */ (
    captures.find((c) => c.file === 'markets-unresolved-district.json')
  );

  it('has its reference captures', () => {
    expect([latest, mandi, markets].every(Boolean)).toBe(true);
    expect(verdict(latest, latest.body).valid).toBe(true);
  });

  it('detects a missing required field (in a row, in meta and at the envelope)', () => {
    for (const mutate of [
      (b) => delete b.data[0].provenance,
      (b) => delete b.data[0].unit_basis,
      (b) => delete b.data[0].latest_observation_date,
      (b) => delete b.meta.reference_date,
      (b) => delete b.meta.requested_at,
      (b) => delete b.pagination,
      (b) => delete b.meta,
      (b) => delete b.data,
    ]) {
      const body = clone(latest.body);
      mutate(body);
      expect(verdict(latest, body).valid, String(mutate)).toBe(false);
    }
  });

  it('detects an incorrect field type', () => {
    for (const mutate of [
      (b) => (b.data[0].modal_price = '391'),
      (b) => (b.data[0].observations_on_latest_date = 'one'),
      (b) => (b.data[0].observed_date = 20250611),
      (b) => (b.data[0].market.verification_status = null),
      (b) => (b.data[0].provenance.source_row_number = '12'),
      (b) => (b.pagination.has_more = 'no'),
      (b) => (b.pagination.next_cursor = 42),
      (b) => (b.meta.requested_at = 'yesterday'),
      (b) => (b.meta.filters.state_id = 7),
    ]) {
      const body = clone(latest.body);
      mutate(body);
      expect(verdict(latest, body).valid, String(mutate)).toBe(false);
    }
  });

  it('detects a mismatched envelope', () => {
    const bare = clone(latest.body.data); // a bare array instead of { data, pagination, meta }
    expect(verdict(latest, bare).valid).toBe(false);
    const renamed = clone(latest.body);
    renamed.items = renamed.data;
    delete renamed.data;
    expect(verdict(latest, renamed).valid).toBe(false);
    const stray = clone(latest.body);
    stray.extra_top_level = true;
    expect(verdict(latest, stray).valid).toBe(false);
    expect(verdict(latest, null).valid).toBe(false);
  });

  it('detects bad pagination', () => {
    for (const mutate of [
      (b) => (b.pagination.limit = 0),
      (b) => delete b.pagination.has_more,
      (b) => (b.pagination.extra = 1),
    ]) {
      const body = clone(markets.body);
      mutate(body);
      expect(verdict(markets, body).valid, String(mutate)).toBe(false);
    }
  });

  it('enforces historical-only responses: a response claiming to be live is invalid', () => {
    for (const c of [latest, mandi, markets]) {
      const body = clone(c.body);
      body.meta.is_live = true;
      expect(verdict(c, body).valid, c.file).toBe(false);
      const wrongStatus = clone(c.body);
      wrongStatus.meta.data_status = 'live';
      expect(verdict(c, wrongStatus).valid, c.file).toBe(false);
    }
  });

  it('detects a state-level row smuggled into a mandi-level list', () => {
    const state = /** @type {Capture} */ (
      captures.find((c) => c.file === 'state-prices-keralam.json' && c.label.startsWith('apps/web'))
    );
    const body = clone(mandi.body);
    body.data.push(clone(state.body.data[0]));
    expect(verdict(mandi, body).valid).toBe(false);
  });

  it('fails when the document changes incompatibly (a new required field, a removed field, a type change)', () => {
    const base = clone(document.components.schemas);
    /** @param {(s: any) => void} edit */
    const changed = (edit) => {
      const schemas = clone(base);
      edit(schemas);
      return createSchemaValidator(schemas).check('LatestMandiPriceList', latest.body);
    };
    expect(changed(() => undefined).valid).toBe(true);
    // a new required field the API does not return
    expect(changed((s) => s.LatestMandiPrice.required.push('trend')).valid).toBe(false);
    // a property the API still returns is removed from the contract (additionalProperties is false)
    expect(changed((s) => delete s.LatestMandiPrice.properties.grade).valid).toBe(false);
    // a type change
    expect(
      changed((s) => (s.LatestMandiPrice.properties.modal_price = { type: 'string' })).valid,
    ).toBe(false);
    // the historical-only guarantee weakened or removed
    expect(changed((s) => (s.LatestMandiMeta.properties.is_live = { type: 'string' })).valid).toBe(
      false,
    );
  });

  it('the documented error body is validated too', () => {
    const error = /** @type {Capture} */ (
      captures.find((c) => c.file === 'error-latest-missing-commodity.json')
    );
    expect(error.status).toBe(400);
    expect(verdict(error, error.body).valid).toBe(true);
    const bad = clone(error.body);
    bad.error.code = 'SOMETHING_NEW';
    expect(verdict(error, bad).valid).toBe(false);
  });
});
