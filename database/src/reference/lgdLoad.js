/**
 * Idempotent loader for the reference plan (Milestone 2.4, Stage 3a). It only INSERTs into
 * `geo_reference_set` and `admin_unit_version` (both append-only) and only READS the registry to record,
 * by LGD code, which registry row carries a unit. It never changes a registry row, an alias, a mandi or an
 * observation, and it applies no geographic correction.
 *
 * Idempotent: a set is identified by the SHA-256 of its file (or of its page manifest). Loading it again is
 * a no-op when every row's content hash matches, and an error when the same fingerprint now holds different
 * content (the source changed under a stable fingerprint: that must be looked at, not overwritten).
 *
 * Rollback: the tables refuse UPDATE and DELETE. A mistaken load is removed only by the owner-run
 * `retractReferenceSet`, which fails while any decision points at the set's units.
 */

const UNIT_COLUMNS = [
  'reference_set_id',
  'unit_type',
  'lgd_code',
  'history_seq',
  'is_latest_version',
  'version',
  'minor_version',
  'name_en',
  'name_local',
  'parent_lgd_code',
  'state_kind',
  'census_2001_code',
  'census_2011_code',
  'status',
  'lgd_effective_date',
  'lgd_effective_is_baseline',
  'legal_effective_date',
  'legal_effective_evidence',
  'valid_from_known',
  'order_no',
  'order_date',
  'gazette_date',
  'government_order_ref',
  'source_url',
  'source_sha256',
  'retrieved_at',
  'content_sha256',
  'raw_record',
  'state_id',
  'district_id',
];

const unitValues = (setId, u, ids) => [
  setId,
  u.unitType,
  u.lgdCode,
  u.historySeq,
  u.isLatestVersion,
  u.version,
  u.minorVersion,
  u.nameEn,
  u.nameLocal,
  u.parentLgdCode,
  u.stateKind,
  u.census2001Code,
  u.census2011Code,
  u.status,
  u.lgdEffectiveDate,
  u.lgdEffectiveIsBaseline,
  u.legalEffectiveDate,
  u.legalEffectiveEvidence,
  u.validFromKnown,
  u.orderNo,
  u.orderDate,
  u.gazetteDate,
  u.governmentOrderRef,
  u.sourceUrl,
  u.sourceSha256,
  u.retrievedAt,
  u.contentSha256,
  JSON.stringify(u.rawRecord ?? {}),
  u.unitType === 'state' ? (ids.states.get(u.lgdCode) ?? null) : null,
  u.unitType === 'district' ? (ids.districts.get(u.lgdCode) ?? null) : null,
];

/** Registry rows by numeric LGD code (read only). */
async function registryIds(client) {
  const read = async (table) =>
    new Map(
      (
        await client.query(
          `SELECT id, lgd_code::int AS code FROM ${table} WHERE lgd_code ~ '^[0-9]+$'`,
        )
      ).rows.map((r) => [r.code, r.id]),
    );
  return { states: await read('states'), districts: await read('districts') };
}

/**
 * Inserts one reference set and its unit rows through a client that is ALREADY inside a transaction owned by the
 * caller (no BEGIN, COMMIT or ROLLBACK here). The controlled development loader uses it to load all sets in one
 * transaction; `loadReferencePlan` uses it for the disposable path.
 *
 * @param {import('pg').PoolClient} client
 * @param {any} set
 * @returns {Promise<string>} The id of the new reference set.
 */
