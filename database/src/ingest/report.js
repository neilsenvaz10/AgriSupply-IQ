import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

// Dates are reported exactly as stored ('YYYY-MM-DD'). pg's default DATE parser builds a local-time
// Date, which shifts the calendar day by the machine's timezone offset (a bug caught in review).
pg.types.setTypeParser(1082, (value) => value);

/**
 * Quality, coverage and alias-resolution reports, generated from the database (read-only).
 *
 * Two outputs, each as machine-readable JSON and readable Markdown:
 *   ingestion-quality-report   per dataset: input rows and where every one went (accepted, exact
 *                              duplicate, conflict, quarantined), date range, distinct entities,
 *                              granularity, unit assumptions, missing values, coverage gaps
 *   alias-resolution-report    every state, district and mandi identity that needs a human
 *
 * Nothing here claims forecast eligibility: historical sufficiency is not proven eligibility.
 */

const DATASET_SOURCES = {
  D: {
    code: 'wpi_national_monthly_historical',
    title: 'Dataset D: Wholesale Price Index (national, monthly)',
    granularity: 'national WPI index x month (index numbers, not prices)',
  },
  C: {
    code: 'national_monthly_prices_historical',
    title: 'Dataset C: national monthly commodity prices',
    granularity: 'India x commodity x month (monthly averages)',
  },
  A: {
    code: 'mandi_daily_prices_historical',
    title: 'Dataset A: mandi-level daily prices',
    granularity: 'market x commodity x variety x grade x day (prices; no arrivals)',
  },
  B: {
    code: 'state_daily_prices_arrivals_historical',
    title: 'Dataset B: state-level daily prices and arrivals',
    granularity: 'state x commodity x day (state totals, never mandi figures)',
  },
};

const LIMITATIONS = {
  A: [
    'No arrivals and no market identifiers in the source; markets are identified by source labels and created as unverified.',
    'The price unit is not stated: INR per quintal is an assumption (see unit assumptions).',
    'Markets whose district is unresolved are identified by the source district label; they are not merged with any other market.',
    'Commodity coverage is uneven in time (per-commodity windows below); gaps are real absences and are never filled.',
  ],
  B: [
    'State-level only: arrivals cannot be attributed to a mandi.',
    'Units are mixed (tonnes, bundles, pieces); counts are not converted to mass.',
    'Overlapping report files repeat the same state/commodity/day; exact repeats are skipped and differing repeats are kept as conflicts for review.',
    'Footer text and structurally broken source rows are quarantined, not repaired.',
  ],
  C: [
    'The price unit is not stated: INR per quintal is an assumption.',
    'The meaning of the "change" column is unconfirmed; it is stored as reported and must not be used for modelling.',
    'National monthly averages: unusable for daily mandi forecasting.',
  ],
  D: [
    'Index numbers, not prices. The index base period is not stated in the file (left NULL).',
    'Items are not linked to the commodity registry (a reviewed, separate step).',
    'National monthly series: context only, not for daily forecasting.',
  ],
};

/** @returns {number} (null counts become 0 only where arithmetic is needed) */
const num = (v) => Number(v ?? 0);
const n = (v) => (v === null || v === undefined ? null : Number(v));
const iso = (v) =>
  v instanceof Date
    ? v.toISOString().slice(0, 10)
    : v === null || v === undefined
      ? null
      : String(v);

/**
 * @param {import('pg').Pool} pool
 * @param {{ referenceManifest?: Record<string, any>, target?: { host: string, port: string, database: string } }} [options]
 */
export async function buildReports(pool, options = {}) {
  /** @param {string} text @param {unknown[]} [values] @returns {Promise<any[]>} */
  const q = async (text, values = []) => (await pool.query(text, values)).rows;
  const tableExists = async (name) =>
    (await q('SELECT to_regclass($1) AS t', [`public.${name}`]))[0].t !== null;
  if (!(await tableExists('ingestion_runs')))
    throw new Error('The canonical schema is not migrated in this database.');

  const datasets = {};
  for (const [key, def] of Object.entries(DATASET_SOURCES)) {
    datasets[key] = await datasetBlock(q, key, def);
  }
  const identity = await identityBlock(q, datasets);
  const reference = await referenceBlock(q, options.referenceManifest);
  const quality = {
    generatedAt: new Date().toISOString(),
    generator: 'database/src/ingest/report.js',
    target: options.target ?? null,
    notice:
      'Historical records only: nothing here is a current market price, and historical coverage is not proven forecast eligibility (that needs backtesting, Phase 3).',
    reference,
    datasets,
    mandiLevelVersusStateLevel:
      'Mandi-level (dataset A) and state-level (dataset B) coverage are reported separately and are not comparable or additive.',
  };
  const aliases = {
    generatedAt: quality.generatedAt,
    target: quality.target,
    reference,
    ...identity,
  };
  return {
    quality,
    aliases,
    markdown: { quality: qualityMarkdown(quality), aliases: aliasMarkdown(aliases) },
  };
}

