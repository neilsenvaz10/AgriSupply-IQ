import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../test/helpers.js';
import { document, validate } from '../test/openapi.js';

/**
 * Contract tests: live responses must satisfy docs/api/express.openapi.json. The validator below
 * implements only the JSON Schema subset the document uses (type, enum, required, properties,
 * additionalProperties, items, pattern, minimum, $ref), so no extra dependency is needed.
 */

/** @param {string} path @param {string} status */
function responseSchema(path, status) {
  return document.paths[path].get.responses[status].content['application/json'].schema;
}

const HEALTH = { status: 'ok', service: 'fasalytics-intelligence', version: '0.1.0' };
const fetchImpl = vi.fn(async (url) =>
  new URL(String(url)).pathname === '/ready'
    ? new Response(JSON.stringify({ ...HEALTH, status: 'not_ready', model_ready: false }), {
        status: 503,
      })
    : new Response(JSON.stringify(HEALTH), { status: 200 }),
);
const healthyPool = {
  connect: vi.fn(async () => ({ query: vi.fn(async () => ({})), release: vi.fn() })),
  end: vi.fn(),
  on: vi.fn(),
};
const downPool = {
  connect: vi.fn(async () => {
    throw Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
  }),
  end: vi.fn(),
  on: vi.fn(),
};

/** @param {any} pool @param {Partial<import('../config/env.js').AppConfig>} [extra] */
const appWith = (pool, extra = {}) =>
  createApp(
    testConfig({
      databaseUrl: 'postgresql://fasalytics_app:pw@db:5432/f',
      mlServiceUrl: 'http://intelligence:8000',
      ...extra,
    }),
    {
      fetchImpl: /** @type {any} */ (fetchImpl),
      pool,
    },
  );

describe('docs/api/express.openapi.json', () => {
  it('documents the operational endpoints and only GET historical endpoints under /api/v1', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(expect.arrayContaining(['/health', '/health/dependencies', '/ready']));
    for (const path of paths.filter((p) => p.startsWith('/api/v1/'))) {
      expect(Object.keys(document.paths[path])).toEqual(['get']);
    }
    expect(paths.filter((p) => !p.startsWith('/api/v1/')).sort()).toEqual([
      '/health',
      '/health/dependencies',
      '/ready',
    ]);
  });

  it('the validator itself rejects a wrong document (guards against a vacuous test)', () => {
    const schema = responseSchema('/health', '200');
    expect(validate(schema, { status: 'ok' }).length).toBeGreaterThan(0);
    expect(
      validate(schema, {
        status: 'nope',
        service: 'x',
        version: '1',
        uptime_seconds: 1,
        timestamp: 'now',
      }).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    ['/health', 200, () => appWith(healthyPool)],
    ['/health/dependencies', 200, () => appWith(healthyPool)],
    ['/health/dependencies', 200, () => appWith(downPool)],
    ['/health/dependencies', 200, () => createApp(testConfig())],
    ['/ready', 200, () => appWith(healthyPool)],
    ['/ready', 503, () => appWith(downPool)],
    ['/ready', 200, () => createApp(testConfig())],
  ])('GET %s (%i) matches its documented schema', async (path, status, build) => {
    const res = await request(build()).get(path);
    expect(res.status).toBe(status);
    expect(validate(responseSchema(path, String(status)), res.body)).toEqual([]);
    expect(res.headers['x-request-id']).toMatch(
      new RegExp(document.components.parameters.RequestId.schema.pattern + '|^[0-9a-f-]{36}$'),
    );
  });

  it('error responses match the documented ErrorResponse', async () => {
    const app = createApp(testConfig());
    for (const res of [
      await request(app).get('/missing'),
      await request(app).post('/health').send({}),
    ]) {
      expect(validate({ $ref: '#/components/schemas/ErrorResponse' }, res.body)).toEqual([]);
    }
  });
});

describe('real example responses in docs/api/examples/real', () => {
  const dir = fileURLToPath(new URL('../../../../docs/api/examples/real/', import.meta.url));
  /** @type {Record<string, string>} */
  const PATHS = {
    'states-kerala': '/api/v1/states',
    'geography-unresolved': '/api/v1/geography/unresolved',
    'commodity-wheat': '/api/v1/commodities',
    'market-unresolved-district': '/api/v1/markets/{id}',
    'mandi-prices': '/api/v1/mandi-prices',
    'state-prices-keralam': '/api/v1/state-prices',
    'national-prices': '/api/v1/national-prices',
    'wpi-observations': '/api/v1/wpi/observations',
    coverage: '/api/v1/coverage',
    sources: '/api/v1/sources',
  };

  it('every example is a documented real capture that satisfies its schema', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.map((f) => f.replace('.json', '')).sort()).toEqual(Object.keys(PATHS).sort());
    for (const file of files) {
      const example = JSON.parse(readFileSync(`${dir}${file}`, 'utf8'));
      expect(example._about, file).toMatch(/^REAL RESPONSE captured from/);
      const schema =
        document.paths[PATHS[file.replace('.json', '')]].get.responses['200'].content[
          'application/json'
        ].schema;
      expect(validate(schema, example.response), file).toEqual([]);
      expect(example.response.meta.is_live, file).toBe(false);
    }
  });
});
