import { createHash } from 'node:crypto';
import { rows } from './db.js';
import { encodeCursor, invalid, likeEscape } from './params.js';
import { day, num, stateMappingStatus } from './policy.js';

/**
 * Parameterized, read-only SQL for the historical market endpoints.
 *
 * Rules every query here follows:
 *  - values are always bound parameters; only fixed text is concatenated into SQL;
 *  - list queries use keyset (cursor) pagination with a total order that ends in the row id, so
 *    pages are stable and cost the same on page 1 and page 10,000;
 *  - one granularity per query: mandi, state, national and WPI rows are never joined or merged.
 *
 * @typedef {import('./db.js').Client} Client
 */

/** Small helper to build a WHERE clause with numbered parameters. */
function where() {
  /** @type {string[]} */
  const clauses = [];
  /** @type {unknown[]} */
  const values = [];
  return {
    values,
    /** @param {string} template text containing `?` where the value goes @param {unknown} value */
    add(template, value) {
      values.push(value);
      clauses.push(template.replace('?', `$${values.length}`));
    },
    /** @param {string} text */
    raw(text) {
      clauses.push(text);
    },
    sql: () => (clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''),
    next: () => `$${values.length + 1}`,
  };
}

/**
 * Splits a fetched page (limit + 1 rows) into the page and its pagination block.
 *
 * @template T
 * @param {T[]} fetched
 * @param {number} limit
 * @param {(row: T) => unknown[]} position
 */
function paginate(fetched, limit, position) {
  const hasMore = fetched.length > limit;
  const page = hasMore ? fetched.slice(0, limit) : fetched;
  return {
    page,
    pagination: {
      limit,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor(position(page[page.length - 1])) : null,
    },
  };
}

// ---------------------------------------------------------------------------------- geography

/**
 * @param {Client} c
 * @param {{ kind: string | null, q: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listStates(c, p) {
  const w = where();
  if (p.kind) w.add('s.kind = ?', p.kind);
  if (p.q) w.add("s.normalized_name LIKE ? ESCAPE '\\'", `%${likeEscape(p.q.toLowerCase())}%`);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    w.raw(`(s.name, s.id::text) > ($${w.values.length - 1}, $${w.values.length})`);
  }
  const fetched = await rows(
    c,
    `SELECT s.id, s.name, s.kind, s.lgd_code,
            COALESCE((SELECT json_agg(json_build_object(
                'source_code', ds.code, 'source_label', a.source_label,
                'resolution_status', a.resolution_status, 'note', a.resolution_note)
                ORDER BY ds.code, a.source_label)
              FROM state_aliases a JOIN data_sources ds ON ds.id = a.source_id
              WHERE a.state_id = s.id AND a.normalized_label <> s.normalized_name), '[]'::json) AS source_labels
       FROM states s ${w.sql()}
      ORDER BY s.name, s.id::text LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.name, r.id]);
  return {
    pagination,
    data: page.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      lgd_code: r.lgd_code,
      source_labels: r.source_labels.map((/** @type {any} */ a) => {
        const mapping = stateMappingStatus(a.source_label);
        return {
          source_code: a.source_code,
          source_label: a.source_label,
          resolution_status: a.resolution_status,
          mapping_basis: String(a.note ?? '').startsWith('reviewed decision')
            ? 'reviewed_decision'
            : 'exact_normalised_match',
          mapping_status: mapping.status,
          note: mapping.note ?? a.note,
        };
      }),
    })),
  };
}

/**
 * @param {Client} c
 * @param {{ state_id: string | null, q: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listDistricts(c, p) {
  const w = where();
  if (p.state_id) w.add('d.state_id = ?', p.state_id);
  if (p.q) w.add("d.normalized_name LIKE ? ESCAPE '\\'", `%${likeEscape(p.q.toLowerCase())}%`);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1], p.cursor[2]);
    const n = w.values.length;
    w.raw(`(s.name, d.name, d.id::text) > ($${n - 2}, $${n - 1}, $${n})`);
  }
  const fetched = await rows(
    c,
    `SELECT d.id, d.name, d.lgd_code, s.id AS state_id, s.name AS state_name
       FROM districts d JOIN states s ON s.id = d.state_id ${w.sql()}
      ORDER BY s.name, d.name, d.id::text LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.state_name, r.name, r.id]);
  return {
    pagination,
    data: page.map((r) => ({
      id: r.id,
      name: r.name,
      lgd_code: r.lgd_code,
      state: { id: r.state_id, name: r.state_name },
      reference_status: 'provisional-historical',
    })),
  };
}

/**
 * Labels the source could not map to a reference identity. Rows are never guessed into a district.
 *
 * @param {Client} c
 */
