/**
 * @typedef {object} Logger
 * @property {(message: string, fields?: Record<string, unknown>) => void} error
 * @property {(message: string, fields?: Record<string, unknown>) => void} warn
 * @property {(message: string, fields?: Record<string, unknown>) => void} info
 * @property {(message: string, fields?: Record<string, unknown>) => void} debug
 */

/** @type {Record<import('../config/env.js').LogLevel, number>} */
const ORDER = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

/**
 * Removes `user:password@` from any URL-like text so credentials never reach the logs.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, '$1[redacted]@');
}

function sanitize(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (value instanceof Error) return redactSecrets(`${value.name}: ${value.message}`);
  return value;
}
/**
 * Minimal JSON-lines logger writing to stdout/stderr.
 *
 * @param {import('../config/env.js').LogLevel} level
 * @returns {Logger}
 */
export function createLogger(level) {
  const threshold = ORDER[level];
  function write(lvl, message, fields) {
    if (ORDER[lvl] > threshold) return;
    const entry = {
      time: new Date().toISOString(),
      level: lvl,
      msg: redactSecrets(message),
    };
    if (fields) {
      for (const [key, value] of Object.entries(fields)) entry[key] = sanitize(value);
    }
    const line = `${JSON.stringify(entry)}\n`;
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line);
  }
  return {
    error: (m, f) => write('error', m, f),
    warn: (m, f) => write('warn', m, f),
    info: (m, f) => write('info', m, f),
    debug: (m, f) => write('debug', m, f),
  };
}

export const silentLogger = createLogger('silent');
