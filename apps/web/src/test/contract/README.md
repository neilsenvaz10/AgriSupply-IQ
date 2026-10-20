# Frontend/API contract examples (v1)

`v1/` holds **sanitized captures of real responses** from the FASALYTICS historical market API
(`/api/v1`, see `docs/api/historical-market-api.md`). They let the frontend tests check its understanding
of the contract without the API or the database.

|                       | Contract examples (this folder)                 | Synthetic fixtures (`../historicalFixtures.js`) |
| --------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Origin                | Captured from the running API                   | Written by hand ("Testcrop", "Synthetic Mandi") |
| Used for              | Contract checks in `contract.test.jsx`          | Page behaviour tests with a mocked `fetch`      |
| May be shown as data? | Only in tests; they are real historical records | Never; they are not data                        |

## What "sanitized" means

Each file keeps the response body exactly as returned, shortened to a few rows (the file says so in
`trimmed`). The wrapper records the contract version, the request path, the HTTP status and the capture
time. No credentials, hosts or request ids are stored (a test checks this).

## Versioning

The folder name is the contract version. If the API contract changes incompatibly, capture a new `v2/`
folder and keep `v1/` until the frontend no longer supports it.

## Refreshing the captures

With the API running (and the historical data imported):

```bash
cd apps/web
API_BASE_URL=http://localhost:4000 node scripts/capture-contract-examples.mjs
```

The script rewrites `v1/*.json` and `v1/manifest.json`. Review the diff: a changed shape is a contract
change and the contract tests should be updated deliberately, never silently.
