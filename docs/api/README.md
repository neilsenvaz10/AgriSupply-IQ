# API contracts

The contracts below document the **existing** operational endpoints. No agricultural endpoints exist yet.
Both documents are OpenAPI 3.1 JSON and are checked by tests, so they cannot silently drift from the code.

| Service | Contract | How it is kept correct |
| --- | --- | --- |
| Express API (`/health`, `/health/dependencies`, `/ready`) | [express.openapi.json](./express.openapi.json) | `apps/api/src/contract/openapi.contract.test.js` validates live responses (healthy, degraded, unconfigured) against the schemas |
| FastAPI intelligence service (`/health`, `/ready`) | [intelligence.openapi.json](./intelligence.openapi.json) | Generated from the application; `services/intelligence/tests/test_openapi_contract.py` fails if the file is stale. Regenerate with `python scripts/export_openapi.py` in `services/intelligence` |

## Three different questions

| Endpoint | Question it answers | Fails (non-2xx) when |
| --- | --- | --- |
| Express `GET /health` | Is the Express process alive? | Never because of PostgreSQL or FastAPI |
| Express `GET /health/dependencies` | What did the probes just find? | Never (always 200; read `overall` and each `status`) |
| Express `GET /ready` | Can the API do its job right now? | **503** when a *configured* dependency (PostgreSQL, intelligence service) is not healthy |
| FastAPI `GET /health` | Is the FastAPI process alive? | Never because of models |
| FastAPI `GET /ready` | Are validated forecasting models loaded? | **503** until models exist (the case in Phase 1, by design) |

### Express readiness is not model readiness

`GET /ready` on Express reports whether the **API's dependencies** are healthy. A healthy intelligence
service means "the FastAPI process answered and identified itself", nothing more. Whether forecasting models
are loaded is answered only by FastAPI's own `GET /ready`, and Express echoes that answer separately as
`forecasting_models` with `gates_readiness: false`:

- `ready`: FastAPI `/ready` returned 200 **and** `model_ready: true`.
- `not_ready`: FastAPI `/ready` returned 503 / `model_ready: false` (today).
- `unknown`: not configured, unreachable, or an unrecognised answer.

Express readiness is therefore `ready` (200) in Phase 1 even though `forecasting_models.status` is
`not_ready`. Later features that need models must check `forecasting_models`, or call FastAPI and handle its
explicit "unavailable" status, and must never infer model availability from `/health` or from Express
`/ready`.

Readiness rules: a dependency that is **configured** is **required**; one that is not configured is reported
as `not_configured` with `required: false` and does not block. `not_checked` (configured but impossible to
probe) and `unreachable` both block.

## Request ids

Both services accept `X-Request-Id` (8-64 characters from `A-Za-z0-9._-`), otherwise generate a UUID. Express
forwards the id to FastAPI on every probe, returns it in the `X-Request-Id` response header, includes it in
structured error bodies (`error.requestId`) and writes it to log lines. See the threat model for why unsafe
ids are replaced.

## Validation

There is no body-accepting endpoint yet, so request validation is limited to headers, method and path.
Express maps framework errors to the standard error body in one place (`middleware/errorHandler.js`) and
validates configuration in one place (`config/env.js`). FastAPI uses Pydantic models and its central
error handlers. When the first body-accepting endpoint arrives (Phase 2), it must define a schema and use the
same central error contract.
