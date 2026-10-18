import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../test/helpers.js';

/**
 * Contract tests: live responses must satisfy docs/api/express.openapi.json. The validator below
 * implements only the JSON Schema subset the document uses (type, enum, required, properties,
 * additionalProperties, items, pattern, minimum, $ref), so no extra dependency is needed.
 */

const document = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../docs/api/express.openapi.json', import.meta.url)),
    'utf8',
  ),
);

/** @param {string} ref */
function resolve(ref) {
  return ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node, key) => node[key], document);
}

/**
 * @param {any} schema
 * @param {unknown} value
 * @param {string} where
 * @returns {string[]} violations
 */
function validate(schema, value, where = '$') {
  if (schema.$ref) return validate(resolve(schema.$ref), value, where);
  const errors = [];
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${where}: not in enum`);
  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [...errors, `${where}: expected object`];
      }
      const record = /** @type {Record<string, unknown>} */ (value);
      for (const key of schema.required ?? []) {
        if (!(key in record)) errors.push(`${where}.${key}: missing`);
      }
      for (const [key, v] of Object.entries(record)) {
        const sub = schema.properties?.[key];
        if (sub) errors.push(...validate(sub, v, `${where}.${key}`));
        else if (schema.additionalProperties === false) errors.push(`${where}.${key}: not allowed`);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(value)) return [...errors, `${where}: expected array`];
      value.forEach((item, i) => errors.push(...validate(schema.items, item, `${where}[${i}]`)));
      break;
    case 'string':
      if (typeof value !== 'string') return [...errors, `${where}: expected string`];
      if (schema.pattern && !new RegExp(schema.pattern).test(value))
        errors.push(`${where}: pattern`);
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value)))
        errors.push(`${where}: date-time`);
      break;
    case 'integer':
      if (!Number.isInteger(value)) return [...errors, `${where}: expected integer`];
      if (schema.minimum !== undefined && /** @type {number} */ (value) < schema.minimum)
        errors.push(`${where}: minimum`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${where}: expected boolean`);
      break;
    default:
      break;
  }
  return errors;
}

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
  it('documents exactly the operational endpoints', () => {
    expect(Object.keys(document.paths).sort()).toEqual([
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