/** Writes both reports (JSON and Markdown) into `directory`. */
export function writeReports(reports, directory) {
  mkdirSync(directory, { recursive: true });
  const files = {
    'ingestion-quality-report.json': JSON.stringify(reports.quality, null, 2) + '\n',
    'ingestion-quality-report.md': reports.markdown.quality,
    'alias-resolution-report.json': JSON.stringify(reports.aliases, null, 2) + '\n',
    'alias-resolution-report.md': reports.markdown.aliases,
  };
  for (const [name, content] of Object.entries(files))
    writeFileSync(join(directory, name), content, 'utf8');
  return Object.keys(files).map((f) => join(directory, f));
}

// ------------------------------------------------------------------------------------------

async function datasetBlock(q, key, def) {
  const source = (await q('SELECT id FROM data_sources WHERE code = $1', [def.code]))[0];
  const block = {
    dataset: key,
    title: def.title,
    sourceCode: def.code,
    granularity: def.granularity,
    imported: Boolean(source),
    limitations: LIMITATIONS[key],
  };
  if (!source)
    return { ...block, note: 'No import has been recorded for this dataset in this database.' };
  const sourceId = source.id;

  const runs = await q(
    `SELECT r.id, r.status, r.importer_version, r.started_at, r.finished_at, r.rows_read, r.rows_loaded, r.rows_exact_duplicate,
            r.rows_conflicting, r.rows_rejected, r.last_committed_row, r.resumed_from_run_id, r.error_summary,
            f.file_name, f.file_sha256, f.size_bytes
       FROM ingestion_runs r LEFT JOIN source_files f ON f.id = r.source_file_id
      WHERE r.source_id = $1 ORDER BY r.started_at`,
    [sourceId],
  );
  const mapRun = (r) => ({
    runId: r.id,
    status: r.status,
    importerVersion: r.importer_version,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    file: r.file_name ? { name: r.file_name, sha256: r.file_sha256, bytes: n(r.size_bytes) } : null,
    inputRows: n(r.rows_read),
    accepted: n(r.rows_loaded),
    exactDuplicatesSkipped: n(r.rows_exact_duplicate),
    conflictsRetained: n(r.rows_conflicting),
    quarantined: n(r.rows_rejected),
    lastCommittedRow: n(r.last_committed_row),
    resumedFromRunId: r.resumed_from_run_id,
    errorSummary: r.error_summary,
    reconciled:
      num(r.rows_loaded) +
        num(r.rows_exact_duplicate) +
        num(r.rows_conflicting) +
        num(r.rows_rejected) ===
      num(r.rows_read),
  });
  const mapped = runs.map(mapRun);
  const completed = (r) => r.status === 'succeeded' || r.status === 'succeeded_with_rejections';
  const latest = [...runs].reverse().find(completed);
  const spec = FACT_REPORT[key];

  // The INITIAL LOAD is the first import of the first file: every run from its start up to and
  // including the first completed one (so a crash followed by a resume counts as one load). Later
  // runs of the same file are idempotent re-imports and are listed separately; they must not hide
  // what the first load actually accepted and quarantined.
  const first = runs.find((r) => r.file_sha256);
  const chain = [];
  if (first) {
    for (const r of runs.filter((x) => x.file_sha256 === first.file_sha256)) {
      chain.push(r);
      if (completed(r)) break;
    }
  }
  const chainDone = chain.length > 0 && completed(chain[chain.length - 1]);
  const sum = (field) => chain.reduce((a, r) => a + num(r[field]), 0);
  /** @type {Record<string, any>} */
  const out = {
    ...block,
    runs: mapped,
    latestCompletedRun: latest ? mapRun(latest) : null,
    initialLoad: chainDone
      ? {
          runIds: chain.map((r) => r.id),
          runsInChain: chain.length,
          note:
            chain.length > 1
              ? 'The first attempt was interrupted and resumed; the figures are the sum of the chain.'
              : 'A single run.',
          file: { name: first.file_name, sha256: first.file_sha256, bytes: n(first.size_bytes) },
          inputRows: sum('rows_read'),
          accepted: sum('rows_loaded'),
          exactDuplicatesSkipped: sum('rows_exact_duplicate'),
          conflictsRetained: sum('rows_conflicting'),
          quarantined: sum('rows_rejected'),
          reconciled:
            sum('rows_loaded') +
              sum('rows_exact_duplicate') +
              sum('rows_conflicting') +
              sum('rows_rejected') ===
            sum('rows_read'),
        }
      : null,
    laterRuns: chainDone ? mapped.filter((m) => !chain.some((c) => c.id === m.runId)).length : null,
  };

  if (chainDone) {
    const ids = chain.map((r) => r.id);
    const reasons = await q(
      `SELECT reason_code, count(*)::int AS rows FROM ingestion_rejections WHERE ingestion_run_id = ANY($1::uuid[]) GROUP BY 1 ORDER BY 2 DESC`,
      [ids],
    );
    const details = await q(
      `SELECT reason_code, reason_detail, count(*)::int AS rows FROM ingestion_rejections WHERE ingestion_run_id = ANY($1::uuid[])
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`,
      [ids],
    );
    out.quarantineByReason = Object.fromEntries(reasons.map((r) => [r.reason_code, r.rows]));
    out.topQuarantineDetails = details.map((r) => ({
      reason: r.reason_code,
      detail: r.reason_detail,
      rows: r.rows,
    }));
  }
  Object.assign(out, await spec(q, sourceId));
  out.unitAssumptions = (
    await q(
      'SELECT assumption_code, statement, evidence_reference FROM source_assumptions WHERE source_id = $1 ORDER BY 1',
      [sourceId],
    )
  ).map((r) => ({
    code: r.assumption_code,
    statement: r.statement,
    evidence: r.evidence_reference,
  }));
  return out;
}

