# FASALYTICS (AgriSupply-IQ)

> AI-driven market and risk intelligence platform for agricultural supply chains.  
> Built for **SYRUS 7.0 Hackathon** by **Team CodeSparks Innovators**.

---

## Overview

FASALYTICS helps smallholder farmers and FPOs (Farmer Producer Organizations) make data-backed decisions on **when, where, and how much** of their harvest to sell. 

Instead of chasing the highest sticker price at a distant mandi, the platform calculates **true net returns** by factoring in recent mandi arrivals, 1–7 day price forecasts, transport & handling costs, spoilage risk, and market congestion.

### Scope: nationwide and all-crop

FASALYTICS is designed for **all of India and all agricultural commodities** (India → State/UT → District → Mandi → Commodity → Variety). Nothing is hardcoded to a state or a crop; commodities and markets are discovered from data.

- **Architecture supports everything; data decides capability.** Each commodity–market series is assigned a capability tier (Full / Limited / State-Level Intelligence / Insufficient Data) using measurable criteria and backtests, never a crop whitelist.
- **Early validation** uses well-covered series (e.g. Potato and Onion in Maharashtra) only to prove the pipeline. They are examples, not limits.
- **Honest data labelling:** the supplied datasets are *historical*. Mandi-, state- and national-level records are never blended, and historical data is never shown as a current price. See [docs/data-sources/DATASET_COVERAGE.md](./docs/data-sources/DATASET_COVERAGE.md) for dataset coverage by state.

### Key Capabilities
- **Mandi Price & Arrival Tracking:** Source-tracked modal prices and volume arrivals across target mandis.
- **1–7 Day Price Forecasting:** Tabular time-series forecasts with confidence intervals and uncertainty metrics.
- **Net Return Comparison:** Side-by-side comparison of 3+ feasible mandis factoring in logistics, packing, and mandi fees.
- **Smart Harvest Allocation:** Solves multi-market split decisions to optimize returns while mitigating volume and price shock.
- **Fair Price Card & Risk Engine:** Visual summary of estimated price band, weather risks, and market pressure indicators.
- **Tool-Grounded AI Copilot:** Natural language scenario simulations ("What if diesel goes up 10%?") powered by Groq API tool-calling.
- **Vernacular & Accessible:** Mobile-first PWA design with multilingual support (Marathi, Hindi, English).

---

## Repository Structure

```text
AgriSupply-IQ/
├── PROJECT.md                  # Master blueprint, architecture specs & phased roadmap
├── README.md                   # Project overview
├── .env.example                # Environment template (placeholders only; copy to .env)
├── .gitignore                  # Protects secrets, datasets, models and build output
├── apps/
│   ├── web/                    # React + Vite + JavaScript frontend      (Milestone 5, done)
│   └── api/                    # Express + JavaScript backend            (Milestone 6, done)
├── services/
│   └── intelligence/           # Python 3.12 FastAPI service (Milestone 7, done): /health, /ready
├── compose.yaml                # Docker Compose: database only for now   (Milestone 8; extended in 9)
├── database/                   # PostgreSQL + Drizzle ORM (JavaScript)   (Milestone 8, done)
│   ├── src/                    #   schema, migration runner, verification, tests
│   ├── migrations/             #   generated SQL migrations (committed)
│   ├── init/                   #   first-run role and privilege setup (least privilege)
│   └── README.md               #   setup, roles, connection strings, persistence
├── data/
│   └── raw/                    # Original historical CSVs (git-ignored, read-only)
│                               # Agriculture_price_dataset, merged_preprocessed_all_reports,
│                               # crop_price_dataset, Wholesale-Price-Index-from-2012-to-2024
├── design/
│   └── stitch/
│       ├── original/           # Immutable Google Stitch exports (do not edit)
│       │   └── stitch_fasalytics_agritech_intelligence_platform/
│       │       ├── agriintelligence_market_risk_system/   # DESIGN.md (design system)
│       │       ├── fasalytics_farmer_dashboard/           # code.html + screen.png
│       │       ├── smart_mandi_comparison/
│       │       ├── smart_harvest_allocation/
│       │       └── fasalytics_ai_copilot/
│       ├── (Batch 2 exports currently at design/stitch/new-exports/: forecast, commodities,
│       │    market explorer, what-if simulator)
│       ├── SCREEN_MAP.md               # Screen inventory, checksums, defects
│       ├── DESIGN_SYSTEM.md            # Extracted tokens and components
│       ├── MISSING_SCREENS.md          # Gaps vs nationwide, all-crop scope
│       └── REACT_INTEGRATION_PLAN.md   # Phase 7 conversion plan
└── docs/
    └── data-sources/
        └── DATASET_COVERAGE.md  # Dataset coverage, provenance and limitations
```

