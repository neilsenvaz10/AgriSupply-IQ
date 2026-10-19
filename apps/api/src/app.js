import express from 'express';
import helmet from 'helmet';
import { corsAllowlist } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createReadyRouter } from './routes/ready.routes.js';
import { createV1Router } from './routes/v1.routes.js';
import { silentLogger } from './utils/logger.js';

/**
 * @typedef {object} AppDependencies
 * @property {import('./utils/logger.js').Logger} [logger]
 * @property {typeof fetch} [fetchImpl] Injectable for tests so no real network call is made by
 *   the dependency probes.
 * @property {import('./database/pool.js').PoolLike} [pool] The application connection pool used
 *   by the PostgreSQL health probe. `createApp` never creates a pool itself.
 */

/**
 * Builds the Express application WITHOUT binding a port, so tests can drive it in-process.
 * Binding and lifecycle live in `lifecycle.js` / `server.js`.
 *
 * Middleware order matters:
 *   request id -> logging -> security headers -> CORS allowlist -> timeout -> body parsing
 *   -> routes -> 404 -> centralised error handler
 *
 * @param {import('./config/env.js').AppConfig} config
 * @param {AppDependencies} [deps]
 * @returns {import('express').Express}
 */
export function createApp(config, deps = {}) {
  const logger = deps.logger ?? silentLogger;
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowlist(config.corsOrigins));
  app.use(requestTimeout(config.requestTimeoutMs));
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));
  const probe = {
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.pool ? { pool: deps.pool } : {}),
  };
  app.use('/health', createHealthRouter(config, probe));
  app.use('/ready', createReadyRouter(config, probe));
  app.use('/api/v1', createV1Router(deps.pool));
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
