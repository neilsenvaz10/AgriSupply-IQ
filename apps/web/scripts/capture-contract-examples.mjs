// Captures SANITIZED, VERSIONED examples of real historical-market API responses for the frontend
// contract tests (src/test/contract/v1). Run it against a running API:
//
//   API_BASE_URL=http://localhost:4000 node scripts/capture-contract-examples.mjs
//
// What it keeps: the response body exactly as the API returned it, shortened to a few rows.
// What it drops: nothing sensitive exists in these read-only responses (no credentials, hosts or
// request ids are stored); the file records the request path, the capture time and the contract
// version. Ordinary frontend tests read these files and never need the API or the database.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'test', 'contract', 'v1');
const CONTRACT_VERSION = 'v1';
mkdirSync(out, { recursive: true });

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
  return { status: response.status, body: await response.json() };
}

const manifest = [];
async function save(name, path, { keep = 2, trim = (body) => body } = {}) {
  const { status, body } = await get(path);
  let trimmed = null;
  const shorten = (b) => {
    if (b && Array.isArray(b.data) && b.data.length > keep) {
      trimmed = `data shortened from ${b.data.length} to ${keep} rows`;
      b.data = b.data.slice(0, keep);
    }
    return b;
  };
  const response = trim(shorten(body));
  const document = {
    contract_version: CONTRACT_VERSION,
    about:
      'A REAL response captured from the FASALYTICS historical market API (sanitized: shortened only). Not a synthetic fixture.',
    captured_at: new Date().toISOString(),
    request: `GET ${path}`,
    status,
    ...(trimmed ? { trimmed } : {}),
    response,
  };
  const text = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(join(out, `${name}.json`), text);
  manifest.push({
    file: `${name}.json`,
    request: document.request,
    status,
    sha256: createHash('sha256').update(text).digest('hex'),
  });
  return body;
}

const states = (await get('/api/v1/states?limit=100')).body.data;
const kerala = states.find((s) => s.name === 'KERALA');
const maharashtra = states.find((s) => s.name === 'MAHARASHTRA');
const wheat = (await get('/api/v1/commodities?q=wheat&limit=1')).body.data[0];
const onion = (await get('/api/v1/commodities?q=onion&limit=1')).body.data[0];
const unresolvedMarket = (await get('/api/v1/markets?district_status=unresolved&limit=1')).body
  .data[0];

await save('states-kerala', '/api/v1/states?q=kerala');
await save('states-page-with-cursor', '/api/v1/states?limit=2');
await save('commodities-page-with-cursor', '/api/v1/commodities?limit=3');
await save('commodity-wheat', '/api/v1/commodities?q=wheat&limit=1', { keep: 1 });
await save('markets-unresolved-district', '/api/v1/markets?district_status=unresolved&limit=2');
await save('market-detail', `/api/v1/markets/${unresolvedMarket.id}`);
await save(
  'mandi-prices',
  `/api/v1/mandi-prices?commodity_id=${onion.id}&from=2025-06-11&to=2025-06-11&limit=2`,
);
await save(
  'mandi-prices-empty',
  `/api/v1/mandi-prices?commodity_id=${wheat.id}&from=2025-06-01&to=2025-06-30&limit=2`,
);
await save(
  'state-prices-keralam',
  `/api/v1/state-prices?state_id=${kerala.id}&from=2025-01-01&to=2025-01-31&limit=2`,
);

// A state-level row whose units are COUNT units (not convertible to mass), found by scanning pages.
let cursor = '';
let countRow = null;
for (let i = 0; i < 40 && !countRow; i += 1) {
  const page = (
    await get(
      `/api/v1/state-prices?state_id=${maharashtra.id}&from=2025-01-01&to=2025-01-31&limit=500${cursor}`,
    )
  ).body;
  countRow = page.data.find(
    (r) => r.arrival_unit_dimension === 'count' || r.price_unit_dimension === 'count',
  );
  cursor = page.pagination.next_cursor ? `&cursor=${page.pagination.next_cursor}` : '';
  if (!cursor) break;
}
if (countRow) {
  const day = countRow.observed_date;
  await save(
    'state-prices-count-units',
    `/api/v1/state-prices?state_id=${maharashtra.id}&commodity_id=${countRow.commodity.id}&from=${day}&to=${day}&limit=1`,
    { keep: 1 },
  );
}
await save('coverage', '/api/v1/coverage');
await save('sources', '/api/v1/sources', { keep: 5 });
await save('geography-unresolved', '/api/v1/geography/unresolved', {
  trim: (b) => {
    b.data.districts = b.data.districts.slice(0, 3);
    return b;
  },
});
await save('error-invalid-parameter', '/api/v1/mandi-prices?from=2025-01-01&to=2025-01-31');

writeFileSync(
  join(out, 'manifest.json'),
  `${JSON.stringify({ contract_version: CONTRACT_VERSION, files: manifest }, null, 2)}\n`,
);
console.log(`Captured ${manifest.length} examples into ${out}`);
