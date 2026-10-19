import { HttpError } from '../utils/httpError.js';

/**
 * Query-string validation for the historical market endpoints. Strict by design: unknown
 * parameters, repeated parameters and malformed values are rejected with 400 INVALID_PARAMETER.
 * Error messages name the parameter, never the submitted value.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_RANGE_DAYS = 366;
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 100;

/** @param {string} message */
export const invalid = (message) => new HttpError(400, 'INVALID_PARAMETER', message);

/**
 * @param {string} text
 * @returns {boolean}
 */
function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * Days between two ISO dates, inclusive.
 *
 * @param {string} from
 * @param {string} to
 */
export function spanDays(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
}

/** @typedef {{ parse: (value: string, name: string) => any, required?: boolean, default?: unknown }} Rule */

export const rule = {
  /** @returns {Rule} */
  uuid: () => ({
    parse: (v, name) => {
      if (!UUID.test(v)) throw invalid(`"${name}" must be a UUID.`);
      return v.toLowerCase();
    },
  }),
  /** @returns {Rule} */
  date: () => ({
    parse: (v, name) => {
      if (!isRealDate(v)) throw invalid(`"${name}" must be a real calendar date (YYYY-MM-DD).`);
      return v;
    },
  }),
  /**
   * Calendar month as YYYY-MM or YYYY-MM-01, returned as the first day of the month.
   *
   * @returns {Rule}
   */
  month: () => ({
    parse: (v, name) => {
      const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(v);
      if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
        throw invalid(`"${name}" must be a month (YYYY-MM).`);
      }
      return `${m[1]}-${m[2]}-01`;
    },
  }),
  /**
   * @param {{ min?: number, max: number, default?: number }} o
   * @returns {Rule}
   */
  int: (o) => ({
    default: o.default,
    parse: (v, name) => {
      if (!/^\d{1,9}$/.test(v)) throw invalid(`"${name}" must be a whole number.`);
      const n = Number(v);
      if (n < (o.min ?? 1) || n > o.max) {
        throw invalid(`"${name}" must be between ${o.min ?? 1} and ${o.max}.`);
      }
      return n;
    },
  }),
  /**
   * @param {readonly string[]} values
   * @returns {Rule}
   */
  oneOf: (values) => ({
    parse: (v, name) => {
      if (!values.includes(v)) throw invalid(`"${name}" must be one of: ${values.join(', ')}.`);
      return v;
    },
  }),
  /**
   * @param {number} max
   * @returns {Rule}
   */
  text: (max) => ({
    parse: (v, name) => {
      const t = v.trim();
      const hasControl = [...t].some((c) => c.charCodeAt(0) < 32);
      if (t.length === 0 || t.length > max || hasControl) {
        throw invalid(`"${name}" must be 1-${max} printable characters.`);
      }
      return t;
    },
  }),
  /** @returns {Rule} */
  cursor: () => ({ parse: (v) => decodeCursor(v) }),
};

/** @returns {Rule} */
export const limitRule = () => rule.int({ min: 1, max: MAX_LIMIT, default: DEFAULT_LIMIT });

/**
 * @param {Record<string, unknown>} raw `req.query`
 * @param {Record<string, Rule>} spec
 * @returns {Record<string, any>}
 */
export function parseQuery(raw, spec) {
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(spec, key)) throw invalid(`Unknown query parameter "${key}".`);
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [name, r] of Object.entries(spec)) {
    const v = raw[name];
    if (v === undefined) {
      if (r.required) throw invalid(`Query parameter "${name}" is required.`);
      out[name] = r.default ?? null;
      continue;
    }
    if (typeof v !== 'string') throw invalid(`Query parameter "${name}" must be given once.`);
    out[name] = r.parse(v, name);
  }
  return out;
}

/**
 * Validates a from/to date window: ordered and at most MAX_RANGE_DAYS long.
 *
 * @param {string} from
 * @param {string} to
 */
export function requireWindow(from, to) {
  if (from > to) throw invalid('"from" must not be after "to".');
  if (spanDays(from, to) > MAX_RANGE_DAYS) {
    throw invalid(`The date range may span at most ${MAX_RANGE_DAYS} days.`);
  }
}

/**
 * @param {unknown[]} values opaque position of the last returned row
 * @returns {string}
 */
export function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function decodeCursor(text) {
  try {
    const value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 3 &&
      value.every((x) => typeof x === 'string' && x.length <= 300)
    ) {
      return value;
    }
  } catch {
    // fall through to the single error below
  }
  throw invalid('"cursor" is not valid. Use the next_cursor value of a previous response.');
}

/**
 * Escapes LIKE metacharacters so user text is matched literally.
 *
 * @param {string} text
 */
export const likeEscape = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);
