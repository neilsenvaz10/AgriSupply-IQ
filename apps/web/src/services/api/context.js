import { createContext, useContext } from 'react';
import { readConfig } from '../../config/env';
import { createApiClient } from './client';

const config = readConfig();
/** The application-wide client, built once from the browser-facing configuration. */
export const defaultApiClient = createApiClient({
  baseUrl: config.apiBaseUrl,
  timeoutMs: config.apiTimeoutMs,
});

export const ApiClientContext = createContext(defaultApiClient);

export function useApiClient() {
  return useContext(ApiClientContext);
}