> `compose.yaml` currently defines only the `db` service (Milestone 8). Milestone 9 adds the web, api and intelligence services.

---

## Proposed Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React, JavaScript (JSX), Vite, Tailwind CSS | Mobile-first responsive web app & PWA |
| **Backend API** | Node.js, Express (JavaScript, ES modules) | Main application API, auth, business orchestration |
| **Database** | PostgreSQL + Prisma / Drizzle | Relational data, mandi records, transaction logs |
| **ML & Analytics** | Python, FastAPI, Pandas, scikit-learn, XGBoost | Price forecasting, arrival trends, risk scoring |
| **Optimization** | SciPy / PuLP | Constrained harvest allocation solver |
| **AI Assistant** | Groq API (Function/Tool Calling) | Deterministic-tool grounded copilot & scenario queries |
| **Auth** | Firebase Auth | Phone OTP and role-based access |

---

## Implementation Roadmap

The full engineering blueprint and stage-by-stage implementation guide is documented in [PROJECT.md](./PROJECT.md):

- **Phase 1:** Foundation & environment (monorepo, services, database, Docker, local validation)
- **Phase 2:** Market data engineering (nationwide ingestion, normalisation, provenance, registries)
- **Phase 3:** Multi-crop forecasting (generalised models, backtesting, uncertainty, eligibility)
- **Phase 4:** Risk intelligence (volatility, price-drop, supply pressure, freshness, weather)
- **Phase 5:** Mandi comparison (net returns, transport costs, sell-now vs wait)
- **Phase 6:** Smart Harvest Allocation (risk-adjusted optimisation, explainable plans)
- **Phase 7:** Frontend integration (Stitch designs → React dashboard, PWA)
- **Phase 8:** AI assistant (Groq tool-calling copilot & what-if simulator)
- **Phase 9:** Accessibility & communication (multilingual, alerts, SMS/WhatsApp, voice)
- **Phase 10:** Testing, deployment & demo

---

## Running the full stack with Docker Compose

Requires Docker Desktop (running) and a configured `database/.env` (see
[database/README.md](./database/README.md)). Run everything from the repository root.

```bash
docker compose --env-file database/.env up -d --build --wait    # build, start, wait until healthy
docker compose --env-file database/.env ps                      # status and health
docker compose --env-file database/.env logs -f api             # follow logs (api, web, intelligence, db)
docker compose --env-file database/.env stop                    # stop; containers and data are kept
docker compose --env-file database/.env down                    # remove containers; the data volume is KEPT
docker compose --env-file database/.env up -d --build --wait api   # rebuild and restart one service
```

Never add `-v` to `down`: that deletes the `fasalytics_pgdata` volume and all database data.

