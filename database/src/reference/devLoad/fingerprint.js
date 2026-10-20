import { createHash } from 'node:crypto';

/**
 * Order-independent content fingerprint of every public base table: the row count and the sum of the 64-bit
 * hash of every row's text form. It is READ ONLY. The session time zone is pinned so that the text form of a
 * timestamp is the same on every connection.
 *
 * @param {import('pg').PoolClient | import('pg').Client} client A connection that can SELECT every table.
 * @returns {Promise<Record<string, { rows: number, hash: string }>>}
 */
export async function tableFingerprint(client) {
  await client.query("SET TIME ZONE 'UTC'");
  const tables = (
    await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
    )
  ).rows.map((r) => r.table_name);
  /** @type {Record<string, { rows: number, hash: string }>} */
  const out = {};
  for (const table of tables) {
    const r = (
      await client.query(
        `SELECT count(*)::text AS n, coalesce(sum(hashtextextended(x::text, 0)::numeric), 0)::text AS h FROM public.${client.escapeIdentifier(table)} x`,
      )
    ).rows[0];
    out[table] = { rows: Number(r.n), hash: r.h };
  }
  return out;
}

/** The two tables a reference load is allowed to change. */
export const REFERENCE_TABLES = ['geo_reference_set', 'admin_unit_version'];

/**
 * SHA-256 of a fingerprint in a canonical (sorted) form.
 * @param {Record<string, { rows: number, hash: string }>} fingerprint
 */
export function fingerprintDigest(fingerprint) {
  const keys = Object.keys(fingerprint).sort();
  return createHash('sha256')
    .update(JSON.stringify(keys.map((k) => [k, fingerprint[k].rows, fingerprint[k].hash])))
    .digest('hex');
}

/**
 * Tables whose fingerprint differs between two fingerprints (a table present in only one counts as different).
 * @param {Record<string, { rows: number, hash: string }>} a
 * @param {Record<string, { rows: number, hash: string }>} b
 * @param {string[]} [ignore]
 * @returns {string[]}
 */
export function fingerprintDifferences(a, b, ignore = []) {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names]
    .filter((t) => !ignore.includes(t))
    .filter((t) => !a[t] || !b[t] || a[t].rows !== b[t].rows || a[t].hash !== b[t].hash)
    .sort();
}
