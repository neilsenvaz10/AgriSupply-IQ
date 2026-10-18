# FASALYTICS threat model

> **Status:** Phase 1 baseline (Milestone 11). It describes the system **as built today** and the risks that
> later phases must address. Each control is marked **Implemented** (exists in the repository and is
> tested), **Planned** (designed, not built), or **Not applicable yet**. Nothing marked Planned should be
> treated as protection. Companion documents: [CREDENTIAL_POLICY.md](./CREDENTIAL_POLICY.md) and
> [DEPENDENCY_AUDIT.md](./DEPENDENCY_AUDIT.md).

## 1. What is being protected

| Asset | Why it matters | Today |
| --- | --- | --- |
| Database credentials (admin, migrator, app roles) | Full read/write control of all stored data | In git-ignored `database/.env` (development only) |
| Market-price and arrival data and its provenance | Farmers decide where to sell from it; silent corruption causes real financial harm | Only a neutral `system_metadata` table exists; no agricultural data is stored yet |
| Trained model artifacts (Phase 3) | A tampered model gives confidently wrong forecasts | None exist; the service loads none |
| Future user accounts and location data (Phases 5-9) | Personal and location data of farmers | None exist |
| Third-party API keys (Groq, weather, SMS; later phases) | Cost and abuse | Placeholders only in `.env.example` |
| Availability of the API | Farmers need answers at decision time | Local development only |

## 2. Trust boundaries and data flows

```text
 Browser (untrusted)                              Internet / host network (untrusted)
    |  HTTP, CORS allowlist, X-Request-Id
    v
 [B1] ----------------------------------------------------------------------------------
 Express API (apps/api)  - the ONLY public entry point. Validates input, owns the DB pool.
    |                                   |
    | [B2] HTTP, internal network       | [B3] PostgreSQL protocol, internal network
    |      X-Request-Id forwarded       |      application role only (fasalytics_app)
    v                                   v
 FastAPI intelligence service        PostgreSQL 17
 (internal only, not published)      (host: 127.0.0.1:5433 for developer tools only)
```

| Boundary | Crossing | Controls today | Gaps |
| --- | --- | --- | --- |
| **B1** Browser to Express | Any request from any origin or script | **Implemented:** explicit CORS allowlist (no wildcard; required in production), Helmet security headers, JSON body limit (100 kb), request timeout, centralised error contract that never returns stacks or internals, `X-Request-Id` validation, published on host loopback only (`127.0.0.1:4000`). | **Planned:** authentication, authorization, rate limiting, TLS (development uses plain HTTP on loopback). Anyone who can reach port 4000 can call the API. |
| **B2** Express to FastAPI | Express calls `GET /health` and `GET /ready`; later phases will send prediction inputs | **Implemented:** FastAPI is on the Compose network only (not published); the probe has a timeout, no redirects, a 16 KiB body bound and an identity check (`service: fasalytics-intelligence`), so a foreign service answering 200 is rejected. | **Planned:** service-to-service authentication. Inside the network any container could call FastAPI. Fine for the single-developer Compose network, not for shared hosting. |
| **B3** Express to PostgreSQL | SQL over the network | **Implemented:** least-privilege application role (DML only: no DDL, no `TRUNCATE`, no access to the migration journal, no access to the maintenance database), role-name guard in config, bounded pool and statement timeouts, fixed parameter-free probe query, loopback-only published port. | **Planned:** TLS to the database (not needed on the private Compose network, required anywhere else). |
| **B4** Developer machine to PostgreSQL | Migrations and tooling via `localhost:5433` | **Implemented:** migrator role used only by the migration CLI, never by the API; loopback bind. Migrations are explicit, never run at API start. | The admin role password sits in a local file. |
| **B5** CI to repository | GitHub Actions | **Implemented:** workflow uses `contents: read` only, a disposable database with random masked credentials, no secrets, no deployment. | Branch protection must be enabled in GitHub (see [../process/REPOSITORY_POLICY.md](../process/REPOSITORY_POLICY.md)); it is a repository setting, not code. |

