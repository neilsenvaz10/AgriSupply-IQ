/**
 * Submits chosen pilot proposals as a REVIEWER login (Milestone 2.4, Stage 3c). Part of authorization gate B in
 * docs/geography/STAGE_3C_OPERATOR_RUNBOOK.md: it is not run until that gate has been passed.
 *
 *   node scripts/geo-submit.js --keys <proposalKey,proposalKey,...>              dry run: prints the plan, writes nothing
 *   node scripts/geo-submit.js --keys <...> --execute                            submits them
 *
 * Two connections, both named explicitly in the environment (no .env file is read):
 *   DATABASE_URL           a read-only login: the analysis that rebuilds the proposals (refused if it can write)
 *   DATABASE_REVIEW_URL    the reviewer's personal login (see scripts/review-logins.js): the only one that writes
 *
 * It submits ONLY proposals whose key is in --keys AND that are still pilot-grade (exact official name, one
 * candidate, single version, 2005 default date, registry district, one reviewer) in a fresh analysis, at most five,
 * never an ambiguous, renamed, name-only or state-correction proposal. A duplicate is reported, not raised, so the
 * command is safe to repeat. It reviews, accepts and applies nothing.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { analyse } from '../src/geography/analysis.js';
import { PILOT_MAX, pilotDisqualifiers } from '../src/geography/pilot.js';
import { buildProposals } from '../src/geography/proposals.js';
import { readSnapshot } from '../src/geography/snapshot.js';
import { planSubmission, submitWithRetry } from '../src/geography/workflow.js';
import { reviewLoginProblems } from '../src/identity/logins.js';

const { values } = parseArgs({
  options: { keys: { type: 'string' }, execute: { type: 'boolean', default: false } },
});

/** @type {pg.Client | undefined} */
let reader;
/** @type {pg.Pool | undefined} */
let reviewer;
try {
  const keys = (values.keys ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0)
    throw new Error('--keys is required (the proposal keys of the pilot items)');
  if (keys.length > PILOT_MAX) throw new Error(`at most ${PILOT_MAX} proposals at a time`);
  if (new Set(keys).size !== keys.length) throw new Error('a key is listed twice');
  const readUrl = process.env.DATABASE_URL;
  if (!readUrl) throw new Error('DATABASE_URL (a read-only login) is not set');
  reader = new pg.Client({ connectionString: readUrl, connectionTimeoutMillis: 10_000 });
  reader.on('error', () => undefined);
  await reader.connect();
  const snapshot = await readSnapshot(reader, { requireLowPrivilege: true });
  await reader.end();
  reader = undefined;
  const proposals = buildProposals(analyse(snapshot));
  const chosen = [];
  for (const key of keys) {
    const p = proposals.find((x) => x.proposalKey === key);
    if (!p) throw new Error(`no proposal has the key ${key} in a fresh analysis`);
    const reasons = pilotDisqualifiers(p);
    if (reasons.length > 0)
      throw new Error(`${p.sourceKey} is not a pilot item: ${reasons.join('; ')}`);
    chosen.push(p);
  }
  const plan = planSubmission(chosen, snapshot.decisions);
  console.log(
    `database ${snapshot.identity.database} (${snapshot.identity.system_identifier}), analysed as ${snapshot.identity.login}`,
  );
  for (const p of plan.toSubmit)
    console.log(
      `  would submit  ${p.proposalKey}  ${p.sourceKey}  -> LGD ${p.proposed.lgdCode} ${p.proposed.name}`,
    );
  for (const s of plan.skipped) console.log(`  skipped       ${s.proposalKey}  ${s.reason}`);
  if (!values.execute) {
    console.log('dry run: nothing was written (add --execute to submit)');
  } else {
    const url = process.env.DATABASE_REVIEW_URL;
    if (!url) throw new Error('DATABASE_REVIEW_URL (the reviewer login) is not set');
    reviewer = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
    reviewer.on('error', () => undefined);
    const probe = await reviewer.connect();
    try {
      const who = (
        await probe.query(
          "SELECT current_user AS u, pg_has_role(current_user, 'fasalytics_reviewer', 'USAGE') AS reviewer, pg_has_role(current_user, 'fasalytics_approver', 'USAGE') AS approver",
        )
      ).rows[0];
      if (!who.reviewer || who.approver)
        throw new Error('DATABASE_REVIEW_URL must be a reviewer login (and not an approver)');
      const problems = await reviewLoginProblems(/** @type {any} */ (probe));
      if (problems.length > 0)
        throw new Error(
          `the reviewer login deviates from the access design: ${problems.join(', ')}`,
        );
      console.log(`submitting as ${who.u}`);
    } finally {
      probe.release();
    }
    for (const p of plan.toSubmit) {
      const result = await submitWithRetry(reviewer, p);
      console.log(
        `  ${result.status}  ${p.proposalKey}  ${p.sourceKey}${'id' in result ? `  decision ${result.id}` : ''}`,
      );
    }
  }
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await reader?.end().catch(() => undefined);
  await reviewer?.end().catch(() => undefined);
}