/** Fact-table specific coverage, per dataset. */
const FACT_REPORT = {
  async A(q, sourceId) {
    const t = 'mandi_observations';
    const s = (
      await q(
        `SELECT count(*)::bigint AS rows, min(observed_date) AS first, max(observed_date) AS last, count(DISTINCT observed_date)::int AS days,
              count(DISTINCT market_id)::int AS markets, count(DISTINCT commodity_id)::int AS commodities,
              count(DISTINCT variety_id)::int AS varieties, count(DISTINCT source_state_label)::int AS source_state_labels,
              count(DISTINCT source_district_label)::int AS source_district_labels,
              count(*) FILTER (WHERE variety_id IS NULL)::bigint AS variety_unspecified, count(*) FILTER (WHERE grade IS NULL)::bigint AS grade_missing,
              count(*) FILTER (WHERE min_price IS NULL)::bigint AS min_missing, count(*) FILTER (WHERE max_price IS NULL)::bigint AS max_missing,
              count(*) FILTER (WHERE modal_price IS NULL)::bigint AS modal_missing,
              count(*) FILTER (WHERE quality_status = 'flagged')::bigint AS flagged,
              count(*) FILTER (WHERE unit_basis = 'assumed_from_documentation')::bigint AS unit_assumed
         FROM ${t} WHERE source_id = $1`,
        [sourceId],
      )
    )[0];
    const geo = (
      await q(
        `SELECT count(DISTINCT m.state_id)::int AS states, count(DISTINCT m.district_id)::int AS districts,
              count(*) FILTER (WHERE m.district_id IS NULL)::bigint AS rows_district_unresolved
         FROM ${t} o JOIN markets m ON m.id = o.market_id WHERE o.source_id = $1`,
        [sourceId],
      )
    )[0];
    return {
      loaded: {
        observations: n(s.rows),
        firstDate: iso(s.first),
        lastDate: iso(s.last),
        distinctObservationDays: s.days,
        distinctResolvedStates: geo.states,
        distinctResolvedDistricts: geo.districts,
        distinctSourceStateLabels: s.source_state_labels,
        distinctSourceDistrictLabels: s.source_district_labels,
        distinctMandis: s.markets,
        distinctCommodities: s.commodities,
        distinctVarieties: s.varieties,
        observationsWithUnresolvedDistrict: n(geo.rows_district_unresolved),
      },
      missingValues: {
        varietyUnspecified: n(s.variety_unspecified),
        gradeMissing: n(s.grade_missing),
        minPriceMissing: n(s.min_missing),
        maxPriceMissing: n(s.max_missing),
        modalPriceMissing: n(s.modal_missing),
        arrivals: 'never provided by this source',
      },
      quality: { flagged: n(s.flagged), flagCounts: await flagCounts(q, t, sourceId) },
      unitBasis: {
        assumedFromDocumentation: n(s.unit_assumed),
        sourceStated: num(s.rows) - num(s.unit_assumed),
      },
      perCommodityWindows: await dailyWindows(q, t, sourceId, 'commodity_id', 25),
      coverageGaps: await dailyGaps(q, t, sourceId),
    };
  },
  async B(q, sourceId) {
    const t = 'state_observations';
    const s = (
      await q(
        `SELECT count(*)::bigint AS rows, min(observed_date) AS first, max(observed_date) AS last, count(DISTINCT observed_date)::int AS days,
              count(DISTINCT state_id)::int AS states, count(DISTINCT commodity_id)::int AS commodities,
              count(*) FILTER (WHERE arrival_quantity IS NULL)::bigint AS arrival_missing, count(*) FILTER (WHERE modal_price IS NULL)::bigint AS modal_missing,
              count(*) FILTER (WHERE quality_status = 'flagged')::bigint AS flagged
         FROM ${t} WHERE source_id = $1`,
        [sourceId],
      )
    )[0];
    const units = await q(
      `SELECT coalesce(price_unit, '(none)') AS price_unit, coalesce(arrival_unit, '(none)') AS arrival_unit, count(*)::bigint AS rows
         FROM ${t} WHERE source_id = $1 GROUP BY 1, 2 ORDER BY 3 DESC`,
      [sourceId],
    );
    return {
      loaded: {
        observations: n(s.rows),
        firstDate: iso(s.first),
        lastDate: iso(s.last),
        distinctObservationDays: s.days,
        distinctResolvedStates: s.states,
        distinctCommodities: s.commodities,
        distinctDistricts: 'not applicable (state-level)',
        distinctMandis: 'not applicable (state-level)',
      },
      missingValues: {
        arrivalMissing: n(s.arrival_missing),
        modalPriceMissing: n(s.modal_missing),
      },
      quality: { flagged: n(s.flagged), flagCounts: await flagCounts(q, t, sourceId) },
      unitMix: units.map((u) => ({
        priceUnit: u.price_unit,
        arrivalUnit: u.arrival_unit,
        rows: n(u.rows),
      })),
      unitNote:
        'Mass units (tonne) and count units (nos, bundle) are kept apart; counts are never converted to tonnes.',
      perCommodityWindows: await dailyWindows(q, t, sourceId, 'commodity_id', 25),
      coverageGaps: await dailyGaps(q, t, sourceId),
    };
  },
  async C(q, sourceId) {
    const t = 'national_monthly_prices';
    const s = (
      await q(
        `SELECT count(*)::bigint AS rows, min(period_month) AS first, max(period_month) AS last, count(DISTINCT commodity_id)::int AS commodities,
              count(*) FILTER (WHERE source_reported_change IS NULL)::bigint AS change_missing, count(*) FILTER (WHERE quality_status = 'flagged')::bigint AS flagged
         FROM ${t} WHERE source_id = $1`,
        [sourceId],
      )
    )[0];
    const per = await q(
      `SELECT c.name, count(*)::int AS months, min(period_month) AS first, max(period_month) AS last,
              ((extract(year FROM age(max(period_month), min(period_month))) * 12 + extract(month FROM age(max(period_month), min(period_month))))::int + 1 - count(*)::int) AS missing_months
         FROM ${t} o JOIN commodities c ON c.id = o.commodity_id WHERE o.source_id = $1 GROUP BY c.name ORDER BY c.name`,
      [sourceId],
    );
    return {
      loaded: {
        observations: n(s.rows),
        firstMonth: iso(s.first),
        lastMonth: iso(s.last),
        distinctCommodities: s.commodities,
        geography: 'India (national) only',
      },
      missingValues: { sourceReportedChangeMissing: n(s.change_missing) },
      quality: { flagged: n(s.flagged), flagCounts: await flagCounts(q, t, sourceId) },
      perCommodityMonths: per.map((r) => ({
        commodity: r.name,
        months: r.months,
        first: iso(r.first),
        last: iso(r.last),
        missingMonthsInRange: r.missing_months,
      })),
      coverageGaps: per
        .filter((r) => r.missing_months > 0)
        .map((r) => ({ commodity: r.name, missingMonthsInRange: r.missing_months })),
    };
  },
  async D(q, sourceId) {
    const s = (
      await q(
        `SELECT count(*)::bigint AS rows, min(period_month) AS first, max(period_month) AS last,
              (SELECT count(*)::int FROM wpi_series WHERE source_id = $1) AS series FROM wpi_observations WHERE source_id = $1`,
        [sourceId],
      )
    )[0];
    const per = await q(
      `SELECT ws.item_label, count(*)::int AS months, min(period_month) AS first, max(period_month) AS last,
              ((extract(year FROM age(max(period_month), min(period_month))) * 12 + extract(month FROM age(max(period_month), min(period_month))))::int + 1 - count(*)::int) AS missing_months
         FROM wpi_observations o JOIN wpi_series ws ON ws.id = o.series_id WHERE o.source_id = $1 GROUP BY ws.item_label ORDER BY ws.item_label`,
      [sourceId],
    );
    return {
      loaded: {
        observations: n(s.rows),
        firstMonth: iso(s.first),
        lastMonth: iso(s.last),
        distinctSeries: s.series,
        geography: 'India (national) only',
      },
      missingValues: { note: 'a month with no value is absent, never filled' },
      perSeriesMonths: per.map((r) => ({
        item: r.item_label,
        months: r.months,
        first: iso(r.first),
        last: iso(r.last),
        missingMonthsInRange: r.missing_months,
      })),
      coverageGaps: per
        .filter((r) => r.missing_months > 0)
        .map((r) => ({ item: r.item_label, missingMonthsInRange: r.missing_months })),
      indexNotice:
        'These are index numbers. They are stored in wpi_observations only and are never rupee prices.',
    };
  },
};

