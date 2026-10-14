import { createContext, useContext } from 'react';
import { readConfig } from '../../config/env';
import { createApiClient } from './client';
import type { ApiClient } from './client';

const config = readConfig();

/** The application-wide client, built once from the browser-facing configuration. */
export const defaultApiClient: ApiClient = createApiClient({
  baseUrl: config.apiBaseUrl,
  timeoutMs: config.apiTimeoutMs,
});

export const ApiClientContext = createContext<ApiClient>(defaultApiClient);

export function useApiClient(): ApiClient {
  return useContext(ApiClientContext);
}
