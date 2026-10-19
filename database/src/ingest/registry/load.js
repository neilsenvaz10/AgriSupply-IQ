import { statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { IMPORTER_VERSION } from '../framework.js';
import { insertRejections } from '../persist.js';
import { normalizeLabel, sanitizeMessage, sha256 } from '../util.js';
import { readReferenceSet } from './lgd.js';

/**
 * Loads a verified reference set (states/UTs and districts) into the registry as two ingestion
 * runs, so the registry itself has file-level provenance (source, file name, SHA-256, run).
 *
 * Idempotent and non-destructive, using only INSERT ... ON CONFLICT DO NOTHING:
 *   - a code already loaded with the same name is an exact duplicate (skipped);
 *   - a code that exists under a DIFFERENT name, or a name already used by another code, is
 *     quarantined for review (reason `ambiguous_entity`); the existing row is never overwritten.
 * Loading a newer export later therefore adds new codes and reports every difference.
 *
 * @param {{ pool: import('pg').Pool, directory: string }} options
 */
export async function loadReferenceSet({ pool, directory }) {
  const ref = await readReferenceSet(directory);
  const client = await pool.connect();
  const lockKey = `fasalytics:registry:${ref.manifest.referenceSet}`;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
    if (!lock.rows[0].ok) throw new Error('This reference set is already being loaded.');
    await client.query('BEGIN');
    const code = String(ref.manifest.referenceSet)
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_');
    await client.query(
      `INSERT INTO data_sources (code, name, source_type, publisher, description, endpoint_reference)
       VALUES ($1, $2, 'other', NULL, $3, NULL) ON CONFLICT (code) DO NOTHING`,
      [
        code,
        `Geographic reference: ${ref.manifest.referenceSet}`,
        `Status: ${ref.manifest.status}. Reference date: ${ref.manifest.referenceDate}. Licence: ${ref.manifest.licence.name}. ${ref.manifest.statusNote ?? ''}`.slice(
          0,
          1900,
        ),
      ],
    );
    const sourceId = (await client.query('SELECT id FROM data_sources WHERE code = $1', [code]))
      .rows[0].id;
    await client.query(
      `INSERT INTO source_assumptions (source_id, assumption_code, statement, evidence_reference)
       VALUES ($1, 'reference_is_provisional', $2, 'database/reference/lgd/manifest.json') ON CONFLICT DO NOTHING`,
      [
        sourceId,
        ref.manifest.status === 'verified'
          ? 'Verified reference set.'
          : String(ref.manifest.statusNote),
      ],
    );
    /** @type {Record<string, string>} */
    const fileIds = {};
    for (const f of ref.files) {
      await client.query(
        `INSERT INTO source_files (source_id, file_name, file_sha256, size_bytes, dataset_version)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_id, file_sha256) DO NOTHING`,
        [sourceId, f.name, f.sha256, statSync(f.path).size, String(ref.manifest.referenceDate)],
      );
      fileIds[f.role] = (
        await client.query(
          'SELECT id FROM source_files WHERE source_id = $1 AND file_sha256 = $2',
          [sourceId, f.sha256],
        )
      ).rows[0].id;
    }
    await client.query('COMMIT');

    /** @type {Record<string, any>} */
    const result = {
      referenceSet: ref.manifest.referenceSet,
      status: ref.manifest.status,
      referenceDate: ref.manifest.referenceDate,
      runs: {},
    };

    for (const role of ['states', 'districts']) {
      await client.query('BEGIN');
      const run = (
        await client.query(
          `INSERT INTO ingestion_runs (source_id, source_file_id, importer_name, importer_version)
           VALUES ($1, $2, 'registry-loader', $3) RETURNING id`,
          [sourceId, fileIds[role], IMPORTER_VERSION],
        )
      ).rows[0].id;
      const counts = { read: 0, loaded: 0, duplicate: 0, conflicting: 0, rejected: 0 };
      /** @type {Array<{ rowNumber: number, reason: string, detail: string, raw: unknown, rawSha256: string }>} */
      const rejections = [];
      const reject = (rowNumber, reason, detail, raw) =>
        rejections.push({ rowNumber, reason, detail, raw, rawSha256: sha256(JSON.stringify(raw)) });
      try {
        if (role === 'states') {
          for (const s of ref.states) {
            counts.read += 1;
            const r = await client.query(
              `INSERT INTO states (id, name, kind, lgd_code, provenance_run_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
              [randomUUID(), s.name, s.kind, s.code, run],
            );
            if (r.rowCount === 1) counts.loaded += 1;
            else {
              const existing = (
                await client.query('SELECT name FROM states WHERE lgd_code = $1', [s.code])
              ).rows[0];
              if (existing && normalizeLabel(existing.name) === normalizeLabel(s.name))
                counts.duplicate += 1;
              else {
                counts.rejected += 1;
                reject(
                  s.rowNumber,
                  'ambiguous_entity',
                  existing
                    ? `LGD code ${s.code} exists as "${existing.name}", reference says "${s.name}"`
                    : `name "${s.name}" is already used by a state with another code`,
                  s,
                );
              }
            }
          }
        } else {
          const stateIds = new Map(
            (
              await client.query('SELECT id, lgd_code FROM states WHERE lgd_code IS NOT NULL')
            ).rows.map((r) => [r.lgd_code, r.id]),
          );
          for (const d of ref.districts) {
            counts.read += 1;
            const stateId = stateIds.get(d.stateCode);
            if (!stateId) {
              counts.rejected += 1;
              reject(d.rowNumber, 'unmapped_entity', `state code ${d.stateCode} is not loaded`, d);
              continue;
            }
            const r = await client.query(
              `INSERT INTO districts (id, state_id, name, lgd_code, provenance_run_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
              [randomUUID(), stateId, d.name, d.code, run],
            );
            if (r.rowCount === 1) counts.loaded += 1;
            else {
              const existing = (
                await client.query('SELECT name, state_id FROM districts WHERE lgd_code = $1', [
                  d.code,
                ])
              ).rows[0];
              if (
                existing &&
                existing.state_id === stateId &&
                normalizeLabel(existing.name) === normalizeLabel(d.name)
              )
                counts.duplicate += 1;
              else {
                counts.rejected += 1;
                reject(
                  d.rowNumber,
                  'ambiguous_entity',
                  existing
                    ? `district code ${d.code} exists as "${existing.name}" (or in another state)`
                    : `district name "${d.name}" is already used in this state under another code`,
                  d,
                );
              }
            }
          }
        }
        const problems = ref.problems.filter(
          (p) => p.file === ref.files.find((f) => f.role === role)?.name,
        );
        for (const p of problems) {
          counts.read += 1;
          counts.rejected += 1;
          reject(p.rowNumber, 'structural_error', p.reason, { values: p.raw });
        }
        await insertRejections(client, run, rejections);
        const status = counts.rejected > 0 ? 'succeeded_with_rejections' : 'succeeded';
        await client.query(
          `UPDATE ingestion_runs SET rows_read = $2, rows_loaded = $3, rows_exact_duplicate = $4, rows_conflicting = $5,
                  rows_rejected = $6, last_committed_row = $2, status = $7, finished_at = now() WHERE id = $1`,
          [
            run,
            counts.read,
            counts.loaded,
            counts.duplicate,
            counts.conflicting,
            counts.rejected,
            status,
          ],
        );
        await client.query('COMMIT');
        result.runs[role] = { runId: run, status, ...counts };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.query(
          `INSERT INTO ingestion_runs (source_id, source_file_id, importer_name, importer_version, status, finished_at, error_summary)
           VALUES ($1, $2, 'registry-loader', $3, 'failed', now(), $4)`,
          [
            sourceId,
            fileIds[role],
            IMPORTER_VERSION,
            sanitizeMessage(error instanceof Error ? error.message : String(error)),
          ],
        );
        throw error;
      }
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
    client.release();
  }
}