async function flagCounts(q, table, sourceId) {
  const rows = await q(
    `SELECT f AS flag, count(*)::bigint AS rows FROM ${table}, unnest(quality_flags) AS f WHERE source_id = $1 GROUP BY 1 ORDER BY 2 DESC`,
    [sourceId],
  );
  return Object.fromEntries(rows.map((r) => [r.flag, n(r.rows)]));
}

async function dailyWindows(q, table, sourceId, column, limit) {
  const rows = await q(
    `SELECT c.name, count(*)::bigint AS rows, min(observed_date) AS first, max(observed_date) AS last, count(DISTINCT observed_date)::int AS days
       FROM ${table} o JOIN commodities c ON c.id = o.${column} WHERE o.source_id = $1 GROUP BY c.name ORDER BY 2 DESC LIMIT ${limit}`,
    [sourceId],
  );
  return rows.map((r) => ({
    commodity: r.name,
    observations: n(r.rows),
    first: iso(r.first),
    last: iso(r.last),
    daysWithData: r.days,
  }));
}

async function dailyGaps(q, table, sourceId) {
  const rows = await q(
    `WITH d AS (SELECT DISTINCT observed_date AS d FROM ${table} WHERE source_id = $1),
          g AS (SELECT d, lead(d) OVER (ORDER BY d) AS nxt FROM d)
     SELECT (d + 1) AS gap_start, (nxt - 1) AS gap_end, (nxt - d - 1) AS days FROM g WHERE nxt - d > 1 ORDER BY days DESC, gap_start LIMIT 15`,
    [sourceId],
  );
  return {
    scope:
      'days with no observation at all in this dataset (all commodities together), longest first',
    longestGaps: rows.map((r) => ({ from: iso(r.gap_start), to: iso(r.gap_end), days: r.days })),
  };
}

