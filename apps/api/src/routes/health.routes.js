import { Router } from 'express';
import { methodNotAllowed } from '../middleware/methodNotAllowed.js';
import { checkDependencies, summarize } from '../services/dependencyHealth.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../version.js';

/**
 * Operational endpoints, mounted at the root (not under /api/v1) so probes stay stable
 * across API versions.
 *
 *   GET /health               liveness: "the Express process is running". Says NOTHING about
 *                             PostgreSQL or the intelligence service.
 *   GET /health/dependencies  honest, probe-based status of those dependencies.
 */
export function createHealthRouter(config, probe = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router
    .route('/')
    .get((_req, res) => {
      res.json({
        status: 'ok',
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        uptime_seconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    })
    .all(methodNotAllowed(['GET']));
  router
    .route('/dependencies')
    .get(async (_req, res) => {
      const dependencies = await checkDependencies(config, {
        ...probe,
        requestId: res.locals['requestId'],
      });
      res.json({
        service: SERVICE_NAME,
        checked_at: new Date().toISOString(),
        overall: summarize(dependencies),
        dependencies,
      });
    })
    .all(methodNotAllowed(['GET']));
  return router;
}
