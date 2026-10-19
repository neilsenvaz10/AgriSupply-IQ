import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import { readCsv } from './csv.js';
import {
  addCounters,
  findBlockingRows,
  insertConflicts,
  insertFacts,
  insertRegistry,
  insertRejections,
} from './persist.js';
import { Resolver } from './resolver.js';
import { fingerprint, sanitizeMessage, sha256, sha256File } from './util.js';

export const IMPORTER_NAME = 'fasalytics-historical-importer';
export const IMPORTER_VERSION = '2.2.1';

/**
 * The common ingestion framework. A dataset adapter supplies only what is specific to the file
 * (header check, parsing, validation, identity resolution, the shape of the fact row); the
 * framework supplies everything else: file fingerprinting, streaming, bounded batches,
 * transactions, idempotency, conflict handling, quarantine, counters, resume and run status.
 *
 * Modes:
 *   dry-run  no database is touched: the same parsing, validation and identity rules run against
 *            an in-memory registry built from the reference files, and the outcomes are counted.
 *   write    batches are persisted in transactions through the ingestion role.
 *
 * @typedef {object} AdapterItem
 * @property {{ reason: string, detail: string | null, raw: Record<string, unknown> } | undefined} [reject]
 * @property {{
 *   row: Record<string, unknown>,
 *   keyFields: unknown[],
 *   fingerprintFields: unknown[],
 *   qualityFlags: string[],
 * } | undefined} [fact]
 *
 * @typedef {object} Adapter
 * @property {string} dataset
 * @property {string} factType
 * @property {{ code: string, name: string, sourceType: string, publisher: string | null, description: string, endpointReference: string | null }} source
 * @property {Array<{ code: string, statement: string, evidenceReference: string }>} assumptions
 * @property {(header: string[]) => void} validateHeader Throws when the file is not this dataset.
 * @property {(rec: import('./csv.js').CsvRecord, header: string[], resolver: Resolver) => AdapterItem[]} process
 */

/**
 * @typedef {object} RunOptions
 * @property {Adapter} adapter
 * @property {string} filePath
 * @property {'dry-run' | 'write'} mode
 * @property {import('pg').Pool} [pool] Required for write mode (ingestion role).
 * @property {() => Resolver | Promise<Resolver>} [dryRunResolver] Registry for dry-run.
 * @property {Map<string, any>} [decisions] Reviewed alias decisions for this source.
 * @property {number} [batchSize]
 * @property {boolean} [resume] Continue the latest interrupted run for this file.
 * @property {AbortSignal} [signal]
 * @property {number} [limit] Stop after this many source records (profiling and tests).
 * @property {{ crashAfterBatches?: number, failAfterBatches?: number }} [testHooks]
 * @property {(progress: Record<string, unknown>) => void} [onProgress]
 */

class SimulatedCrash extends Error {}

/** @param {string[]} header @param {string[]} values */
export function rawObject(header, values) {
  /** @type {Record<string, unknown>} */
  const raw = {};
  if (values.length === header.length) header.forEach((h, i) => (raw[h] = values[i]));
  else {
    raw._header_columns = header.length;
    raw._values = values;
  }
  return raw;
}

/**
 * @param {RunOptions} options
 */
