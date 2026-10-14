import type { RequestHandler } from 'express';
import { HttpError } from '../utils/httpError.js';

/** Use after the supported handlers on a route: `route.get(h).all(methodNotAllowed(['GET']))`. */
export function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  const allow = [...new Set([...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'])];
  return (_req, _res, next) => {
    next(
      new HttpError(405, 'METHOD_NOT_ALLOWED', 'This method is not supported for this resource.', {
        Allow: allow.join(', '),
      }),
    );
  };
}