export async function unresolvedGeography(c) {
  const states = await rows(
    c,
    `SELECT ds.code AS source_code, a.source_label, a.resolution_note,
            (SELECT count(DISTINCT r.source_row_number)::int
               FROM ingestion_rejections r JOIN ingestion_runs ir ON ir.id = r.ingestion_run_id
              WHERE ir.source_id = a.source_id AND r.reason_code IN ('unmapped_entity', 'ambiguous_entity')
                AND r.reason_detail = 'state=' || a.source_label) AS rows_quarantined
       FROM state_aliases a JOIN data_sources ds ON ds.id = a.source_id
      WHERE a.resolution_status <> 'resolved' ORDER BY ds.code, a.source_label`,
  );
  const districts = await rows(
    c,
    `SELECT o.source_state_label AS state_label, o.source_district_label AS district_label,
            count(*)::int AS observations, count(DISTINCT o.market_id)::int AS markets
       FROM mandi_observations o
      WHERE o.market_id IN (SELECT id FROM markets WHERE district_id IS NULL)
      GROUP BY 1, 2 ORDER BY 3 DESC, 1, 2`,
  );
  return {
    states: states.map((r) => ({
      source_code: r.source_code,
      source_label: r.source_label,
      status: 'unresolved',
      rows_quarantined: r.rows_quarantined,
      note: r.resolution_note,
    })),
    districts: districts.map((r) => ({
      source_state_label: r.state_label,
      source_district_label: r.district_label,
      status: 'unresolved',
      observations: r.observations,
      markets: r.markets,
    })),
  };
}

// --------------------------------------------------------------------------------- commodities

/**
 * Observed coverage per commodity and granularity (cached by the caller: the data is historical).
 *
 * @param {Client} c
 */
export async function commodityCoverage(c) {
  // Sequential on purpose: one connection runs one statement at a time.
  const mandi = await rows(
    c,
    `SELECT commodity_id, count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last
       FROM mandi_observations GROUP BY 1`,
  );
  const state = await rows(
    c,
    `SELECT commodity_id, count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last
       FROM state_observations GROUP BY 1`,
  );
  const national = await rows(
    c,
    `SELECT commodity_id, count(*)::int AS n, min(period_month)::text AS first, max(period_month)::text AS last
       FROM national_monthly_prices GROUP BY 1`,
  );
  /** @type {Map<string, any>} */
  const map = new Map();
  /** @param {any[]} list @param {string} key */
  const fill = (list, key) => {
    for (const r of list) {
      const entry = map.get(r.commodity_id) ?? {};
      entry[key] = { observations: r.n, first_date: r.first, last_date: r.last };
      map.set(r.commodity_id, entry);
    }
  };
  fill(mandi, 'mandi_daily');
  fill(state, 'state_daily');
  fill(national, 'national_monthly');
  return map;
}

const EMPTY_COVERAGE = { observations: 0, first_date: null, last_date: null };

/**
 * @param {any} r commodity row
 * @param {Map<string, any>} coverage
 */
function commodityView(r, coverage) {
  const cov = coverage.get(r.id) ?? {};
  return {
    id: r.id,
    name: r.name,
    commodity_group: r.commodity_group,
    coverage: {
      mandi_daily: cov.mandi_daily ?? EMPTY_COVERAGE,
      state_daily: cov.state_daily ?? EMPTY_COVERAGE,
      national_monthly: cov.national_monthly ?? EMPTY_COVERAGE,
    },
  };
}

/**
 * @param {Client} c
 * @param {{ q: string | null, group: string | null, limit: number, cursor: string[] | null }} p
 * @param {Map<string, any>} coverage
 */