async function referenceBlock(q, manifest) {
  const sets = await q(
    `SELECT s.code, s.description, (SELECT count(*)::int FROM states WHERE provenance_run_id IN (SELECT id FROM ingestion_runs WHERE source_id = s.id)) AS states,
            (SELECT count(*)::int FROM districts WHERE provenance_run_id IN (SELECT id FROM ingestion_runs WHERE source_id = s.id)) AS districts
       FROM data_sources s WHERE s.code LIKE 'lgd%' ORDER BY s.code`,
  );
  return {
    manifestSummary: manifest
      ? {
          referenceSet: manifest.referenceSet,
          status: manifest.status,
          referenceDate: manifest.referenceDate,
          licence: manifest.licence?.name,
          retrievedAt: manifest.retrievedAt,
          authority: manifest.authority,
        }
      : null,
    loadedSets: sets.map((r) => ({
      source: r.code,
      statesIntroduced: r.states,
      districtsIntroduced: r.districts,
    })),
    totals: (
      await q(
        `SELECT (SELECT count(*)::int FROM states) AS states, (SELECT count(*)::int FROM districts) AS districts`,
      )
    )[0],
    caution:
      'PROVISIONAL: a third-party mirror of LGD as of December 2022. It is not a verified current registry; post-2022 districts stay unresolved.',
  };
}

