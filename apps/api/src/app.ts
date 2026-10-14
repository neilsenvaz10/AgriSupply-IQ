import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import { corsAllowlist } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestTimeout } from './middleware/requestTimeout.js';
import { createHealthRouter } from './routes/health.routes.js';
import { createV1Router } from './routes/v1.routes.js';
import { silentLogger } from './utils/logger.js';
import type { Logger } from './utils/logger.js';

export interface AppDependencies {
  logger?: Logger;
  /** Injectable for tests so no real network call is made by the probes. */
  fetchImpl?: typeof fetch;
}

/**
 * Builds the Express application WITHOUT binding a port, so tests can drive it in-process.
 * Binding and lifecycle live in `lifecycle.ts` / `server.ts`.
 *
 * Middleware order matters:
 *   request id -> logging -> security headers -> CORS allowlist -> timeout -> body parsing
 *   -> routes -> 404 -> centralised error handler
 */
export function createApp(config: AppConfig, deps: AppDependencies = {}): Express {
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

  const probe = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
  app.use('/health', createHealthRouter(config, probe));
  app.use('/api/v1', createV1Router());

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
