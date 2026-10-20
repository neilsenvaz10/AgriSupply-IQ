# FASALYTICS web (React, Vite, JavaScript)

The farmer-facing application, converted from the eight Google Stitch designs. It is **JavaScript and
JSX only** (JSDoc-typed, checked with `tsc -p jsconfig.json`). It talks only to the Express API; it never
connects to PostgreSQL or the FastAPI service.

> **Honest status.** Since Milestone 2.3B the **Dashboard, Market Explorer and Commodities** screens show
> real **historical** data from the read-only Express endpoints under `/api/v1` (imported historical files,
> not a live feed; every response must say `meta.is_live = false` or it is refused). Prices are shown with
> their original units (INR per quintal for mandi data is an **assumption** and is labelled as one), market
> identities are shown as **unverified**, unresolved districts and provisional state mappings are shown as
> such, and a missing mandi price is never filled from state-level data. The other screens (forecasting,
> comparison, allocation, simulation, copilot) remain **UI previews** with explicit "unavailable" states:
> no model, forecast, recommendation or live feed exists. System Status is the real health check.

## Run it

```bash
# Locally (needs the API on http://localhost:4000, see ../api)
cd apps/web
npm ci
npm run dev              # http://localhost:5173

# Through Docker Compose (the project's primary development environment, from the repository root)
docker compose --env-file database/.env up -d --build --wait
# open http://localhost:5173  (the Dashboard)
```

In Compose, `apps/web/src` and `index.html` are mounted read-only into the container and Vite polls for
changes, so edits in those files reload the browser. Changes to other files (config, `package.json`)
need `docker compose --env-file database/.env up -d --build web`.

| Command                                 | Purpose                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `npm run check`                         | JSDoc type check (`tsc -p jsconfig.json`)                   |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                                           |
| `npm test`                              | Vitest + Testing Library                                    |
| `VITE_TEST_LATENCY_MS=40 npm test`      | Same, with a slow mocked API (finds timing-dependent tests) |
| `npm run build`                         | Production build into `dist/`                               |

`VITE_API_BASE_URL` is read by the **browser**, so it is the host URL of Express (`http://localhost:4000`),
never a Docker service name. See `.env.example`.

## Route map

| Route          | Page                            | Source Stitch screen                       | Status                                                                                                 |
| -------------- | ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `/`            | Redirects to `/dashboard`       |                                            |                                                                                                        |
| `/dashboard`   | Farmer Dashboard (landing page) | `original/.../fasalytics_farmer_dashboard` | Historical mandi prices; recommendation, ranking and allocation widgets stay unavailable               |
| `/markets`     | Nationwide Market Explorer      | `new-exports/nationwide_market_explorer`   | Historical directory and mandi prices, plus a separate state-level prices tab and a data quality panel |
| `/commodities` | Explore Commodities             | `new-exports/all_crop_commodity_explorer`  | Real catalogue with mandi / state-level-only / no-data coverage tiers                                  |
| `/forecast`    | AI Price Forecasting            | `new-exports/ai_price_forecasting`         | UI preview                                                                                             |
| `/compare`     | Mandi Comparison                | `original/.../smart_mandi_comparison`      | UI preview                                                                                             |
| `/allocate`    | Smart Harvest Allocation        | `original/.../smart_harvest_allocation`    | UI preview                                                                                             |
| `/simulate`    | What-If Simulator               | `new-exports/what_if_market_simulator`     | UI preview                                                                                             |
| `/assistant`   | AI Copilot                      | `original/.../fasalytics_ai_copilot`       | UI preview                                                                                             |
| `/profile`     | Profile and preferences         | (design system only)                       | UI preview, no sign-in                                                                                 |
| `/status`      | System Status (diagnostics)     | (not a Stitch screen)                      | Working: real API health check                                                                         |
| `*`            | Not found                       |                                            |                                                                                                        |

Alias paths redirect to the canonical routes: `/forecasting`, `/compare-mandis`, `/harvest-allocation`,
`/what-if`, `/copilot` (see `src/app/navigation.js`). Stitch paths are under
`design/stitch/` (the originals are never modified).

## What was converted, and how

