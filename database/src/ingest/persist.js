import { randomUUID } from 'node:crypto';

/**
 * Batch persistence for one transaction. Only INSERT (with ON CONFLICT DO NOTHING) and the
 * run-progress UPDATE are used, so the ingestion role needs nothing more:
 *
 *   1. registry rows the batch introduced (commodities, varieties, markets, WPI series, aliases);
 *   2. the facts, skipping any row that violates a unique constraint;
 *   3. each skipped fact is classified by looking up the row that blocked it:
 *        same fingerprint        -> exact duplicate (counted, nothing written)
 *        different fingerprint   -> conflict (stored in observation_conflicts, existing row kept)
 *        no blocking row found   -> quarantined (a source-record-key collision with another key)
 *   4. rejections (quarantine);
 *   5. the run counters and checkpoint, in the same transaction.
 *
 * If anything throws, the caller rolls the whole batch back: counters, checkpoint, registry rows
 * and facts all disappear together, so a failure can never leave a misleading success trail.
 */

/** Columns every fact table shares (provenance and quality). */
const COMMON = [
  ['id', 'uuid'],
  ['source_id', 'uuid'],
  ['source_file_id', 'uuid'],
  ['ingestion_run_id', 'uuid'],
  ['source_record_key', 'text'],
  ['source_row_number', 'bigint'],
  ['record_fingerprint', 'text'],
  ['is_historical_snapshot', 'boolean'],
  ['quality_status', 'text'],
  ['quality_flags', 'text'],
];

const PRICE_TAIL = [
  ['price_currency', 'text'],
  ['price_unit', 'text'],
  ['source_price_unit_label', 'text'],
  ['unit_basis', 'text'],
];
const ARRIVAL = [
  ['arrival_quantity', 'numeric'],
  ['arrival_unit', 'text'],
  ['source_arrival_unit_label', 'text'],
];

/**
 * Per fact type: the table, the column of observation_conflicts that references it, the domain
 * columns, and the natural key (column, type, nullable) used to find the row that blocked an insert.
 */
/** @type {Record<string, any>} */
export const FACTS = {
  mandi_price: {
    table: 'mandi_observations',
    refColumn: 'mandi_observation_id',
    domain: [
      ['market_id', 'uuid'],
      ['commodity_id', 'uuid'],
      ['variety_id', 'uuid'],
      ['variety_label', 'text'],
      ['grade', 'text'],
      ['observed_date', 'date'],
      ['min_price', 'numeric'],
      ['max_price', 'numeric'],
      ['modal_price', 'numeric'],
      ...PRICE_TAIL,
      ...ARRIVAL,
      ['source_state_label', 'text'],
      ['source_district_label', 'text'],
      ['source_market_label', 'text'],
      ['source_commodity_label', 'text'],
    ],
    natural: [
      ['market_id', 'uuid', false],
      ['commodity_id', 'uuid', false],
      ['variety_id', 'uuid', true],
      ['grade', 'text', true],
      ['observed_date', 'date', false],
    ],
  },
  state_observation: {
    table: 'state_observations',
    refColumn: 'state_observation_id',
    domain: [
      ['state_id', 'uuid'],
      ['commodity_id', 'uuid'],
      ['observed_date', 'date'],
      ['min_price', 'numeric'],
      ['max_price', 'numeric'],
      ['modal_price', 'numeric'],
      ...PRICE_TAIL,
      ...ARRIVAL,
      ['source_state_label', 'text'],
      ['source_commodity_label', 'text'],
      ['source_commodity_group_label', 'text'],
      ['source_report_label', 'text'],
    ],
    natural: [
      ['state_id', 'uuid', false],
      ['commodity_id', 'uuid', false],
      ['observed_date', 'date', false],
    ],
  },
  national_commodity_price: {
    table: 'national_monthly_prices',
    refColumn: 'national_price_observation_id',
    domain: [
      ['commodity_id', 'uuid'],
      ['period_month', 'date'],
      ['avg_min_price', 'numeric'],
      ['avg_max_price', 'numeric'],
      ['avg_modal_price', 'numeric'],
      ...PRICE_TAIL,
      ['source_reported_change', 'numeric'],
      ['source_calculation_type', 'text'],
      ['source_commodity_label', 'text'],
    ],
    natural: [
      ['commodity_id', 'uuid', false],
      ['period_month', 'date', false],
    ],
  },
  wpi_index: {
    table: 'wpi_observations',
    refColumn: 'wpi_observation_id',
    domain: [
      ['series_id', 'uuid'],
      ['period_month', 'date'],
      ['index_value', 'numeric'],
    ],
    natural: [
      ['series_id', 'uuid', false],
      ['period_month', 'date', false],
    ],
  },
};

