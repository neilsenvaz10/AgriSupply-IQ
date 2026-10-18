import { describe, expect, it } from 'vitest';
import {
  DatabaseConfigError,
  describeTarget,
  readDatabaseConfig,
  redactSecrets,
} from './config.js';

const APP = 'postgresql://app_user:s3cretAppPw@localhost:5433/fasalytics';
const MIG = 'postgresql://migrator_user:s3cretMigPw@localhost:5433/fasalytics';

/**
 * @param {Record<string, string | undefined>} env
 * @param {Parameters<typeof readDatabaseConfig>[1]} [options]
 */
function issuesFor(env, options) {
  try {
    readDatabaseConfig(env, options);
  } catch (error) {
    if (error instanceof DatabaseConfigError) return error.issues;
    throw error;
  }
  return [];
}

describe('readDatabaseConfig', () => {
  it('reads both connection strings', () => {
    expect(readDatabaseConfig({ DATABASE_URL: APP, DATABASE_MIGRATION_URL: MIG })).toEqual({
      appUrl: APP,
      migrationUrl: MIG,
    });
  });

  it('treats absent or empty values as unset when they are not required', () => {
    expect(readDatabaseConfig({ DATABASE_URL: '', DATABASE_MIGRATION_URL: '   ' })).toEqual({
      appUrl: null,
      migrationUrl: null,
    });
  });

  it('requires only what the caller asks for', () => {
    expect(issuesFor({ DATABASE_URL: APP }, { require: ['migrationUrl'] })).toEqual([
      'DATABASE_MIGRATION_URL is required.',
    ]);
    expect(issuesFor({ DATABASE_URL: APP }, { require: ['appUrl'] })).toEqual([]);
  });

  it.each([
    ['mysql://u:p@h/db', /scheme/],
    ['not a url', /valid postgres/],
    ['postgresql://localhost:5433/db', /user name and password/],
    ['postgresql://u@localhost:5433/db', /user name and password/],
    ['postgresql://u:p@localhost:5433', /database name/],
    ['postgresql://u:p@/db', /host|valid/],
  ])('rejects %s', (value, rule) => {
    const issues = issuesFor({ DATABASE_URL: value });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/DATABASE_URL/);
    expect(issues[0]).toMatch(rule);
  });

  it('never echoes a password in an error message', () => {
    let message = '';
    try {
      readDatabaseConfig({ DATABASE_URL: 'mysql://admin:TopSecretValue99@db/app' });
    } catch (error) {
      message = /** @type {Error} */ (error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('TopSecretValue99');
    expect(message).not.toContain('admin');
  });
});

describe('describeTarget and redactSecrets', () => {
  it('describes a target without its password', () => {
    expect(describeTarget(APP)).toBe('app_user@localhost:5433/fasalytics');
    expect(describeTarget(APP)).not.toContain('s3cretAppPw');
  });

  it('defaults the port to 5432', () => {
    expect(describeTarget('postgresql://u:p@db/fasalytics')).toBe('u@db:5432/fasalytics');
  });

  it('redacts credentials in arbitrary text', () => {
    expect(redactSecrets(`connect failed ${APP} (timeout)`)).toBe(
      'connect failed postgresql://[redacted]@localhost:5433/fasalytics (timeout)',
    );
  });
});