export async function listCommodities(c, p, coverage) {
  const w = where();
  if (p.q) w.add("c.normalized_name LIKE ? ESCAPE '\\'", `%${likeEscape(p.q.toLowerCase())}%`);
  if (p.group) w.add('c.commodity_group = ?', p.group);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    w.raw(`(c.name, c.id::text) > ($${w.values.length - 1}, $${w.values.length})`);
  }
  const fetched = await rows(
    c,
    `SELECT c.id, c.name, c.commodity_group FROM commodities c ${w.sql()}
      ORDER BY c.name, c.id::text LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.name, r.id]);
  return { pagination, data: page.map((r) => commodityView(r, coverage)) };
}

/**
 * @param {Client} c
 * @param {string} id
 * @param {Map<string, any>} coverage
 */
export async function getCommodity(c, id, coverage) {
  const [r] = await rows(c, `SELECT id, name, commodity_group FROM commodities WHERE id = $1`, [
    id,
  ]);
  if (!r) return null;
  const varieties = await rows(
    c,
    `SELECT id, name FROM varieties WHERE commodity_id = $1 ORDER BY name, id::text`,
    [id],
  );
  return { ...commodityView(r, coverage), varieties };
}

// -------------------------------------------------------------------------------------- markets

/**
 * @param {any} r
 * @returns {{ source_district_label: string | null, district_status: 'resolved' | 'unresolved' }}
 */
function districtView(r) {
  const label =
    typeof r.disambiguator === 'string' && r.disambiguator.startsWith('src-district:')
      ? r.disambiguator.slice('src-district:'.length)
      : null;
  return {
    source_district_label: label,
    district_status: r.district_id ? 'resolved' : 'unresolved',
  };
}

/** @param {any} r */
function marketView(r) {
  const d = districtView(r);
  return {
    id: r.id,
    name: r.name,
    state: { id: r.state_id, name: r.state_name },
    district: r.district_id ? { id: r.district_id, name: r.district_name } : null,
    district_status: d.district_status,
    source_district_label: d.source_district_label,
    verification_status: r.status,
    government_market_code: r.government_market_code,
    classification: r.classification,
  };
}

const MARKET_SELECT = `SELECT m.id, m.name, m.disambiguator, m.status, m.government_market_code, m.classification,
            m.state_id, s.name AS state_name, m.district_id, d.name AS district_name
       FROM markets m JOIN states s ON s.id = m.state_id LEFT JOIN districts d ON d.id = m.district_id`;

/**
 * @param {Client} c
 * @param {{ state_id: string | null, district_id: string | null, district_status: string | null, verification_status: string | null, q: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listMarkets(c, p) {
  const w = where();
  if (p.state_id) w.add('m.state_id = ?', p.state_id);
  if (p.district_id) w.add('m.district_id = ?', p.district_id);
  if (p.district_status === 'resolved') w.raw('m.district_id IS NOT NULL');
  if (p.district_status === 'unresolved') w.raw('m.district_id IS NULL');
  if (p.verification_status) w.add('m.status = ?', p.verification_status);
  if (p.q) w.add("m.normalized_name LIKE ? ESCAPE '\\'", `%${likeEscape(p.q.toLowerCase())}%`);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1], p.cursor[2]);
    const n = w.values.length;
    w.raw(`(s.name, m.name, m.id::text) > ($${n - 2}, $${n - 1}, $${n})`);
  }
  const fetched = await rows(
    c,
    `${MARKET_SELECT} ${w.sql()} ORDER BY s.name, m.name, m.id::text LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.state_name, r.name, r.id]);
  return { pagination, data: page.map(marketView) };
}

/**
 * @param {Client} c
 * @param {string} id
 */
export async function getMarket(c, id) {
  const [r] = await rows(c, `${MARKET_SELECT} WHERE m.id = $1`, [id]);
  if (!r) return null;
  const [cov] = await rows(
    c,
    `SELECT count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last,
            count(DISTINCT commodity_id)::int AS commodities
       FROM mandi_observations WHERE market_id = $1`,
    [id],
  );
  return {
    ...marketView(r),
    coverage: {
      mandi_daily: {
        observations: cov.n,
        first_date: cov.first,
        last_date: cov.last,
        commodities: cov.commodities,
      },
    },
  };
}

// -------------------------------------------------------------------------- observation tables

const PROVENANCE = `src.code AS source_code, o.source_file_id, o.ingestion_run_id, o.source_row_number,
            o.is_historical_snapshot, o.is_synthetic, o.quality_status, o.quality_flags`;

/** @param {any} r */
function provenance(r) {
  return {
    source_code: r.source_code,
    source_file_id: r.source_file_id,
    ingestion_run_id: r.ingestion_run_id,
    source_row_number: num(r.source_row_number),
    is_historical_snapshot: r.is_historical_snapshot,
    is_synthetic: r.is_synthetic,
    quality_status: r.quality_status,
    quality_flags: r.quality_flags ?? [],
  };
}

/**
 * Mandi-level daily prices. Only mandi rows: a missing mandi price is never filled from state or
 * national data.
 *
 * @param {Client} c
 * @param {{ market_id: string | null, commodity_id: string | null, state_id: string | null, from: string, to: string, limit: number, cursor: string[] | null }} p
 */
