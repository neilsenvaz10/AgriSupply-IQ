/**
 * Stable machine-readable error codes returned in the `error.code` field.
 * Clients may switch on these; messages are for humans and may be reworded.
 *
 * @typedef {'BAD_REQUEST' | 'INVALID_JSON' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE'
 *   | 'CORS_ORIGIN_NOT_ALLOWED' | 'NOT_FOUND' | 'METHOD_NOT_ALLOWED' | 'REQUEST_TIMEOUT'
 *   | 'DEPENDENCY_TIMEOUT' | 'DEPENDENCY_UNREACHABLE' | 'INTERNAL_ERROR'} ErrorCode
 */

/**
 * The public error response body.
 *
 * @typedef {object} ErrorBody
 * @property {object} error
 * @property {ErrorCode} error.code
 * @property {string} error.message
 * @property {string} [error.requestId] Correlation id, also sent in the `X-Request-Id` header.
 */

/** An error that is safe to show to API clients (status, stable code, fixed message). */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {ErrorCode} code Stable machine-readable code.
   * @param {string} message Human-readable, client-safe message.
   * @param {Record<string, string>} [headers] Extra response headers (for example `Allow`).
   */
  constructor(status, code, message, headers) {
    super(message);
    this.name = 'HttpError';
    /** @type {number} */
    this.status = status;
    /** @type {ErrorCode} */
    this.code = code;
    /** @type {Record<string, string> | undefined} */
    this.headers = headers;
  }
}
