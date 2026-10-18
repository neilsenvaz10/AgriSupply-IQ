import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../lifecycle.js';
import { testConfig } from '../test/helpers.js';

/**
 * Real-socket test of request-id propagation Express -> intelligence service.
 * A stand-in server records the headers it receives and echoes X-Request-Id back, exactly as the
 * real FastAPI request guard does (see services/intelligence/app/core/middleware.py).
 */

/** @type {Array<() => Promise<void>>} */
const cleanup = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.();
});

async function startFakeIntelligence() {
  /** @type {Array<{ path: string, requestId: string | undefined }>} */
  const seen = [];
  const server = http.createServer((req, res) => {
    const requestId = req.headers['x-request-id'];
    seen.push({
      path: req.url ?? '',
      requestId: typeof requestId === 'string' ? requestId : undefined,
    });
    const body =
      req.url === '/ready'
        ? { status: 'not_ready', service: 'fasalytics-intelligence', model_ready: false }
        : { status: 'ok', service: 'fasalytics-intelligence', version: '0.1.0' };
    res.writeHead(req.url === '/ready' ? 503 : 200, {
      'Content-Type': 'application/json',
      ...(typeof requestId === 'string' ? { 'X-Request-Id': requestId } : {}),
    });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  cleanup.push(
    () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  );
  return { port, seen };
}

async function startExpress(mlPort) {
  const running = await startServer(testConfig({ mlServiceUrl: `http://127.0.0.1:${mlPort}` }));
  cleanup.push(() => running.close(1000));
  return running;
}

describe('X-Request-Id across Express and the intelligence service', () => {
  it('forwards a safe client id on /health/dependencies and returns the same id', async () => {
    const ml = await startFakeIntelligence();
    const api = await startExpress(ml.port);
    const res = await fetch(`http://127.0.0.1:${api.port}/health/dependencies`, {
      headers: { 'X-Request-Id': 'client-trace-0001' },
    });
    expect(res.headers.get('x-request-id')).toBe('client-trace-0001');
    expect(ml.seen.length).toBeGreaterThan(0);
    for (const call of ml.seen) expect(call.requestId).toBe('client-trace-0001');
  });

  it('forwards the same id to both /health and /ready probes of /ready', async () => {
    const ml = await startFakeIntelligence();
    const api = await startExpress(ml.port);
    const res = await fetch(`http://127.0.0.1:${api.port}/ready`, {
      headers: { 'X-Request-Id': 'ready-trace-0002' },
    });
    expect(res.headers.get('x-request-id')).toBe('ready-trace-0002');
    expect(ml.seen.map((c) => c.path).sort()).toEqual(['/health', '/ready']);
    for (const call of ml.seen) expect(call.requestId).toBe('ready-trace-0002');
  });

  it('generates one id when none is supplied and forwards that same id', async () => {
    const ml = await startFakeIntelligence();
    const api = await startExpress(ml.port);
    const res = await fetch(`http://127.0.0.1:${api.port}/health/dependencies`);
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    for (const call of ml.seen) expect(call.requestId).toBe(id);
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['unsafe characters', 'bad id; <script>'],
    ['header injection attempt', 'abcdefgh%0d%0aX-Evil: 1'],
  ])('replaces an unacceptable client id (%s) before forwarding it', async (_label, bad) => {
    const ml = await startFakeIntelligence();
    const api = await startExpress(ml.port);
    const res = await fetch(`http://127.0.0.1:${api.port}/health/dependencies`, {
      headers: { 'X-Request-Id': bad },
    });
    const id = res.headers.get('x-request-id');
    expect(id).not.toBe(bad);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    for (const call of ml.seen) expect(call.requestId).toBe(id);
  });

  it('puts the id in structured error responses', async () => {
    const api = await startExpress(1);
    const res = await fetch(`http://127.0.0.1:${api.port}/no-such-route`, {
      headers: { 'X-Request-Id': 'error-trace-0003' },
    });
    expect(res.status).toBe(404);
    const body = /** @type {any} */ (await res.json());
    expect(body.error.requestId).toBe('error-trace-0003');
    expect(res.headers.get('x-request-id')).toBe('error-trace-0003');
  });
});