export async function listMandiPrices(c, p) {
  const w = where();
  w.add('o.observed_date >= ?::date', p.from);
  w.add('o.observed_date <= ?::date', p.to);
  if (p.market_id) w.add('o.market_id = ?', p.market_id);
  if (p.commodity_id) w.add('o.commodity_id = ?', p.commodity_id);
  if (p.state_id) w.add('m.state_id = ?', p.state_id);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    const n = w.values.length;
    w.raw(`(o.observed_date, o.id) > ($${n - 1}::date, $${n}::uuid)`);
  }
  const fetched = await rows(
    c,
    `SELECT o.id, o.observed_date::text AS observed_date, o.market_id, m.name AS market_name,
            m.status AS market_status, m.district_id, m.disambiguator, m.state_id, s.name AS state_name,
            d.name AS district_name, o.commodity_id, cm.name AS commodity_name,
            o.variety_id, o.variety_label, o.grade,
            o.min_price, o.max_price, o.modal_price, o.price_currency, o.price_unit,
            o.source_price_unit_label, o.unit_basis,
            o.source_state_label, o.source_district_label, o.source_market_label, o.source_commodity_label,
            ${PROVENANCE}
       FROM mandi_observations o
       JOIN markets m ON m.id = o.market_id
       JOIN states s ON s.id = m.state_id
       LEFT JOIN districts d ON d.id = m.district_id
       JOIN commodities cm ON cm.id = o.commodity_id
       JOIN data_sources src ON src.id = o.source_id
       ${w.sql()}
      ORDER BY o.observed_date, o.id LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.observed_date, r.id]);
  return { pagination, data: page.map(mandiView) };
}

/**
 * The public shape of one mandi observation (shared by /mandi-prices and /mandi-prices/latest).
 *
 * @param {any} r a row from the mandi SELECT
 */
function mandiView(r) {
  return {
    id: r.id,
    granularity: 'mandi_daily',
    observed_date: r.observed_date,
    market: {
      id: r.market_id,
      name: r.market_name,
      verification_status: r.market_status,
      district_status: r.district_id ? 'resolved' : 'unresolved',
    },
    state: { id: r.state_id, name: r.state_name, ...mappingOf(r.source_state_label) },
    district: r.district_id ? { id: r.district_id, name: r.district_name } : null,
    commodity: { id: r.commodity_id, name: r.commodity_name },
    variety:
      r.variety_label === null && r.variety_id === null
        ? null
        : { id: r.variety_id, label: r.variety_label },
    grade: r.grade,
    min_price: num(r.min_price),
    max_price: num(r.max_price),
    modal_price: num(r.modal_price),
    price_currency: r.price_currency,
    price_unit: r.price_unit,
    source_price_unit_label: r.source_price_unit_label,
    unit_basis: r.unit_basis,
    source_labels: {
      state: r.source_state_label,
      district: r.source_district_label,
      market: r.source_market_label,
      commodity: r.source_commodity_label,
    },
    provenance: provenance(r),
  };
}

/** @param {string | null} label */
function mappingOf(label) {
  const m = stateMappingStatus(label);
  return { mapping_status: m.status, ...(m.note ? { mapping_note: m.note } : {}) };
}

/**
 * State-level daily prices and arrivals. No market or district exists at this granularity.
 *
 * @param {Client} c
 * @param {{ state_id: string | null, commodity_id: string | null, from: string, to: string, limit: number, cursor: string[] | null }} p
 */
export async function listStatePrices(c, p) {
  const w = where();
  w.add('o.observed_date >= ?::date', p.from);
  w.add('o.observed_date <= ?::date', p.to);
  if (p.state_id) w.add('o.state_id = ?', p.state_id);
  if (p.commodity_id) w.add('o.commodity_id = ?', p.commodity_id);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    const n = w.values.length;
    w.raw(`(o.observed_date, o.id) > ($${n - 1}::date, $${n}::uuid)`);
  }
  const fetched = await rows(
    c,
    `SELECT o.id, o.observed_date::text AS observed_date, o.state_id, s.name AS state_name,
            o.commodity_id, cm.name AS commodity_name,
            o.modal_price, o.min_price, o.max_price, o.price_currency, o.price_unit,
            o.source_price_unit_label, o.arrival_quantity, o.arrival_unit, o.source_arrival_unit_label,
            au.dimension AS arrival_dimension, pu.dimension AS price_dimension, o.unit_basis,
            o.source_state_label, o.source_commodity_label, o.source_commodity_group_label,
            o.source_report_label, ${PROVENANCE}
       FROM state_observations o
       JOIN states s ON s.id = o.state_id
       JOIN commodities cm ON cm.id = o.commodity_id
       JOIN data_sources src ON src.id = o.source_id
       LEFT JOIN measurement_units au ON au.code = o.arrival_unit
       LEFT JOIN measurement_units pu ON pu.code = o.price_unit
       ${w.sql()}
      ORDER BY o.observed_date, o.id LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.observed_date, r.id]);
  return {
    pagination,
    data: page.map((r) => ({
      id: r.id,
      granularity: 'state_daily',
      observed_date: r.observed_date,
      state: { id: r.state_id, name: r.state_name, ...mappingOf(r.source_state_label) },
      commodity: { id: r.commodity_id, name: r.commodity_name },
      modal_price: num(r.modal_price),
      price_currency: r.price_currency,
      price_unit: r.price_unit,
      price_unit_dimension: r.price_dimension ?? null,
      source_price_unit_label: r.source_price_unit_label,
      arrival_quantity: num(r.arrival_quantity),
      arrival_unit: r.arrival_unit,
      arrival_unit_dimension: r.arrival_dimension ?? null,
      source_arrival_unit_label: r.source_arrival_unit_label,
      unit_basis: r.unit_basis,
      source_labels: {
        state: r.source_state_label,
        commodity: r.source_commodity_label,
        commodity_group: r.source_commodity_group_label,
        report: r.source_report_label,
      },
      provenance: provenance(r),
    })),
  };
}