export async function runIngestion(options) {
  const { adapter, filePath, mode } = options;
  const batchSize = options.batchSize ?? 2000;
  const startedAt = Date.now();
  const stats = {
    read: 0,
    loaded: 0,
    duplicate: 0,
    conflicting: 0,
    rejected: 0,
    wouldLoad: 0,
    skippedByResume: 0,
    batches: 0,
    peakRssBytes: 0,
    /** @type {Record<string, number>} */ rejectionsByReason: {},
    /** @type {Record<string, Array<{ rowNumber: number, detail: string | null, raw: unknown }>>} */ rejectionExamples:
      {},
  };
  const note = (reason, rowNumber, detail, raw) => {
    stats.rejectionsByReason[reason] = (stats.rejectionsByReason[reason] ?? 0) + 1;
    const ex = (stats.rejectionExamples[reason] ??= []);
    if (ex.length < 5) ex.push({ rowNumber, detail, raw });
  };

  const fileSha = await sha256File(filePath);
  const { header, records } = await readCsv(filePath);
  adapter.validateHeader(header);

  /** @type {import('pg').PoolClient | null} */
  let client = null;
  /** @type {Resolver} */
  let resolver;
  let runId = /** @type {string | null} */ (null);
  let sourceId = '';
  /** @type {string | null} */
  let fileId = null;
  let checkpoint = 0;
  /** @type {string | null} */
  let resumedFrom = null;
  let sizeBefore = null;
  /** @type {string | null} */
  let lockKey = null;

  try {
    if (mode === 'write') {
      if (!options.pool) throw new Error('write mode needs a database pool');
      client = await options.pool.connect();
      lockKey = `fasalytics:ingest:${adapter.source.code}`;
      const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
        /** @type {string} */ (lockKey),
      ]);
      if (!lock.rows[0].ok)
        throw new Error(`Another import of ${adapter.source.code} is already running.`);
      sizeBefore = Number(
        (await client.query('SELECT pg_database_size(current_database()) AS n')).rows[0].n,
      );

      await client.query('BEGIN');
      let setup;
      try {
        setup = await setupRun(client, adapter, filePath, fileSha, options.resume === true);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
      ({ runId, sourceId, fileId, checkpoint, resumedFrom } = setup);
      resolver = await loadResolver(
        client,
        sourceId,
        /** @type {string} */ (runId),
        options.decisions,
      );
    } else {
      if (!options.dryRunResolver) throw new Error('dry-run needs a registry (dryRunResolver)');
      resolver = await options.dryRunResolver();
    }

    /** @type {Array<AdapterItem & { recordNumber: number }>} */
    let batch = [];
    let recordNumber = 0;

    const flush = async () => {
      if (!batch.length) return;
      const items = batch;
      batch = [];
      stats.batches += 1;
      stats.peakRssBytes = Math.max(stats.peakRssBytes, process.memoryUsage().rss);
      if (mode === 'dry-run') {
        for (const item of items) {
          stats.read += 1;
          if (item.reject) {
            stats.rejected += 1;
            note(item.reject.reason, item.recordNumber, item.reject.detail, item.reject.raw);
          } else stats.wouldLoad += 1;
        }
        resolver.commit();
        return;
      }
      await persist(/** @type {import('pg').PoolClient} */ (client), items);
      options.onProgress?.({ ...stats, runId });
      const hooks = options.testHooks;
      if (hooks?.crashAfterBatches && stats.batches >= hooks.crashAfterBatches)
        throw new SimulatedCrash('simulated crash');
      if (hooks?.failAfterBatches && stats.batches >= hooks.failAfterBatches)
        throw new Error('simulated failure');
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    };

    /** @param {import('pg').PoolClient} c @param {Array<AdapterItem & { recordNumber: number }>} items */
    const persist = async (c, items) => {
      const facts = [];
      const rejections = [];
      for (const item of items) {
        if (item.reject) {
          rejections.push({
            rowNumber: item.recordNumber,
            reason: item.reject.reason,
            detail: item.reject.detail,
            raw: item.reject.raw,
            rawSha256: sha256(JSON.stringify(item.reject.raw)),
          });
        } else if (item.fact) {
          const f = item.fact;
          facts.push({
            id: randomUUID(),
            source_id: sourceId,
            source_file_id: fileId,
            ingestion_run_id: runId,
            source_record_key: sha256(JSON.stringify(f.keyFields)),
            source_row_number: item.recordNumber,
            record_fingerprint: fingerprint(f.fingerprintFields),
            is_historical_snapshot: true,
            quality_status: f.qualityFlags.length ? 'flagged' : 'accepted',
            quality_flags: f.qualityFlags.join(','),
            ...f.row,
          });
        }
      }
      await c.query('BEGIN');
      try {
        await insertRegistry(c, resolver.pending, {
          sourceId,
          runId: /** @type {string} */ (runId),
        });
        const insertedIds = await insertFacts(c, adapter.factType, facts);
        const skipped = facts.filter((f) => !insertedIds.has(f.id));
        const blocking = await findBlockingRows(c, adapter.factType, sourceId, skipped);
        let duplicate = 0;
        const conflicts = [];
        skipped.forEach((row, i) => {
          const existing = blocking.get(i);
          if (existing && existing.fingerprint === row.record_fingerprint) duplicate += 1;
          else if (existing) {
            conflicts.push({
              existingId: existing.id,
              fingerprint: row.record_fingerprint,
              record: {
                recordNumber: row.source_row_number,
                sourceRecordKey: row.source_record_key,
                values: row,
              },
            });
          } else {
            rejections.push({
              rowNumber: row.source_row_number,
              reason: 'other',
              detail: 'source record key collides with a different natural key',
              raw: { source_record_key: row.source_record_key },
              rawSha256: sha256(row.source_record_key),
            });
          }
        });
        await insertConflicts(c, adapter.factType, /** @type {string} */ (runId), conflicts);
        await insertRejections(c, /** @type {string} */ (runId), rejections);
        const loaded = insertedIds.size;
        await addCounters(c, /** @type {string} */ (runId), {
          read: items.length,
          loaded,
          duplicate,
          conflicting: conflicts.length,
          rejected: rejections.length,
          lastRow: items[items.length - 1].recordNumber,
        });
        await c.query('COMMIT');
        stats.read += items.length;
        stats.loaded += loaded;
        stats.duplicate += duplicate;
        stats.conflicting += conflicts.length;
        stats.rejected += rejections.length;
        for (const r of rejections) note(r.reason, r.rowNumber, r.detail, r.raw);
        resolver.commit();
      } catch (error) {
        await c.query('ROLLBACK').catch(() => undefined);
        resolver.rollback();
        throw error;
      }
    };

    let csvRows = 0;
    for await (const rec of records) {
      csvRows += 1;
      const items = adapter.process(rec, header, resolver);
      for (const item of items) {
        recordNumber += 1;
        if (recordNumber <= checkpoint) {
          stats.skippedByResume += 1;
          continue;
        }
        if (options.limit !== undefined && recordNumber > options.limit) break;
        batch.push({ ...item, recordNumber });
        if (batch.length >= batchSize) await flush();
      }
      if (options.limit !== undefined && recordNumber >= options.limit) break;
    }
    await flush();

    let status = 'dry-run';
    if (mode === 'write' && client && runId) {
      status =
        stats.rejected > 0 || stats.conflicting > 0 ? 'succeeded_with_rejections' : 'succeeded';
      await client.query(
        `UPDATE ingestion_runs SET status = $2, finished_at = now() WHERE id = $1 AND status = 'running'`,
        [runId, status],
      );
    }
    const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
    let sizeAfter = null;
    if (client)
      sizeAfter = Number(
        (await client.query('SELECT pg_database_size(current_database()) AS n')).rows[0].n,
      );
    return {
      dataset: adapter.dataset,
      mode,
      status,
      runId,
      resumedFromRunId: resumedFrom,
      file: { name: basename(filePath), bytes: statSync(filePath).size, sha256: fileSha },
      csvRows,
      ...stats,
      reconciled:
        mode === 'write'
          ? stats.loaded + stats.duplicate + stats.conflicting + stats.rejected === stats.read
          : stats.wouldLoad + stats.rejected === stats.read,
      created: resolver.created,
      unresolved: {
        states: Object.fromEntries(resolver.unresolved.state),
        districtsAffectedRows: [...resolver.unresolved.district.values()].reduce(
          (a, b) => a + b,
          0,
        ),
        distinctUnresolvedDistricts: resolver.unresolved.district.size,
      },
      performance: {
        seconds: Number(seconds.toFixed(2)),
        rowsPerSecond: Math.round(stats.read / seconds),
        batchSize,
        peakRssMiB: Math.round(stats.peakRssBytes / 1048576),
        databaseGrowthBytes:
          sizeBefore !== null && sizeAfter !== null ? sizeAfter - sizeBefore : null,
      },
    };
  } catch (error) {
    if (mode === 'write' && client && runId && !(error instanceof SimulatedCrash)) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      await client
        .query(
          `UPDATE ingestion_runs SET status = $2, finished_at = now(), error_summary = $3 WHERE id = $1 AND status = 'running'`,
          [
            runId,
            aborted ? 'cancelled' : 'failed',
            sanitizeMessage(error instanceof Error ? error.message : String(error)),
          ],
        )
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (client) {
      // A simulated crash must look like a killed process: the run stays 'running' and the lock is
      // released only because the connection closes.
      if (lockKey)
        await client
          .query('SELECT pg_advisory_unlock(hashtext($1))', [/** @type {string} */ (lockKey)])
          .catch(() => undefined);
      client.release();
    }
  }
}

