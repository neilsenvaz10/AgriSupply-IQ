import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Bounded-memory SHA-256 of a file (hex). The file is opened read-only. */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** SHA-256 of a string (hex). */
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Name normalisation used to compare labels. MUST stay equivalent to the database's generated
 * `normalized_name` columns: lower-case, whitespace runs collapsed to one space, trimmed.
 * It does not repair spelling; spelling variants are resolved only through reviewed aliases.
 *
 * @param {string | null | undefined} text
 */
export function normalizeLabel(text) {
  return String(text ?? '')
    .replace(/[ \t\n\r\f\v]+/g, ' ')
    .replace(/^ +| +$/g, '')
    .toLowerCase();
}

/**
 * Deterministic fingerprint of a record's normalised source values. Two records with the same
 * natural key and the same fingerprint are EXACT duplicates; the same key with a different
 * fingerprint is a conflict. The row number, file and run are deliberately not part of it.
 *
 * @param {unknown[]} fields Values in a fixed, documented order.
 */
export const fingerprint = (fields) => sha256(JSON.stringify(fields));

const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Parses a decimal cell. Returns `{ blank: true }` for an empty cell, `{ value: '123.45' }` for a
 * valid number (the canonical text, not a float, so no precision is lost), or `{ invalid: true }`.
 *
 * @param {string | undefined} cell
 * @returns {{ blank: true } | { value: string, number: number } | { invalid: true }}
 */
export function parseDecimal(cell) {
  const text = (cell ?? '').trim();
  if (text === '') return { blank: true };
  if (!DECIMAL.test(text)) return { invalid: true };
  const number = Number(text);
  if (!Number.isFinite(number)) return { invalid: true };
  const canonical = text
    .replace(/^\+/, '')
    .replace(/^(-?)\./, '$10.')
    .replace(/\.$/, '');
  return { value: canonical, number };
}

/** @param {number} year @param {number} month 1-12 @param {number} day */
function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || year < 1000) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last;
}

const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * `M/D/YYYY` (month first, as established in DATASET_COVERAGE.md) to `YYYY-MM-DD`, or null when
 * the text is not a real calendar date.
 *
 * @param {string | undefined} cell
 */
export function parseMonthFirstDate(cell) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((cell ?? '').trim());
  if (!m) return null;
  const [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isRealDate(year, month, day) ? `${pad(year, 4)}-${pad(month)}-${pad(day)}` : null;
}

/** `YYYY-MM-DD` to the same text when it is a real calendar date, otherwise null. */
export function parseIsoDate(cell) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((cell ?? '').trim());
  if (!m) return null;
  return isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) ? m[0] : null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** `January-2013` to `2013-01-01` (the first day of the month), or null. */
export function parseMonthYear(cell) {
  const m = /^([A-Za-z]+)-(\d{4})$/.exec((cell ?? '').trim());
  if (!m) return null;
  const index = MONTHS.indexOf(m[1].toLowerCase());
  return index < 0 ? null : `${m[2]}-${pad(index + 1)}-01`;
}

/** Splits an array into chunks of at most `size` (used for bounded SQL batches). */
export function* chunk(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** Removes anything credential-shaped from a message before it is stored or printed. */
export function sanitizeMessage(message, maxLength = 500) {
  return String(message)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, '$1[redacted]@')
    .replace(/password[^\s,;]*/gi, 'password [redacted]')
    .slice(0, maxLength);
}
