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

/** @typedef {'timeout' | 'connection_failed' | 'http_error'} FailureReason */

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
/**
 * FastAPI intelligence service: bounded HTTP probe of `GET {ML_SERVICE_URL}/health`.
 * Redirects are not followed, the body is discarded, and the timeout is enforced.
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
    // Release the connection; the body is not used.
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) {
      return {
        status: 'healthy',
        latencyMs: elapsed(),
        message: 'The intelligence service answered its health check.',
      };
    }
    return {
      status: 'unreachable',
      latencyMs: elapsed(),
      reason: 'http_error',
      httpStatus: response.status,
      message: 'The intelligence service responded with an unsuccessful status.',
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
