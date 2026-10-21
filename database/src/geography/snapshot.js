/**
 * Read-only snapshot of everything the discrepancy analysis needs (Milestone 2.4, Stage 3b).
 *
 * Only SELECT statements run, inside a READ ONLY transaction that is always rolled back; the connection is
 * refused unless PostgreSQL itself reports the transaction as read only. Run it with the application role
 * (SELECT only) or any read-only login. Nothing is written, nothing is cached in the database.
 */

/** @typedef {Awaited<ReturnType<typeof readSnapshot>>} Snapshot */

/**
 * @param {import('pg').Client | import('pg').PoolClient} client
 * @param {{ requireLowPrivilege?: boolean }} [options] the command line sets it; it refuses any login that can write
 */
export async function readSnapshot(client, { requireLowPrivilege = false } = {}) {
  await client.query('BEGIN READ ONLY');
  try {
    const ro = (await client.query("SELECT current_setting('transaction_read_only') AS v")).rows[0]
      .v;
    if (ro !== 'on') throw new Error('refusing to read: the transaction is not read only');
    if (requireLowPrivilege) {
      // The analysis needs to read and nothing else: refuse a login that could also change the registry or decisions.
      const p = (
        await client.query(
          `SELECT r.rolsuper, r.rolcreaterole,
                  has_table_privilege(current_user, 'public.markets', 'INSERT, UPDATE, DELETE') AS writes_markets,
                  has_table_privilege(current_user, 'public.identity_decision', 'INSERT, UPDATE, DELETE') AS writes_decisions,
                  has_table_privilege(current_user, 'public.admin_unit_version', 'INSERT, UPDATE, DELETE') AS writes_reference,
                  has_table_privilege(current_user, 'public.mandi_observations', 'INSERT, UPDATE, DELETE') AS writes_observations
             FROM pg_roles r WHERE r.rolname = current_user`,
        )
      ).rows[0];
      const excess = Object.entries(p)
        .filter(([, v]) => v === true)
        .map(([k]) => k);
      if (excess.length > 0)
        throw new Error(
          `refusing to analyse with a login that has more than read access: ${excess.join(', ')}`,
        );
    }
    /** @param {string} text */
    const rows = async (text) => (await client.query(text)).rows;
    const identity = (
      await client.query(
        `SELECT current_database() AS database, (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier, current_user AS login`,
      )
    ).rows[0];
    const snapshot = {
      identity,
      sources: await rows('SELECT id, code FROM data_sources ORDER BY code'),
      states: await rows('SELECT id, name, kind, lgd_code, is_active FROM states ORDER BY name'),
      districts: await rows(
        'SELECT id, state_id, name, lgd_code, is_active FROM districts ORDER BY state_id, name',
      ),
      stateAliases: await rows(
        `SELECT id, source_id, source_key, source_label, resolution_status, state_id FROM state_aliases ORDER BY source_key`,
      ),
      districtAliases: await rows(
        `SELECT id, source_id, source_key, source_label, source_context, resolution_status, district_id FROM district_aliases ORDER BY source_key`,
      ),
      markets: await rows(
        `SELECT m.id, m.state_id, m.district_id, m.name, m.normalized_name, m.status, m.disambiguator,
                m.government_market_code, m.latitude::text AS latitude,
                a.source_id AS alias_source_id, a.source_key AS alias_source_key, a.source_label AS alias_source_label,
                a.source_context AS alias_source_context
           FROM markets m LEFT JOIN market_aliases a ON a.market_id = m.id
          ORDER BY m.id, a.source_key`,
      ),
      marketObservations: await rows(
        `SELECT market_id, source_id, count(*)::int AS observations, min(observed_date)::text AS first_date, max(observed_date)::text AS last_date
           FROM mandi_observations GROUP BY market_id, source_id ORDER BY market_id, source_id`,
      ),
      units: await rows(
        `SELECT v.id, v.unit_type, v.lgd_code, v.history_seq, v.is_latest_version, v.name_en, v.parent_lgd_code, v.status,
                v.lgd_effective_date::text AS lgd_effective_date, v.lgd_effective_is_baseline, v.valid_from_known,
                v.legal_effective_date::text AS legal_effective_date, v.order_no, v.source_url, v.source_sha256, v.retrieved_at::text AS retrieved_at,
                s.code AS set_code, s.kind AS set_kind, s.fingerprint_kind, s.file_sha256 AS set_sha256, v.state_id, v.district_id
           FROM admin_unit_version v JOIN geo_reference_set s ON s.id = v.reference_set_id
          ORDER BY s.code, v.unit_type, v.lgd_code, v.history_seq`,
      ),
      decisions: await rows(
        `SELECT id, status, decision_kind, entity_kind, source_id, source_key, subject_market_id,
                evidence->>'proposalKey' AS proposal_key, evidence->>'evidenceDigest' AS evidence_digest
           FROM identity_decision ORDER BY proposed_at, id`,
      ),
    };
    return snapshot;
  } finally {
    await client.query('ROLLBACK');
  }
}
