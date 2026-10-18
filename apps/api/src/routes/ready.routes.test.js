import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../test/helpers.js';

const DB_URL = 'postgresql://fasalytics_app:S3cr3t@db:5432/fasalytics';

const HEALTH = { status: 'ok', service: 'fasalytics-intelligence', version: '0.1.0' };
const NOT_READY = { status: 'not_ready', service: 'fasalytics-intelligence', model_ready: false };
const READY = { status: 'ready', service: 'fasalytics-intelligence', model_ready: true };

/** fetch double that answers /health and /ready independently; `state` can change mid-test. */
function fakeFetch(state) {
  return vi.fn(async (url) => {
    if (state.down) throw new Error('connect ECONNREFUSED');
    const path = new URL(String(url)).pathname;
    if (path === '/health') return new Response(JSON.stringify(HEALTH), { status: 200 });
    if (path === '/ready') {
      return state.modelsReady
        ? new Response(JSON.stringify(READY), { status: 200 })
        : new Response(JSON.stringify(NOT_READY), { status: 503 });
    }
    return new Response('{}', { status: 404 });
  });
}

/** Pool double whose availability can be flipped. */
function fakePool(state) {
  return {
    connect: vi.fn(async () => {
      if (state.dbDown) throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      return { query: vi.fn(async () => ({ rows: [{ ok: 1 }] })), release: vi.fn() };
    }),
    end: vi.fn(),
    on: vi.fn(),
  };
}

function build(overrides = {}, state = {}) {
  const config = testConfig({
    databaseUrl: DB_URL,
    mlServiceUrl: 'http://intelligence:8000',
    ...overrides,
  });
  const app = createApp(config, {
    fetchImpl: fakeFetch(state),
    pool: /** @type {any} */ (fakePool(state)),
  });
  return { app, state };
}

describe('GET /ready (readiness)', () => {
  it('is 200 ready when every configured dependency is healthy', async () => {
    const { app } = build();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      service: 'fasalytics-api',
      blocking: [],
      dependencies: {
        postgres: { required: true, status: 'healthy' },
        intelligence_service: { required: true, status: 'healthy' },
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Number.isNaN(Date.parse(res.body.checked_at))).toBe(false);
  });

  it('is 503 not_ready when PostgreSQL is unavailable, naming the blocker', async () => {
    const { app } = build({}, { dbDown: true });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('not_ready');
    expect(res.body.blocking).toEqual(['postgres']);
    expect(res.body.dependencies.postgres).toMatchObject({
      status: 'unreachable',
      reason: 'connection_failed',
    });
    expect(JSON.stringify(res.body)).not.toContain('S3cr3t');
  });

  it('is 503 when the intelligence service is unreachable', async () => {
    const { app } = build({}, { down: true });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.blocking).toEqual(['intelligence_service']);
  });

  it('is 503 when a database is configured but cannot be verified (no pool)', async () => {
    const app = createApp(testConfig({ databaseUrl: DB_URL }));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.dependencies.postgres.status).toBe('not_checked');
  });

  it('does not block on dependencies that are not configured, and says so', async () => {
    const app = createApp(testConfig({ databaseUrl: null, mlServiceUrl: null }));
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.dependencies.postgres).toMatchObject({
      required: false,
      status: 'not_configured',
    });
    expect(res.body.dependencies.intelligence_service.required).toBe(false);
    expect(res.body.forecasting_models.status).toBe('unknown');
  });

  it('only configured dependencies are required', async () => {
    const { app } = build({ databaseUrl: null });
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.dependencies.postgres.required).toBe(false);
    expect(res.body.dependencies.intelligence_service.required).toBe(true);
  });

  it('recovers to 200 when the dependencies come back, without a restart', async () => {
    const { app, state } = build({}, { dbDown: true, down: true });
    expect((await request(app).get('/ready')).status).toBe(503);
    state.dbDown = false;
    const partial = await request(app).get('/ready');
    expect(partial.status).toBe(503);
    expect(partial.body.blocking).toEqual(['intelligence_service']);
    state.down = false;
    const recovered = await request(app).get('/ready');
    expect(recovered.status).toBe(200);
    expect(recovered.body.status).toBe('ready');
  });

  it('does NOT report models ready just because FastAPI /health succeeds', async () => {
    const { app, state } = build({}, { modelsReady: false });
    const res = await request(app).get('/ready');
    // Express is ready (dependencies healthy) while FastAPI models are still not loaded.
    expect(res.status).toBe(200);
    expect(res.body.dependencies.intelligence_service.status).toBe('healthy');
    expect(res.body.forecasting_models).toMatchObject({
      status: 'not_ready',
      gates_readiness: false,
    });
    state.modelsReady = true;
    const later = await request(app).get('/ready');
    expect(later.body.forecasting_models.status).toBe('ready');
  });

  it('reports models as unknown (not ready) when the answer is unrecognised', async () => {
    const odd = vi.fn(async (url) =>
      new URL(String(url)).pathname === '/health'
        ? new Response(JSON.stringify(HEALTH), { status: 200 })
        : new Response(JSON.stringify({ status: 'ready' }), { status: 200 }),
    );
    const app = createApp(testConfig({ mlServiceUrl: 'http://intelligence:8000' }), {
      fetchImpl: /** @type {any} */ (odd),
    });
    const res = await request(app).get('/ready');
    expect(res.body.forecasting_models.status).toBe('unknown');
  });

  it('keeps /health a liveness check while /ready is 503', async () => {
    const { app } = build({}, { dbDown: true, down: true });
    expect((await request(app).get('/ready')).status).toBe(503);
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('leaves the /health/dependencies contract intact', async () => {
    const { app } = build();
    const res = await request(app).get('/health/dependencies');
    expect(Object.keys(res.body).sort()).toEqual([
      'checked_at',
      'dependencies',
      'overall',
      'service',
    ]);
    expect(Object.keys(res.body.dependencies).sort()).toEqual(['intelligence_service', 'postgres']);
    expect(res.body.dependencies.postgres).not.toHaveProperty('required');
  });

  it('rejects other methods with 405', async () => {
    const { app } = build();
    const res = await request(app).post('/ready').send({});
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toMatch(/GET/);
  });
});