export async function insertReferenceSet(client, set) {
  const ids = await registryIds(client);
  const inserted = await client.query(
    `INSERT INTO geo_reference_set (code, kind, authority, source_url, access_method, original_filename, format, file_sha256, fingerprint_kind,
       size_bytes, record_count, retrieved_at, as_of_date, publication_date, publication_note, licence_note, terms_note, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [
      set.code,
      set.kind,
      set.authority,
      set.sourceUrl,
      set.accessMethod,
      set.originalFilename,
      set.format,
      set.fileSha256,
      set.fingerprintKind,
      set.sizeBytes,
      set.recordCount,
      set.retrievedAt,
      set.asOfDate,
      set.publicationDate,
      set.publicationNote,
      set.licenceNote,
      set.termsNote,
      set.notes,
    ],
  );
  const setId = inserted.rows[0].id;
  const width = UNIT_COLUMNS.length;
  for (let i = 0; i < set.units.length; i += 200) {
    const batch = set.units.slice(i, i + 200);
    const params = batch.flatMap((u) => unitValues(setId, u, ids));
    const placeholders = batch
      .map(
        (_, row) =>
          `(${UNIT_COLUMNS.map((c, col) => `$${row * width + col + 1}${c === 'raw_record' ? '::jsonb' : ''}`).join(', ')})`,
      )
      .join(', ');
    await client.query(
      `INSERT INTO admin_unit_version (${UNIT_COLUMNS.join(', ')}) VALUES ${placeholders}`,
      params,
    );
  }
  return setId;
}

/**
 * @param {import('pg').Pool} pool Connection of a role that may INSERT into the two reference tables.
 * @param {{ sets: any[] }} plan
 * @returns {Promise<Array<{ code: string, status: string, units: number, id: string }>>}
 */
export async function loadReferencePlan(pool, plan) {
  /** @type {Array<{ code: string, status: string, units: number, id: string }>} */
  const results = [];
  for (const set of plan.sets) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        'SELECT id, code FROM geo_reference_set WHERE file_sha256 = $1',
        [set.fileSha256],
      );
      if ((existing.rowCount ?? 0) > 0) {
        const id = existing.rows[0].id;
        const rows = await client.query(
          'SELECT unit_type, lgd_code, history_seq, content_sha256 FROM admin_unit_version WHERE reference_set_id = $1',
          [id],
        );
        const have = new Map(
          rows.rows.map((r) => [`${r.unit_type}|${r.lgd_code}|${r.history_seq}`, r.content_sha256]),
        );
        const same =
          have.size === set.units.length &&
          set.units.every(
            (u) => have.get(`${u.unitType}|${u.lgdCode}|${u.historySeq}`) === u.contentSha256,
          );
        if (!same) {
          throw new Error(
            `reference set ${existing.rows[0].code} already exists with this fingerprint but different content (${have.size} rows stored, ${set.units.length} planned): the source changed under a stable fingerprint`,
          );
        }
        await client.query('ROLLBACK');
        results.push({ code: set.code, status: 'unchanged', units: set.units.length, id });
        continue;
      }
      const setId = await insertReferenceSet(client, set);
      await client.query('COMMIT');
      results.push({ code: set.code, status: 'loaded', units: set.units.length, id: setId });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return results;
}

/**
 * Removes a mistaken reference load. OWNER ONLY (needs DDL rights to switch the append-only trigger off, which
 * is deliberate: it is an audited, reviewed act, not application behaviour). Refuses while any identity
 * decision still points at a unit of the set.
 *
 * @param {import('pg').Pool} ownerPool
 * @param {string} code Reference set code.
 */
export async function retractReferenceSet(ownerPool, code) {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    const set = await client.query('SELECT id FROM geo_reference_set WHERE code = $1 FOR UPDATE', [
      code,
    ]);
    if ((set.rowCount ?? 0) === 0) throw new Error(`no reference set ${code}`);
    const id = set.rows[0].id;
    const used = await client.query(
      `SELECT count(*)::int AS n FROM identity_decision d JOIN admin_unit_version v ON v.id = d.target_admin_unit_version_id WHERE v.reference_set_id = $1`,
      [id],
    );
    if (used.rows[0].n > 0)
      throw new Error(
        `${used.rows[0].n} identity decisions point at units of ${code}: it cannot be retracted`,
      );
    await client.query('ALTER TABLE admin_unit_version DISABLE TRIGGER aun_append_only');
    await client.query('ALTER TABLE geo_reference_set DISABLE TRIGGER grs_append_only');
    const units = await client.query('DELETE FROM admin_unit_version WHERE reference_set_id = $1', [
      id,
    ]);
    await client.query('DELETE FROM geo_reference_set WHERE id = $1', [id]);
    await client.query('ALTER TABLE admin_unit_version ENABLE TRIGGER aun_append_only');
    await client.query('ALTER TABLE geo_reference_set ENABLE TRIGGER grs_append_only');
    await client.query('COMMIT');
    return { retracted: code, units: units.rowCount };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
