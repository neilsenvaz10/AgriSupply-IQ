# FASALYTICS database

PostgreSQL for FASALYTICS, managed with **Drizzle ORM** (JavaScript) and **drizzle-kit**
migrations.

> **Milestone 8 status: PostgreSQL setup only.** The database contains one neutral table
> (`system_metadata`) that proves migrations, privileges and persistence work. It holds **no
> agricultural data**. The commodity, market and observation tables, and all data ingestion,
> belong to Phase 2.
> The same `compose.yaml` also runs `web`, `api` and `intelligence` (Milestone 9). Since Milestone 10
> the Express API connects with the application role only (`DATABASE_URL`, host `db:5432` inside
> Compose); it never receives admin or migrator credentials. See the root README.

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

| Command                                   | What it does                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `npm run db:up`                           | Start the container (`docker compose up -d --wait db`)                 |
| `npm run db:down`                         | Stop and remove only the `db` container. **The data volume is kept.**  |
| `npm run db:status` / `db:logs`           | Container state / last 100 log lines                                   |
| `npm run db:generate`                     | Create a new migration from changes to `src/schema`                    |
| `npm run db:check`                        | Check that the migration history is consistent                         |
| `npm run db:migrate`                      | Apply pending migrations (repeatable; safe to run any number of times) |
| `npm run db:verify`                       | Verify connections, migrations, data access and denied operations      |
| `npm test`                                | Unit tests; integration tests run when the database is reachable       |
| `npm run check` / `lint` / `format:check` | JSDoc type check, ESLint, Prettier                                     |

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
