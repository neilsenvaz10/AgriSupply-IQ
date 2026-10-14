import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_TIMEOUT_MS,
  DEV_DEFAULT_API_BASE_URL,
  normalizeBaseUrl,
  readConfig,
} from './env';

describe('normalizeBaseUrl', () => {
  it('trims and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  http://localhost:4000// ')).toBe('http://localhost:4000');
  });

  it.each([[''], ['   '], ['localhost:4000'], ['ftp://example.com'], ['not a url']])(
    'rejects %j',
    (value) => {
      expect(normalizeBaseUrl(value)).toBeNull();
    },
  );
});

describe('readConfig', () => {
  it('uses VITE_API_BASE_URL when valid', () => {
    expect(readConfig({ VITE_API_BASE_URL: 'https://api.example.org/', DEV: false })).toEqual({
      apiBaseUrl: 'https://api.example.org',
      apiBaseUrlSource: 'env',
      apiTimeoutMs: DEFAULT_API_TIMEOUT_MS,
    });
  });

  it('falls back to the development default only in dev mode', () => {
    expect(readConfig({ DEV: true })).toMatchObject({
      apiBaseUrl: DEV_DEFAULT_API_BASE_URL,
      apiBaseUrlSource: 'dev-default',
    });
  });

  it('reports a missing URL in production instead of guessing', () => {
    expect(readConfig({ DEV: false })).toMatchObject({
      apiBaseUrl: null,
      apiBaseUrlSource: 'missing',
    });
  });

  it('flags an invalid URL', () => {
    expect(readConfig({ VITE_API_BASE_URL: 'nonsense', DEV: true })).toMatchObject({
      apiBaseUrl: null,
      apiBaseUrlSource: 'invalid',
    });
  });

  it('parses a positive timeout and ignores bad values', () => {
    expect(readConfig({ VITE_API_TIMEOUT_MS: '2500' }).apiTimeoutMs).toBe(2500);
    expect(readConfig({ VITE_API_TIMEOUT_MS: '-1' }).apiTimeoutMs).toBe(DEFAULT_API_TIMEOUT_MS);
    expect(readConfig({ VITE_API_TIMEOUT_MS: 'abc' }).apiTimeoutMs).toBe(DEFAULT_API_TIMEOUT_MS);
  });
});
