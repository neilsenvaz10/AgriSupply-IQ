import type { RequestHandler } from 'express';
import { sendError } from './errorHandler.js';
import { HttpError } from '../utils/httpError.js';

/**
 * Responds 503 REQUEST_TIMEOUT if a handler has not produced a response within `timeoutMs`.
 * (Handlers are expected to be well below this; it is a backstop, not a scheduling tool.)
 */
export function requestTimeout(timeoutMs: number): RequestHandler {
  return (_req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        sendError(
          res,
          new HttpError(503, 'REQUEST_TIMEOUT', 'The request took too long to process.'),
        );
      }
    }, timeoutMs);
    timer.unref();
    const clear = () => clearTimeout(timer);
    res.once('finish', clear);
    res.once('close', clear);
    next();
  };
}
