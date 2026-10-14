import { describe, expect, it } from 'vitest';
import { ConfigError, expandLoopbackOrigins, loadConfig, parseOrigin } from './env.js';

function issuesFor(env: Record<string, string>): readonly string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies safe defaults and does not require any dependency', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      host: '127.0.0.1',
      port: 4000,
      databaseUrl: null,
      mlServiceUrl: null,
      mlServiceTimeoutMs: 5000,
    });
    expect(config.corsOrigins).toEqual(
      expect.arrayContaining(['http://localhost:5173', 'http://127.0.0.1:5173']),
    );
  });

  it('treats empty strings (as in .env.example) as unset', () => {
    const config = loadConfig({ DATABASE_URL: '', ML_SERVICE_URL: '   ', API_PORT: '' });
    expect(config.databaseUrl).toBeNull();
    expect(config.mlServiceUrl).toBeNull();
    expect(config.port).toBe(4000);
  });

  it('reads and normalises a full valid configuration', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      API_PORT: '8080',
      API_HOST: '0.0.0.0',
      API_CORS_ORIGINS: 'https://app.example.org, https://admin.example.org/',
      DATABASE_URL: 'postgresql://u:p@db:5432/app',
      ML_SERVICE_URL: 'http://ml:8000/',
      ML_SERVICE_TIMEOUT_MS: '2500',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      host: '0.0.0.0',
      mlServiceUrl: 'http://ml:8000',
      mlServiceTimeoutMs: 2500,
    });
    expect(config.corsOrigins).toEqual(['https://app.example.org', 'https://admin.example.org']);
  });

  it.each([['0'], ['65536'], ['abc'], ['-1'], ['40.5']])('rejects API_PORT=%s', (value) => {
    expect(issuesFor({ API_PORT: value }).join(' ')).toMatch(/API_PORT/);
  });

  it.each([['99'], ['60001'], ['soon']])('rejects ML_SERVICE_TIMEOUT_MS=%s', (value) => {
    expect(issuesFor({ ML_SERVICE_TIMEOUT_MS: value }).join(' ')).toMatch(/ML_SERVICE_TIMEOUT_MS/);
  });

  it.each([['999'], ['120001']])('rejects API_REQUEST_TIMEOUT_MS=%s', (value) => {
    expect(issuesFor({ API_REQUEST_TIMEOUT_MS: value }).join(' ')).toMatch(
      /API_REQUEST_TIMEOUT_MS/,
    );
  });

  it.each([
    ['*'],
    ['http://localhost:5173/app'],
    ['ftp://example.org'],
    ['localhost:5173'],
    ['http://user:pw@example.org'],
  ])('rejects API_CORS_ORIGINS entry %s', (value) => {
    expect(issuesFor({ API_CORS_ORIGINS: value }).join(' ')).toMatch(/API_CORS_ORIGINS/);
  });

  it('requires explicit CORS origins in production', () => {
    expect(issuesFor({ NODE_ENV: 'production' }).join(' ')).toMatch(/API_CORS_ORIGINS is required/);
  });

  it('does not add loopback twins in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'http://localhost:5173',
    });
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
  });

  it('rejects wrong-scheme or credential-bearing dependency URLs', () => {
    expect(issuesFor({ DATABASE_URL: 'mysql://u:p@h/db' }).join(' ')).toMatch(/DATABASE_URL/);
    expect(issuesFor({ DATABASE_URL: 'not a url' }).join(' ')).toMatch(/DATABASE_URL/);
    expect(issuesFor({ ML_SERVICE_URL: 'ftp://ml' }).join(' ')).toMatch(/ML_SERVICE_URL/);
    expect(issuesFor({ ML_SERVICE_URL: 'http://u:p@ml:8000' }).join(' ')).toMatch(
      /ML_SERVICE_URL must not contain embedded credentials/,
    );
  });

  it('rejects an unknown NODE_ENV and LOG_LEVEL', () => {
    expect(issuesFor({ NODE_ENV: 'staging' }).join(' ')).toMatch(/NODE_ENV/);
    expect(issuesFor({ LOG_LEVEL: 'loud' }).join(' ')).toMatch(/LOG_LEVEL/);
  });

  it('reports every problem at once and never echoes secret values', () => {
    const secret = 'SuperSecretPassw0rd';
    let message = '';
    try {
      loadConfig({
        API_PORT: 'nope',
        DATABASE_URL: `mysql://admin:${secret}@db/app`,
        ML_SERVICE_URL: `http://admin:${secret}@ml`,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as ConfigError).message;
      expect((error as ConfigError).issues.length).toBeGreaterThanOrEqual(3);
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('admin');
  });
});

describe('parseOrigin / expandLoopbackOrigins', () => {
  it('accepts bare origins only', () => {
    expect(parseOrigin('https://example.org:8443')).toBe('https://example.org:8443');
    expect(parseOrigin('https://example.org/')).toBe('https://example.org');
    expect(parseOrigin('https://example.org/x')).toBeNull();
    expect(parseOrigin('*')).toBeNull();
  });

  it('adds only the loopback twin of a loopback origin', () => {
    expect(expandLoopbackOrigins(['http://localhost:5173']).sort()).toEqual([
      'http://127.0.0.1:5173',
      'http://localhost:5173',
    ]);
    expect(expandLoopbackOrigins(['https://app.example.org'])).toEqual(['https://app.example.org']);
  });
});
