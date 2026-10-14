import type { ApiClient } from './client';

/**
 * Payload of `GET /health` on the Express API (process health only).
 * Only `status` is required; the remaining fields are optional and shown if present.
 * The contract will be finalised with the API in Milestone 6.
 */
export interface HealthResponse {
  status: string;
  service?: string;
  version?: string;
  uptimeSeconds?: number;
  timestamp?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseHealthResponse(data: unknown): HealthResponse {
  if (!isRecord(data)) throw new Error('expected a JSON object');
  const status = data['status'];
  if (typeof status !== 'string' || status.trim() === '') {
    throw new Error('missing string field "status"');
  }
  const result: HealthResponse = { status };
  const service = optionalString(data, 'service');
  const version = optionalString(data, 'version');
  const timestamp = optionalString(data, 'timestamp');
  const uptimeSeconds = optionalNumber(data, 'uptime_seconds') ?? optionalNumber(data, 'uptime');
  if (service !== undefined) result.service = service;
  if (version !== undefined) result.version = version;
  if (timestamp !== undefined) result.timestamp = timestamp;
  if (uptimeSeconds !== undefined) result.uptimeSeconds = uptimeSeconds;
  return result;
}

export function fetchHealth(client: ApiClient, signal?: AbortSignal): Promise<HealthResponse> {
  return client.get(
    '/health',
    signal ? { parse: parseHealthResponse, signal } : { parse: parseHealthResponse },
  );
}
