import cors from 'cors';
import { HttpError } from '../utils/httpError.js';

/**
 * Explicit CORS allowlist.
 *  - Requests without an Origin header (curl, server-to-server, health probes) pass through.
 *  - A listed Origin receives the CORS headers.
 *  - Any other Origin is rejected with 403 CORS_ORIGIN_NOT_ALLOWED and gets NO CORS headers.
 * There is no wildcard and credentials are not enabled.
 */
export function corsAllowlist(allowedOrigins) {
  const allowed = new Set(allowedOrigins);
  const guard = (req, _res, next) => {
    const origin = req.header('origin');
    if (origin !== undefined && !allowed.has(origin)) {
      next(
        new HttpError(
          403,
          'CORS_ORIGIN_NOT_ALLOWED',
          'This origin is not allowed to access the API.',
        ),
      );
      return;
    }
    next();
  };
  const headers = cors({
    origin: (origin, callback) => {
      callback(null, origin !== undefined && allowed.has(origin));
    },
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: 600,
    optionsSuccessStatus: 204,
  });
  return [guard, headers];
}
