import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  LatestObservationCard,
  MandiObservationCard,
  StateObservationCard,
} from '../../components/market/historical';
import { createApiClient } from '../../services/api/client';
import { describePrice } from '../../services/agri/format';
import {
  buildPath,
  checkLatestMeta,
  checkObservationRows,
  historical,
  parseEnvelope,
} from '../../services/agri/historical';

/**
 * Frontend/API CONTRACT tests. They read sanitized, versioned CAPTURES of real API responses from
 * ./v1 (see ./README.md) and check the frontend's understanding of the contract: envelope,
 * historical-only enforcement, pagination, empty results, original units, provenance, geographic
 * uncertainty, mandi versus state granularity, and unexpected or missing fields.
 *
 * Nothing here is synthetic and nothing needs the API or the database. The synthetic unit-test
 * fixtures live in ../historicalFixtures.js and are deliberately kept apart.
 */

const files = /** @type {Record<string, any>} */ (
  import.meta.glob('./v1/*.json', { eager: true, import: 'default' })
);
const byName = (/** @type {string} */ name) => {
  const doc = files[`./v1/${name}.json`];
  if (!doc) throw new Error(`missing contract example ${name}`);
  return doc;
};
const clone = (/** @type {any} */ value) => JSON.parse(JSON.stringify(value));

/** A client that answers every request with the captured response. */
function clientFor(/** @type {any} */ example) {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify(example.response), {
        status: example.status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  return {
    client: createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetchImpl }),
    fetchImpl,
  };
}

const examples = Object.entries(files)
  .filter(([path]) => !path.endsWith('manifest.json'))
  .map(([path, doc]) => [path.replace('./v1/', '').replace('.json', ''), doc]);

