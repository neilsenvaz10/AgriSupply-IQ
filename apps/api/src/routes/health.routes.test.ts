import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { okResponse, testConfig } from '../test/helpers.js';

describe('GET /health (liveness)', () => {
  const app = createApp(testConfig());

  it('returns 200 with JSON and only liveness information', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json; charset=utf-8$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ status: 'ok', service: 'fasalytics-api' });
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('does not say anything about dependencies', async () => {
    const res = await request(app).get('/health');
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|database|intelligence|ml_service/i);
  });

  it('sets a request id and security headers, and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('echoes a safe client request id but replaces an unsafe one', async () => {
    const good = await request(app).get('/health').set('X-Request-Id', 'client-req-12345');
    expect(good.headers['x-request-id']).toBe('client-req-12345');

    const bad = await request(app).get('/health').set('X-Request-Id', 'x\ty<script>');
    expect(bad.headers['x-request-id']).not.toContain('script');
  });

  it('supports HEAD and rejects other methods with 405 and an Allow header', async () => {
    expect((await request(app).head('/health')).status).toBe(200);

    const res = await request(app).post('/health').send({});
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toMatch(/GET/);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('GET /health/dependencies', () => {
  it('reports both dependencies as not_configured when nothing is set', async () => {
    const fetchImpl = vi.fn();
    const app = createApp(testConfig(), { fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await request(app).get('/health/dependencies');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.overall).toBe('unknown');
    expect(res.body.dependencies.postgres.status).toBe('not_configured');
    expect(res.body.dependencies.intelligence_service.status).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a configured database as not_checked, never healthy', async () => {
    const app = createApp(testConfig({ databaseUrl: 'postgres://appuser:s3cretpw@db:5432/app' }));

    const res = await request(app).get('/health/dependencies');

    expect(res.body.dependencies.postgres.status).toBe('not_checked');
    expect(res.body.overall).toBe('unknown');
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('s3cretpw');
    expect(text).not.toContain('appuser');
    expect(text).not.toMatch(/postgres:\/\//);
  });

  it('reports the intelligence service healthy only after a successful probe', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(200)));
    const app = createApp(testConfig({ mlServiceUrl: 'http://ml.internal:8000' }), { fetchImpl });

    const res = await request(app).get('/health/dependencies');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://ml.internal:8000/health');
    expect(res.body.dependencies.intelligence_service).toMatchObject({ status: 'healthy' });
    expect(typeof res.body.dependencies.intelligence_service.latencyMs).toBe('number');
    // Postgres is configured-nowhere here, so the overall verdict must not be "healthy".
    expect(res.body.overall).toBe('unknown');
  });

  it('is overall healthy only when every dependency is healthy', async () => {
    // Only the intelligence probe exists today, so this documents that postgres blocks "healthy".
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(200)));
    const app = createApp(
      testConfig({ mlServiceUrl: 'http://ml:8000', databaseUrl: 'postgres://u:p@db/app' }),
      { fetchImpl },
    );
    const res = await request(app).get('/health/dependencies');
    expect(res.body.overall).not.toBe('healthy');
  });

  it('reports unreachable with reason connection_failed when the probe errors', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    const app = createApp(testConfig({ mlServiceUrl: 'http://ml:8000' }), { fetchImpl });

    const res = await request(app).get('/health/dependencies');

    expect(res.status).toBe(200);
    expect(res.body.overall).toBe('degraded');
    expect(res.body.dependencies.intelligence_service).toMatchObject({
      status: 'unreachable',
      reason: 'connection_failed',
    });
  });

  it('reports unreachable with the HTTP status for unsuccessful responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(okResponse(503, { error: 'x' })));
    const app = createApp(testConfig({ mlServiceUrl: 'http://ml:8000' }), { fetchImpl });

    const res = await request(app).get('/health/dependencies');

    expect(res.body.dependencies.intelligence_service).toMatchObject({
      status: 'unreachable',
      reason: 'http_error',
      httpStatus: 503,
    });
  });

  it('times out a hanging probe within the configured bound', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const app = createApp(testConfig({ mlServiceUrl: 'http://ml:8000', mlServiceTimeoutMs: 150 }), {
      fetchImpl,
    });

    const started = Date.now();
    const res = await request(app).get('/health/dependencies');
    const elapsed = Date.now() - started;

    expect(res.body.dependencies.intelligence_service).toMatchObject({
      status: 'unreachable',
      reason: 'timeout',
    });
    expect(elapsed).toBeLessThan(2000);
  });

  it('never leaks the service address, stack traces or error internals', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.reject(new Error('connect ECONNREFUSED 10.0.0.7:8000 at Socket.<anonymous>')),
    );
    const app = createApp(testConfig({ mlServiceUrl: 'http://10.0.0.7:8000' }), { fetchImpl });

    const res = await request(app).get('/health/dependencies');
    const text = JSON.stringify(res.body);

    expect(text).not.toContain('10.0.0.7');
    expect(text).not.toMatch(/ECONNREFUSED|at Socket|stack/i);
  });

  it('rejects non-GET methods', async () => {
    const res = await request(createApp(testConfig())).post('/health/dependencies');
    expect(res.status).toBe(405);
  });
});

describe('GET /api/v1/health', () => {
  it('exposes the versioned health route and no agricultural data', async () => {
    const app = createApp(testConfig());
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'fasalytics-api', apiVersion: 'v1' });

    for (const path of [
      '/api/v1/commodities',
      '/api/v1/markets',
      '/api/v1/prices',
      '/api/v1/forecasts',
    ]) {
      expect((await request(app).get(path)).status).toBe(404);
    }
  });
});
