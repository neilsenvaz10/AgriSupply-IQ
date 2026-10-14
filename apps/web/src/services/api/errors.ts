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
 */
export type ApiErrorKind = 'config' | 'network' | 'timeout' | 'http' | 'parse' | 'aborted';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | undefined;
  readonly url: string | undefined;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: { status?: number; url?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status;
    this.url = options.url;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
