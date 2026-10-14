import type { RequestHandler } from 'express';
import { HttpError } from '../utils/httpError.js';

/** Terminal handler for unmatched routes. */
export const notFound: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};
