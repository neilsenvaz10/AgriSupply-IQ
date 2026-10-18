/**
 * A valid configuration for tests; override only what a test cares about.
 *
 * @param {Partial<import('../config/env.js').AppConfig>} [overrides]
 * @returns {import('../config/env.js').AppConfig}
 */
export function testConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    databaseUrl: null,
    databasePool: {
      max: 2,
      connectionTimeoutMs: 500,
      idleTimeoutMs: 5000,
      queryTimeoutMs: 1000,
      healthTimeoutMs: 800,
    },
    mlServiceUrl: null,
    mlServiceTimeoutMs: 1000,
    requestTimeoutMs: 15000,
    bodyLimit: '100kb',
    logLevel: 'silent',
    ...overrides,
  };
}

/**
 * @param {number} [status]
 * @param {unknown} [body]
 * @returns {Response}
 */
export function okResponse(
  status = 200,
  body = { status: 'ok', service: 'fasalytics-intelligence', version: '0.1.0' },
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
