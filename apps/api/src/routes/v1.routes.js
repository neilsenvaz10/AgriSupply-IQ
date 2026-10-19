import { Router } from 'express';
import { methodNotAllowed } from '../middleware/methodNotAllowed.js';
import { createMarketRouter } from './market.routes.js';
import { SERVICE_NAME } from '../version.js';

/**
 * Versioned API surface, mounted at /api/v1.
 *
 * Contains the read-only HISTORICAL market endpoints (Milestone 2.3A) and nothing else agricultural:
 * no forecasts, no live data, no write operations. See docs/api/historical-market-api.md.
 *
 * @param {import('../database/pool.js').PoolLike} [pool] The read-only application pool.
 */
export function createV1Router(pool) {
  const router = Router();
  router
    .route('/health')
    .get((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'ok', service: SERVICE_NAME, apiVersion: 'v1' });
    })
    .all(methodNotAllowed(['GET']));
  router.use(createMarketRouter(pool));
  return router;
}