/**
 * Registers the source, its assumptions and the file (idempotently) and opens the run.
 *
 * @param {import('pg').PoolClient} client
 * @param {Adapter} adapter
 * @param {string} filePath
 * @param {string} fileSha
 * @param {boolean} resume
 */
async function setupRun(client, adapter, filePath, fileSha, resume) {
  const s = adapter.source;
  await client.query(
    `INSERT INTO data_sources (code, name, source_type, publisher, description, endpoint_reference)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (code) DO NOTHING`,
    [s.code, s.name, s.sourceType, s.publisher, s.description, s.endpointReference],
  );
  const sourceId = (await client.query('SELECT id FROM data_sources WHERE code = $1', [s.code]))
    .rows[0].id;
  for (const a of adapter.assumptions) {
    await client.query(
      `INSERT INTO source_assumptions (source_id, assumption_code, statement, evidence_reference)
       VALUES ($1, $2, $3, $4) ON CONFLICT (source_id, assumption_code) DO NOTHING`,
      [sourceId, a.code, a.statement, a.evidenceReference],
    );
  }
  await client.query(
    `INSERT INTO source_files (source_id, file_name, file_sha256, size_bytes)
     VALUES ($1, $2, $3, $4) ON CONFLICT (source_id, file_sha256) DO NOTHING`,
    [sourceId, basename(filePath), fileSha, statSync(filePath).size],
  );
  const fileId = (
    await client.query('SELECT id FROM source_files WHERE source_id = $1 AND file_sha256 = $2', [
      sourceId,
      fileSha,
    ])
  ).rows[0].id;

  let checkpoint = 0;
  let resumedFrom = null;
  if (resume) {
    const prev = await client.query(
      `SELECT id, last_committed_row FROM ingestion_runs
        WHERE source_id = $1 AND source_file_id = $2 AND status IN ('failed', 'cancelled', 'running')
        ORDER BY started_at DESC LIMIT 1`,
      [sourceId, fileId],
    );
    if (prev.rowCount === 0) throw new Error('There is no interrupted run of this file to resume.');
    resumedFrom = prev.rows[0].id;
    checkpoint = Number(prev.rows[0].last_committed_row);
    // We hold the per-source advisory lock, so a run still marked "running" is stale (its process died).
    await client.query(
      `UPDATE ingestion_runs SET status = 'failed', finished_at = now(),
              error_summary = 'interrupted; superseded by a resumed run'
        WHERE id = $1 AND status = 'running'`,
      [resumedFrom],
    );
  }
  // Whatever else is still "running" for this source is stale too: we hold the advisory lock, so no
  // other importer is active. Close it as failed rather than leave a run that looks live forever.
  await client.query(
    `UPDATE ingestion_runs SET status = 'failed', finished_at = now(),
            error_summary = 'interrupted; the process ended before the run completed'
      WHERE source_id = $1 AND status = 'running'`,
    [sourceId],
  );
  const run = await client.query(
    `INSERT INTO ingestion_runs (source_id, source_file_id, importer_name, importer_version, resumed_from_run_id, last_committed_row)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [sourceId, fileId, IMPORTER_NAME, IMPORTER_VERSION, resumedFrom, checkpoint],
  );
  return { runId: run.rows[0].id, sourceId, fileId, checkpoint, resumedFrom };
}

/**
 * Loads the registry state the resolver needs from the database.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} sourceId
 * @param {string} runId
 * @param {Map<string, any> | undefined} decisions
 */
export async function loadResolver(client, sourceId, runId, decisions) {
  /** @param {string} text @param {unknown[]} [values] @returns {Promise<any[]>} */
  const q = async (text, values = []) => (await client.query(text, values)).rows;
  const aliasTables = {
    state_aliases: 'state_id',
    district_aliases: 'district_id',
    market_aliases: 'market_id',
    commodity_aliases: 'commodity_id',
    variety_aliases: 'variety_id',
  };
  const aliases = [];
  for (const [table, column] of Object.entries(aliasTables)) {
    for (const r of await q(
      `SELECT source_key, resolution_status, ${column} AS entity FROM ${table} WHERE source_id = $1`,
      [sourceId],
    )) {
      aliases.push({ table, key: r.source_key, status: r.resolution_status, entityId: r.entity });
    }
  }
  return new Resolver({
    sourceId,
    runId,
    decisions: decisions ?? new Map(),
    states: (await q('SELECT id, name, lgd_code, kind FROM states')).map((r) => ({
      id: r.id,
      name: r.name,
      lgd: r.lgd_code,
      kind: r.kind,
    })),
    districts: (await q('SELECT id, state_id, name, lgd_code FROM districts')).map((r) => ({
      id: r.id,
      stateId: r.state_id,
      name: r.name,
      lgd: r.lgd_code,
    })),
    commodities: (await q('SELECT id, normalized_name FROM commodities')).map((r) => ({
      id: r.id,
      normalized: r.normalized_name,
    })),
    varieties: (await q('SELECT id, commodity_id, normalized_name FROM varieties')).map((r) => ({
      id: r.id,
      commodityId: r.commodity_id,
      normalized: r.normalized_name,
    })),
    markets: (
      await q('SELECT id, state_id, district_id, normalized_name, disambiguator FROM markets')
    ).map((r) => ({
      id: r.id,
      stateId: r.state_id,
      districtId: r.district_id,
      normalized: r.normalized_name,
      disambiguator: r.disambiguator,
    })),
    wpiSeries: (
      await q('SELECT id, normalized_label FROM wpi_series WHERE source_id = $1', [sourceId])
    ).map((r) => ({ id: r.id, normalized: r.normalized_label })),
    aliases,
  });
}
