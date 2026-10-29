/**
 * Rehearsal of the complete identity review workflow on a COPY of the development data (Milestone 2.4, Stage 3c).
 *
 *   node scripts/geo-rehearse.js
 *
 * It WRITES (decisions, reviews, mapping sets, temporary logins), so it runs ONLY against a verified disposable
 * database: the same fail-closed guard as the integration tests (FASALYTICS_DISPOSABLE_DB=1, the token, and every
 * connection string in the environment must reach a database carrying that identity). The development database
 * never does. Use a restored backup of development (see docs/geography/STAGE_3C_OPERATOR_RUNBOOK.md).
 *
 * It creates five SYNTHETIC logins with the real provisioning code, rehearses the workflow with the real pilot
 * proposals, proves that no other table changed (every observation row included), prints the checks, and drops
 * the logins. Nothing is left behind except the decisions in the disposable copy.
 */
import pg from 'pg';
import { provisionReviewLogin, revokeAllReviewLogins } from '../src/identity/logins.js';
import { grantIdentityPrivileges } from '../src/identity/privileges.js';
import { analyse } from '../src/geography/analysis.js';
import { selectPilot } from '../src/geography/pilot.js';
import { buildProposals } from '../src/geography/proposals.js';
import { runRehearsal } from '../src/geography/rehearsal.js';
import { readSnapshot } from '../src/geography/snapshot.js';
import { checkDisposable } from '../src/test/disposable.js';
import { urlFor } from '../src/test/roles.js';

const KEYS = /** @type {const} */ (['revA', 'revB', 'revC', 'app1', 'app2']);
const KIND = /** @type {const} */ ({
  revA: 'reviewer',
  revB: 'reviewer',
  revC: 'reviewer',
  app1: 'approver',
  app2: 'approver',
});

const verdict = await checkDisposable();
if (!verdict.ok) {
  console.error(
    `Refusing to run: the target is not a verified disposable database: ${verdict.reason}.`,
  );
  process.exit(3);
}
const ownerUrl = process.env.DATABASE_MIGRATION_URL;
const adminUrl = process.env.DATABASE_ADMIN_URL;
const readerUrl = process.env.DATABASE_URL;
if (!ownerUrl || !adminUrl || !readerUrl) {
  console.error(
    'DATABASE_MIGRATION_URL, DATABASE_ADMIN_URL and DATABASE_URL (the disposable copy) are required',
  );
  process.exit(2);
}
const tag = Date.now().toString(36).slice(-6);
const owner = new pg.Pool({ connectionString: ownerUrl, max: 3 });
const admin = new pg.Client({ connectionString: adminUrl });
const reader = new pg.Pool({ connectionString: readerUrl, max: 2 });
/** @type {Record<string, pg.Pool>} */
const pools = {};
/** @type {Record<string, string>} */
const names = {};
let exitCode = 0;
try {
  await admin.connect();
  await grantIdentityPrivileges(ownerUrl);
  for (const key of KEYS) {
    const made = await provisionReviewLogin(admin, {
      person: `${key.toLowerCase()}${tag}`,
      kind: KIND[key],
      validUntil: new Date(Date.now() + 2 * 86_400_000),
    });
    names[key] = made.role;
    pools[key] = new pg.Pool({
      connectionString: urlFor(ownerUrl, made.role, made.password),
      max: 3,
    });
    pools[key].on('error', () => undefined);
  }
  const client = await owner.connect();
  let proposals;
  try {
    proposals = buildProposals(analyse(await readSnapshot(client)));
  } finally {
    client.release();
  }
  const { selected, excluded } = selectPilot(proposals);
  console.log(
    `pilot: ${selected.length} item(s): ${selected.map((p) => p.sourceLabel).join(', ')}`,
  );
  console.log(`exact-name candidates left out: ${excluded.map((e) => e.sourceKey).join(', ')}`);
  if (selected.length < 5) {
    // the rehearsal needs five items: complete it with the next safest exact-name candidates, for the rehearsal only
    const rest = proposals.filter(
      (p) => p.evidenceClass === 'exact_official_name' && !selected.includes(p),
    );
    const added = rest.slice(0, 5 - selected.length);
    selected.push(...added);
    console.log(
      `rehearsal only (not a pilot): completed to ${selected.length} with ${added.map((p) => p.sourceLabel).join(', ')}`,
    );
  }
  const result = await runRehearsal({
    owner,
    pools: /** @type {any} */ (pools),
    reader,
    names: /** @type {any} */ (names),
    proposals: selected,
    tag,
  });
  for (const c of result.checks)
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
  console.log(
    `\n${result.checks.filter((c) => c.ok).length}/${result.checks.length} checks passed`,
  );
  console.log(JSON.stringify(result.summary));
  if (result.checks.some((c) => !c.ok)) exitCode = 1;
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  exitCode = 1;
} finally {
  for (const p of Object.values(pools)) await p.end().catch(() => undefined);
  await revokeAllReviewLogins(admin).catch(() => undefined);
  await admin.end().catch(() => undefined);
  await reader.end().catch(() => undefined);
  await owner.end().catch(() => undefined);
}
process.exitCode = exitCode;
