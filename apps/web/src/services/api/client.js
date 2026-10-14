import { ApiError } from './errors';

/**
 * Turns an unknown JSON value into `T`, or throws. Keeps response handling typed and honest.
 *
 * @template T
 * @callback ResponseParser
 * @param {unknown} data
 * @returns {T}
 */

/**
 * @typedef {object} ApiClientOptions
 * @property {string | null} baseUrl Base URL of the Express API gateway. `null` means "not
 *   configured".
 * @property {number} timeoutMs Request timeout in milliseconds.
 * @property {typeof fetch} [fetchImpl] Injectable for tests. Defaults to the global `fetch`.
 */

/**
 * @template T
 * @typedef {object} GetOptions
 * @property {ResponseParser<T>} parse Validates and types the JSON body.
 * @property {AbortSignal} [signal] Caller-supplied cancellation (for example on unmount).
 */

/**
 * @typedef {object} ApiClient
 * @property {string | null} baseUrl
 * @property {number} timeoutMs
 * @property {<T>(path: string, options: GetOptions<T>) => Promise<T>} get Resolves with the
 *   parsed body, or rejects with an `ApiError`. Never resolves with fabricated data.
 */

/**
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
function joinUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Minimal typed fetch wrapper.
 * Guarantees: configurable base URL, request timeout, one error type (`ApiError`),
 * and no fabricated data: every failure rejects.
 *
 * @param {ApiClientOptions} options
 * @returns {ApiClient}
 */
export function createApiClient(options) {
  const { baseUrl, timeoutMs } = options;
  async function get(path, { parse, signal }) {
    if (baseUrl === null) {
      throw new ApiError('config', 'API base URL is not configured (VITE_API_BASE_URL).');
    }
    const url = joinUrl(baseUrl, path);
    const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      let response;
      try {
        response = await doFetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (cause) {
        if (timedOut) {
          throw new ApiError('timeout', `No response from ${url} within ${timeoutMs} ms.`, {
            url,
            cause,
          });
        }
        if (controller.signal.aborted) {
          throw new ApiError('aborted', 'The request was cancelled.', { url, cause });
        }
        throw new ApiError('network', `Could not reach ${url}.`, { url, cause });
      }
      if (!response.ok) {
        throw new ApiError('http', `The API responded with HTTP ${response.status}.`, {
          status: response.status,
          url,
        });
      }
      let body;
      try {
        body = await response.json();
      } catch (cause) {
        throw new ApiError('parse', 'The API response was not valid JSON.', {
          status: response.status,
          url,
          cause,
        });
      }
      try {
        return parse(body);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : 'unexpected shape';
        throw new ApiError('parse', `The API response was not in the expected format: ${detail}`, {
          status: response.status,
          url,
          cause,
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }
  return { baseUrl, timeoutMs, get };
}
