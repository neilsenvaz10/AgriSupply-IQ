/**
 * Honest dependency status.
 *  - healthy:        a real, successful probe happened just now.
 *  - unreachable:    a probe was attempted and failed (see `reason`).
 *  - not_configured: no address/credentials were supplied, so nothing could be probed.
 *  - not_checked:    configured, but no probe is implemented (or it was not run).
 * "healthy" is never inferred from configuration alone.
 *
 * @typedef {'healthy' | 'unreachable' | 'not_configured' | 'not_checked'} DependencyStatus
 */

/**
 * Why a probe failed.
 *  - timeout:             no answer within the configured time.
 *  - connection_failed:   nothing could be reached at the configured address.
 *  - http_error:          the service answered with a non-2xx status.
 *  - unexpected_response: something answered 2xx, but not as the intelligence service.
 *  - authentication_failed (PostgreSQL only): the server rejected the configured credentials.
 *  - query_failed (PostgreSQL only): connected, but the test query failed.
 *
 * @typedef {'timeout' | 'connection_failed' | 'http_error' | 'unexpected_response' |
 *   'authentication_failed' | 'query_failed'} FailureReason
 */

/**
 * @typedef {object} DependencyReport
 * @property {DependencyStatus} status
 * @property {number} [latencyMs] Round-trip time of a probe, when one was run.
 * @property {FailureReason} [reason]
 * @property {number} [httpStatus] HTTP status returned by the dependency when `reason` is
 *   `http_error`.
 * @property {string} message Fixed, human-readable text. Never contains addresses or credentials.
 */

/**
 * @typedef {object} DependencyReports
 * @property {DependencyReport} postgres
 * @property {DependencyReport} intelligence_service
 */

/**
 * `degraded` if anything is unreachable; `healthy` only if EVERY dependency was probed and is
 * healthy; otherwise `unknown` (including when nothing is configured).
 *
 * @typedef {'healthy' | 'degraded' | 'unknown'} OverallStatus
 */

/**
 * @typedef {object} ProbeOptions
 * @property {typeof fetch} [fetchImpl] Injectable for tests so no real network call is made.
 * @property {import('../database/pool.js').PoolLike} [pool] The application connection pool.
 * @property {string} [requestId] Correlation id of the inbound request; forwarded to the
 *   intelligence service as `X-Request-Id` so one id follows the request across services.
 */

/** SQLSTATE / errno values meaning "the server is unreachable or not accepting connections". */
const AUTH_CODES = new Set(['28P01', '28000']);
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up)
  '3D000', // database does not exist
  '08000',
  '08001',
  '08003',
  '08006',
]);

/**
 * Maps a driver error to a fixed category. The error text is never copied into the result
 * (it can contain addresses or user names).
 *
 * @param {unknown} error
 * @returns {'timeout' | 'connection_failed' | 'authentication_failed' | 'query_failed'}
 */
function classifyDatabaseError(error) {
  const e = /** @type {{ code?: string, message?: string }} */ (error ?? {});
  if (typeof e.code === 'string') {
    if (AUTH_CODES.has(e.code)) return 'authentication_failed';
    if (e.code === '57014') return 'timeout'; // query_canceled by statement_timeout
    if (UNAVAILABLE_CODES.has(e.code)) return 'connection_failed';
  }
  const message = typeof e.message === 'string' ? e.message : '';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/Connection terminated|ended unexpectedly/i.test(message)) return 'connection_failed';
  return 'query_failed';
}

const POSTGRES_FAILURE_MESSAGES = {
  timeout: 'The database did not respond in time.',
  connection_failed: 'The database could not be reached.',
  authentication_failed: 'The database rejected the configured credentials.',
  query_failed: 'The database was reached but the health query failed.',
};

class ProbeTimeout extends Error {}

/**
 * Awaits `promise`, but gives up after `ms`. If it settles later, `onLate` receives the result so
 * a connection acquired after the deadline is still released.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {(late: T) => void} onLate
 * @returns {Promise<T>}
 */
function withDeadline(promise, ms, onLate) {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new ProbeTimeout());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        if (expired) onLate(value);
        else resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        if (!expired) reject(error);
      },
    );
  });
}

