/**
 * Historical ingestion CLI (Phase 2, Milestone 2.2).
 *
 *   node src/ingest/cli.js <command> [options]
 *
 * Commands
 *   profile            dry-run: parse, validate and resolve identities, no database (alias of import without --write)
 *   registry:validate  verify the reference set (checksums, structure) and the alias decision files
 *   registry:load      load states/UTs and districts            (dry-run unless --write)
 *   import             import datasets D, C, A, B               (dry-run unless --write)
 *   report             write the quality and alias reports from the database (read-only)
 *
 * SAFETY
 *   - Everything is a dry run unless --write is given.
 *   - A write prints a non-secret target summary (host, port, database, role, dataset, operation)
 *     and needs --yes (or typing the database name). Credentials are never printed.
 *   - A write to the development database host/port is refused unless
 *     --allow-development-target is passed (it needs the project owner's approval).
 *   - The target comes from an environment variable (default DATABASE_INGEST_URL, the ingestion
 *     role); nothing is read from the command line, so no credential can end up in shell history.
 *   - Files in data/raw are opened read-only and never modified.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import pg from 'pg';
import { DATASETS, DATASET_ORDER } from './adapters/index.js';
import { runIngestion } from './framework.js';
import { loadDecisions, decisionsForSource } from './registry/decisions.js';
import { readReferenceSet } from './registry/lgd.js';
import { loadReferenceSet } from './registry/load.js';
import { resolverFromReference } from './registry/memory.js';
import { buildReports, writeReports } from './report.js';
import { sanitizeMessage } from './util.js';

const DATABASE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(DATABASE_DIR, '..');
const DEFAULT_REFERENCE = join(DATABASE_DIR, 'reference', 'lgd');
const DECISIONS_DIR = join(DATABASE_DIR, 'reference', 'aliases');

const OPTIONS = /** @type {const} */ ({
  dataset: { type: 'string' },
  file: { type: 'string' },
  'data-dir': { type: 'string' },
  reference: { type: 'string' },
  write: { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  resume: { type: 'boolean', default: false },
  'batch-size': { type: 'string' },
  limit: { type: 'string' },
  out: { type: 'string' },
  'url-env': { type: 'string' },
  'allow-development-target': { type: 'boolean', default: false },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
});

/** @param {string} url */
export function describeTarget(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    database: u.pathname.replace(/^\//, ''),
    role: decodeURIComponent(u.username),
  };
}

/** Host and port of the development database (from the git-ignored database/.env), if configured. */
function developmentTarget() {
  const file = join(DATABASE_DIR, '.env');
  if (!existsSync(file)) return null;
  const url = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
  if (!url) return null;
  const t = describeTarget(url);
  return { host: t.host, port: t.port };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const sameEndpoint = (a, b) =>
  a.port === b.port && (a.host === b.host || (LOOPBACK.has(a.host) && LOOPBACK.has(b.host)));

function targetUrl(values) {
  const name = values['url-env'] ?? 'DATABASE_INGEST_URL';
  const url = process.env[name];
  if (!url)
    throw new Error(
      `Set ${name} to the ingestion role's connection string (see database/docs/INGESTION.md).`,
    );
  return { name, url };
}

async function confirmWrite(values, summaryLines, target) {
  console.log('\nTARGET SUMMARY (no credentials shown)');
  for (const line of summaryLines) console.log(`  ${line}`);
  const dev = developmentTarget();
  if (dev && sameEndpoint(dev, target) && !values['allow-development-target']) {
    throw new Error(
      `Refusing to write: ${target.host}:${target.port} is the DEVELOPMENT database. Importing there needs the project owner's approval (--allow-development-target).`,
    );
  }
  if (values.yes) return;
  if (!process.stdin.isTTY)
    throw new Error('A write needs --yes (or an interactive terminal to confirm).');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Type the database name (${target.database}) to confirm: `);
  rl.close();
  if (answer.trim() !== target.database)
    throw new Error('Confirmation did not match. Nothing was written.');
}

function printRun(result) {
  const p = result.performance;
  console.log(
    `  ${result.mode === 'write' ? `run ${String(result.runId).slice(0, 8)} ${result.status}` : 'dry run'}: read ${result.read}, ` +
      (result.mode === 'write'
        ? `accepted ${result.loaded}, exact duplicates ${result.duplicate}, conflicts ${result.conflicting}, quarantined ${result.rejected}`
        : `would load ${result.wouldLoad}, quarantined ${result.rejected}`) +
      `, reconciled ${result.reconciled ? 'yes' : 'NO'}`,
  );
  console.log(
    `  ${p.seconds}s, ${p.rowsPerSecond} rows/s, batch ${p.batchSize}, peak RSS ${p.peakRssMiB} MiB` +
      (p.databaseGrowthBytes !== null
        ? `, database growth ${(p.databaseGrowthBytes / 1048576).toFixed(1)} MiB`
        : ''),
  );
  const reasons = Object.entries(result.rejectionsByReason);
  if (reasons.length)
    console.log(`  quarantined by reason: ${reasons.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const states = Object.entries(result.unresolved.states);
  if (states.length)
    console.log(`  unresolved states: ${states.map(([k, v]) => `"${k}" (${v} rows)`).join(', ')}`);
}

export async function main(argv) {
  const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const { positionals } = parsed;
  /** @type {Record<string, any>} */
  const values = parsed.values;
  const command = positionals[0] ?? (values.help ? 'help' : '');
  if (!command || command === 'help' || values.help) {
    console.log(
      readFileSync(new URL(import.meta.url), 'utf8')
        .split('*/')[0]
        .replace(/^\/\*\*\n|^ \* ?/gm, ''),
    );
    return 0;
  }
  const referenceDir = values.reference ? join(process.cwd(), values.reference) : DEFAULT_REFERENCE;
  const dataDir = values['data-dir'] ?? join(REPO_ROOT, 'data', 'raw');

  if (command === 'registry:validate') {
    const ref = await readReferenceSet(referenceDir);
    const decisions = await loadDecisions(DECISIONS_DIR);
    const badTargets = [...decisions.entries()].filter(
      ([k, v]) =>
        k.startsWith('state|') && v.entityId && !ref.states.some((s) => s.code === v.entityId),
    );
    console.log(
      `Reference set ${ref.manifest.referenceSet}: status ${ref.manifest.status}, reference date ${ref.manifest.referenceDate}, licence ${ref.manifest.licence.name}`,
    );
    console.log(
      `  files verified against the manifest SHA-256: ${ref.files.map((f) => f.name).join(', ')}`,
    );
    console.log(
      `  ${ref.states.length} states/UTs, ${ref.districts.length} districts, ${ref.problems.length} problem row(s)`,
    );
    for (const p of ref.problems)
      console.log(`  PROBLEM ${p.file} row ${p.rowNumber}: ${p.reason}`);
    console.log(
      `  alias decisions: ${decisions.size} (${badTargets.length} with a target missing from the reference)`,
    );
    for (const [k] of badTargets) console.log(`  BAD DECISION TARGET ${k}`);
    return ref.problems.length || badTargets.length ? 1 : 0;
  }

  if (command === 'registry:load') {
    const ref = await readReferenceSet(referenceDir);
    if (!values.write) {
      console.log(
        `DRY RUN: would load ${ref.states.length} states/UTs and ${ref.districts.length} districts from ${ref.manifest.referenceSet} (${ref.manifest.status}, ${ref.manifest.referenceDate}). Add --write to load.`,
      );
      return 0;
    }
    const { name, url } = targetUrl(values);
    const target = describeTarget(url);
    await confirmWrite(
      values,
      [
        `operation: load reference set ${ref.manifest.referenceSet}`,
        `database: ${target.host}:${target.port}/${target.database} as role ${target.role} (from ${name})`,
      ],
      target,
    );
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      console.log(
        JSON.stringify(await loadReferenceSet({ pool, directory: referenceDir }), null, 2),
      );
    } finally {
      await pool.end();
    }
    return 0;
  }

  if (command === 'report') {
    const { url } = targetUrl(values);
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const manifest = JSON.parse(readFileSync(join(referenceDir, 'manifest.json'), 'utf8'));
      const t = describeTarget(url);
      const reports = await buildReports(pool, {
        referenceManifest: manifest,
        target: { host: t.host, port: t.port, database: t.database },
      });
      const files = writeReports(
        reports,
        values.out
          ? join(process.cwd(), values.out)
          : join(DATABASE_DIR, 'reports', 'milestone-2.2'),
      );
      console.log(`Wrote:\n${files.map((f) => `  ${f}`).join('\n')}`);
    } finally {
      await pool.end();
    }
    return 0;
  }

  if (command === 'import' || command === 'profile') {
    const write = command === 'import' && values.write;
    const wanted =
      !values.dataset || values.dataset === 'all'
        ? [...DATASET_ORDER]
        : values.dataset.toUpperCase().split(',');
    for (const d of wanted)
      if (!(d in DATASETS)) throw new Error(`Unknown dataset "${d}". Use D, C, A, B or all.`);
    const decisions = await loadDecisions(DECISIONS_DIR);
    const ref = await readReferenceSet(referenceDir);
    let pool = null;
    if (write) {
      const { name, url } = targetUrl(values);
      const target = describeTarget(url);
      await confirmWrite(
        values,
        [
          `operation: ${values.resume ? 'resume' : 'import'} dataset(s) ${wanted.join(', ')}`,
          `database: ${target.host}:${target.port}/${target.database} as role ${target.role} (from ${name})`,
          `files: ${wanted.map((d) => values.file ?? DATASETS[/** @type {keyof typeof DATASETS} */ (d)].defaultFile).join(', ')} (read-only)`,
        ],
        target,
      );
      pool = new pg.Pool({ connectionString: url, max: 3 });
    } else {
      console.log('DRY RUN: no database is touched. Add --write to import.');
    }
    let exit = 0;
    try {
      for (const key of wanted) {
        const { adapter, defaultFile } = DATASETS[/** @type {keyof typeof DATASETS} */ (key)];
        const filePath = values.file ?? join(dataDir, defaultFile);
        console.log(`\nDataset ${key}: ${filePath}`);
        const sourceDecisions = decisionsForSource(decisions, adapter.source.code);
        try {
          const result = await runIngestion({
            adapter,
            filePath,
            mode: write ? 'write' : 'dry-run',
            ...(pool ? { pool } : {}),
            dryRunResolver: () => resolverFromReference(ref, sourceDecisions),
            decisions: sourceDecisions,
            batchSize: values['batch-size'] ? Number(values['batch-size']) : 2000,
            resume: values.resume,
            ...(values.limit ? { limit: Number(values.limit) } : {}),
            onProgress: values.json
              ? undefined
              : (p) => {
                  if (Number(p.batches) % 50 === 0) console.log(`  ... ${p.read} rows`);
                },
          });
          printRun(result);
          if (values.json) console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          exit = 1;
          console.error(
            `  FAILED: ${sanitizeMessage(error instanceof Error ? error.message : String(error))}`,
          );
          break;
        }
      }
    } finally {
      await pool?.end();
    }
    return exit;
  }
  throw new Error(`Unknown command "${command}". Run with --help.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(sanitizeMessage(error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    },
  );
}
