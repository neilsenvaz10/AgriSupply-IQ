import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { testConfig } from '../test/helpers.js';
import { createLogger } from '../utils/logger.js';
import { errorHandler } from './errorHandler.js';
import { notFound } from './notFound.js';
import { requestTimeout } from './requestTimeout.js';

describe('CORS allowlist', () => {
  const app = createApp(testConfig());

  it('allows the configured frontend origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toMatch(/X-Request-Id/i);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows the 127.0.0.1 development twin', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://127.0.0.1:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
  });

  it('allows requests without an Origin header (curl, probes)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([['https://evil.example'], ['http://localhost:5174'], ['null']])(
    'rejects origin %s with 403 and no CORS headers',
    async (origin) => {
      const res = await request(app).get('/health').set('Origin', origin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['content-type']).toMatch(/application\/json/);
    },
  );

  it('answers a preflight from an allowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/);
  });

  it('refuses a preflight from a disallowed origin', async () => {
    const res = await request(app)
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never uses a wildcard', async () => {
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('request parsing and errors', () => {
  const app = createApp(testConfig());

  it('returns 400 INVALID_JSON for malformed JSON', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken": ');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toMatchObject({ code: 'INVALID_JSON' });
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|at |stack|node_modules/);
  });

  it('returns 413 PAYLOAD_TOO_LARGE above the body limit', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ blob: 'x'.repeat(150_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 404 NOT_FOUND in the standard format for unknown routes', async () => {
    const res = await request(app).get('/definitely/not/here');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('returns 405 for unsupported methods on a known route', async () => {
    const res = await request(app).delete('/api/v1/health');
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });

  it('converts unexpected errors into a generic 500 without leaking details', async () => {
    const logger = createLogger('silent');
    const errorSpy = vi.spyOn(logger, 'error');
    const probeApp = express();
    probeApp.get('/boom', () => {
      throw new Error('db password is hunter2 at /srv/app/secret.ts:12');
    });
    probeApp.use(notFound);
    probeApp.use(errorHandler(logger));

    const res = await request(probeApp).get('/boom');

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/hunter2|secret\.ts|stack/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('handles errors thrown from async handlers (Express 5)', async () => {
    const probeApp = express();
    probeApp.get('/async-boom', async () => {
      await Promise.resolve();
      throw new Error('async failure');
    });
    probeApp.use(errorHandler(createLogger('silent')));

    const res = await request(probeApp).get('/async-boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('responds 503 REQUEST_TIMEOUT when a handler is too slow', async () => {
    const slowApp = express();
    slowApp.use(requestTimeout(50));
    slowApp.get('/slow', (_req, res) => {
      setTimeout(() => res.json({ late: true }), 400).unref();
    });
    slowApp.use(errorHandler(createLogger('silent')));

    const res = await request(slowApp).get('/slow');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
  });
});

describe('logger redaction', () => {
  it('removes credentials from URLs', async () => {
    const { redactSecrets } = await import('../utils/logger.js');
    expect(redactSecrets('failed postgres://admin:pw123@db:5432/app now')).toBe(
      'failed postgres://[redacted]@db:5432/app now',
    );
  });
});
