#!/bin/sh
# Runs ONCE, when the PostgreSQL data volume is first initialised
# (docker-entrypoint-initdb.d). It creates the least-privilege roles.
#
#   POSTGRES_USER (superuser)  bootstrap/admin only
#   migrator                   owns the database and schema objects; runs migrations
#   app                        SELECT / INSERT / UPDATE / DELETE only; no DDL, no TRUNCATE
#
# Passwords come from the container environment and are passed to psql as variables
# (:'name' quotes them as literals), so they are neither interpolated by the shell into SQL
# text nor echoed. Do not add `set -x` to this file.
set -eu

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DB_MIGRATOR_USER:?DB_MIGRATOR_USER is required}"
: "${DB_MIGRATOR_PASSWORD:?DB_MIGRATOR_PASSWORD is required}"
: "${DB_APP_USER:?DB_APP_USER is required}"
: "${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v dbname="$POSTGRES_DB" \
  -v migrator_user="$DB_MIGRATOR_USER" -v migrator_pw="$DB_MIGRATOR_PASSWORD" \
  -v app_user="$DB_APP_USER" -v app_pw="$DB_APP_PASSWORD" <<'SQL'

-- Roles: login only; no superuser, no role/database creation, no replication, no RLS bypass.
CREATE ROLE :"migrator_user" LOGIN PASSWORD :'migrator_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- Bound runaway queries from the application role.
ALTER ROLE :"app_user" SET statement_timeout = '30s';

-- Nobody gets anything implicitly: PUBLIC loses all database-level privileges.
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO :"migrator_user", :"app_user";

-- The maintenance database is not a place for application roles.
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;

-- The migrator owns the database and the public schema (so it can run DDL).
ALTER DATABASE :"dbname" OWNER TO :"migrator_user";
ALTER SCHEMA public OWNER TO :"migrator_user";

-- Nobody else may create objects in public; the app role may only use it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";

-- Objects the migrator creates later automatically get data-access-only grants for the app.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_user";
SQL

# Optional ingestion role (Phase 2, Milestone 2.2). Created only when both variables are set.
# It may log in and use the schema; its table privileges are granted by
# scripts/grant-ingest-privileges.js, run as the migrator AFTER the migrations (so it can grant
# on the tables that exist then), and never include DELETE, TRUNCATE or DDL.
if [ -n "${DB_INGEST_USER:-}" ] && [ -n "${DB_INGEST_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"     -v dbname="$POSTGRES_DB" -v ingest_user="$DB_INGEST_USER" -v ingest_pw="$DB_INGEST_PASSWORD" <<'SQL'
CREATE ROLE :"ingest_user" LOGIN PASSWORD :'ingest_pw'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE :"ingest_user" SET statement_timeout = '10min';
GRANT CONNECT ON DATABASE :"dbname" TO :"ingest_user";
GRANT USAGE ON SCHEMA public TO :"ingest_user";
SQL
fi
