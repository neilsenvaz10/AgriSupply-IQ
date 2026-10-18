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
 *
 * @typedef {'timeout' | 'connection_failed' | 'http_error' | 'unexpected_response'} FailureReason
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
 */

/**
 * PostgreSQL: no connection pool is created in this milestone, and a bare TCP check would not
 * prove the database is usable. So we never claim "healthy": configured => not_checked.
 *
 * @param {Pick<import('../config/env.js').AppConfig, 'databaseUrl'>} config
 * @returns {DependencyReport}
 */
export function checkPostgres(config) {
  if (config.databaseUrl === null) {
    return { status: 'not_configured', message: 'DATABASE_URL is not set.' };
  }
  return {
    status: 'not_checked',
    message: 'A database address is configured, but no database probe is implemented yet.',
  };
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
      headers: { Accept: 'application/json' },
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

export async function checkDependencies(config, options = {}) {
  const [intelligence_service] = await Promise.all([checkIntelligenceService(config, options)]);
  return { postgres: checkPostgres(config), intelligence_service };
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