describe('captured contract examples (v1)', () => {
  it('are versioned, labelled as real captures, and listed in the manifest', () => {
    const manifest = byName('manifest');
    expect(manifest.contract_version).toBe('v1');
    expect(manifest.files.map((f) => f.file).sort()).toEqual(
      examples.map(([name]) => `${name}.json`).sort(),
    );
    for (const [name, doc] of examples) {
      expect(doc.contract_version, name).toBe('v1');
      expect(doc.about, name).toMatch(/REAL response captured/);
      expect(doc.request, name).toMatch(/^GET \/api\/v1\//);
      expect(Number.isNaN(Date.parse(doc.captured_at)), name).toBe(false);
    }
  });

  it('contain no credentials, hosts or personal data', () => {
    const text = JSON.stringify(examples);
    expect(text).not.toMatch(
      /postgres(ql)?:\/\/|password|secret|token|api[_-]?key|localhost|127\.0\.0\.1/i,
    );
  });
});

describe('API envelope and historical-only enforcement', () => {
  // Paginated lists carry `pagination`; /sources returns a plain, unpaginated array of sources.
  const lists = examples.filter(([, doc]) => doc.status === 200 && 'pagination' in doc.response);
  const objects = examples.filter(
    ([, doc]) => doc.status === 200 && !('pagination' in doc.response),
  );

  it.each(lists)(
    '%s: the list envelope is accepted and says it is a historical snapshot',
    (_name, doc) => {
      const envelope = parseEnvelope(doc.response, { list: true });
      expect(envelope.meta.is_live).toBe(false);
      expect(envelope.meta.data_status).toBe('historical_snapshot');
      expect(typeof envelope.meta.notice).toBe('string');
      expect(typeof envelope.pagination?.has_more).toBe('boolean');
    },
  );

  it.each(objects)(
    '%s: the object envelope is accepted and says it is a historical snapshot',
    (_name, doc) => {
      const envelope = parseEnvelope(doc.response, { list: false });
      expect(envelope.meta.is_live).toBe(false);
    },
  );

  it.each(examples.filter(([, doc]) => doc.status === 200))(
    '%s: is refused if the same response claimed to be live',
    (_name, doc) => {
      const live = clone(doc.response);
      live.meta.is_live = true;
      expect(() => parseEnvelope(live, { list: Array.isArray(live.data) })).toThrow(
        /historical snapshot/,
      );
      const wrongStatus = clone(doc.response);
      wrongStatus.meta.data_status = 'live';
      expect(() => parseEnvelope(wrongStatus, { list: Array.isArray(wrongStatus.data) })).toThrow();
      const noMeta = clone(doc.response);
      delete noMeta.meta;
      expect(() => parseEnvelope(noMeta, { list: Array.isArray(noMeta.data) })).toThrow(/meta/);
    },
  );

  it('the documented error body is surfaced as an HTTP error, never as data', async () => {
    const example = byName('error-invalid-parameter');
    expect(example.status).toBe(400);
    expect(example.response.error.code).toBe('INVALID_PARAMETER');
    const { client } = clientFor(example);
    await expect(
      client.get('/api/v1/x', { parse: (b) => parseEnvelope(b, { list: true }) }),
    ).rejects.toMatchObject({
      kind: 'http',
      status: 400,
    });
  });
});

describe('pagination cursors', () => {
  it('a real page with more data carries an opaque cursor the frontend can send back', () => {
    for (const name of ['states-page-with-cursor', 'commodities-page-with-cursor']) {
      const { pagination } = parseEnvelope(byName(name).response, { list: true });
      expect(pagination?.has_more, name).toBe(true);
      expect(pagination?.next_cursor, name).toMatch(/^[A-Za-z0-9_-]{8,}$/);
      const endpoint = name.startsWith('states') ? 'states' : 'commodities';
      expect(buildPath(endpoint, { limit: 2, cursor: pagination?.next_cursor })).toContain(
        `cursor=${pagination?.next_cursor}`,
      );
    }
  });

  it('the last page has no cursor', () => {
    const { pagination } = parseEnvelope(byName('mandi-prices-empty').response, { list: true });
    expect(pagination?.has_more).toBe(false);
    expect(pagination?.next_cursor).toBeNull();
  });

  it('a malformed cursor is rejected before it is sent', () => {
    expect(() => buildPath('states', { cursor: 'not a cursor!' })).toThrow();
    expect(() => buildPath('states', { cursor: `${'a'.repeat(601)}` })).toThrow();
  });

  it('an invalid next_cursor type from the API is rejected', () => {
    const bad = clone(byName('states-page-with-cursor').response);
    bad.pagination.next_cursor = 42;
    expect(() => parseEnvelope(bad, { list: true })).toThrow(/pagination/);
  });
});

describe('empty datasets', () => {
  it('an empty mandi window is a valid, explicit empty list (not an error, no placeholder rows)', async () => {
    const example = byName('mandi-prices-empty');
    const { client } = clientFor(example);
    const page = await historical.mandiPrices(client, {
      commodity_id: '00000000-0000-4000-8000-000000000001',
      from: '2025-06-01',
      to: '2025-06-30',
    });
    expect(page.data).toEqual([]);
    expect(page.pagination).toEqual({ limit: 2, has_more: false, next_cursor: null });
    expect(page.meta.is_live).toBe(false);
  });
});

describe('original units and unit assumptions', () => {
  it('mandi rows state that INR per quintal is an assumption and carry no source unit label', () => {
    for (const row of byName('mandi-prices').response.data) {
      expect(row).toMatchObject({
        price_currency: 'INR',
        price_unit: 'quintal',
        unit_basis: 'assumed_from_documentation',
        source_price_unit_label: null,
      });
      expect(describePrice(row)).toMatchObject({ unit: 'per quintal', assumed: true });
    }
    expect(byName('mandi-prices').response.meta.unit_note).toMatch(/assumed/i);
  });

  it('state rows keep the units the source stated, with their original labels', () => {
    for (const row of byName('state-prices-keralam').response.data) {
      expect(row.unit_basis).toBe('source_stated');
      expect(row.source_price_unit_label).toMatch(/^Rs\.\//);
      expect(row.source_arrival_unit_label).toEqual(expect.any(String));
      expect(describePrice(row).assumed).toBe(false);
    }
  });

  it('a state row with count units says so, and the card never converts to weight', () => {
    const row = byName('state-prices-count-units').response.data[0];
    expect(row.arrival_unit_dimension === 'count' || row.price_unit_dimension === 'count').toBe(
      true,
    );
    render(<StateObservationCard row={row} />);
    const card = screen.getByRole('article');
    expect(card).toHaveTextContent(/Count unit · not convertible to weight/);
    expect(card).toHaveTextContent(
      `${row.source_arrival_unit_label} (original unit, not converted)`,
    );
    expect(card.textContent).not.toMatch(/tonne|quintal.*arrival|kg/i);
  });
});

describe('source provenance', () => {
  const rows = [
    ...byName('mandi-prices').response.data,
    ...byName('state-prices-keralam').response.data,
    ...byName('state-prices-count-units').response.data,
  ];

  it('every observation names its source, file, run, original row and says it is not synthetic', () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row.provenance).toMatchObject({
        source_code: expect.stringMatching(/_historical$/),
        source_file_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        ingestion_run_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        is_historical_snapshot: true,
        is_synthetic: false,
      });
      expect(row.provenance.source_row_number).toBeGreaterThan(0);
    }
  });

  it('the sources endpoint resolves those files, with fingerprints and recorded assumptions', () => {
    const sources = byName('sources').response.data;
    const mandi = sources.find((s) => s.code === 'mandi_daily_prices_historical');
    expect(mandi.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(mandi.assumptions.map((a) => a.code)).toContain('price_unit_inr_per_quintal');
    expect(mandi.initial_load.importer_version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('a row without provenance, or one marked synthetic, is refused rather than shown', () => {
    const row = clone(byName('mandi-prices').response.data[0]);
    delete row.provenance;
    expect(() => checkObservationRows('mandiPrices', [row])).toThrow(/provenance|missing/);
    const synthetic = clone(byName('mandi-prices').response.data[0]);
    synthetic.provenance.is_synthetic = true;
    expect(() => checkObservationRows('mandiPrices', [synthetic])).toThrow(/provenance/);
  });
});

describe('geographic uncertainty', () => {
  it('unverified markets with an unresolved district keep the label the file used', () => {
    const markets = byName('markets-unresolved-district').response.data;
    expect(markets.length).toBeGreaterThan(0);
    for (const m of markets) {
      expect(m.verification_status).toBe('unverified');
      expect(m.district).toBeNull();
      expect(m.district_status).toBe('unresolved');
      expect(m.source_district_label).toEqual(expect.any(String));
    }
  });

  it('Keralam is a provisional mapping, in the state registry and in the state-level rows', () => {
    const kerala = byName('states-kerala').response.data[0];
    const label = kerala.source_labels.find((l) => l.source_label === 'Keralam');
    expect(label).toMatchObject({
      mapping_status: 'provisional',
      mapping_basis: 'reviewed_decision',
    });
    const row = byName('state-prices-keralam').response.data[0];
    expect(row.state.mapping_status).toBe('provisional');
    expect(row.source_labels.state).toBe('Keralam');
    render(<StateObservationCard row={row} />);
    expect(screen.getByText(/provisional state mapping: “Keralam”/i)).toBeVisible();
  });

  it('Gao is reported as an unresolved state label, and unresolved districts carry their row counts', () => {
    const { data } = byName('geography-unresolved').response;
    expect(data.states[0]).toMatchObject({
      source_label: 'Gao',
      status: 'unresolved',
      rows_quarantined: 4,
    });
    for (const d of data.districts) {
      expect(d.status).toBe('unresolved');
      expect(d.observations).toBeGreaterThan(0);
    }
  });

  it('the coverage summary states how many markets are unverified and how many districts are unresolved', () => {
    const { geography, registry } = byName('coverage').response.data;
    expect(geography.markets_unverified).toBe(registry.markets);
    expect(geography.unresolved_district_labels).toBeGreaterThan(0);
  });
});

describe('mandi versus state granularity', () => {
  it('each endpoint accepts its own granularity', () => {
    expect(() =>
      checkObservationRows('mandiPrices', byName('mandi-prices').response.data),
    ).not.toThrow();
    expect(() =>
      checkObservationRows('statePrices', byName('state-prices-keralam').response.data),
    ).not.toThrow();
  });

  it('a state-level row can never be accepted as a mandi observation, nor the reverse', () => {
    expect(() =>
      checkObservationRows('mandiPrices', byName('state-prices-keralam').response.data),
    ).toThrow(/mandi_daily/);
    expect(() => checkObservationRows('statePrices', byName('mandi-prices').response.data)).toThrow(
      /state_daily/,
    );
  });

  it('a state-level row with mandi fields is refused', () => {
    const row = clone(byName('state-prices-keralam').response.data[0]);
    row.market = { id: 'x', name: 'A mandi' };
    expect(() => checkObservationRows('statePrices', [row])).toThrow(/mandi-level fields/);
  });

  it('a mixed response is rejected as a whole through the real client path', async () => {
    const mixed = clone(byName('mandi-prices'));
    mixed.response.data.push(clone(byName('state-prices-keralam').response.data[0]));
    const { client } = clientFor(mixed);
    await expect(
      historical.mandiPrices(client, {
        commodity_id: '00000000-0000-4000-8000-000000000001',
        from: '2025-06-11',
        to: '2025-06-11',
      }),
    ).rejects.toMatchObject({ kind: 'parse' });
  });

  it('mandi rows render as mandi-level (market and verification) and state rows as state-level', () => {
    const mandi = byName('mandi-prices').response.data[0];
    const { unmount } = render(<MandiObservationCard row={mandi} />);
    expect(screen.getByRole('article')).toHaveTextContent(mandi.market.name);
    expect(screen.getByRole('article')).toHaveTextContent('Unverified market');
    expect(screen.getByRole('article')).not.toHaveTextContent('State-level observation');
    unmount();
    render(<StateObservationCard row={byName('state-prices-keralam').response.data[0]} />);
    expect(screen.getByRole('article')).toHaveTextContent(
      'State-level observation · not a mandi price',
    );
    expect(screen.getByRole('article')).not.toHaveTextContent('Unverified market');
  });
});

describe('unexpected or missing response fields', () => {
  it('ignores fields the API may add later, and does not render them', () => {
    const row = clone(byName('state-prices-keralam').response.data[0]);
    row.future_field = 'SURPRISE-VALUE';
    row.provenance.another_future_field = 'SURPRISE-PROVENANCE';
    expect(() => checkObservationRows('statePrices', [row])).not.toThrow();
    render(<StateObservationCard row={row} />);
    expect(screen.getByRole('article').textContent).not.toMatch(/SURPRISE/);
  });

  it.each([
    [
      'mandiPrices',
      'mandi-prices',
      ['unit_basis', 'price_unit', 'source_labels', 'provenance', 'market', 'observed_date'],
    ],
    [
      'statePrices',
      'state-prices-keralam',
      [
        'unit_basis',
        'price_unit',
        'arrival_unit',
        'source_labels',
        'provenance',
        'state',
        'observed_date',
      ],
    ],
  ])('%s: a row missing a required field is refused', (endpoint, name, required) => {
    for (const key of required) {
      const row = clone(byName(name).response.data[0]);
      delete row[key];
      expect(() => checkObservationRows(/** @type {any} */ (endpoint), [row]), key).toThrow(
        new RegExp(key),
      );
    }
  });

  it('a response whose data is not a list, or whose pagination is missing, is refused', () => {
    expect(() =>
      parseEnvelope(
        {
          data: {},
          pagination: { has_more: false, next_cursor: null },
          meta: byName('mandi-prices').response.meta,
        },
        { list: true },
      ),
    ).toThrow(/list/);
    const noPagination = clone(byName('mandi-prices').response);
    delete noPagination.pagination;
    expect(() => parseEnvelope(noPagination, { list: true })).toThrow(/pagination/);
  });

  it('a non-JSON or non-object body is a parse error through the client', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>nope</html>', { status: 200 }));
    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1000, fetchImpl });
    await expect(historical.states(client)).rejects.toMatchObject({ kind: 'parse' });
  });
});

