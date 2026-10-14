import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Resolves to apps/api/package.json from both src/ (dev, tests) and dist/ (build). */
const pkg = require('../package.json') as { name?: unknown; version?: unknown };

export const SERVICE_NAME = 'fasalytics-api';
export const SERVICE_VERSION: string = typeof pkg.version === 'string' ? pkg.version : 'unknown';