async function identityBlock(q, datasets) {
  const stateAliases = await q(
    `SELECT ds.code AS source, a.source_label, a.resolution_status, a.resolution_note, s.name AS resolved_to
       FROM state_aliases a JOIN data_sources ds ON ds.id = a.source_id LEFT JOIN states s ON s.id = a.state_id ORDER BY ds.code, a.source_label`,
  );
  // Count quarantined rows from each dataset's INITIAL load only (an idempotent re-run would repeat them).
  const initialRuns = Object.values(datasets).flatMap((d) =>
    d.initialLoad ? d.initialLoad.runIds.map((id) => ({ source: d.sourceCode, id })) : [],
  );
  const rejectedStates = initialRuns.length
    ? await q(
        `SELECT ds.code AS source, r.reason_detail AS detail, count(*)::int AS rows
           FROM ingestion_rejections r JOIN ingestion_runs ir ON ir.id = r.ingestion_run_id JOIN data_sources ds ON ds.id = ir.source_id
          WHERE r.ingestion_run_id = ANY($1::uuid[]) AND r.reason_code IN ('unmapped_entity', 'ambiguous_entity') AND r.reason_detail LIKE 'state=%'
          GROUP BY 1, 2 ORDER BY 3 DESC`,
        [initialRuns.map((r) => r.id)],
      )
    : [];
  const affected = new Map(
    rejectedStates.map((r) => [`${r.source}|${String(r.detail).replace(/^state=/, '')}`, r.rows]),
  );
  const states = stateAliases.map((r) => ({
    source: r.source,
    sourceLabel: r.source_label,
    status: r.resolution_status,
    resolvedTo: r.resolved_to,
    note: r.resolution_note,
    rowsQuarantined: affected.get(`${r.source}|${r.source_label}`) ?? 0,
    needsReview:
      r.resolution_status !== 'resolved' ||
      !String(r.resolution_note).startsWith('exact normalised match'),
  }));

  const districtCounts = await q(
    `SELECT resolution_status, count(*)::int AS n FROM district_aliases GROUP BY 1 ORDER BY 1`,
  );
  const districtList = await q(
    `SELECT ds.code AS source, a.source_context AS state_label, a.source_label AS district_label, a.resolution_status, a.resolution_note
       FROM district_aliases a JOIN data_sources ds ON ds.id = a.source_id WHERE a.resolution_status <> 'resolved' ORDER BY ds.code, a.source_context, a.source_label`,
  );
  const marketTotals = (
    await q(
      `SELECT count(*)::int AS markets, count(*) FILTER (WHERE status = 'unverified')::int AS unverified,
            count(*) FILTER (WHERE district_id IS NULL)::int AS district_unresolved FROM markets`,
    )
  )[0];
  const shared = await q(
    `SELECT m.normalized_name AS name, count(*)::int AS identities, array_agg(DISTINCT s.name ORDER BY s.name) AS states,
            array_agg(DISTINCT coalesce(d.name, m.disambiguator) ORDER BY coalesce(d.name, m.disambiguator)) AS places
       FROM markets m JOIN states s ON s.id = m.state_id LEFT JOIN districts d ON d.id = m.district_id
      GROUP BY m.normalized_name HAVING count(*) > 1 ORDER BY count(*) DESC, m.normalized_name LIMIT 100`,
  );
  const unresolvedMarkets = await q(
    `SELECT s.name AS state, m.name AS market, m.disambiguator FROM markets m JOIN states s ON s.id = m.state_id
      WHERE m.district_id IS NULL ORDER BY s.name, m.name LIMIT 2000`,
  );
  const commodityDuplicates = await q(
    `SELECT regexp_replace(lower(name), '[^a-z0-9]', '', 'g') AS key, array_agg(name ORDER BY name) AS labels
       FROM commodities GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`,
  );
  return {
    policy: [
      'A label resolves only by a reviewed decision or an exact case/whitespace-insensitive match. There is no fuzzy matching.',
      'Unresolved, ambiguous and rejected identities are never merged; their rows are quarantined (states) or kept with a source-label identity (districts, mandis).',
      'Districts resolve only inside their resolved state. Markets have no authoritative list: they are created from source labels as unverified.',
    ],
    states,
    statesNeedingReview: states.filter((s) => s.needsReview),
    districts: {
      statusCounts: Object.fromEntries(districtCounts.map((r) => [r.resolution_status, r.n])),
      unresolvedOrAmbiguous: districtList.map((r) => ({
        source: r.source,
        state: r.state_label,
        district: r.district_label,
        status: r.resolution_status,
      })),
      note: 'Districts absent from the December 2022 reference (created or renamed since) are unresolved. They are not invented.',
    },
    mandis: {
      totals: marketTotals,
      note: 'Every mandi is "unverified": there is no authoritative market list. Mandis whose district is unresolved carry the source district label as their identity.',
      namesSharedByDifferentIdentities: shared.map((r) => ({
        name: r.name,
        identities: r.identities,
        states: r.states,
        places: r.places,
      })),
      withUnresolvedDistrict: unresolvedMarkets.map((r) => ({
        state: r.state,
        market: r.market,
        identity: r.disambiguator,
      })),
    },
    commodities: {
      possibleDuplicateLabels: commodityDuplicates.map((r) => ({ key: r.key, labels: r.labels })),
      note: 'Commodities are created per exact label; these differ only by punctuation or spacing and are NOT merged.',
    },
    datasetsCovered: Object.keys(datasets),
  };
}

