/**
 * Browser-facing runtime configuration.
 *
 * Only VITE_* variables exist in the browser bundle. Nothing secret belongs here.
 * The frontend talks to the Express API gateway only: never to PostgreSQL or the FastAPI service.
 */

/**
 * @typedef {'env' | 'dev-default' | 'missing' | 'invalid'} ApiBaseUrlSource
 */

/**
 * @typedef {object} AppConfig
 * @property {string | null} apiBaseUrl Normalised base URL without a trailing slash, or null
 *   when unusable.
 * @property {ApiBaseUrlSource} apiBaseUrlSource Where the URL came from (shown on the status page).
 * @property {number} apiTimeoutMs
 */

/**
 * The subset of Vite's `import.meta.env` that this module reads.
 *
 * @typedef {object} EnvLike
 * @property {string} [VITE_API_BASE_URL]
 * @property {string} [VITE_API_TIMEOUT_MS]
 * @property {boolean} [DEV]
 */

/** Used in development only, so a fresh clone works without a .env file. */
export const DEV_DEFAULT_API_BASE_URL = 'http://localhost:4000';

export const DEFAULT_API_TIMEOUT_MS = 5000;

/**
 * @param {string} raw
 * @returns {string | null} The URL without trailing slashes, or null if not a valid http(s) URL.
 */
export function normalizeBaseUrl(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Reads the browser configuration.
 * - `VITE_API_BASE_URL` when valid.
 * - The development default only when `DEV` is true.
 * - Otherwise null (the status page reports "not configured" instead of guessing).
 *
 * @param {EnvLike} [env]
 * @returns {AppConfig}
 */
export function readConfig(env = import.meta.env) {
  const rawTimeout = Number(env.VITE_API_TIMEOUT_MS);
  const apiTimeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_API_TIMEOUT_MS;
  const configured = env.VITE_API_BASE_URL;
  if (configured !== undefined && configured.trim() !== '') {
    const normalised = normalizeBaseUrl(configured);
    return normalised
      ? { apiBaseUrl: normalised, apiBaseUrlSource: 'env', apiTimeoutMs }
      : { apiBaseUrl: null, apiBaseUrlSource: 'invalid', apiTimeoutMs };
  }
  if (env.DEV === true) {
    return {
      apiBaseUrl: DEV_DEFAULT_API_BASE_URL,
      apiBaseUrlSource: 'dev-default',
      apiTimeoutMs,
    };
  }
  return { apiBaseUrl: null, apiBaseUrlSource: 'missing', apiTimeoutMs };
}
