# FASALYTICS intelligence service

Internal FastAPI service that will host forecasting, risk analysis, what-if scenarios and
harvest allocation.

> **Milestone 7 status: infrastructure only.** There are **no models, no forecasts and no
> market data** in this service yet. `/ready` says so truthfully. It is reached through the
> Express gateway (`apps/api`); browsers must never call it directly.

## Quick start (Windows PowerShell)

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12 (`uv python install 3.12`).

```powershell
cd services\intelligence
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.lock

# run (binds 127.0.0.1:8000)
.venv\Scripts\python.exe -m app

# check
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m ruff format --check .
.venv\Scripts\python.exe -m pytest
```

Exact versions of every package (direct and transitive) are in `requirements.lock`; the direct
dependencies are pinned in `pyproject.toml`. No ML libraries (pandas, scikit-learn, XGBoost,
PyTorch, TensorFlow) are installed: they will be added by the milestone that needs them.

## Ports: the default and a temporary local override

- **Default (committed everywhere):** the service listens on `127.0.0.1:8000`, and the Express
  gateway probes `ML_SERVICE_URL=http://127.0.0.1:8000`.
- **Temporary local override (not part of the project defaults):** if port 8000 is occupied by an
  unrelated process, run FastAPI on another port by setting it in your own git-ignored files:

  ```text
  services/intelligence/.env   ML_SERVICE_PORT=8001
  apps/api/.env                ML_SERVICE_URL=http://127.0.0.1:8001
  ```

  Both values must change together. Express only treats a service as healthy if it answers
  `GET /health` with `service: fasalytics-intelligence`, so an unrelated service on the
  configured port is reported as `unreachable` (`unexpected_response`), never as healthy.
- To return to the default, delete the override lines and restart both processes.

## Endpoints

| Method | Path | Meaning |
|---|---|---|
| GET, HEAD | `/health` | **Liveness.** `200` whenever the process runs. Says nothing about models. |
| GET, HEAD | `/ready` | **Readiness for ML work.** `200 ready` only when validated models are loaded; `503 not_ready` when the process is up but ML capabilities are unavailable (always, in Milestone 7). |
| GET | `/docs`, `/openapi.json` | Development only (disabled when `APP_ENV=production`). |

### `GET /health` → 200

```json
{ "status": "ok", "service": "fasalytics-intelligence", "version": "0.1.0", "uptime_seconds": 12 }
```

### `GET /ready` → 503 (Milestone 7)

```json
{
  "status": "not_ready",
  "service": "fasalytics-intelligence",
  "version": "0.1.0",
  "model_ready": false,
  "application": { "available": true },
  "models": {
    "loaded": false,
    "loaded_count": 0,
    "artifact_directory": { "configured": true, "exists": false },
    "reason": "the model artifact directory does not exist and no models are loaded"
  },
  "capabilities": {
    "forecasting": false,
    "risk_analysis": false,
    "scenario_simulation": false,
    "allocation": false
  }
}
```

A file in the artifact directory is **not** a loaded model. A model counts as loaded only after
a validated loader (not yet written) has verified its checksum, feature schema and evaluation
record.

### Errors

Same shape as the Express API:

```json
{ "error": { "code": "NOT_FOUND", "message": "The requested resource was not found.", "requestId": "…" } }
```

Codes: `BAD_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `PAYLOAD_TOO_LARGE` (413),
`VALIDATION_ERROR` (422, field names and failed rules only, never submitted values),
`REQUEST_TIMEOUT` (503), `INTERNAL_ERROR` (500). Stack traces and exception messages are never
returned; they are logged server-side with credentials redacted.

## Configuration

Environment variables (see `.env.example`). Real environment variables beat `.env` files
(`services/intelligence/.env`, then the repo-root `.env`; unrelated variables are ignored).

| Variable | Default | Rule |
|---|---|---|
| `APP_ENV` | `development` | `development`, `test`, `production` |
| `ML_SERVICE_HOST` | `127.0.0.1` | hostname or IP; keep loopback for local development |
| `ML_SERVICE_PORT` | `8000` | 1–65535 |
| `LOG_LEVEL` | `info` | `silent`, `critical`, `error`, `warn`/`warning`, `info`, `debug` |
| `ML_MODEL_DIR` | `./models/artifacts` | need not exist; relative paths resolve from the repo root |
| `ML_REQUEST_TIMEOUT_S` | `30` | > 0 and ≤ 300 |
| `ML_MAX_BODY_BYTES` | `1048576` | 1024–10485760 |

Invalid values stop startup with exit code 1 and a message naming the **variable**, never the
value. The service needs neither model files nor PostgreSQL to start.

## Request ids and the API contract

`X-Request-Id` (8-64 characters from `A-Za-z0-9._-`) is accepted from the caller, otherwise a UUID is
generated. The Express API forwards its own request id on every probe, so one id follows a request across
both services. The id is returned in the `X-Request-Id` header, in error bodies (`error.requestId`) and in
every JSON log line. Unsafe or over-long ids are replaced, never echoed.

The OpenAPI document is committed at `docs/api/intelligence.openapi.json`. After changing an endpoint or
schema, regenerate it with `python scripts/export_openapi.py`; `tests/test_openapi_contract.py` fails while
the file is stale.

## Running in Docker

`docker compose --env-file database/.env up -d --build --wait intelligence` (or the whole stack;
see the root README). The image uses `python:3.12.15-slim`, installs `requirements.txt` constrained
by `requirements.lock`, runs as non-root user `10001` with a read-only root filesystem, and contains
no `.env`, datasets or model artifacts. It binds `0.0.0.0:8000` **inside** the container and is
**not published to the host**; Express reaches it at `http://intelligence:8000`. The container
healthcheck calls `/health` (alive). `/ready` is deliberately not used: it returns 503 until
validated models are loaded. To use it from the host, run it outside Docker (`python -m app`, port
8000 or the temporary `8001` override) as described above.

`requirements.txt` lists the runtime dependencies and must match `pyproject.toml`
(`tests/test_dependencies.py` enforces this).

## Reliability and security

- No CORS middleware: this is an internal service.
- Every response carries `X-Request-Id` (a safe client-supplied id is reused); logs are JSON
  lines with the request id and credential redaction.
- Declared request bodies above `ML_MAX_BODY_BYTES` get 413; handlers exceeding
  `ML_REQUEST_TIMEOUT_S` get 503. (Chunked bodies without a length are not inspected; the
  service accepts no bodies yet.)
- Uvicorn handles SIGINT/SIGTERM: stop accepting, drain for up to 10 s, run shutdown hooks.
- `limit_concurrency=100` and a 5 s keep-alive bound resource use.

## Layout

```text
app/
├── main.py            application factory (create_app)
├── __main__.py        `python -m app` entry point
├── config.py          validated settings
├── api/health.py      /health and /ready
├── core/              logging, errors, middleware, model registry
├── schemas/           Pydantic response models
└── (extension points, docstrings only; see each package)
    data_prep/ features/ forecasting/ evaluation/ risk/ scenarios/ allocation/ artifacts/
tests/                 pytest suite
```

The extension packages contain **only documentation of their contract**. They must not be
filled with placeholder predictions or synthetic data. FASALYTICS is nationwide and
commodity-agnostic: nothing in this service may hardcode a state, crop or mandi, and future
forecasts must depend on data sufficiency, freshness and backtesting.
