import { HttpError } from '../utils/httpError.js';

/** Writes the standard error body. Never includes stacks, internals or configuration. */
export function sendError(res, error) {
  if (error.headers) {
    for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
  }
  const requestId = res.locals['requestId'];
  const body = {
    error: {
      code: error.code,
      message: error.message,
      ...(typeof requestId === 'string' ? { requestId } : {}),
    },
  };
  res.status(error.status).json(body);
}
/** Maps errors thrown by body parsing and application code to the public error contract. */
function toHttpError(err) {
  if (err instanceof HttpError) return err;
  const candidate = typeof err === 'object' && err !== null ? err : {};
  switch (candidate.type) {
    case 'entity.parse.failed':
      return new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.');
    case 'entity.too.large':
      return new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new HttpError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'The request encoding or charset is not supported.',
      );
    case 'request.aborted':
    case 'request.size.invalid':
      return new HttpError(400, 'BAD_REQUEST', 'The request could not be read.');
    default:
      break;
  }
  const status = candidate.status ?? candidate.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new HttpError(status, 'BAD_REQUEST', 'The request could not be processed.');
  }
  return new HttpError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}
/**
 * Single place where every error becomes a response.
 * Unexpected errors are logged server-side (secrets redacted) and returned as a generic 500.
 */
export function errorHandler(logger) {
  // Express identifies error middleware by arity (4 arguments).
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const httpError = toHttpError(err);
    if (httpError.status >= 500) {
      logger.error('unhandled error', {
        requestId: res.locals['requestId'],
        method: req.method,
        path: req.path,
        error: err instanceof Error ? err : String(err),
      });
    }
    sendError(res, httpError);
  };
}
