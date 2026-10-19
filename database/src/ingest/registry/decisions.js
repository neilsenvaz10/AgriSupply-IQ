import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv } from '../csv.js';
import { normalizeLabel } from '../util.js';

/**
 * Reviewed alias decisions: the only way, besides an exact normalised match, that a source label
 * resolves to a registry entity.
 *
 * Files live in database/reference/aliases/ (version-controlled, so every decision is reviewable
 * and attributable). Columns:
 *
 *   source_code    data source code the decision applies to, or * for every source
 *   source_label   the label as the source writes it (compared normalised)
 *   context        for districts: the source's state label; empty otherwise
 *   decision       resolved | ambiguous | unresolved | rejected
 *   target_code    for `resolved`: the LGD code of the state or district it maps to
 *   note           why (required)
 *
 * A `resolved` decision needs a target and a note; the other decisions record a deliberate
 * "do not map this" and must not carry a target.
 */

const FILES = { state: 'state-aliases.csv', district: 'district-aliases.csv' };
const STATUSES = new Set(['resolved', 'ambiguous', 'unresolved', 'rejected']);

/**
 * @param {string} directory Directory containing the decision CSV files (missing files are empty).
 * @returns {Promise<Map<string, { status: any, entityId: string | null, note: string }>>}
 */
export async function loadDecisions(directory) {
  const decisions = new Map();
  for (const [kind, file] of Object.entries(FILES)) {
    const path = join(directory, file);
    if (!existsSync(path)) continue;
    const { header: columns, records } = await readCsv(path);
    const index = Object.fromEntries(columns.map((c, i) => [c.trim(), i]));
    for (const col of [
      'source_code',
      'source_label',
      'context',
      'decision',
      'target_code',
      'note',
    ]) {
      if (index[col] === undefined) throw new Error(`${file} is missing the "${col}" column`);
    }
    for await (const rec of records) {
      const get = (/** @type {string} */ c) => (rec.values[index[c]] ?? '').trim();
      const where = `${file} row ${rec.rowNumber}`;
      if (rec.columnCountMismatch) throw new Error(`${where}: wrong number of columns`);
      const decision = get('decision');
      if (!STATUSES.has(decision)) throw new Error(`${where}: unknown decision "${decision}"`);
      if (!get('note')) throw new Error(`${where}: a note explaining the decision is required`);
      if (decision === 'resolved' && !get('target_code'))
        throw new Error(`${where}: "resolved" needs a target_code`);
      if (decision !== 'resolved' && get('target_code'))
        throw new Error(`${where}: only "resolved" may have a target_code`);
      const source = get('source_code') || '*';
      const label = normalizeLabel(get('source_label'));
      const key = kind === 'district' ? `${normalizeLabel(get('context'))}|${label}` : label;
      const mapKey = `${kind}|${source}|${key}`;
      if (decisions.has(mapKey)) throw new Error(`${where}: duplicate decision for the same label`);
      decisions.set(mapKey, {
        status: decision,
        entityId: get('target_code') || null,
        note: `reviewed decision: ${get('note')}`,
      });
    }
  }
  return decisions;
}

/**
 * Builds the resolver's decision lookup for ONE source: source-specific decisions win over `*`.
 *
 * @param {Map<string, { status: any, entityId: string | null, note: string }>} all
 * @param {string} sourceCode
 */
export function decisionsForSource(all, sourceCode) {
  const out = new Map();
  for (const [key, value] of all) {
    const [kind, source, ...rest] = key.split('|');
    if (source === sourceCode) out.set(`${kind}|${rest.join('|')}`, value);
  }
  for (const [key, value] of all) {
    const [kind, source, ...rest] = key.split('|');
    const k = `${kind}|${rest.join('|')}`;
    if (source === '*' && !out.has(k)) out.set(k, value);
  }
  return out;
}
