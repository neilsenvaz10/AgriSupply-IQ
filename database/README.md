# FASALYTICS database

PostgreSQL for FASALYTICS, managed with **Drizzle ORM** (JavaScript) and **drizzle-kit**
migrations.

> **Status.** Milestone 8 set up PostgreSQL; **Phase 2, Milestone 2.1 added the canonical
> agricultural schema** (registries, source aliases, provenance and ingestion tracking, four
> granularity-separated observation tables, quarantine and conflict tables). It is **structure only:
> no agricultural data is created by the migrations** and every registry and fact table is empty after
> migration (the development database has since received the Milestone 2.2 import, see
> [docs/INGESTION.md](./docs/INGESTION.md)). The full design, rules and the plan for importing each dataset are in
> [docs/CANONICAL_SCHEMA.md](./docs/CANONICAL_SCHEMA.md). Importers are Milestone 2.2.
> The same `compose.yaml` also runs `web`, `api` and `intelligence`; the Express API connects with the
> application role only (`DATABASE_URL`, host `db:5432` inside Compose), never with admin or migrator
> credentials. See the root README.

## What runs where

| Item                                  | Value                                                        |
| ------------------------------------- | ------------------------------------------------------------ |
| Image                                 | `postgres:17-alpine` (PostgreSQL 17.11 when this was set up) |
| Container                             | `fasalytics-db` (dedicated; used by nothing else)            |
| Data volume                           | `fasalytics_pgdata` (named, persistent)                      |
| Host port                             | `127.0.0.1:5433` (loopback only) -> container `5432`         |
| Existing PostgreSQL on host port 5432 | **Not used and never touched**                               |

## First-time setup

Requires Docker Desktop (running) and Node.js >= 22.12.

```bash
cd database
cp .env.example .env          # then replace every change_me_* with a long random password
npm install
npm run db:up                 # pulls the image, creates the volume, waits until healthy
npm run db:migrate            # applies the migrations
npm run db:verify             # proves connection, privileges and data access
```

Generate a password with, for example, PowerShell:
`-join ((1..24) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })`

`database/.env` is git-ignored. **Never commit it.** The credentials are not hardcoded anywhere
and are never printed by the scripts.

## Commands (run in `database/`)

| Command                                   | What it does                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run db:up`                           | Start the container (`docker compose up -d --wait db`)                        |
| `npm run db:down`                         | Stop and remove only the `db` container. **The data volume is kept.**         |
| `npm run db:status` / `db:logs`           | Container state / last 100 log lines                                          |
| `npm run db:generate`                     | Create a new migration from changes to `src/schema`                           |
| `npm run db:check`                        | Check that the migration history is consistent                                |
| `npm run db:migrate`                      | Apply pending migrations (repeatable; safe to run any number of times)        |
| `npm run db:verify`                       | Verify connections, migrations, data access and denied operations (33 checks) |
| `npm run test:disposable`                 | Full verification against a **throwaway** PostgreSQL container (see below)    |
| `npm test`                                | Unit tests; integration tests run when the database is reachable              |
| `npm run check` / `lint` / `format:check` | JSDoc type check, ESLint, Prettier                                            |

From the repository root the equivalent compose commands are:

```bash
docker compose --env-file database/.env up -d --wait db
docker compose --env-file database/.env rm --stop --force db   # removes only the db container
```

## Roles and privileges (least privilege)

Created once, by `init/01-roles-and-privileges.sh`, when the data volume is first initialised.

| Role                                     | Purpose                                       | Can                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fasalytics_admin` (bootstrap superuser) | Container administration only                 | Everything. **Never used by applications or migrations.**                                                                                                                 |
| `fasalytics_migrator`                    | Owns the database and schema; runs migrations | DDL (create/alter/drop)                                                                                                                                                   |
| `fasalytics_app`                         | Application data access                       | `SELECT`, `INSERT`, `UPDATE`, `DELETE` on tables, `USAGE`/`SELECT` on sequences. **No** DDL, no `TRUNCATE`, no access to the migration journal. 30 s `statement_timeout`. |

Neither the migrator nor the app role is a superuser, and neither can create roles or databases.
`PUBLIC` has no database-level privileges, and cannot create objects in the `public` schema.
Tables created by the migrator automatically grant the app role data access through default
privileges, so new migrations do not need extra GRANT statements.

## Connection strings

| Where the client runs                                                        | Host:port        | Variable                                                            |
| ---------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| **On your machine** (npm scripts, tests, Express or FastAPI started locally) | `localhost:5433` | `DATABASE_URL` (app role), `DATABASE_MIGRATION_URL` (migrator role) |
| **In another container** on the Compose network (the `api` service)          | `db:5432`        | `DATABASE_URL` only (app role), set by `compose.yaml`               |

Examples (passwords are placeholders):

```text
postgresql://fasalytics_app:<app password>@localhost:5433/fasalytics
postgresql://fasalytics_migrator:<migrator password>@localhost:5433/fasalytics
postgresql://fasalytics_app:<app password>@db:5432/fasalytics        # inside Docker
```

Inside a container `localhost` means that container itself, so use the service name `db` and
the container port `5432`. URL-encode special characters in passwords (generated hex passwords
need none). Applications use the **app** URL. Only the migration tooling uses the migrator URL.

## Express API integration tests

`apps/api` has PostgreSQL integration tests (connection, wrong credentials, unreachable database,
pool timeout, connection release, query timeout, no DDL for the app role, graceful shutdown).
Prerequisites: the database running and migrated (`npm run db:up`, `npm run db:migrate`) and
`database/.env` present. Run from `apps/api`:

