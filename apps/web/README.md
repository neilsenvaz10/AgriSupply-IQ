# FASALYTICS web (React, Vite, JavaScript)

The farmer-facing application, converted from the eight Google Stitch designs. It is **JavaScript and
JSX only** (JSDoc-typed, checked with `tsc -p jsconfig.json`). It talks only to the Express API; it never
connects to PostgreSQL or the FastAPI service.

> **Honest status.** The screens are implemented as **UI previews**. There is no agricultural data
> pipeline, registry or trained model yet, so every data-dependent area shows an explicit
> "unavailable" state instead of sample data. Nothing on any page is a price, forecast, recommendation,
> count or "live" feed. The System Status page (real health check) is the only data-backed screen.

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

| Command                                 | Purpose                                   |
| --------------------------------------- | ----------------------------------------- |
| `npm run check`                         | JSDoc type check (`tsc -p jsconfig.json`) |
| `npm run lint` / `npm run format:check` | ESLint / Prettier                         |
| `npm test`                              | Vitest + Testing Library                  |
| `npm run build`                         | Production build into `dist/`             |

`VITE_API_BASE_URL` is read by the **browser**, so it is the host URL of Express (`http://localhost:4000`),
never a Docker service name. See `.env.example`.

## Route map

| Route          | Page                            | Source Stitch screen                       | Status                         |
| -------------- | ------------------------------- | ------------------------------------------ | ------------------------------ |
| `/`            | Redirects to `/dashboard`       |                                            |                                |
| `/dashboard`   | Farmer Dashboard (landing page) | `original/.../fasalytics_farmer_dashboard` | UI preview                     |
| `/markets`     | Nationwide Market Explorer      | `new-exports/nationwide_market_explorer`   | UI preview                     |
| `/commodities` | Explore Commodities             | `new-exports/all_crop_commodity_explorer`  | UI preview                     |
| `/forecast`    | AI Price Forecasting            | `new-exports/ai_price_forecasting`         | UI preview                     |
| `/compare`     | Mandi Comparison                | `original/.../smart_mandi_comparison`      | UI preview                     |
| `/allocate`    | Smart Harvest Allocation        | `original/.../smart_harvest_allocation`    | UI preview                     |
| `/simulate`    | What-If Simulator               | `new-exports/what_if_market_simulator`     | UI preview                     |
| `/assistant`   | AI Copilot                      | `original/.../fasalytics_ai_copilot`       | UI preview                     |
| `/profile`     | Profile and preferences         | (design system only)                       | UI preview, no sign-in         |
| `/status`      | System Status (diagnostics)     | (not a Stitch screen)                      | Working: real API health check |
| `*`            | Not found                       |                                            |                                |

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

## Data-unavailable behaviour

Each screen reads its data through one hook in `src/services/agri/index.js` that returns
`{ status, data, reason, needs }`. Today every hook returns `unavailable`, makes **no network request**
and never falls back to demo data. A later phase replaces the hook body with a real call through the
Express API client; the pages already render `ready`, `loading` and `error` through `DataState`.

| Screen             | Unavailable message                                                                 | Needs (future Express endpoint, PROJECT.md section 5.5) |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Dashboard          | Market data will appear here once the ingestion pipeline is connected.              | prices, forecasts, comparison                           |
| Market Explorer    | Market directory data is not available yet.                                         | `GET /markets` (state, district and market registries)  |
| Commodities        | Commodity catalogue data is not available yet.                                      | `GET /commodities` plus capability tiers                |
| Forecasting        | Forecasts are not available until the forecasting service is trained and validated. | `POST /forecasts`                                       |
| Mandi Comparison   | Mandi comparison requires verified market prices and cost inputs.                   | `POST /compare`                                         |
| Harvest Allocation | Allocation recommendations require verified market and forecast data.               | `POST /allocate`                                        |
| What-If Simulator  | Risk simulation is not yet connected to the intelligence engine.                    | `POST /scenarios`                                       |
| AI Copilot         | AI Copilot is not yet configured.                                                   | `POST /chat`                                            |

These endpoints do not exist yet and are **not** called.

## What works today (frontend only)

Sidebar, bottom-bar and drawer navigation; breadcrumbs; the filter dialog (Market Explorer); search
input state (with an honest "not available yet" note); segmented controls (forecast horizon, allocation
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
