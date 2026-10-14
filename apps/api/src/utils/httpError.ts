/**
 * Stable machine-readable error codes returned in the `error.code` field.
 * Clients may switch on these; messages are for humans and may be reworded.
 */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_JSON'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'CORS_ORIGIN_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'REQUEST_TIMEOUT'
  | 'DEPENDENCY_TIMEOUT'
  | 'DEPENDENCY_UNREACHABLE'
  | 'INTERNAL_ERROR';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, code: ErrorCode, message: string, headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
  };
}