/**
 * PostgreSQL: borrows a connection from the application pool, runs `SELECT 1` and releases the
 * connection in every case. `healthy` only after the query really succeeded.
 *
 *  - no DATABASE_URL            -> not_configured
 *  - configured, but no pool    -> not_checked (nothing was probed)
 *  - any failure                -> unreachable + a fixed `reason`; no addresses, credentials or
 *                                  raw driver errors are ever returned.
 *
 * @param {Pick<import('../config/env.js').AppConfig, 'databaseUrl'> & {
 *   databasePool?: Pick<import('../config/env.js').DatabasePoolConfig, 'healthTimeoutMs'> }} config
 * @param {{ pool?: import('../database/pool.js').PoolLike }} [options]
 * @returns {Promise<DependencyReport>}
 */
export async function checkPostgres(config, options = {}) {
  if (config.databaseUrl === null) {
    return { status: 'not_configured', message: 'DATABASE_URL is not set.' };
  }
  const pool = options.pool;
  if (!pool) {
    return {
      status: 'not_checked',
      message: 'A database address is configured, but no connection pool is available to probe.',
    };
  }
  const budget = config.databasePool?.healthTimeoutMs ?? 2000;
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  /** @type {import('pg').PoolClient | undefined} */
  let client;
  // A connection that failed or timed out may be in an unknown state: destroy it, don't recycle it.
  let discard = false;
  try {
    client = await withDeadline(pool.connect(), budget, (late) => late.release(true));
    const remaining = Math.max(50, budget - (performance.now() - startedAt));
    await withDeadline(client.query('SELECT 1 AS ok'), remaining, () => undefined);
    return {
      status: 'healthy',
      latencyMs: elapsed(),
      message: 'The database answered a test query.',
    };
  } catch (error) {
    discard = true;
    const reason = error instanceof ProbeTimeout ? 'timeout' : classifyDatabaseError(error);
    return {
      status: 'unreachable',
      latencyMs: elapsed(),
      reason,
      message: POSTGRES_FAILURE_MESSAGES[reason],
    };
  } finally {
    client?.release(discard);
  }
}

/** The `service` value the FastAPI intelligence service reports from `GET /health`. */
export const EXPECTED_INTELLIGENCE_SERVICE = 'fasalytics-intelligence';

/** A health document is tiny; anything larger is not a health response. */
const MAX_PROBE_BODY_BYTES = 16 * 1024;

/**
 * Reads at most `maxBytes` of the body as text. Returns null if the body is larger.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<string | null>}
 */