// ------------------------------------------------------------------------------------------ markdown

const fmt = (v) =>
  typeof v === 'number'
    ? v.toLocaleString('en-US')
    : v === null || v === undefined
      ? '-'
      : String(v);
const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(fmt).join(' | ')} |`),
  ].join('\n');

function qualityMarkdown(r) {
  const out = [
    `# Ingestion quality and coverage report`,
    '',
    `> Generated ${r.generatedAt}. ${r.notice}`,
    '',
    `> ${r.mandiLevelVersusStateLevel}`,
    '',
  ];
  const ref = r.reference;
  out.push('## Geographic reference (provisional)', '', ref.caution, '');
  if (ref.manifestSummary)
    out.push(
      `Reference set \`${ref.manifestSummary.referenceSet}\`, status **${ref.manifestSummary.status}**, reference date ${ref.manifestSummary.referenceDate}, licence ${ref.manifestSummary.licence}, retrieved ${ref.manifestSummary.retrievedAt}.`,
      '',
    );
  out.push(
    `Registry now holds ${fmt(ref.totals.states)} states/UTs and ${fmt(ref.totals.districts)} districts.`,
    '',
  );
  out.push('## Reconciliation of every input row', '');
  const rows = [];
  for (const d of Object.values(r.datasets)) {
    const c = d.initialLoad;
    rows.push([
      d.dataset,
      d.imported
        ? c
          ? `initial load (${c.runsInChain} run${c.runsInChain > 1 ? 's' : ''}), ${d.laterRuns} later idempotent re-run(s)`
          : 'no completed run'
        : 'not imported',
      c?.inputRows,
      c?.accepted,
      c?.exactDuplicatesSkipped,
      c?.conflictsRetained,
      c?.quarantined,
      c ? (c.reconciled ? 'yes' : 'NO') : '-',
    ]);
  }
  out.push(
    table(
      [
        'Dataset',
        'Status',
        'Input rows',
        'Accepted',
        'Exact duplicates skipped',
        'Conflicts retained',
        'Quarantined',
        'Reconciled',
      ],
      rows,
    ),
    '',
  );
  out.push(
    "Input rows = accepted + exact duplicates + conflicts + quarantined, for the initial load of each file (an interrupted run and its resume count as one load). Later runs of the same file are idempotent re-imports and appear in each dataset's run table. Dataset D counts one record per month cell.",
    '',
  );
  for (const d of Object.values(r.datasets)) {
    out.push(`## ${d.title}`, '', `Granularity: ${d.granularity}`, '');
    if (!d.imported) {
      out.push(d.note, '');
      continue;
    }
    if (d.loaded)
      out.push(
        '**Loaded**',
        '',
        table(
          ['Measure', 'Value'],
          Object.entries(d.loaded).map(([k, v]) => [k, v]),
        ),
        '',
      );
    if (d.quarantineByReason)
      out.push(
        '**Quarantined by reason**',
        '',
        table(['Reason', 'Rows'], Object.entries(d.quarantineByReason)),
        '',
      );
    if (d.topQuarantineDetails?.length)
      out.push(
        '**Most common quarantine details**',
        '',
        table(
          ['Reason', 'Detail', 'Rows'],
          d.topQuarantineDetails.map((x) => [x.reason, x.detail, x.rows]),
        ),
        '',
      );
    if (d.missingValues)
      out.push(
        '**Missing values**',
        '',
        table(
          ['Field', 'Count'],
          Object.entries(d.missingValues).map(([k, v]) => [k, v]),
        ),
        '',
      );
    if (d.quality)
      out.push(
        '**Quality flags**',
        '',
        `Flagged rows: ${fmt(d.quality.flagged)}. ` +
          (Object.keys(d.quality.flagCounts).length
            ? Object.entries(d.quality.flagCounts)
                .map(([k, v]) => `${k}: ${fmt(v)}`)
                .join(', ')
            : 'no flag counts.'),
        '',
      );
    if (d.unitMix)
      out.push(
        '**Unit mix**',
        '',
        table(
          ['Price unit', 'Arrival unit', 'Rows'],
          d.unitMix.map((u) => [u.priceUnit, u.arrivalUnit, u.rows]),
        ),
        '',
        d.unitNote,
        '',
      );
    if (d.unitBasis)
      out.push(
        `Unit basis: ${fmt(d.unitBasis.assumedFromDocumentation)} rows use an assumed unit, ${fmt(d.unitBasis.sourceStated)} a source-stated unit.`,
        '',
      );
    if (d.unitAssumptions?.length)
      out.push(
        '**Unit and source assumptions**',
        '',
        ...d.unitAssumptions.map((a) => `- \`${a.code}\`: ${a.statement} Evidence: ${a.evidence}.`),
        '',
      );
    if (d.perCommodityWindows)
      out.push(
        '**Per-commodity windows (top 25 by rows)**',
        '',
        table(
          ['Commodity', 'Observations', 'First', 'Last', 'Days with data'],
          d.perCommodityWindows.map((w) => [
            w.commodity,
            w.observations,
            w.first,
            w.last,
            w.daysWithData,
          ]),
        ),
        '',
      );
    if (d.coverageGaps?.longestGaps)
      out.push(
        '**Longest gaps (no observation on any commodity)**',
        '',
        table(
          ['From', 'To', 'Days'],
          d.coverageGaps.longestGaps.map((g) => [g.from, g.to, g.days]),
        ),
        '',
      );
    else if (Array.isArray(d.coverageGaps))
      out.push(
        `**Coverage gaps**: ${d.coverageGaps.length} series with missing months inside their range${d.coverageGaps.length ? ' (full list in the JSON report)' : ''}.`,
        '',
      );
    out.push('**Known source limitations**', '', ...d.limitations.map((l) => `- ${l}`), '');
    out.push(
      '**Runs**',
      '',
      table(
        [
          'Run',
          'Status',
          'Input',
          'Accepted',
          'Duplicates',
          'Conflicts',
          'Quarantined',
          'Resumed from',
        ],
        d.runs.map((x) => [
          x.runId.slice(0, 8),
          x.status,
          x.inputRows,
          x.accepted,
          x.exactDuplicatesSkipped,
          x.conflictsRetained,
          x.quarantined,
          x.resumedFromRunId ? x.resumedFromRunId.slice(0, 8) : '-',
        ]),
      ),
      '',
    );
  }
  return out.join('\n') + '\n';
}

