import { describe, expect, it } from 'vitest';
import { parseHealthResponse } from './health';

describe('parseHealthResponse', () => {
  it('accepts a minimal payload', () => {
    expect(parseHealthResponse({ status: 'ok' })).toEqual({ status: 'ok' });
  });
  it('keeps recognised optional fields and ignores unknown ones', () => {
    const parsed = parseHealthResponse({
      status: 'ok',
      service: 'api',
      version: '1.2.3',
      uptime_seconds: 42,
      timestamp: '2026-10-14T10:00:00Z',
      secret: 'not-passed-through',
    });
    expect(parsed).toEqual({
      status: 'ok',
      service: 'api',
      version: '1.2.3',
      uptimeSeconds: 42,
      timestamp: '2026-10-14T10:00:00Z',
    });
  });
  it.each([[null], [[]], ['ok'], [{}], [{ status: 1 }], [{ status: '  ' }]])(
    'rejects invalid payload %j',
    (payload) => {
      expect(() => parseHealthResponse(payload)).toThrow();
    },
  );
});
