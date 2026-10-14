/**
 * Environment-based configuration with strict validation.
 *
 * Rules:
 *  - Validation errors name the VARIABLE and the rule, never the value
 *    (values may be credentials).
 *  - Empty strings are treated as "not set" (so `.env.example` placeholders are safe).
 *  - PostgreSQL and the intelligence service are OPTIONAL: the API must start without them.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export interface AppConfig {
  nodeEnv: NodeEnv;
  host: string;
  port: number;
  /** Exact allowed browser origins (already expanded for loopback in non-production). */
  corsOrigins: readonly string[];
  /** Present only to know whether it is configured. Never log or return this value. */
  databaseUrl: string | null;
  /** Base URL of the FastAPI intelligence service without trailing slash, or null. */
  mlServiceUrl: string | null;
  mlServiceTimeoutMs: number;
  requestTimeoutMs: number;
  /** JSON / urlencoded body size limit. */
  bodyLimit: string;
  logLevel: LogLevel;
}

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

type Env = Record<string, string | undefined>;

const NODE_ENVS: readonly NodeEnv[] = ['development', 'test', 'production'];
const LOG_LEVELS: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];

function read(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readInt(
  env: Env,
  key: string,
  fallback: number,
  min: number,
  max: number,
  issues: string[],
): number {
  const raw = read(env, key);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    issues.push(`${key} must be a whole number between ${min} and ${max}.`);
    return fallback;
  }
  const value = Number(raw);
  if (value < min || value > max) {
    issues.push(`${key} must be between ${min} and ${max}.`);
    return fallback;
  }
  return value;
}

/** Returns the canonical origin if `value` is a bare http(s) origin, otherwise null. */
export function parseOrigin(value: string): string | null {
  if (value === '*') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  const hasExtra = (url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash;
  if (hasExtra) return null;
  return url.origin;
}

/**
 * In non-production, `http://localhost:5173` also allows `http://127.0.0.1:5173` (and vice versa),
 * because both are used for local development. Nothing else is added.
 */
export function expandLoopbackOrigins(origins: readonly string[]): string[] {
  const result = new Set<string>(origins);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1';
      result.add(url.origin);
    } else if (url.hostname === '127.0.0.1') {
      url.hostname = 'localhost';
      result.add(url.origin);
    }
  }
  return [...result];
}

function parseHttpBaseUrl(raw: string, key: string, issues: string[]): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`${key} must be a valid http(s) URL.`);
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    issues.push(`${key} must use http or https.`);
    return null;
  }
  if (url.username !== '' || url.password !== '') {
    issues.push(`${key} must not contain embedded credentials.`);
    return null;
  }
  return raw.replace(/\/+$/, '');
}

export function loadConfig(env: Env = process.env): AppConfig {
  const issues: string[] = [];

  // NODE_ENV
  const rawNodeEnv = read(env, 'NODE_ENV') ?? 'development';
  let nodeEnv: NodeEnv = 'development';
  if ((NODE_ENVS as readonly string[]).includes(rawNodeEnv)) {
    nodeEnv = rawNodeEnv as NodeEnv;
  } else {
    issues.push(`NODE_ENV must be one of: ${NODE_ENVS.join(', ')}.`);
  }
  const isProduction = nodeEnv === 'production';

  // Network
  const host = read(env, 'API_HOST') ?? '127.0.0.1';
  if (!/^[A-Za-z0-9.:\-_]+$/.test(host)) issues.push('API_HOST contains invalid characters.');
  const port = readInt(env, 'API_PORT', 4000, nodeEnv === 'test' ? 0 : 1, 65535, issues);

  // CORS
  const rawOrigins = read(env, 'API_CORS_ORIGINS');
  let corsOrigins: string[] = [];
  if (rawOrigins === undefined) {
    if (isProduction) {
      issues.push('API_CORS_ORIGINS is required when NODE_ENV=production.');
    } else {
      corsOrigins = ['http://localhost:5173'];
    }
  } else {
    const parsed: string[] = [];
    for (const [index, item] of rawOrigins
      .split(',')
      .map((s) => s.trim())
      .entries()) {
      if (item === '') continue;
      const origin = parseOrigin(item);
      if (origin === null) {
        issues.push(
          `API_CORS_ORIGINS entry #${index + 1} must be an http(s) origin (scheme://host[:port], no path, no wildcard).`,
        );
      } else {
        parsed.push(origin);
      }
    }
    if (parsed.length === 0 && issues.every((i) => !i.startsWith('API_CORS_ORIGINS'))) {
      issues.push('API_CORS_ORIGINS must list at least one origin.');
    }
    corsOrigins = parsed;
  }
  if (!isProduction) corsOrigins = expandLoopbackOrigins(corsOrigins);

  // Optional dependencies
  let databaseUrl: string | null = null;
  const rawDb = read(env, 'DATABASE_URL');
  if (rawDb !== undefined) {
    try {
      const url = new URL(rawDb);
      if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
        issues.push('DATABASE_URL must use the postgres:// or postgresql:// scheme.');
      } else {
        databaseUrl = rawDb;
      }
    } catch {
      issues.push('DATABASE_URL must be a valid postgres:// URL.');
    }
  }

  let mlServiceUrl: string | null = null;
  const rawMl = read(env, 'ML_SERVICE_URL');
  if (rawMl !== undefined) mlServiceUrl = parseHttpBaseUrl(rawMl, 'ML_SERVICE_URL', issues);

  const mlServiceTimeoutMs = readInt(env, 'ML_SERVICE_TIMEOUT_MS', 5000, 100, 60000, issues);
  const requestTimeoutMs = readInt(env, 'API_REQUEST_TIMEOUT_MS', 15000, 1000, 120000, issues);

  // Logging
  const rawLevel = read(env, 'LOG_LEVEL') ?? (nodeEnv === 'test' ? 'silent' : 'info');
  let logLevel: LogLevel = 'info';
  if ((LOG_LEVELS as readonly string[]).includes(rawLevel)) {
    logLevel = rawLevel as LogLevel;
  } else {
    issues.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}.`);
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    nodeEnv,
    host,
    port,
    corsOrigins,
    databaseUrl,
    mlServiceUrl,
    mlServiceTimeoutMs,
    requestTimeoutMs,
    bodyLimit: '100kb',
    logLevel,
  };
}