/**
 * National monthly average prices (India, all commodities in the source file).
 *
 * @param {Client} c
 * @param {{ commodity_id: string | null, from: string | null, to: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listNationalPrices(c, p) {
  const w = where();
  if (p.commodity_id) w.add('o.commodity_id = ?', p.commodity_id);
  if (p.from) w.add('o.period_month >= ?::date', p.from);
  if (p.to) w.add('o.period_month <= ?::date', p.to);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1], p.cursor[2]);
    const n = w.values.length;
    w.raw(`(cm.name, o.period_month, o.id) > ($${n - 2}, $${n - 1}::date, $${n}::uuid)`);
  }
  const fetched = await rows(
    c,
    `SELECT o.id, o.period_month::text AS period_month, o.country_code, o.commodity_id, cm.name AS commodity_name,
            o.avg_min_price, o.avg_max_price, o.avg_modal_price, o.price_currency, o.price_unit,
            o.source_price_unit_label, o.unit_basis, o.source_reported_change, o.source_calculation_type,
            o.source_commodity_label, ${PROVENANCE}
       FROM national_monthly_prices o
       JOIN commodities cm ON cm.id = o.commodity_id
       JOIN data_sources src ON src.id = o.source_id
       ${w.sql()}
      ORDER BY cm.name, o.period_month, o.id LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [
    r.commodity_name,
    r.period_month,
    r.id,
  ]);
  return {
    pagination,
    data: page.map((r) => ({
      id: r.id,
      granularity: 'national_monthly',
      period_month: r.period_month,
      country_code: r.country_code,
      commodity: { id: r.commodity_id, name: r.commodity_name },
      avg_min_price: num(r.avg_min_price),
      avg_max_price: num(r.avg_max_price),
      avg_modal_price: num(r.avg_modal_price),
      price_currency: r.price_currency,
      price_unit: r.price_unit,
      source_price_unit_label: r.source_price_unit_label,
      unit_basis: r.unit_basis,
      source_reported_change: num(r.source_reported_change),
      source_reported_change_status: 'unconfirmed_not_for_modelling',
      source_calculation_type: r.source_calculation_type,
      source_labels: { commodity: r.source_commodity_label },
      provenance: provenance(r),
    })),
  };
}

/**
 * @param {Client} c
 * @param {{ q: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listWpiSeries(c, p) {
  const w = where();
  if (p.q) w.add("ws.normalized_label LIKE ? ESCAPE '\\'", `%${likeEscape(p.q.toLowerCase())}%`);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    w.raw(`(ws.item_label, ws.id::text) > ($${w.values.length - 1}, $${w.values.length})`);
  }
  const fetched = await rows(
    c,
    `SELECT ws.id, ws.item_label, ws.commodity_id, ws.base_description,
            (SELECT min(period_month)::text FROM wpi_observations x WHERE x.series_id = ws.id) AS first_month,
            (SELECT max(period_month)::text FROM wpi_observations x WHERE x.series_id = ws.id) AS last_month,
            (SELECT count(*)::int FROM wpi_observations x WHERE x.series_id = ws.id) AS observations
       FROM wpi_series ws ${w.sql()} ORDER BY ws.item_label, ws.id::text LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.item_label, r.id]);
  return {
    pagination,
    data: page.map((r) => ({
      id: r.id,
      item_label: r.item_label,
      commodity_id: r.commodity_id,
      base_description: r.base_description,
      value_kind: 'index',
      first_month: r.first_month,
      last_month: r.last_month,
      observations: r.observations,
    })),
  };
}

/**
 * @param {Client} c
 * @param {{ series_id: string, from: string | null, to: string | null, limit: number, cursor: string[] | null }} p
 */