The original HTML/CSS is **not** copied. Each screen's layout, hierarchy, tokens, icons and component
shapes were rebuilt in React with the extracted Stitch tokens (`src/styles/stitchTokens.js`, applied through
`tailwind.config.js`), Plus Jakarta Sans / Inter and the self-hosted Material Symbols font.

Deliberately **not** carried over from the exports: every sample number, place, crop and person
(for example prices, mandi names, "94% confidence", "Live Feed", farmer counts), fake actions (booking,
gate-pass and QR generation, freight locking), remote photos and the remote Tailwind/Google Fonts
loaders. Where Stitch showed data, the page shows a structural placeholder (skeleton, empty chart
frame, empty ring) plus a plain-language reason.

## Shared components

| Component                                                                                                                                      | File                           | Purpose                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `AppShell`, `NavEntry`                                                                                                                         | `src/layouts/`                 | Header, desktop sidebar, five-tab mobile bar, mobile menu drawer                                |
| `Dialog`                                                                                                                                       | `src/components/ui/Dialog.jsx` | Accessible modal/drawer/sheet (focus handling, Escape, backdrop)                                |
| `PageHeader`, `Breadcrumbs`, `Card`, `EmptyState`, `InfoBanner`, `PreviewBadge`, `Skeleton`, `SkeletonCard`, `LinkButton`, `UnavailableAction` | `primitives.jsx`               | Stitch card/chip/pill styling; `UnavailableAction` is a disabled control that states its reason |
| `SearchField`, `SegmentedControl`, `RegistrySelect`, `Disclosure`                                                                              | `controls.jsx`                 | Inputs; `RegistrySelect` is disabled with no options until the registry exists                  |
| `DataState`                                                                                                                                    | `DataState.jsx`                | Renders loading, error (with retry), unavailable or ready from one state object                 |
| `ErrorBoundary`, `RouteError`                                                                                                                  | `ErrorBoundary.jsx`            | A failing page never takes down the shell                                                       |

## Responsive layout

- **Mobile (< 768 px):** Stitch layout: top bar with a menu button, five-tab bottom bar (Dashboard, Mandis,
  raised **Allocate** action, AI Copilot, Profile), single column. The menu drawer reaches every page.
- **Tablet and desktop (>= 768 px):** persistent 260 px sidebar (width from the design system) with every
  page and a Diagnostics group; content is laid out in 12-column grids from 1024 px so cards are
  re-proportioned rather than stretched.
- Pages never scroll horizontally (verified at 375, 768 and 1440 px). Zoom is not disabled (the exports
  disabled it). Focus rings are visible everywhere and animation respects `prefers-reduced-motion`.

## Data layer and data-unavailable behaviour

Screens read data through hooks in `src/services/agri/` and render the standard state
`{ status, data, reason, needs }` with `DataState` (`ready`, `loading`, `error`, `unavailable`).

- `historical.js` builds and validates the requests to `/api/v1` (parameters, the 366-day window, UUIDs,
  limits and cursors are checked before anything is sent; a bad request is an `invalid_request` error and
  nothing goes over the network) and checks every response: it must declare itself a historical snapshot
  (`meta.is_live === false`), otherwise it is refused as an unexpected format and not displayed.
- `useApiQuery.js` provides `useApiQuery` (one request) and `usePagedQuery` (cursor pagination: page 1, then
  "Load more" with the server cursor). Both cancel in-flight requests when the inputs change or the page
  unmounts, never show the previous inputs' data for new inputs, and never fabricate data.
- `hooks.js` has the screen hooks (`useCoverage`, `useStates`, `useDistricts`, `useCommodityCatalogue`,
  `useMarketDirectory`, `useMarketDetail`, `useMandiObservations`); `format.js` only formats API values
  (dates, rupees, original units); it never converts units or computes changes.

Endpoints used: `/coverage`, `/states`, `/districts`, `/commodities`, `/markets`, `/markets/{id}`,
`/mandi-prices`, `/state-prices`, `/sources`, `/geography/unresolved` (all GET; see
`docs/api/historical-market-api.md`). `/state-prices` is used only by the separate **State-level prices**
tab of the Market Explorer; its rows are checked to be `state_daily` (and mandi rows `mandi_daily`), so a
state-level row can never be shown as a mandi observation.

