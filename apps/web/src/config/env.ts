/**
 * Browser-facing runtime configuration.
 *
 * Only VITE_* variables exist in the browser bundle. Nothing secret belongs here.
 * The frontend talks to the Express API gateway only: never to PostgreSQL or the FastAPI service.
 */

/** Used in development only, so a fresh clone works without a .env file. */
export const DEV_DEFAULT_API_BASE_URL = 'http://localhost:4000';
export const DEFAULT_API_TIMEOUT_MS = 5000;

export type ApiBaseUrlSource = 'env' | 'dev-default' | 'missing' | 'invalid';

export interface AppConfig {
  /** Normalised base URL without a trailing slash, or null when unusable. */
  apiBaseUrl: string | null;
  apiBaseUrlSource: ApiBaseUrlSource;
  apiTimeoutMs: number;
}

interface EnvLike {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
  readonly DEV?: boolean;
}

export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function readConfig(env: EnvLike = import.meta.env): AppConfig {
  const rawTimeout = Number(env.VITE_API_TIMEOUT_MS);
  const apiTimeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_API_TIMEOUT_MS;

  const configured = env.VITE_API_BASE_URL;
  if (configured !== undefined && configured.trim() !== '') {
    const normalised = normalizeBaseUrl(configured);
    return normalised
      ? { apiBaseUrl: normalised, apiBaseUrlSource: 'env', apiTimeoutMs }
      : { apiBaseUrl: null, apiBaseUrlSource: 'invalid', apiTimeoutMs };
  }
  if (env.DEV === true) {
    return {
      apiBaseUrl: DEV_DEFAULT_API_BASE_URL,
      apiBaseUrlSource: 'dev-default',
      apiTimeoutMs,
    };
  }
  return { apiBaseUrl: null, apiBaseUrlSource: 'missing', apiTimeoutMs };
}
