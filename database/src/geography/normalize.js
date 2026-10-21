import { createHash } from 'node:crypto';

/**
 * Deterministic name handling for the geographic discrepancy analysis (Milestone 2.4, Stage 3b).
 *
 * `normalizeName` is the same function as the registry's generated `normalized_name` column (collapse runs of
 * whitespace, trim, lower-case), so a label compares exactly as the database compares it. Everything else here is
 * a documented, testable rule used to FIND candidates. None of these rules is proof of identity.
 */

/** @param {string} value */
export const normalizeName = (value) => value.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Letters and digits only, lower-case: ignores spaces, hyphens, dots and other punctuation.
 * @param {string} value
 */
export const compactName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Word tokens of a name.
 * @param {string} value
 * @returns {string[]}
 */
export const nameTokens = (value) =>
  normalizeName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * Optimal string alignment distance (insertions, deletions, substitutions and adjacent transpositions).
 * @param {string} a
 * @param {string} b
 */
export function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  /** @type {number[][]} */
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) d[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[rows - 1][cols - 1];
}

/**
 * Whether two compact names are a plausible SPELLING variant. This only nominates a candidate for a human to
 * check: distance 1 for names up to 5 characters, 2 for longer ones; under 4 characters only one adjacent transposition.
 * @param {string} a compact name
 * @param {string} b compact name
 */
export function isSpellingVariant(a, b) {
  if (a === b) return false;
  if (Math.min(a.length, b.length) < 4) {
    // very short names: only one adjacent transposition of the same letters (for example gao / goa)
    const sorted = (/** @type {string} */ v) => [...v].sort().join('');
    return (
      a.length === b.length && a.length >= 3 && sorted(a) === sorted(b) && editDistance(a, b) === 1
    );
  }
  const limit = Math.max(a.length, b.length) <= 5 ? 1 : 2;
  return editDistance(a, b) <= limit;
}

/**
 * Stable JSON: object keys sorted at every level (so equal content gives equal text and equal hashes).
 * @param {any} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/**
 * @param {any} value
 * @param {number} [length] hex characters to keep
 */
export const digestOf = (value, length = 64) =>
  createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, length);