/** Entity column of each alias table. */
const ALIAS_ENTITY = {
  state_aliases: 'state_id',
  district_aliases: 'district_id',
  market_aliases: 'market_id',
  commodity_aliases: 'commodity_id',
  variety_aliases: 'variety_id',
};

const qcol = (name) => `"${name}"`;

/**
 * @param {import('pg').PoolClient} client
 * @param {{ aliases: any[], commodities: any[], varieties: any[], markets: any[], wpiSeries: any[] }} pending
 * @param {{ sourceId: string, runId: string }} ctx
 */
export async function insertRegistry(client, pending, ctx) {
  const expect = (label, result, count) => {
    if (result.rowCount !== count) {
      throw new Error(
        `Registry changed concurrently: ${label} inserted ${result.rowCount} of ${count} new rows. Another importer may be running.`,
      );
    }
  };
  if (pending.commodities.length) {
    const rows = pending.commodities;
    const r = await client.query(
      `INSERT INTO commodities (id, name, commodity_group, provenance_run_id)
       SELECT u.id, u.name, u.grp, $4::uuid FROM unnest($1::uuid[], $2::text[], $3::text[]) AS u(id, name, grp)
       ON CONFLICT DO NOTHING`,
      [rows.map((x) => x.id), rows.map((x) => x.name), rows.map((x) => x.group), ctx.runId],
    );
    expect('commodities', r, rows.length);
  }
  if (pending.varieties.length) {
    const rows = pending.varieties;
    const r = await client.query(
      `INSERT INTO varieties (id, commodity_id, name, provenance_run_id)
       SELECT u.id, u.cid, u.name, $4::uuid FROM unnest($1::uuid[], $2::uuid[], $3::text[]) AS u(id, cid, name)
       ON CONFLICT DO NOTHING`,
      [rows.map((x) => x.id), rows.map((x) => x.commodityId), rows.map((x) => x.name), ctx.runId],
    );
    expect('varieties', r, rows.length);
  }
  if (pending.markets.length) {
    const rows = pending.markets;
    const r = await client.query(
      `INSERT INTO markets (id, state_id, district_id, name, disambiguator, status, provenance_run_id)
       SELECT u.id, u.sid, u.did, u.name, u.dis, 'unverified', $6::uuid
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[]) AS u(id, sid, did, name, dis)
       ON CONFLICT DO NOTHING`,
      [
        rows.map((x) => x.id),
        rows.map((x) => x.stateId),
        rows.map((x) => x.districtId),
        rows.map((x) => x.name),
        rows.map((x) => x.disambiguator),
        ctx.runId,
      ],
    );
    expect('markets', r, rows.length);
  }
  if (pending.wpiSeries.length) {
    const rows = pending.wpiSeries;
    const r = await client.query(
      `INSERT INTO wpi_series (id, source_id, item_label)
       SELECT u.id, $3::uuid, u.label FROM unnest($1::uuid[], $2::text[]) AS u(id, label)
       ON CONFLICT DO NOTHING`,
      [rows.map((x) => x.id), rows.map((x) => x.itemLabel), ctx.sourceId],
    );
    expect('WPI series', r, rows.length);
  }
  for (const table of Object.keys(ALIAS_ENTITY)) {
    const rows = pending.aliases.filter((a) => a.table === table);
    if (!rows.length) continue;
    const entity = ALIAS_ENTITY[/** @type {keyof typeof ALIAS_ENTITY} */ (table)];
    const r = await client.query(
      `INSERT INTO ${table} (id, source_id, source_key, source_label, source_context, ${entity}, resolution_status, resolution_note, resolved_at)
       SELECT u.id, $8::uuid, u.k, u.label, u.ctx, u.ent, u.status, u.note,
              CASE WHEN u.status = 'resolved' THEN now() END
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::text[], $7::text[])
              AS u(id, k, label, ctx, ent, status, note)
       ON CONFLICT DO NOTHING`,
      [
        rows.map((x) => x.id),
        rows.map((x) => x.key),
        rows.map((x) => x.label),
        rows.map((x) => x.context),
        rows.map((x) => x.entityId),
        rows.map((x) => x.status),
        rows.map((x) => x.note),
        ctx.sourceId,
      ],
    );
    expect(table, r, rows.length);
  }
}

/**
 * Inserts the facts that do not violate a unique constraint.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} factType
 * @param {Array<Record<string, any>>} rows Fully built rows (common + domain columns).
 * @returns {Promise<Set<string>>} ids of the rows that were inserted
 */
