/**
 * Payload of `GET /health` on the Express API (process health only).
 * Only `status` is required; the remaining fields are optional and shown if present.
 *
 * @typedef {object} HealthResponse
 * @property {string} status
 * @property {string} [service]
 * @property {string} [version]
 * @property {number} [uptimeSeconds] Parsed from `uptime_seconds` (or `uptime`).
 * @property {string} [timestamp]
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {string | undefined}
 */
function optionalString(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @returns {number | undefined}
 */
function optionalNumber(record, key) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Validates the `/health` body. Unknown fields are ignored and not passed through.
 *
 * @param {unknown} data
 * @returns {HealthResponse}
 * @throws {Error} When the body is not an object with a non-empty string `status`.
 */
export function parseHealthResponse(data) {
  if (!isRecord(data)) throw new Error('expected a JSON object');
  const status = data['status'];
  if (typeof status !== 'string' || status.trim() === '') {
    throw new Error('missing string field "status"');
  }
  /** @type {HealthResponse} */
  const result = { status };
  const service = optionalString(data, 'service');
  const version = optionalString(data, 'version');
  const timestamp = optionalString(data, 'timestamp');
  const uptimeSeconds = optionalNumber(data, 'uptime_seconds') ?? optionalNumber(data, 'uptime');
  if (service !== undefined) result.service = service;
  if (version !== undefined) result.version = version;
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (uptimeSeconds !== undefined) result.uptimeSeconds = uptimeSeconds;
  return result;
}

/**
 * @param {import('./client').ApiClient} client
 * @param {AbortSignal} [signal]
 * @returns {Promise<HealthResponse>}
 */
export function fetchHealth(client, signal) {
  return client.get(
    '/health',
    signal ? { parse: parseHealthResponse, signal } : { parse: parseHealthResponse },
  );
}
