import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv } from '../csv.js';
import { sha256File } from '../util.js';

/**
 * Reference sets for the geographic registry.
 *
 * A reference set is a directory holding `manifest.json` plus the files it lists. The manifest
 * records where the data came from, when it was retrieved, its SHA-256, its licence and its
 * reference date, and states whether it is verified or provisional. Loading a set verifies every
 * file against the manifest, so the registry is reproducible and a replaced file is detected.
 *
 * To use a newer or official LGD export, add another reference-set directory (same format, or a
 * new parser registered in PARSERS) and load it; nothing about the first set is lost, because
 * every registry row keeps the ingestion run (and therefore the file) that introduced it.
 *
 * @typedef {object} ReferenceState
 * @property {string} code LGD state code.
 * @property {string} name Name exactly as the reference writes it.
 * @property {'state' | 'union_territory'} kind
 * @property {number} rowNumber
 *
 * @typedef {object} ReferenceDistrict
 * @property {string} code LGD district code.
 * @property {string} stateCode
 * @property {string} name Name exactly as the reference writes it.
 * @property {number} rowNumber
 *
 * @typedef {object} ReferenceSet
 * @property {Record<string, any>} manifest
 * @property {Array<{ role: string, name: string, path: string, sha256: string, bytes: number }>} files
 * @property {ReferenceState[]} states
 * @property {ReferenceDistrict[]} districts
 * @property {Array<{ file: string, rowNumber: number, reason: string, raw: string[] }>} problems
 */

/**
 * `lgd-mirror-v1`: the planemad mirror layout. Positional columns, because the state file has two
 * columns both called "State Name".
 *   states:    S.No., State Code, State Version, State Name, State Name, Census 2001, Census 2011, State or UT
 *   districts: State Code, State Name, District Code, District Name, Census 2001, Census 2011
 */
async function parseLgdMirrorV1(files) {
  const stateFile = files.find((f) => f.role === 'states');
  const districtFile = files.find((f) => f.role === 'districts');
  if (!stateFile || !districtFile)
    throw new Error('lgd-mirror-v1 needs a "states" and a "districts" file.');
  /** @type {ReferenceSet['problems']} */
  const problems = [];
  /** @type {ReferenceState[]} */
  const states = [];
  const seenStates = new Set();
  for await (const rec of (await readCsv(stateFile.path)).records) {
    const [, code, , name, , , , kind] = rec.values;
    if (
      rec.columnCountMismatch ||
      !code?.trim() ||
      !name?.trim() ||
      !['S', 'U'].includes(kind?.trim())
    ) {
      problems.push({
        file: stateFile.name,
        rowNumber: rec.rowNumber,
        reason: 'malformed state row',
        raw: rec.values,
      });
      continue;
    }
    if (seenStates.has(code.trim())) {
      problems.push({
        file: stateFile.name,
        rowNumber: rec.rowNumber,
        reason: 'duplicate state code',
        raw: rec.values,
      });
      continue;
    }
    seenStates.add(code.trim());
    states.push({
      code: code.trim(),
      name: name.trim(),
      kind: kind.trim() === 'S' ? 'state' : 'union_territory',
      rowNumber: rec.rowNumber,
    });
  }
  /** @type {ReferenceDistrict[]} */
  const districts = [];
  const seenDistricts = new Set();
  const seenNames = new Set();
  for await (const rec of (await readCsv(districtFile.path)).records) {
    const [stateCode, , code, name] = rec.values;
    if (rec.columnCountMismatch || !stateCode?.trim() || !code?.trim() || !name?.trim()) {
      problems.push({
        file: districtFile.name,
        rowNumber: rec.rowNumber,
        reason: 'malformed district row',
        raw: rec.values,
      });
      continue;
    }
    if (!seenStates.has(stateCode.trim())) {
      problems.push({
        file: districtFile.name,
        rowNumber: rec.rowNumber,
        reason: 'district names an unknown state code',
        raw: rec.values,
      });
      continue;
    }
    const nameKey = `${stateCode.trim()}|${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;
    if (seenDistricts.has(code.trim()) || seenNames.has(nameKey)) {
      problems.push({
        file: districtFile.name,
        rowNumber: rec.rowNumber,
        reason: 'duplicate district code or name within a state',
        raw: rec.values,
      });
      continue;
    }
    seenDistricts.add(code.trim());
    seenNames.add(nameKey);
    districts.push({
      code: code.trim(),
      stateCode: stateCode.trim(),
      name: name.trim(),
      rowNumber: rec.rowNumber,
    });
  }
  return { states, districts, problems };
}

/** Parsers by manifest `format`. Register new formats here. */
const PARSERS = { 'lgd-mirror-v1': parseLgdMirrorV1 };

/**
 * Reads and VERIFIES a reference set: the manifest is required, every file must exist and match
 * its recorded SHA-256 and size, and the format must be known.
 *
 * @param {string} directory
 * @returns {Promise<ReferenceSet>}
 */
export async function readReferenceSet(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  for (const field of [
    'referenceSet',
    'format',
    'status',
    'referenceDate',
    'licence',
    'retrievedAt',
    'files',
  ]) {
    if (manifest[field] === undefined) throw new Error(`manifest.json is missing "${field}"`);
  }
  if (!['verified', 'provisional-historical'].includes(manifest.status)) {
    throw new Error('manifest.status must be "verified" or "provisional-historical"');
  }
  const parser = PARSERS[/** @type {keyof typeof PARSERS} */ (manifest.format)];
  if (!parser) throw new Error(`unknown reference format "${manifest.format}"`);
  const files = [];
  for (const entry of manifest.files) {
    const path = join(directory, entry.name);
    const digest = await sha256File(path);
    if (digest !== entry.sha256) {
      throw new Error(
        `${entry.name} does not match the SHA-256 in manifest.json (the file changed)`,
      );
    }
    files.push({ role: entry.role, name: entry.name, path, sha256: digest, bytes: entry.bytes });
  }
  const parsed = await parser(files);
  return { manifest, files, ...parsed };
}