async function readBoundedText(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * True only for the intelligence service's own health document. A different service that
 * happens to answer 200 on this port (for example `{"status":"ok"}`) does NOT qualify.
 *
 * @param {string} text
 * @returns {boolean}
 */
function isIntelligenceHealth(text) {
  try {
    const data = JSON.parse(text);
    return (
      typeof data === 'object' &&
      data !== null &&
      data.status === 'ok' &&
      data.service === EXPECTED_INTELLIGENCE_SERVICE
    );
  } catch {
    return false;
  }
}

/**
 * FastAPI intelligence service: bounded HTTP probe of `GET {ML_SERVICE_URL}/health`.
 * Redirects are not followed, the timeout and the body size are enforced, and the answer must
 * identify itself as the FASALYTICS intelligence service before it counts as healthy.
 *
 * @param {Pick<import('../config/env.js').AppConfig, 'mlServiceUrl' | 'mlServiceTimeoutMs'>} config
 * @param {ProbeOptions} [options]
 * @returns {Promise<DependencyReport>}
 */
export async function checkIntelligenceService(config, options = {}) {
  if (config.mlServiceUrl === null) {
    return { status: 'not_configured', message: 'ML_SERVICE_URL is not set.' };
  }
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.mlServiceTimeoutMs);
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const response = await doFetch(`${config.mlServiceUrl}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status < 200 || response.status >= 300) {
      // Release the connection; the body is not used.
      await response.body?.cancel().catch(() => undefined);
      return {
        status: 'unreachable',
        latencyMs: elapsed(),
        reason: 'http_error',
        httpStatus: response.status,
        message: 'The intelligence service responded with an unsuccessful status.',
      };
    }

    const text = await readBoundedText(response, MAX_PROBE_BODY_BYTES);
    if (text === null || !isIntelligenceHealth(text)) {
      return {
        status: 'unreachable',
        latencyMs: elapsed(),
        reason: 'unexpected_response',
        message:
          'A service answered, but it did not identify as the FASALYTICS intelligence service.',
      };
    }
    return {
      status: 'healthy',
      latencyMs: elapsed(),
      message: 'The intelligence service answered its health check.',
    };
  } catch {
    if (timedOut) {
      return {
        status: 'unreachable',
        latencyMs: elapsed(),
        reason: 'timeout',
        message: 'The intelligence service did not respond in time.',
      };
    }
    return {
      status: 'unreachable',
      latencyMs: elapsed(),
      reason: 'connection_failed',
      message: 'The intelligence service could not be reached.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Forecasting-model readiness, reported by the intelligence service's own `GET /ready`.
 * This is NOT inferred from `GET /health`: a live FastAPI process says nothing about whether
 * validated models are loaded.
 *
 *  - ready:     200 and `model_ready: true`
 *  - not_ready: 503 and `model_ready: false` (expected until models exist)
 *  - unknown:   not configured, unreachable, or an unrecognised answer
 *
 * @typedef {object} ModelsReport
 * @property {'ready' | 'not_ready' | 'unknown'} status
 * @property {string} message Fixed text; never contains addresses or credentials.
 */

/**
 * @param {Pick<import('../config/env.js').AppConfig, 'mlServiceUrl' | 'mlServiceTimeoutMs'>} config
 * @param {ProbeOptions} [options]
 * @returns {Promise<ModelsReport>}
 */
export async function checkIntelligenceModels(config, options = {}) {
  if (config.mlServiceUrl === null) {
    return { status: 'unknown', message: 'ML_SERVICE_URL is not set.' };
  }
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.mlServiceTimeoutMs);
  try {
    const response = await doFetch(`${config.mlServiceUrl}/ready`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.requestId ? { 'X-Request-Id': options.requestId } : {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status !== 200 && response.status !== 503) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 'unknown', message: 'The intelligence service gave an unexpected answer.' };
    }
    const text = await readBoundedText(response, MAX_PROBE_BODY_BYTES);
    const data = text === null ? null : JSON.parse(text);
    const identified =
      typeof data === 'object' &&
      data !== null &&
      data.service === EXPECTED_INTELLIGENCE_SERVICE &&
      typeof data.model_ready === 'boolean';
    if (!identified) {
      return { status: 'unknown', message: 'The intelligence service gave an unexpected answer.' };
    }
    // Both the HTTP status and the body flag must agree before models count as ready.
    if (response.status === 200 && data.model_ready === true) {
      return {
        status: 'ready',
        message: 'The intelligence service reports validated models loaded.',
      };
    }
    return {
      status: 'not_ready',
      message: 'The intelligence service is running but reports no validated forecasting models.',
    };
  } catch {
    return { status: 'unknown', message: 'Model readiness could not be determined.' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {Pick<import('../config/env.js').AppConfig, 'databaseUrl' | 'databasePool' | 'mlServiceUrl' | 'mlServiceTimeoutMs'>} config
 * @param {ProbeOptions} [options]
 * @returns {Promise<DependencyReports>}
 */
export async function checkDependencies(config, options = {}) {
  const [postgres, intelligence_service] = await Promise.all([
    checkPostgres(config, options.pool ? { pool: options.pool } : {}),
    checkIntelligenceService(config, options),
  ]);
  return { postgres, intelligence_service };
}
/**
 * `degraded` if anything is unreachable; `healthy` only if EVERY dependency was probed and is
 * healthy; otherwise `unknown` (including when nothing is configured).
 */
export function summarize(reports) {
  const statuses = Object.values(reports).map((r) => r.status);
  if (statuses.includes('unreachable')) return 'degraded';
  if (statuses.every((s) => s === 'healthy')) return 'healthy';
  return 'unknown';
}
