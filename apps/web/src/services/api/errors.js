/**
 * Classification of everything that can go wrong when calling the API.
 *
 * - `config`:  no usable base URL is configured.
 * - `network`: the request could not be completed (server down, DNS failure, CORS block;
 *              browsers deliberately do not distinguish these).
 * - `timeout`: no response within the configured time.
 * - `http`:    the server answered with a non-2xx status.
 * - `parse`:   the server answered 2xx but the body was not valid JSON or failed validation.
 * - `aborted`: the caller cancelled the request.
 * - `invalid_request`: the request was rejected locally, before any network call, because a
 *              parameter failed validation (nothing was sent).
 *
 * @typedef {'config' | 'network' | 'timeout' | 'http' | 'parse' | 'aborted' | 'invalid_request'} ApiErrorKind
 */

export class ApiError extends Error {
  /**
   * @param {ApiErrorKind} kind
   * @param {string} message
   * @param {{ status?: number, url?: string, cause?: unknown }} [options]
   */
  constructor(kind, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    /** @type {ApiErrorKind} */
    this.kind = kind;
    /** @type {number | undefined} */
    this.status = options.status;
    /** @type {string | undefined} */
    this.url = options.url;
  }
}

/**
 * @param {unknown} value
 * @returns {value is ApiError}
 */
export function isApiError(value) {
  return value instanceof ApiError;
}
