import type { LogLevel } from '../config/env.js';

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

export interface Logger {
  error(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
}

/** Removes `user:password@` from any URL-like text so credentials never reach the logs. */
export function redactSecrets(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, '$1[redacted]@');
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (value instanceof Error) return redactSecrets(`${value.name}: ${value.message}`);
  return value;
}

/** Minimal JSON-lines logger writing to stdout/stderr. */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];

  function write(
    lvl: Exclude<LogLevel, 'silent'>,
    message: string,
    fields?: Record<string, unknown>,
  ) {
    if (ORDER[lvl] > threshold) return;
    const entry: Record<string, unknown> = {
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

export const silentLogger: Logger = createLogger('silent');
