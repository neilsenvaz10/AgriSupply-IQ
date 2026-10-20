# Development migration checklist (migrations 0005 and 0006)

Status: **prepared, not executed.** Rehearsed on a disposable clone of the development database (a pg_dump restored into a separate container). The development database has not been written to. Run this only after explicit approval.

## Backup requirements (before anything)

1. Stop writers: no ingestion run in progress; the API may keep serving reads (the migrations take brief locks only on new objects).
2. Take a logical backup with the admin role: `pg_dump -Fc` of the `fasalytics` database to a path outside Git and outside the Docker volume (about 375 MB at the time of the rehearsal).
3. Record the SHA-256 of the dump and the row counts: `mandi_observations` 735,461; `state_observations` 1,953,793; `national_monthly_prices` 2,800; `wpi_observations` 6,273 (sum 2,698,327); `markets` 1,610; `ingestion_rejections` 4,364.
4. Restore the dump into a disposable container and run the verification below on it first (the rehearsal procedure). Never drop, reset or recreate `fasalytics_pgdata`.

## Preconditions

- The development cluster has the NOLOGIN group roles `fasalytics_reviewer` and `fasalytics_approver`. `database/init` creates them only on a **fresh** cluster, so on the existing cluster an administrator must create them once (`CREATE ROLE ... NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`). Without them the migrations still apply, but `db:grant-identity` fails closed and nobody can act.
- No reviewer or approver login is created by this work. Real people are added by an administrator, each in exactly one group.
- Branch merged or the migration files checked out at the reviewed commit; `npm run db:check`, lint, format and the disposable suite green.

## Steps

1. `npm run db:migrate` as the migrator role. Expected: "Applied 2 migration(s); 7 total." Run it again: "Database is up to date (7 migration(s) already applied)."
2. `npm run db:grant-identity` (as the migrator). Expected: reviewer 3 functions, approver 5, no direct table writes.
3. Re-run the ingest grant script so the ingest role keeps its permissions but has no write to the identity tables (`npm run db:grant-ingest`).
4. `npm run db:verify`: all checks pass (75 on the disposable database).
5. Do **not** run `db:load-lgd`: loading the LGD reference into development is a separate approval (the loader refuses non-disposable databases).

## Verification after migrating

- The 23 original tables: per-table row count and content fingerprint equal to the pre-migration values.
- Observation counts as above, unchanged.
- `drizzle.__drizzle_migrations`: the first 5 rows (id and hash) unchanged; two new rows.
- Five new tables exist and are empty; four views are `security_invoker`.
- The application role: SELECT only on the new tables and views; cannot execute any identity function; cannot write the audit log.
- The API health and market contract tests pass against the migrated database.
- `identity_decision_in_effect` is empty: no mapping is applied.

## Rollback

Migrations are additive and nothing in existing tables references them. If a step fails: drop the new views, the eleven functions, the five tables (`identity_review_event`, `identity_decision`, `mapping_set`, `admin_unit_version`, `geo_reference_set`) in that order, delete the two journal rows (`drizzle.__drizzle_migrations` ids 6 and 7), and restore from the backup only if existing data differs from the recorded fingerprints.