export async function listWpiObservations(c, p) {
  const [series] = await rows(c, `SELECT id, item_label FROM wpi_series WHERE id = $1`, [
    p.series_id,
  ]);
  if (!series) return null;
  const w = where();
  w.add('o.series_id = ?', p.series_id);
  if (p.from) w.add('o.period_month >= ?::date', p.from);
  if (p.to) w.add('o.period_month <= ?::date', p.to);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    const n = w.values.length;
    w.raw(`(o.period_month, o.id) > ($${n - 1}::date, $${n}::uuid)`);
  }
  const fetched = await rows(
    c,
    `SELECT o.id, o.period_month::text AS period_month, o.index_value, ${PROVENANCE}
       FROM wpi_observations o JOIN data_sources src ON src.id = o.source_id
       ${w.sql()} ORDER BY o.period_month, o.id LIMIT ${w.next()}`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [r.period_month, r.id]);
  return {
    series: { id: series.id, item_label: series.item_label },
    pagination,
    data: page.map((r) => ({
      id: r.id,
      granularity: 'wpi_monthly_index',
      period_month: r.period_month,
      index_value: num(r.index_value),
      value_kind: 'index',
      provenance: provenance(r),
    })),
  };
}

// ------------------------------------------------------------------- provenance and coverage

/**
 * Sources, the files loaded from them, the load counters of their first completed load, assumptions
 * and the observed date range of what they contributed.
 *
 * @param {Client} c
 */
export async function sourcesOverview(c) {
  const sources = await rows(
    c,
    `SELECT id, code, name, source_type, publisher, description FROM data_sources ORDER BY code`,
  );
  const files = await rows(
    c,
    `SELECT id, source_id, file_name, file_sha256, size_bytes, registered_at FROM source_files ORDER BY registered_at`,
  );
  const runs = await rows(
    c,
    `SELECT id, source_id, source_file_id, status, importer_name, importer_version,
            started_at, finished_at, rows_read, rows_loaded, rows_exact_duplicate, rows_conflicting, rows_rejected
       FROM ingestion_runs ORDER BY started_at, id`,
  );
  const assumptions = await rows(
    c,
    `SELECT source_id, assumption_code, statement, evidence_reference FROM source_assumptions ORDER BY assumption_code`,
  );
  const ranges = await rows(
    c,
    `SELECT s.code, 'mandi_daily' AS granularity, count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last FROM mandi_observations o JOIN data_sources s ON s.id = o.source_id GROUP BY 1
     UNION ALL SELECT s.code, 'state_daily', count(*)::int, min(observed_date)::text, max(observed_date)::text FROM state_observations o JOIN data_sources s ON s.id = o.source_id GROUP BY 1
     UNION ALL SELECT s.code, 'national_monthly', count(*)::int, min(period_month)::text, max(period_month)::text FROM national_monthly_prices o JOIN data_sources s ON s.id = o.source_id GROUP BY 1
     UNION ALL SELECT s.code, 'wpi_monthly_index', count(*)::int, min(period_month)::text, max(period_month)::text FROM wpi_observations o JOIN data_sources s ON s.id = o.source_id GROUP BY 1`,
  );
  const done = (/** @type {any} */ r) =>
    r.status === 'succeeded' || r.status === 'succeeded_with_rejections';
  return sources.map((s) => {
    const srcRuns = runs.filter((r) => r.source_id === s.id);
    const firstDone = srcRuns.find(done);
    // Initial load = every run up to and including the first completed one (an interrupted
    // attempt and its resume count as one load); later runs are idempotent re-imports.
    const chain = firstDone
      ? srcRuns.filter((r) => r.finished_at !== null && r.finished_at <= firstDone.finished_at)
      : [];
    const sum = (/** @type {string} */ f) => chain.reduce((a, r) => a + Number(r[f]), 0);
    const last = [...srcRuns].reverse().find(done);
    const range = ranges.find((x) => x.code === s.code);
    return {
      code: s.code,
      name: s.name,
      source_type: s.source_type,
      publisher: s.publisher,
      description: s.description,
      granularity: range?.granularity ?? null,
      files: files
        .filter((f) => f.source_id === s.id)
        .map((f) => ({
          id: f.id,
          file_name: f.file_name,
          sha256: f.file_sha256,
          size_bytes: num(f.size_bytes),
          registered_at: f.registered_at,
        })),
      initial_load: firstDone
        ? {
            importer_version: firstDone.importer_version,
            finished_at: firstDone.finished_at,
            rows_read: sum('rows_read'),
            accepted: sum('rows_loaded'),
            exact_duplicates: sum('rows_exact_duplicate'),
            conflicts: sum('rows_conflicting'),
            quarantined: sum('rows_rejected'),
          }
        : null,
      runs_total: srcRuns.length,
      last_completed_run_at: last?.finished_at ?? null,
      observations: range
        ? { count: range.n, first_date: range.first, last_date: range.last }
        : null,
      assumptions: assumptions
        .filter((a) => a.source_id === s.id)
        .map((a) => ({
          code: a.assumption_code,
          statement: a.statement,
          evidence_reference: a.evidence_reference,
        })),
    };
  });
}