## 3. Authentication and authorization (future phases)

**Not applicable yet:** there are no user accounts, and the only endpoints are operational (`/health`,
`/health/dependencies`, `/ready`) which expose dependency status but no data.

Design constraints for later phases (all **Planned**):

- Firebase Authentication is the intended identity provider (PROJECT.md). Express must verify ID tokens on
  every protected route; the browser is never trusted to state who it is.
- Authorization is enforced in Express, not in the UI. Every query that returns user data must be scoped by
  the authenticated user id.
- `/health/dependencies` and `/ready` reveal which infrastructure exists. Before any public deployment they
  should be restricted to the platform's internal probes or reduced to a liveness-only public view.
- FastAPI must not accept requests that did not come from Express (network isolation now, authentication
  later).

## 4. Untrusted input and SQL injection

- **Untrusted inputs today:** HTTP method, path, query string, headers (`Origin`, `X-Request-Id`), JSON
  bodies (none of the current routes accept one).
- **Implemented:** `X-Request-Id` must match `^[A-Za-z0-9._-]{8,64}$` in both Express and FastAPI, otherwise a
  generated UUID replaces it (prevents log injection and header injection; tested). Bodies are size-limited
  and parse errors map to a fixed error body. FastAPI validates input with Pydantic and returns field names
  and rules only, never submitted values.
- **SQL injection:** the API issues exactly one SQL statement today, the constant `SELECT 1`. No user input
  reaches SQL. **Rule for Phase 2 onwards:** all queries use bound parameters (Drizzle or `pg` placeholders);
  string-built SQL is forbidden; identifiers that vary (sort columns, table names) come from an allowlist.
  Even a successful injection would be limited by the application role (no DDL, no role changes), which is
  a **defence in depth** measure, not a substitute for parameterisation.
- **Planned:** a centralised request-validation layer for body-accepting endpoints (a schema per route) when
  the first such endpoint is added in Phase 2. None exists, so none is claimed.

## 5. Credential storage and rotation

See [CREDENTIAL_POLICY.md](./CREDENTIAL_POLICY.md). Summary: secrets live only in git-ignored `.env` files and
the process environment; nothing is hardcoded; logs and responses redact them; **rotation is a manual,
documented procedure today** and automated secret management is **Planned** for any shared environment.

## 6. Docker environment-variable exposure

- The `api` container receives `DATABASE_URL` (application role) as an environment variable, built by
  `compose.yaml` from `database/.env`. Anyone able to run `docker inspect` or `docker exec ... env` on that
  container, or to read the Docker socket, can read it. On a single-developer workstation that person is
  already the developer. In any shared or hosted environment this is **not acceptable**: use Docker/Compose
  secrets or the platform's secret store (**Planned**).
- The `db` container receives the admin, migrator and app passwords because its init script needs them to
  create the roles on first start. They are not passed to `api`, `intelligence` or `web`.
- `VITE_*` variables are compiled into the browser bundle. Never put a secret in one (checked in review; the
  root `.env.example` says so).
- Images contain no `.env`, credentials, datasets or model artifacts (`.dockerignore`). Containers run
  non-root (`api`, `web`, `intelligence`), drop all capabilities, use `no-new-privileges`; `api` and
  `intelligence` have read-only root filesystems.
- Published ports bind to `127.0.0.1` only; FastAPI is not published.

## 7. Data integrity and provenance

**Not applicable yet** (no agricultural data is stored). Risks Phase 2 must address, taken from PROJECT.md
section 4:

| Risk | Required control (Planned) |
| --- | --- |
| Wrong or mixed units (tonne vs quintal) | Normalise on ingest, keep the source unit, test conversions |
| Duplicate or revised records | Idempotent upserts keyed by source record, overlapping re-fetch windows |
| Synthetic or stale data shown as current | `is_synthetic` flag, `is_historical_snapshot` flag, freshness based on last observation |
| Blending market, state and national records | `geo_granularity` is never mixed; enforced by schema and tests |
| Silent source change or tampering | Raw snapshot checksums and a manifest (source, retrieved time, SHA-256) |
| Look-ahead leakage in training features | Availability timestamps and cutoff-safe feature tests (Phase 3) |
| Original datasets modified | The four files in `data/raw/` are git-ignored inputs; checksums are recorded and re-verified at milestone close-out |

