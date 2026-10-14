import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError } from './errors';

const asString = (data) => {
  if (typeof data !== 'string') throw new Error('expected a string');
  return data;
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('createApiClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('requests the joined URL and returns the parsed body', async () => {
    const fetchImpl = vi.fn(
      /** @type {typeof fetch} */ (() => Promise.resolve(jsonResponse('hello'))),
    );
    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetchImpl });
    await expect(client.get('/health', { parse: asString })).resolves.toBe('hello');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://api.test/health');
  });
  it('rejects with kind "config" when no base URL is configured', async () => {
    const fetchImpl = vi.fn();
    const client = createApiClient({
      baseUrl: null,
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    await expect(client.get('/health', { parse: asString })).rejects.toMatchObject({
      kind: 'config',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects with kind "network" when the request cannot be completed', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    const error = await client.get('/health', { parse: asString }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: 'network' });
  });
  it('rejects with kind "http" and the status for non-2xx responses', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('nope', { status: 503 })));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    await expect(client.get('/health', { parse: asString })).rejects.toMatchObject({
      kind: 'http',
      status: 503,
    });
  });
  it('rejects with kind "parse" for invalid JSON', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('<html>', { status: 200 })));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    await expect(client.get('/health', { parse: asString })).rejects.toMatchObject({
      kind: 'parse',
    });
  });
  it('rejects with kind "parse" when the body fails validation', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ unexpected: true })));
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    await expect(client.get('/health', { parse: asString })).rejects.toMatchObject({
      kind: 'parse',
    });
  });
  it('rejects with kind "timeout" when the server does not answer in time', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 1000,
      fetchImpl: fetchImpl,
    });
    const assertion = expect(client.get('/health', { parse: asString })).rejects.toMatchObject({
      kind: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });
  it('rejects with kind "aborted" when the caller cancels', async () => {
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }),
    );
    const client = createApiClient({
      baseUrl: 'http://api.test',
      timeoutMs: 10_000,
      fetchImpl: fetchImpl,
    });
    const controller = new AbortController();
    const assertion = expect(
      client.get('/health', { parse: asString, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await assertion;
  });
});
