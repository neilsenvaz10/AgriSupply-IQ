/**
 * Read-only geographic discrepancy analysis and candidate identity proposals (Milestone 2.4, Stage 3b).
 *
 *   node scripts/geo-analyze.js --out-dir <folder outside Git> [--url-env DATABASE_URL]
 *
 * Connects with the variable named by --url-env (default DATABASE_URL: the application role, which has SELECT
 * only), reads a snapshot inside a READ ONLY transaction, and writes findings.json, proposals.json and
 * summary.json into the output folder. It reads the database/.env file only to find that variable when it is not
 * already in the environment. It writes NOTHING to the database, submits nothing, accepts nothing and applies
 * nothing. The output folder must be outside the Git working tree.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { loadDatabaseEnvFile } from '../src/config.js';
import { analyse } from '../src/geography/analysis.js';
import { countByClass, buildProposals } from '../src/geography/proposals.js';
import { readSnapshot } from '../src/geography/snapshot.js';
import { planSubmission } from '../src/geography/workflow.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({
  options: {
    'out-dir': { type: 'string' },
    'url-env': { type: 'string', default: 'DATABASE_URL' },
  },
});

try {
  const outDir = values['out-dir'];
  if (!outDir) throw new Error('--out-dir is required (a folder outside the Git working tree)');
  const rel = relative(REPO_ROOT, resolve(outDir));
  if (!rel.startsWith('..') && !isAbsolute(rel))
    throw new Error('the output folder must be outside the Git working tree');
  const variable = values['url-env'] ?? 'DATABASE_URL';
  if (!process.env[variable]) loadDatabaseEnvFile();
  const url = process.env[variable];
  if (!url) throw new Error(`${variable} is not set`);
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  client.on('error', () => undefined);
  await client.connect();
  let snapshot;
  try {
    snapshot = await readSnapshot(client, { requireLowPrivilege: true });
  } finally {
    await client.end();
  }
  const analysis = analyse(snapshot);
  const proposals = buildProposals(analysis);
  const plan = planSubmission(proposals, snapshot.decisions);
  const summary = {
    generatedFrom: {
      database: snapshot.identity.database,
      systemIdentifier: snapshot.identity.system_identifier,
      login: snapshot.identity.login,
    },
    analysisVersion: analysis.version,
    limitations: analysis.limitations,
    findings: analysis.summary,
    proposals: {
      total: proposals.length,
      byEvidenceClass: countByClass(proposals),
      wouldSubmit: plan.toSubmit.length,
      skipped: plan.skipped,
    },
  };
  mkdirSync(resolve(outDir), { recursive: true });
  const serialisable = /** @type {any} */ ({ ...analysis });
  delete serialisable.context;
  writeFileSync(join(outDir, 'findings.json'), JSON.stringify(serialisable, null, 2));
  writeFileSync(join(outDir, 'proposals.json'), JSON.stringify(proposals, null, 2));
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({ findings: summary.findings.findings, proposals: summary.proposals }, null, 2),
  );
  console.log(`written to ${outDir}; nothing was written to the database`);
} catch (error) {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
