import { Router } from 'express';
import { methodNotAllowed } from '../middleware/methodNotAllowed.js';
import { checkDependencies, checkIntelligenceModels } from '../services/dependencyHealth.js';
import { SERVICE_NAME, SERVICE_VERSION } from '../version.js';

/**
 * `GET /ready`: readiness of the Express API to do its job, as opposed to `GET /health`, which
 * only says the process is alive.
 *
 *  - 200 `ready`      every CONFIGURED dependency (PostgreSQL, intelligence service) is healthy.
 *  - 503 `not_ready`  at least one configured dependency is unreachable or could not be verified.
 *  - A dependency that is not configured is reported as such and does not block readiness.
 *
 * `forecasting_models` is reported separately and never gates readiness: it is the intelligence
 * service's OWN `/ready` answer (models loaded or not), never inferred from its `/health`.
 */
export function createReadyRouter(config, probe = {}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router
    .route('/')
    .get(async (_req, res) => {
      const options = { ...probe, requestId: res.locals['requestId'] };
      const [reports, models] = await Promise.all([
        checkDependencies(config, options),
        checkIntelligenceModels(config, options),
      ]);
      const dependencies = Object.fromEntries(
        Object.entries(reports).map(([name, report]) => [
          name,
          { required: report.status !== 'not_configured', ...report },
        ]),
      );
      const blocking = Object.entries(dependencies)
        .filter(([, d]) => d.required && d.status !== 'healthy')
        .map(([name]) => name);
      const ready = blocking.length === 0;
      res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        checked_at: new Date().toISOString(),
        blocking,
        dependencies,
        forecasting_models: {
          ...models,
          gates_readiness: false,
        },
      });
    })
    .all(methodNotAllowed(['GET']));
  return router;
}