/**
 * Whole-database coverage summary (cached by the caller).
 *
 * @param {Client} c
 */
export async function coverageSummary(c) {
  const [mandi] = await rows(
    c,
    `SELECT count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last,
            count(DISTINCT market_id)::int AS markets, count(DISTINCT commodity_id)::int AS commodities FROM mandi_observations`,
  );
  const [state] = await rows(
    c,
    `SELECT count(*)::int AS n, min(observed_date)::text AS first, max(observed_date)::text AS last,
            count(DISTINCT state_id)::int AS states, count(DISTINCT commodity_id)::int AS commodities FROM state_observations`,
  );
  const [national] = await rows(
    c,
    `SELECT count(*)::int AS n, min(period_month)::text AS first, max(period_month)::text AS last,
            count(DISTINCT commodity_id)::int AS commodities FROM national_monthly_prices`,
  );
  const [wpi] = await rows(
    c,
    `SELECT count(*)::int AS n, min(period_month)::text AS first, max(period_month)::text AS last,
            count(DISTINCT series_id)::int AS series FROM wpi_observations`,
  );
  const [reg] = await rows(
    c,
    `SELECT (SELECT count(*)::int FROM states) AS states, (SELECT count(*)::int FROM districts) AS districts,
            (SELECT count(*)::int FROM markets) AS markets,
            (SELECT count(*)::int FROM markets WHERE status = 'unverified') AS markets_unverified,
            (SELECT count(*)::int FROM markets WHERE district_id IS NULL) AS markets_unresolved_district,
            (SELECT count(*)::int FROM district_aliases WHERE resolution_status <> 'resolved') AS unresolved_district_labels,
            (SELECT count(*)::int FROM state_aliases WHERE resolution_status <> 'resolved') AS unresolved_state_labels,
            (SELECT count(*)::int FROM commodities) AS commodities,
            (SELECT count(*)::int FROM varieties) AS varieties,
            (SELECT count(DISTINCT state_id)::int FROM markets) AS mandi_states`,
  );
  const [affected] = await rows(
    c,
    `SELECT count(*)::int AS n FROM mandi_observations
      WHERE market_id IN (SELECT id FROM markets WHERE district_id IS NULL)`,
  );
  const units = await rows(
    c,
    `SELECT code, label, dimension, kg_per_unit FROM measurement_units ORDER BY code`,
  );
  return {
    granularities: {
      mandi_daily: {
        observations: mandi.n,
        first_date: mandi.first,
        last_date: mandi.last,
        markets: mandi.markets,
        states: reg.mandi_states,
        commodities: mandi.commodities,
      },
      state_daily: {
        observations: state.n,
        first_date: state.first,
        last_date: state.last,
        states: state.states,
        commodities: state.commodities,
      },
      national_monthly: {
        observations: national.n,
        first_month: national.first,
        last_month: national.last,
        commodities: national.commodities,
      },
      wpi_monthly_index: {
        observations: wpi.n,
        first_month: wpi.first,
        last_month: wpi.last,
        series: wpi.series,
      },
    },
    registry: {
      states: reg.states,
      districts: reg.districts,
      markets: reg.markets,
      commodities: reg.commodities,
      varieties: reg.varieties,
    },
    geography: {
      markets_unverified: reg.markets_unverified,
      markets_with_unresolved_district: reg.markets_unresolved_district,
      mandi_observations_in_unresolved_district_markets: affected.n,
      unresolved_district_labels: reg.unresolved_district_labels,
      unresolved_state_labels: reg.unresolved_state_labels,
    },
    units: units.map((u) => ({
      code: u.code,
      label: u.label,
      dimension: u.dimension,
      kg_per_unit: num(u.kg_per_unit),
    })),
  };
}

export { day };

/**
 * The latest available observation of ONE commodity in each mandi, using each mandi's own latest date.
 *
 * Strategy: page over MARKETS in a total order (name, id) with keyset pagination, and for each market
 * take its newest observation of the commodity through a LATERAL index probe on
 * mandi_obs_history_idx (market_id, commodity_id, observed_date). A market with no observation of the
 * commodity drops out of the CROSS JOIN, so nothing is invented for it, and state-level data is never
 * consulted. One page costs at most limit + 1 probes; the full result set is never materialised.
 *
 * Several rows can share a mandi's latest date (varieties, grades). The one returned is chosen by a
 * price-neutral, deterministic rule: variety label then grade, alphabetically (missing last), then
 * id. `observations_on_latest_date` tells the client how many rows that date has.
 *
 * @param {Client} c
 * @param {{ commodity_id: string, state_id: string | null, district_id: string | null, limit: number, cursor: string[] | null }} p
 */
