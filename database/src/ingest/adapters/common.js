import { rawObject } from '../framework.js';
import { parseDecimal } from '../util.js';

/**
 * Helpers shared by the dataset adapters.
 *
 * Reason codes are the ones accepted by `ingestion_rejections.reason_code`:
 * structural_error, missing_required_value, invalid_value, invalid_date, negative_value,
 * price_ordering_violation, unmapped_entity, ambiguous_entity, unsupported_unit, other.
 */

/** @param {string[]} header @param {string[]} expected */
export function requireHeader(header, expected, dataset) {
  const missing = expected.filter((name) => !header.map((h) => h.trim()).includes(name));
  if (missing.length) {
    throw new Error(
      `This file does not look like dataset ${dataset}: missing column(s) ${missing.join(', ')}.`,
    );
  }
}

/** Returns a function that reads a trimmed cell by column name. */
export function cells(header, rec) {
  const index = new Map(header.map((h, i) => [h.trim(), i]));
  return (/** @type {string} */ name) => (rec.values[index.get(name) ?? -1] ?? '').trim();
}

/** A quarantined record. */
export function rejection(reason, detail, header, rec, extra = {}) {
  return { reject: { reason, detail, raw: { ...rawObject(header, rec.values), ...extra } } };
}

/**
 * Parses min/max/modal price cells and applies the shared price rules.
 *
 * @param {Record<string, string>} cellsByName e.g. { min, max, modal }
 * @returns {{ reject: { reason: string, detail: string } } | { values: Record<string, { value: string, number: number } | null>, flags: string[] }}
 */
export function checkPrices(cellsByName) {
  /** @type {Record<string, { value: string, number: number } | null>} */
  const values = {};
  for (const [name, cell] of Object.entries(cellsByName)) {
    const parsed = parseDecimal(cell);
    if ('invalid' in parsed)
      return { reject: { reason: 'invalid_value', detail: `${name} price is not a number` } };
    if ('blank' in parsed) values[name] = null;
    else {
      if (parsed.number < 0)
        return { reject: { reason: 'negative_value', detail: `${name} price is negative` } };
      // A price of zero is not a price: non-positive prices are quarantined, never stored.
      if (parsed.number === 0)
        return {
          reject: {
            reason: 'invalid_value',
            detail: `${name} price is zero (non-positive prices are quarantined)`,
          },
        };
      values[name] = parsed;
    }
  }
  if (Object.values(values).every((v) => v === null)) {
    return { reject: { reason: 'missing_required_value', detail: 'no price is present' } };
  }
  const { min, max, modal } = values;
  const bad =
    (min && modal && min.number > modal.number) ||
    (modal && max && modal.number > max.number) ||
    (min && max && min.number > max.number);
  if (bad)
    return {
      reject: {
        reason: 'price_ordering_violation',
        detail: 'min, modal and max prices are not in order',
      },
    };
  return { values, flags: /** @type {string[]} */ ([]) };
}

/** Canonical text of a parsed decimal (so 12.50 and 12.5 fingerprint identically), or null. */
export const numKey = (parsed) => (parsed ? String(parsed.number) : null);
