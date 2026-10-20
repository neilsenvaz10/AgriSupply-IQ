import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../api/client';
import { ApiError } from '../api/errors';
import { META, id, listBody } from '../../test/historicalFixtures';
import { buildPath, describeError, historical, parseEnvelope } from './historical';

const client = (fetchImpl) =>
  createApiClient({ baseUrl: 'http://api.test', timeoutMs: 500, fetchImpl });
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('request construction', () => {
  it('builds the documented /api/v1 paths and skips empty values', () => {
    expect(buildPath('states')).toBe('/api/v1/states');
    expect(buildPath('states', { kind: 'state', q: '', limit: 100, cursor: null })).toBe(
      '/api/v1/states?kind=state&limit=100',
    );
    expect(buildPath('coverage')).toBe('/api/v1/coverage');
    expect(buildPath('unresolved')).toBe('/api/v1/geography/unresolved');
    expect(buildPath('marketDetail', {}, { id: id(5) })).toBe(`/api/v1/markets/${id(5)}`);
  });

  it('builds a mandi price request with every filter, the window and the cursor', () => {
    const path = buildPath('mandiPrices', {
      market_id: id(1),
      commodity_id: id(2),
      from: '2024-01-01',
      to: '2024-03-31',
      limit: 50,
      cursor: 'abc_DEF-123',
    });
    const url = new URL(`http://x${path}`);
    expect(url.pathname).toBe('/api/v1/mandi-prices');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      market_id: id(1),
      commodity_id: id(2),
      from: '2024-01-01',
      to: '2024-03-31',
      limit: '50',
      cursor: 'abc_DEF-123',
    });
  });

  it('lower-cases UUIDs and trims search text', () => {
    const path = buildPath('markets', { state_id: id(3).toUpperCase(), q: '  rampur ' });
    expect(path).toBe(`/api/v1/markets?state_id=${id(3)}&q=rampur`);
  });

  it.each([
    ['an unknown parameter', 'states', { colour: 'red' }],
    ['a bad UUID', 'districts', { state_id: 'nope' }],
    ['a limit above 500', 'states', { limit: 501 }],
    ['a limit of 0', 'states', { limit: 0 }],
    [
      'an impossible date',
      'mandiPrices',
      { commodity_id: id(1), from: '2024-02-30', to: '2024-03-01' },
    ],
    ['a missing window', 'mandiPrices', { commodity_id: id(1) }],
    [
      'a reversed window',
      'mandiPrices',
      { commodity_id: id(1), from: '2024-03-02', to: '2024-03-01' },
    ],
    [
      'a window over 366 days',
      'mandiPrices',
      { commodity_id: id(1), from: '2023-01-01', to: '2024-12-31' },
    ],
    ['no market, commodity or state', 'mandiPrices', { from: '2024-01-01', to: '2024-01-31' }],
    ['a bad enum', 'markets', { district_status: 'maybe' }],
    ['a cursor with unsafe characters', 'markets', { cursor: 'a b&c=d' }],
  ])('rejects %s before anything is sent', (_label, endpoint, params) => {
    const build = () => buildPath(/** @type {any} */ (endpoint), params);
    expect(build).toThrow(ApiError);
    try {
      build();
    } catch (error) {
      expect(/** @type {any} */ (error).kind).toBe('invalid_request');
    }
  });

  it('accepts a window of exactly 366 days', () => {
    expect(() =>
      buildPath('mandiPrices', { commodity_id: id(1), from: '2024-01-01', to: '2024-12-31' }),
    ).not.toThrow();
  });

  it('never calls the network for an invalid request', async () => {
    const fetchImpl = vi.fn();
    await expect(
      historical.mandiPrices(client(fetchImpl), { from: '2024-01-01', to: '2024-01-31' }),
    ).rejects.toMatchObject({ kind: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends GET requests to the configured API base with the built path', async () => {
    const fetchImpl = vi.fn(async (/** @type {string} */ _url, /** @type {RequestInit} */ _init) =>
      json(listBody([])),
    );
    await historical.markets(client(fetchImpl), { state_id: id(11), limit: 50 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`http://api.test/api/v1/markets?state_id=${id(11)}&limit=50`);
    expect(init.method).toBe('GET');
  });
});

describe('response checking', () => {
  it('accepts a historical snapshot envelope and returns it as given', () => {
    const body = listBody([{ id: id(1) }]);
    expect(parseEnvelope(body, { list: true }).data).toEqual([{ id: id(1) }]);
  });

  it.each([
    ['claims to be live', { ...listBody([]), meta: { ...META, is_live: true } }],
    ['has no meta', { data: [], pagination: { limit: 1, has_more: false, next_cursor: null } }],
    ['is not a historical snapshot', { ...listBody([]), meta: { ...META, data_status: 'live' } }],
    ['has no pagination', { data: [], meta: META }],
    [
      'has a non-list data',
      { data: {}, pagination: { limit: 1, has_more: false, next_cursor: null }, meta: META },
    ],
  ])('rejects a list response that %s', (_label, body) => {
    expect(() => parseEnvelope(body, { list: true })).toThrow();
  });

  it('surfaces a response that claims to be live as a parse error, never as data', async () => {
    const live = { ...listBody([]), meta: { ...META, is_live: true } };
    await expect(historical.states(client(vi.fn(async () => json(live))))).rejects.toMatchObject({
      kind: 'parse',
    });
  });

  it('maps every failure kind to a plain-language reason', () => {
    expect(describeError(new ApiError('network', 'x'))).toMatch(/could not be reached/);
    expect(describeError(new ApiError('timeout', 'x'))).toMatch(/did not answer in time/);
    expect(describeError(new ApiError('http', 'x', { status: 503 }))).toMatch(/problem/);
    expect(describeError(new ApiError('http', 'x', { status: 400 }))).toMatch(/rejected/);
    expect(describeError(new ApiError('parse', 'x'))).toMatch(/unexpected format/);
    expect(describeError(new ApiError('invalid_request', 'x'))).toMatch(/not valid/);
    expect(describeError(new ApiError('config', 'x'))).toMatch(/not configured/);
    expect(describeError(new Error('boom'))).toMatch(/could not be loaded/);
    expect(describeError(new Error('boom'))).not.toMatch(/boom/);
  });
});

describe('request cancellation', () => {
  it('passes the caller signal through so an abort cancels the request', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    const pending = historical.states(client(fetchImpl), {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });
});
