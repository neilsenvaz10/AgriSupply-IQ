import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../lifecycle.js';
import { testConfig } from '../test/helpers.js';

/**
 * Real-socket test of the Express -> intelligence-service probe.
 *
 * A small HTTP server stands in for FastAPI and returns exactly what the real service's
 * `GET /health` returns (see services/intelligence/README.md). No fetch is mocked: Express
 * performs a genuine network probe, so outage and recovery are real.
 */

const FASTAPI_HEALTH = {
  status: 'ok',
  service: 'fasalytics-intelligence',
  version: '0.1.0',
  uptime_seconds: 3,
};

/** @type {Array<{ close: () => Promise<void> }>} */
const cleanup = [];

afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.close();
});

/**
 * @param {number} [port] 0 picks a free port.
 * @param {{ status?: number, body?: unknown }} [reply]
 * @returns {Promise<{ port: number, seen: { paths: string[] }, close: () => Promise<void> }>}
 */
function startFakeIntelligence(port = 0, reply = {}) {
  const status = reply.status ?? 200;
  const body = reply.body ?? FASTAPI_HEALTH;
  const seen = { paths: /** @type {string[]} */ ([]) };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      seen.paths.push(req.url ?? '');
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      const handle = {
        port: address.port,
        seen,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done(undefined));
          }),
      };
      cleanup.push(handle);
      resolve(handle);
    });
  });
}

/**
 * @param {number} port
 * @returns {Promise<{ port: number, close: (graceMs?: number) => Promise<void> }>}
 */
async function startExpress(port) {
  const running = await startServer(
    testConfig({ mlServiceUrl: `http://127.0.0.1:${port}`, mlServiceTimeoutMs: 1500 }),
  );
  cleanup.push({ close: () => running.close(500) });
  return running;
}

/** @param {number} expressPort */
async function intelligenceStatus(expressPort) {
  const res = await fetch(`http://127.0.0.1:${expressPort}/health/dependencies`);
  const body = /** @type {any} */ (await res.json());
  return { httpStatus: res.status, ...body };
}

describe('Express -> FastAPI dependency probe (real sockets)', () => {
  it('reports healthy only after a real successful probe of GET /health', async () => {
    const fake = await startFakeIntelligence();
    const express = await startExpress(fake.port);

    const report = await intelligenceStatus(express.port);

    expect(report.httpStatus).toBe(200);
    expect(report.dependencies.intelligence_service.status).toBe('healthy');
    expect(typeof report.dependencies.intelligence_service.latencyMs).toBe('number');
    expect(fake.seen.paths).toEqual(['/health']);
    // PostgreSQL is not configured here and must not be reported as healthy.
    expect(report.dependencies.postgres.status).toBe('not_configured');
    expect(report.overall).toBe('unknown');
  });

  it('reports unreachable when the service is down and healthy again after it recovers', async () => {
    const fake = await startFakeIntelligence();
    const express = await startExpress(fake.port);
    const port = fake.port;

    expect((await intelligenceStatus(express.port)).dependencies.intelligence_service.status).toBe(
      'healthy',
    );

    // Outage: the FastAPI stand-in disappears.
    await fake.close();
    const outage = await intelligenceStatus(express.port);
    expect(outage.dependencies.intelligence_service).toMatchObject({
      status: 'unreachable',
      reason: 'connection_failed',
    });
    expect(outage.overall).toBe('degraded');

    // Recovery: the service returns on the same address.
    await startFakeIntelligence(port);
    const recovered = await intelligenceStatus(express.port);
    expect(recovered.dependencies.intelligence_service.status).toBe('healthy');
  });

  it('treats an unsuccessful status from the service as unreachable', async () => {
    const fake = await startFakeIntelligence(0, { status: 503, body: { error: 'starting' } });
    const express = await startExpress(fake.port);

    const report = await intelligenceStatus(express.port);

    expect(report.dependencies.intelligence_service).toMatchObject({
      status: 'unreachable',
      reason: 'http_error',
      httpStatus: 503,
    });
  });

  it('does not leak the service address in the report', async () => {
    const fake = await startFakeIntelligence();
    const express = await startExpress(fake.port);

    const res = await fetch(`http://127.0.0.1:${express.port}/health/dependencies`);
    const text = await res.text();

    expect(text).not.toContain(String(fake.port));
    expect(text).not.toContain('127.0.0.1');
  });
});