function aliasMarkdown(r) {
  const out = [
    '# Alias-resolution report',
    '',
    `> Generated ${r.generatedAt}. Reference status: ${r.reference.manifestSummary?.status ?? 'unknown'} (${r.reference.manifestSummary?.referenceDate ?? 'n/a'}). ${r.reference.caution}`,
    '',
    '## Policy',
    '',
    ...r.policy.map((p) => `- ${p}`),
    '',
  ];
  out.push(
    '## States and union territories',
    '',
    `${r.statesNeedingReview.length} of ${r.states.length} state labels need your review (not an exact match, or not resolved).`,
    '',
  );
  out.push(
    table(
      ['Source', 'Source label', 'Status', 'Resolved to', 'Rows quarantined', 'Note'],
      r.statesNeedingReview.map((s) => [
        s.source,
        s.sourceLabel,
        s.status,
        s.resolvedTo ?? '-',
        s.rowsQuarantined,
        s.note,
      ]),
    ),
    '',
  );
  out.push(
    '## Districts',
    '',
    `Alias status counts: ${
      Object.entries(r.districts.statusCounts)
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(', ') || 'none'
    }.`,
    '',
    r.districts.note,
    '',
  );
  out.push(
    `${fmt(r.districts.unresolvedOrAmbiguous.length)} district labels are unresolved or ambiguous (first 60 shown; all are in the JSON report).`,
    '',
  );
  out.push(
    table(
      ['Source', 'State label', 'District label', 'Status'],
      r.districts.unresolvedOrAmbiguous
        .slice(0, 60)
        .map((d) => [d.source, d.state, d.district, d.status]),
    ),
    '',
  );
  out.push(
    '## Mandis',
    '',
    r.mandis.note,
    '',
    table(
      ['Measure', 'Value'],
      Object.entries(r.mandis.totals).map(([k, v]) => [k, v]),
    ),
    '',
  );
  out.push(
    `### Market names shared by different identities (${r.mandis.namesSharedByDifferentIdentities.length}; kept apart, never merged)`,
    '',
  );
  out.push(
    table(
      ['Name', 'Identities', 'States', 'Places'],
      r.mandis.namesSharedByDifferentIdentities
        .slice(0, 40)
        .map((m) => [m.name, m.identities, m.states.join(', '), m.places.join(', ')]),
    ),
    '',
  );
  out.push(
    `### Commodity labels that differ only by punctuation or spacing (${r.commodities.possibleDuplicateLabels.length}; NOT merged)`,
    '',
  );
  out.push(
    table(
      ['Key', 'Labels'],
      r.commodities.possibleDuplicateLabels.slice(0, 60).map((c) => [c.key, c.labels.join(' | ')]),
    ),
    '',
  );
  return out.join('\n') + '\n';
}
