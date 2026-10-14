import { HttpError } from '../utils/httpError.js';

/** Terminal handler for unmatched routes. */
export const notFound = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'The requested resource was not found.'));
};
