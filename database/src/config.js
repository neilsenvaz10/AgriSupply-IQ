/**
 * Database configuration: env-file loading, URL validation and secret-safe descriptions.
 *
 * Rules:
 *  - Credentials live in the git-ignored `database/.env`; nothing is hardcoded.
 *  - Validation errors name the VARIABLE and the rule, never the value.
 *  - Anything printed about a connection omits the password (see `describeTarget`).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads `database/.env` if present, without overriding variables already in the environment.
 *
 * @returns {boolean} Whether a file was loaded.
 */
export function loadDatabaseEnvFile() {
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

/** Raised when database configuration is invalid. `issues` never contain supplied values. */
export class DatabaseConfigError extends Error {
  /** @param {readonly string[]} issues */
  constructor(issues) {
    super(`Invalid database configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'DatabaseConfigError';
    /** @type {readonly string[]} */
    this.issues = issues;
  }
}

/**
 * Removes `user:password@` from any URL-like text so credentials never reach output.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, '$1[redacted]@');
}

/**
 * @param {string} raw
 * @param {string} name Variable name used in error messages.
 * @param {string[]} issues Collects problems.
 * @returns {string | null} The URL if valid.
 */
function parsePostgresUrl(raw, name, issues) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`${name} must be a valid postgres:// URL.`);
    return null;
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    issues.push(`${name} must use the postgres:// or postgresql:// scheme.`);
    return null;
  }
  if (url.hostname === '') {
    issues.push(`${name} must include a host.`);
    return null;
  }
  if (url.username === '' || url.password === '') {
    issues.push(`${name} must include a user name and password.`);
    return null;
  }
  if (url.pathname.length <= 1) {
    issues.push(`${name} must include a database name.`);
    return null;
  }
  return raw;
}

/**
 * @typedef {object} DatabaseConfig
 * @property {string | null} appUrl Least-privilege application connection (`DATABASE_URL`).
 * @property {string | null} migrationUrl Schema-owner connection (`DATABASE_MIGRATION_URL`).
 */

/**
 * Reads and validates the connection strings.
 *
 * @param {Record<string, string | undefined>} [env] Defaults to `process.env`.
 * @param {{ require?: ReadonlyArray<'appUrl' | 'migrationUrl'> }} [options] Which URLs must exist.
 * @returns {DatabaseConfig}
 * @throws {DatabaseConfigError}
 */
export function readDatabaseConfig(env = process.env, options = {}) {
  const required = options.require ?? [];
  /** @type {string[]} */
  const issues = [];

  /**
   * @param {string} name
   * @param {'appUrl' | 'migrationUrl'} key
   */
  const read = (name, key) => {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === '') {
      if (required.includes(key)) issues.push(`${name} is required.`);
      return null;
    }
    return parsePostgresUrl(raw, name, issues);
  };

  const config = {
    appUrl: read('DATABASE_URL', 'appUrl'),
    migrationUrl: read('DATABASE_MIGRATION_URL', 'migrationUrl'),
  };
  if (issues.length > 0) throw new DatabaseConfigError(issues);
  return config;
}

/**
 * A human-readable, password-free description of a connection target.
 *
 * @param {string} connectionString
 * @returns {string} For example `fasalytics_app@localhost:5433/fasalytics`.
 */
export function describeTarget(connectionString) {
  const url = new URL(connectionString);
  const port = url.port === '' ? '5432' : url.port;
  return `${decodeURIComponent(url.username)}@${url.hostname}:${port}${url.pathname}`;
}
