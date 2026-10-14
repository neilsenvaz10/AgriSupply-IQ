import { Router } from 'express';
import { methodNotAllowed } from '../middleware/methodNotAllowed.js';
import { SERVICE_NAME } from '../version.js';

/**
 * Versioned API surface, mounted at /api/v1.
 *
 * Intentionally contains NO agricultural endpoints yet: no commodities, mandis, prices or
 * forecasts. Those arrive with their own milestones and must be backed by real data.
 */
export function createV1Router() {
  const router = Router();
  router
    .route('/health')
    .get((_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ status: 'ok', service: SERVICE_NAME, apiVersion: 'v1' });
    })
    .all(methodNotAllowed(['GET']));
  return router;
}