```bash
npm test                                      # database tests are SKIPPED if the db is down
REQUIRE_DB=1 npm test                         # FAIL instead of skip when the db is down
REQUIRE_DB=1 DB_TEST_RESTART=1 npm test       # also stop/start the db container (data kept)
```

## Migration history

| Migration                                     | Content                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_initial_system_metadata`                | Phase 1: the neutral `system_metadata` table (never modified)                                                                                                 |
| `0001_canonical_agricultural_schema`          | Phase 2.1: 21 tables (registries, aliases, units, sources, files, runs, rejections, conflicts, four fact tables, WPI series) with all constraints and indexes |
| `0002_units_normalised_views_and_comments`    | Phase 2.1: six physical units, two derived normalised views, read-only protection of unit conversions for the application role, table comments                |
| `0003_ingestion_provenance_and_resume`        | Phase 2.2: `source_assumptions`, `unit_basis` on price facts, run resume fields, registry provenance run                                                      |
| `0004_restrict_application_role_to_read_only` | Phase 2.2: the application role keeps SELECT only on every canonical table (ingestion uses its own role)                                                      |

### Test safety: tests never write to your development database

The database integration tests migrate, insert and delete, so they run **only** against a database that proves
it is disposable: a random token that exists both in the test environment (`FASALYTICS_DISPOSABLE_TOKEN`
with `FASALYTICS_DISPOSABLE_DB=1`) and inside the database itself (`ALTER DATABASE ... SET
fasalytics.disposable_token`). Host names and ports are never trusted, and `database/.env` cannot supply the
token. An ordinary `npm test` therefore skips those suites (each skipped suite says why in its name) and writes
nothing, even though `.env` points at the development database. `npm run test:disposable` (and the CI
database job) create and stamp a throwaway database. Deliberate migrations stay available as
`npm run db:migrate`. See `src/test/disposable.js` and its regression tests.

### Ingesting the historical datasets (Phase 2.2)

See [docs/INGESTION.md](./docs/INGESTION.md): dry-run profiling, registry loading, the four importers, resume,
the ingestion role (`SELECT`/`INSERT` only) and the quality and alias reports in `reports/milestone-2.2/`.
Importing into the development database needs the project owner's approval.

### Testing the schema without touching your data

`npm run test:disposable` starts a uniquely named throwaway `postgres:17-alpine` container on a random
loopback port with random credentials, applies only the Phase 1 baseline, stores a marker row, upgrades
to the current schema (proving fresh migration, preservation and repeatability), then runs `db:check`,
the migration runner again, `db:verify` and the whole test suite with `REQUIRE_DB=1`, and removes the
container. It never uses `fasalytics-db` or the `fasalytics_pgdata` volume.

Note: `npm test` run against your development database applies pending migrations first (as the
Milestone 8 tests always have). Integration tests that need the canonical schema stop with an explicit
"prerequisite missing: run `npm run db:migrate`" message when it is absent.

## Migrations

- Source of truth: `src/schema/*.js` (Drizzle table definitions).
- `npm run db:generate` writes SQL to `migrations/` (committed). **Never edit an applied
  migration**; create a new one.
- `npm run db:migrate` applies pending migrations as the migrator role. It records them in
  `drizzle.__drizzle_migrations`, takes an advisory lock so two runners cannot collide, and
  reports "up to date" when there is nothing to do.
- Add a table: create `src/schema/<name>.js`, export it from `src/schema/index.js`, run
  `db:generate`, review the SQL, then `db:migrate`.

## Persistence

Removing the container (`db:down`, or `docker compose down`) **keeps** the named volume, so data survives
`down`/`up` and container restarts. This is covered by the persistence tests:

```bash
# disruptive (restarts and recreates only the fasalytics-db container); never uses `down -v`
DB_TEST_RESTART=1 REQUIRE_DB=1 npm test
```

## Resetting (destructive)

Role passwords are applied only when the volume is **first** created, so editing the passwords
in `database/.env` later does not change an existing database. To start over, which
**permanently deletes all FASALYTICS database data**:

```bash
npm run db:down
docker volume rm fasalytics_pgdata   # explicit, deliberate: removes only the FASALYTICS volume
npm run db:up && npm run db:migrate
```

Never run this against data you need. It affects only the `fasalytics_pgdata` volume.

## Troubleshooting

| Symptom                                  | Likely cause and fix                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `failed to connect to the docker API`    | Start Docker Desktop and wait for "Engine running".                                                                                                    |
| Port 5433 already in use                 | Another process holds 5433. Change `POSTGRES_HOST_PORT` and the ports in the URLs together. Do not point the project at your other PostgreSQL on 5432. |
| `password authentication failed` (28P01) | The URL password differs from the one the volume was initialised with (see Resetting).                                                                 |
| `DATABASE_MIGRATION_URL is required`     | `database/.env` is missing or incomplete.                                                                                                              |
| Integration tests are skipped            | The database is not running. Run `npm run db:up`, or use `REQUIRE_DB=1` to make that a failure.                                                        |
| Init script did not run                  | It runs only on first initialisation of an empty volume.                                                                                               |

## Security notes

- The port is bound to `127.0.0.1` only; the database is not reachable from the network.
- Credentials are read from the git-ignored `database/.env`; error output redacts connection
  strings.
- The init script passes passwords to `psql` as quoted variables and does not echo them.
- `npm audit` reports 4 moderate findings in the dev-only `drizzle-kit` CLI (a nested old
  `esbuild`); runtime dependencies have none. See `docs/security/DEPENDENCY_AUDIT.md`.