| Service        | Inside the Compose network | Published on the host | Notes |
| -------------- | -------------------------- | --------------------- | ----- |
| `web`          | `web:5173`                 | `127.0.0.1:5173`      | Open <http://localhost:5173>. Source in `apps/web/src` is mounted for live reload. |
| `api`          | `api:4000`                 | `127.0.0.1:4000`      | The browser calls this. Health: `/health`, `/health/dependencies`. |
| `intelligence` | `intelligence:8000`        | **not published**     | Only `api` talks to it. Liveness is `/health`; `/ready` returns 503 until models exist (by design). |
| `db`           | `db:5432`                  | `127.0.0.1:5433`      | Host tools only. The unrelated PostgreSQL on host port 5432 is never used. |

Startup order is enforced with health conditions: `db` and `intelligence` become healthy, then
`api`, then `web`. The `intelligence` healthcheck only proves the process is alive; it does not mean
models are loaded.

### Host-based versus containerized configuration

| Setting | Processes on your machine (`npm run dev`, `python -m app`) | Inside Compose |
| --- | --- | --- |
| Express -> FastAPI (`ML_SERVICE_URL`) | `http://127.0.0.1:8000` (`8001` with the temporary local override) | `http://intelligence:8000` (set by `compose.yaml`; never `localhost`) |
| Browser -> Express (`VITE_API_BASE_URL`) | `http://localhost:4000` | `http://localhost:4000`: the browser runs on the host, so this is never `http://api:4000` |
| PostgreSQL (`DATABASE_URL`, application role) | `localhost:5433` | `db:5432` |
| Bind addresses | `127.0.0.1` | `0.0.0.0` inside containers, published to host loopback only |

Values in your git-ignored `.env` files apply to host processes only; the containers do not read
them. Only `api` receives a database URL: the application role at `db:5432`, built by
`compose.yaml` from `database/.env`. Admin and migrator credentials never leave the `db` service,
and migrations are never run at API startup. Optional
overrides read from `database/.env` or your shell: `API_HOST_PORT`, `WEB_HOST_PORT`,
`POSTGRES_HOST_PORT`, `API_CORS_ORIGINS`, `WEB_API_BASE_URL`, `LOG_LEVEL`.

Host processes and containers cannot both own a port. Stop host-run Express (4000) and Vite (5173)
before starting the stack. A host FastAPI on 8001 does not conflict, because the container's
FastAPI is not published.

### How Express talks to PostgreSQL and FastAPI

Express (`apps/api`) owns one `pg` connection pool, created at startup and closed on shutdown
(`src/database/pool.js`). It connects as `fasalytics_app` and refuses admin, migrator and superuser
role names. The pool does not connect until first use, so the API starts and `/health` stays `200`
even when PostgreSQL or FastAPI is down.

| Variable | Default | Range | Meaning |
| --- | --- | --- | --- |
| `DB_POOL_MAX` | `5` | 1-20 | maximum simultaneous connections |
| `DB_CONNECTION_TIMEOUT_MS` | `3000` | 100-30000 | longest wait to open or obtain a connection |
| `DB_IDLE_TIMEOUT_MS` | `30000` | 1000-600000 | idle connections are closed after this |
| `DB_QUERY_TIMEOUT_MS` | `5000` | 100-60000 | per-statement limit (client and server side) |
| `DB_HEALTH_TIMEOUT_MS` | `2000` | 100-30000 | overall budget of one health probe |

`GET /health/dependencies` (always HTTP 200; read `overall` and each `status`):

| `postgres.status` | Meaning |
| --- | --- |
| `healthy` | a connection was borrowed and `SELECT 1` succeeded just now |
| `unreachable` | the probe failed; `reason` is `connection_failed`, `timeout`, `authentication_failed` or `query_failed` |
| `not_configured` | `DATABASE_URL` is not set |
| `not_checked` | configured, but no pool was available to probe (in-process tests only) |

`intelligence_service.status` keeps its earlier contract (`healthy`, or `unreachable` with `reason`
`connection_failed`, `timeout`, `http_error` or `unexpected_response`). Messages are fixed text:
passwords, connection strings and raw driver errors are never returned or logged. `overall` is
`healthy` only when every dependency is healthy, `degraded` if any is unreachable, else `unknown`.
With the database container stopped the probe typically reports `timeout` (the name `db` stops
resolving) rather than `connection_failed`.