export async function insertFacts(client, factType, rows) {
  if (!rows.length) return new Set();
  const spec = FACTS[factType];
  const columns = [...COMMON, ...spec.domain];
  const select = columns.map(([name]) =>
    name === 'quality_flags'
      ? `COALESCE(string_to_array(NULLIF(u.${qcol(name)}, ''), ','), '{}'::text[])`
      : `u.${qcol(name)}`,
  );
  const args = columns.map(([name]) => rows.map((r) => r[name] ?? null));
  const casts = columns.map(([, type], i) => `$${i + 1}::${type}[]`);
  const result = await client.query(
    `INSERT INTO ${spec.table} (${columns.map(([n]) => qcol(n)).join(', ')})
     SELECT ${select.join(', ')}
       FROM unnest(${casts.join(', ')}) AS u(${columns.map(([n]) => qcol(n)).join(', ')})
     ON CONFLICT DO NOTHING
     RETURNING id`,
    args,
  );
  return new Set(result.rows.map((r) => r.id));
}

/**
 * Finds, for each skipped fact, the existing row with the same natural key.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} factType
 * @param {string} sourceId
 * @param {Array<Record<string, any>>} rows Skipped rows.
 * @returns {Promise<Map<number, { id: string, fingerprint: string }>>} by index into `rows`
 */
export async function findBlockingRows(client, factType, sourceId, rows) {
  const out = new Map();
  if (!rows.length) return out;
  const spec = FACTS[factType];
  const cols = spec.natural;
  const args = [rows.map((_, i) => i), ...cols.map(([name]) => rows.map((r) => r[name] ?? null))];
  const casts = ['$1::int[]', ...cols.map(([, type], i) => `$${i + 2}::${type}[]`)];
  const conditions = cols.map(([name, , nullable]) =>
    nullable
      ? `(o.${qcol(name)} = u.${qcol(name)} OR (o.${qcol(name)} IS NULL AND u.${qcol(name)} IS NULL))`
      : `o.${qcol(name)} = u.${qcol(name)}`,
  );
  const result = await client.query(
    `SELECT u.ord, o.id, o.record_fingerprint
       FROM unnest(${casts.join(', ')}) AS u(ord, ${cols.map(([n]) => qcol(n)).join(', ')})
       JOIN ${spec.table} o ON o.source_id = $${cols.length + 2}::uuid AND ${conditions.join(' AND ')}`,
    [...args, sourceId],
  );
  for (const r of result.rows) out.set(r.ord, { id: r.id, fingerprint: r.record_fingerprint });
  return out;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} factType
 * @param {string} runId
 * @param {Array<{ existingId: string, record: unknown, fingerprint: string }>} conflicts
 */
export async function insertConflicts(client, factType, runId, conflicts) {
  if (!conflicts.length) return;
  const ref = FACTS[factType].refColumn;
  await client.query(
    `INSERT INTO observation_conflicts (ingestion_run_id, fact_type, ${ref}, incoming_record, incoming_fingerprint)
     SELECT $1::uuid, $2::text, u.ref, u.rec::jsonb, u.fp
       FROM unnest($3::uuid[], $4::text[], $5::text[]) AS u(ref, rec, fp)
     ON CONFLICT DO NOTHING`,
    [
      runId,
      factType,
      conflicts.map((c) => c.existingId),
      conflicts.map((c) => JSON.stringify(c.record)),
      conflicts.map((c) => c.fingerprint),
    ],
  );
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} runId
 * @param {Array<{ rowNumber: number, reason: string, detail: string | null, raw: unknown, rawSha256: string }>} rejections
 */
export async function insertRejections(client, runId, rejections) {
  if (!rejections.length) return;
  await client.query(
    `INSERT INTO ingestion_rejections (ingestion_run_id, source_row_number, reason_code, reason_detail, raw_record, raw_record_sha256)
     SELECT $1::uuid, u.n, u.reason, u.detail, u.raw::jsonb, u.sha
       FROM unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(n, reason, detail, raw, sha)
     ON CONFLICT (ingestion_run_id, source_row_number) DO NOTHING`,
    [
      runId,
      rejections.map((r) => r.rowNumber),
      rejections.map((r) => r.reason),
      rejections.map((r) => r.detail),
      rejections.map((r) => JSON.stringify(r.raw)),
      rejections.map((r) => r.rawSha256),
    ],
  );
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} runId
 * @param {{ read: number, loaded: number, duplicate: number, conflicting: number, rejected: number, lastRow: number }} delta
 */
export async function addCounters(client, runId, delta) {
  await client.query(
    `UPDATE ingestion_runs
        SET rows_read = rows_read + $2, rows_loaded = rows_loaded + $3,
            rows_exact_duplicate = rows_exact_duplicate + $4, rows_conflicting = rows_conflicting + $5,
            rows_rejected = rows_rejected + $6, last_committed_row = GREATEST(last_committed_row, $7)
      WHERE id = $1`,
    [
      runId,
      delta.read,
      delta.loaded,
      delta.duplicate,
      delta.conflicting,
      delta.rejected,
      delta.lastRow,
    ],
  );
}

export const newId = () => randomUUID();