### Milestone 2.3C additions

- **Searchable selector** (`components/ui/SearchableSelect.jsx`): an accessible combobox (type to filter,
  arrow keys / Home / End / Enter / Escape, a Clear button, a "no match" message, coverage shown under each
  option, a render limit). Used for the 434-commodity catalogue (Commodities spotlight, state-level view).
- **State-level prices tab** (Market Explorer): state and commodity filters, a date window of at most 366
  days, cursor pagination, original units (arrivals are never converted; count units are flagged), source
  provenance, and its own "state-level, not a mandi price" labels.
- **Latest-observation discovery**: "Latest available day only" is offered only when the API's summary
  data proves the day for exactly the active filters: a commodity on its own (its own latest day) or a
  market on its own (that market's latest day). With a state filter, or a market and a commodity together,
  the summary data cannot say which day was the latest, so no shortcut is offered and the dataset-wide
  maximum is never used instead (the default window then only _starts_ at the relevant end date). The
  single day is listed in full through the server's cursor, with a note that it is the latest available,
  not live, and not a ranking. No browser-side re-sorting of partial pages. The proposed API
  addition for a per-market latest list is in `docs/api/proposals/latest-observations.md` (not built).
- **Data quality and coverage** panel (Market Explorer): unverified mandis, unresolved district labels with
  row counts, provisional aliases, unit assumptions, source files and fingerprints, latest dates and
  coverage limits, all from API metadata. Its heavier requests are made only when it is opened.
- **Contract tests**: `src/test/contract/` holds versioned, sanitized captures of real API responses
  (refresh with `scripts/capture-contract-examples.mjs`); they are kept apart from the synthetic
  unit-test fixtures in `src/test/historicalFixtures.js` and need no API or database.

| Screen             | Data                                                               | When there is none                                                                            |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Dashboard          | Latest-day mandi observations; a chosen mandi's own 90-day history | Explicit loading / empty / error states; recommendation, ranking, allocation stay unavailable |
| Market Explorer    | Market directory (server-paginated), mandi prices of a market      | "No mandi observations exist for these filters"; state prices are never substituted           |
| Commodities        | Real catalogue with per-granularity coverage and date ranges       | Error state with retry                                                                        |
| Forecasting        | none (no backend)                                                  | Forecasts are not available until the forecasting service is trained and validated.           |
| Mandi Comparison   | none                                                               | Mandi comparison requires verified market prices and cost inputs.                             |
| Harvest Allocation | none                                                               | Allocation recommendations require verified market and forecast data.                         |
| What-If Simulator  | none                                                               | Risk simulation is not yet connected to the intelligence engine.                              |
| AI Copilot         | none                                                               | AI Copilot is not yet configured.                                                             |

The five screens without a backend make **no network request** and never fall back to demo data.

## What works today (frontend only)

Sidebar, bottom-bar and drawer navigation; breadcrumbs; the Market Explorer filters (state, dependent
district, district status, commodity), search and server-side paging; the Commodities category, coverage
and search filters and spotlight; segmented controls (forecast horizon, allocation
strategy, comparison sort) as remembered choices; the readiness-tier accordion; the What-If levers,
presets and Reset (the chosen values are shown but never converted into a payout); suggested Copilot
questions filling the input; the not-found page; the page-level error boundary; System Status.

## Not available (disabled with a visible reason)

Compare selected mandis, explore mandis for a commodity, price alerts, lock rate and route, split
allocation, gate-pass generation, full optimization, Copilot Send, voice input, notifications,
Hindi/Marathi, sign-in and saved preferences. Selectors for state, commodity and market are disabled and
offer no options, so no pilot list is presented as the supported universe.

## Tests

`src/pages/screens.test.jsx` (every route, landing page, aliases, not-found, missing-data states, a
scan proving no prices, quantities, confidence scores, places, crops or personal names appear, disabled
actions, interactions, accessible names and heading order) and `src/layouts/AppShell.test.jsx` (landmarks,
navigation, mobile bar, drawer behaviour). The earlier status, API client, config and token tests remain.