describe('latest observation per mandi (captured)', () => {
  it('the real capture satisfies the frontend row and meta contract and is historical-only', async () => {
    const example = byName('mandi-prices-latest');
    const { client } = clientFor(example);
    const page = await historical.latestMandiPrices(client, {
      commodity_id: '00000000-0000-4000-8000-000000000001',
      limit: 2,
    });
    expect(page.data.length).toBeGreaterThan(0);
    checkLatestMeta(page.meta);
    expect(page.meta.is_live).toBe(false);
    for (const row of page.data) {
      expect(row.latest_observation_date).toBe(row.observed_date);
      expect(row.observations_on_latest_date).toBeGreaterThanOrEqual(1);
      expect(row.granularity).toBe('mandi_daily');
    }
  });

  it('renders a real row with neutral wording, original unit, provenance and verification', () => {
    const doc = byName('mandi-prices-latest');
    const row = doc.response.data[0];
    render(<LatestObservationCard row={row} referenceDate={doc.response.meta.reference_date} />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Last reported on/);
    expect(text).toMatch(/Historical observation/);
    expect(text).toMatch(/unit assumed/);
    expect(text).toMatch(/Source: /);
    expect(text).not.toMatch(/\b(fresh|current)\b/i);
  });

  it('the empty and state-filtered captures and the missing-commodity error are understood', () => {
    expect(byName('mandi-prices-latest-empty').response.data).toEqual([]);
    expect(byName('mandi-prices-latest-state').response.meta.filters.state_id).toBeTruthy();
    expect(byName('error-latest-missing-commodity').status).toBe(400);
  });

  it('a latest row whose date disagrees is refused', () => {
    const rows = clone(byName('mandi-prices-latest').response.data);
    rows[0].latest_observation_date = '1999-01-01';
    expect(() => checkObservationRows('latestMandiPrices', rows)).toThrow(/differs/);
  });
});