### Testing outage and recovery safely

These stop and start single containers; no volume is touched and nothing is deleted.

```bash
docker compose --env-file database/.env stop db            # PostgreSQL outage
curl http://localhost:4000/health/dependencies             # postgres unreachable, overall degraded
curl http://localhost:4000/health                          # still 200: liveness is independent
docker compose --env-file database/.env start db           # recovery, same pool, no API restart
docker compose --env-file database/.env stop intelligence  # FastAPI outage (start it again to recover)
```

Never use `down -v`. The API's database integration tests (`apps/api`, `npm test`) need the
database running and migrated; without it they are reported as **skipped**. `REQUIRE_DB=1` turns
that into a failure, and `DB_TEST_RESTART=1` also runs the disruptive outage/recovery test, which
stops and restarts only the `db` container.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `port is already allocated` / `address already in use` | Stop the host process using 4000 or 5173 (`Get-NetTCPConnection -LocalPort 4000`), or set `API_HOST_PORT` / `WEB_HOST_PORT`. If you change `API_HOST_PORT`, set `WEB_API_BASE_URL` to match. |
| Status page shows API unreachable | `docker compose ... ps`; read `logs api`. Open the page at `http://localhost:5173` (the CORS allowlist). |
| `intelligence_service` is `unreachable` | `logs intelligence`; the API reports this honestly and keeps running. |
| `set POSTGRES_USER in database/.env` | Pass `--env-file database/.env` on every compose command. |
| Source edits do not appear in the web container | Only `apps/web/src` and `index.html` are mounted; rebuild for other files. API and intelligence changes need `up -d --build <service>`. |

---
## Current Status

- [x] Problem statement & requirements analysis
- [x] UI/UX prototypes designed in Google Stitch
- [x] Master engineering specification & roadmap ([PROJECT.md](./PROJECT.md))
- [x] Phase 1 / Milestone 1: development environment verified
- [x] Phase 1 / Milestone 2: historical datasets profiled ([coverage report](./docs/data-sources/DATASET_COVERAGE.md))
- [x] Phase 1 / Milestone 3: monorepo foundation, `.gitignore`, `.env.example`, raw data organised
- [x] Phase 1 / Milestone 4: Google Stitch assets preserved, inventoried and documented ([screen map](./design/stitch/SCREEN_MAP.md))
- [x] Phase 1 / Milestone 5: frontend foundation in `apps/web` (React + Vite + JavaScript + Tailwind v3, status page, JSDoc-typed API client)
- [x] Phase 1 / Milestone 6: Express.js (JavaScript) API foundation in `apps/api` (`/health`, `/health/dependencies`, `/api/v1`)
- [x] Phase 1 / Milestone 7: FastAPI intelligence service foundation in services/intelligence (infrastructure only: no models, no forecasts)
- [x] Phase 1 / Milestone 8: PostgreSQL setup in `database/` (dedicated container, least-privilege roles, Drizzle migrations; one neutral table, no agricultural data)
- [x] Phase 1 / Milestone 9: Docker Compose integration of `web`, `api`, `intelligence` and `db` (see [Running with Docker Compose](#running-the-full-stack-with-docker-compose))

> **Local ports:** defaults are API `4000`, web `5173`, intelligence service `8000`. On the current
> development machine the intelligence service temporarily runs on `8001` (port 8000 is occupied by
> an unrelated process) via git-ignored `.env` overrides; see `services/intelligence/README.md`.
- [x] Phase 1 / Milestone 10: Express connects to PostgreSQL through a bounded pool (application role) with a real `/health/dependencies` probe; Express to FastAPI probe preserved
- [ ] Core services & data pipeline implementation (not started)

---

## License

Private repository for SYRUS 7.0 Hackathon development.