/**
 * Fingerprint of the filters a latest-observation cursor belongs to. The cursor carries it, so a cursor
 * can only be continued with exactly the commodity, state and district it was issued for.
 *
 * @param {{ commodity_id: string, state_id?: string | null, district_id?: string | null }} p
 */
const latestScope = (p) =>
  createHash('sha256')
    .update(JSON.stringify([p.commodity_id, p.state_id ?? null, p.district_id ?? null]))
    .digest('hex')
    .slice(0, 16);

export async function listLatestMandiPrices(c, p) {
  const scope = latestScope(p);
  if (p.cursor && (p.cursor.length !== 3 || p.cursor[2] !== scope)) {
    throw invalid(
      '"cursor" was issued for a different commodity, state or district. Start again without a cursor when the filters change.',
    );
  }
  const w = where();
  // $1 is the commodity (used by the lateral probe and the commodity join); filters follow as $2...
  w.values.push(p.commodity_id);
  if (p.state_id) w.add('m.state_id = ?', p.state_id);
  if (p.district_id) w.add('m.district_id = ?', p.district_id);
  if (p.cursor) {
    w.values.push(p.cursor[0], p.cursor[1]);
    const n = w.values.length;
    w.raw(`(m.name, m.id) > ($${n - 1}, $${n}::uuid)`);
  }
  // Step 1 picks the PAGE of markets (a total order, keyset cursor) among those that have at least one
  // observation of the commodity (one index probe each). Step 2 then probes the newest observation of
  // only those markets, so the work is bounded by the page size, not by the number of mandis.
  const fetched = await rows(
    c,
    `WITH page AS MATERIALIZED (
       SELECT m.id, m.name, m.state_id, m.district_id, m.status, m.disambiguator
         FROM markets m
        WHERE EXISTS (SELECT 1 FROM mandi_observations e
                       WHERE e.market_id = m.id AND e.commodity_id = $1::uuid)
          ${w.sql().replace(/^WHERE/, 'AND')}
        ORDER BY m.name, m.id LIMIT ${w.next()}
     )
     SELECT o.id, o.observed_date::text AS observed_date, o.market_id, m.name AS market_name,
            m.status AS market_status, m.district_id, m.disambiguator, m.state_id, s.name AS state_name,
            d.name AS district_name, o.commodity_id, cm.name AS commodity_name,
            o.variety_id, o.variety_label, o.grade,
            o.min_price, o.max_price, o.modal_price, o.price_currency, o.price_unit,
            o.source_price_unit_label, o.unit_basis,
            o.source_state_label, o.source_district_label, o.source_market_label, o.source_commodity_label,
            ${PROVENANCE},
            (SELECT count(*)::int FROM mandi_observations x
              WHERE x.market_id = o.market_id AND x.commodity_id = o.commodity_id
                AND x.observed_date = o.observed_date) AS observations_on_latest_date
       FROM page m
       JOIN states s ON s.id = m.state_id
       LEFT JOIN districts d ON d.id = m.district_id
       JOIN commodities cm ON cm.id = $1::uuid
       CROSS JOIN LATERAL (
              SELECT x.* FROM mandi_observations x
               WHERE x.market_id = m.id AND x.commodity_id = $1::uuid
               ORDER BY x.observed_date DESC, x.variety_label ASC NULLS LAST, x.grade ASC NULLS LAST, x.id ASC
               LIMIT 1) o
       JOIN data_sources src ON src.id = o.source_id
      ORDER BY m.name, m.id`,
    [...w.values, p.limit + 1],
  );
  const { page, pagination } = paginate(fetched, p.limit, (r) => [
    r.market_name,
    r.market_id,
    scope,
  ]);

  // The newest observation date in the same scope (commodity, state, district). The client uses it
  // as the reference date for "N days before the reference date"; it is a property of the data, not
  // of the request.
  const ref = where();
  ref.add('o.commodity_id = ?', p.commodity_id);
  if (p.state_id) ref.add('m.state_id = ?', p.state_id);
  if (p.district_id) ref.add('m.district_id = ?', p.district_id);
  // Without a geographic filter the markets table is not needed, so the commodity index alone answers it.
  const join = p.state_id || p.district_id ? 'JOIN markets m ON m.id = o.market_id' : '';
  const [reference] = await rows(
    c,
    `SELECT max(o.observed_date)::text AS reference_date FROM mandi_observations o ${join} ${ref.sql()}`,
    ref.values,
  );
  return {
    pagination,
    referenceDate: reference?.reference_date ?? null,
    data: page.map((r) => ({
      ...mandiView(r),
      latest_observation_date: r.observed_date,
      observations_on_latest_date: r.observations_on_latest_date,
    })),
  };
}