## 8. ML artifact and model-loading risks

**Today:** no model is loaded; FastAPI `/ready` returns 503 and reports `model_ready: false`, and no
capability is derived from the mere existence of files.

Risks and **Planned** controls for Phase 3:

- **Unsafe deserialisation:** loading pickled/joblib artifacts executes code. Only load artifacts produced by
  this repository's own training command, from a directory that is not writable by the service, and prefer
  formats without code execution (for example native XGBoost JSON/UBJ) over pickle.
- **Tampering or substitution:** record a SHA-256, model version, data snapshot id and feature schema in a
  manifest; refuse to load an artifact whose checksum or schema does not match; never download artifacts at
  runtime from a URL.
- **Wrong model served as ready:** readiness requires validated models with passing evaluation metadata;
  until then forecasts return an explicit unavailable/fallback status. Express reports FastAPI model
  readiness separately and never infers it from `/health` (tested).
- **Resource exhaustion:** request body and timeout limits exist in FastAPI; add per-request input bounds
  when `POST /predict` is introduced.

## 9. Dependency vulnerabilities

See [DEPENDENCY_AUDIT.md](./DEPENDENCY_AUDIT.md) (open findings are recorded, nothing is suppressed). CI
installs from lock files (`npm ci`, pinned Python lock). **Planned:** automated `npm audit` / `pip-audit` in
CI with an agreed severity gate, Dependabot or equivalent, container image scanning, and pinning base images
by digest. Until then audits are run by hand at milestone boundaries.

## 10. Logging, request IDs and sensitive data

- **Implemented:** one JSON log line per request (method, path without query string, status, duration,
  request id). Connection strings are redacted (`user:password@` becomes `[redacted]@`) by both services.
  Database errors are logged as SQLSTATE/errno codes only. Health probe results carry fixed messages, never
  addresses or raw driver errors. Error bodies never include stacks, paths or submitted values.
- **Request ids:** Express accepts a client id only if it is safe and bounded, otherwise generates one,
  forwards it to FastAPI as `X-Request-Id`, and returns it in the response header and in structured error
  bodies. FastAPI applies the same rule. A request id is a correlation token, not a secret and not an
  authenticator; it must never encode user data.
- **Planned:** when accounts exist, never log tokens, phone numbers, precise locations or full request
  bodies; add log retention limits.

## 11. Development versus production assumptions

| Topic | Development (this repository today) | Production (required, mostly **Planned**) |
| --- | --- | --- |
| Transport | Plain HTTP on loopback | TLS everywhere outside one trust zone |
| Authentication | None | Firebase ID-token verification on protected routes |
| Secrets | Local `.env` files, env vars in Compose | Secret manager or Compose/Swarm/Kubernetes secrets; rotation schedule |
| CORS | Allowlist, loopback twins allowed | Explicit origins only (already enforced: `API_CORS_ORIGINS` is mandatory when `NODE_ENV=production`) |
| Web container | Vite dev server with live reload | Static production build behind a hardened server |
| Database | One local container, volume on the developer machine | Managed or hardened PostgreSQL, backups, restricted network, TLS |
| Images | Version-pinned tags | Digest-pinned, scanned, rebuilt regularly |
| Operational endpoints | Open on loopback | Restricted to internal probes |

## 12. Residual risks accepted for Phase 1

1. No authentication or rate limiting: acceptable only because every port is bound to loopback.
2. Database credentials are visible to local Docker users.
3. Base images are not digest-pinned and dependency audits are manual.
4. The web dev server is not a production server.

Each item must be closed or consciously re-accepted before any deployment.
