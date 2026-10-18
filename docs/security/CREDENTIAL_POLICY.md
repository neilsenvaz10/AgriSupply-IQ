# Credential policy

> **Scope:** every secret used by FASALYTICS. Companion to [THREAT_MODEL.md](./THREAT_MODEL.md). "Implemented"
> means true in the repository today; "Planned" means a requirement for later phases or shared environments.

## Rules

1. **No secret is ever committed.** `.env` and `.env.*` (except `*.example`) are git-ignored. Example files
   contain placeholders only (`change_me_*`, empty values). **Implemented.**
2. **No secret in the browser.** Variables prefixed `VITE_` are compiled into the public bundle and must
   never hold a secret. The browser talks only to Express. **Implemented** (convention and review).
3. **Least privilege by role.** **Implemented.**

   | Credential | Used by | Can |
   | --- | --- | --- |
   | `fasalytics_admin` (bootstrap superuser) | Container initialisation and administration only | Everything. Never used by applications or migrations. |
   | `fasalytics_migrator` | The migration CLI (`database/`) only | DDL on the FASALYTICS database. Never given to the API. |
   | `fasalytics_app` | The Express API | `SELECT/INSERT/UPDATE/DELETE`; no DDL, `TRUNCATE`, role changes or journal access; 30 s statement timeout. |

   Express refuses a `DATABASE_URL` whose user name looks administrative, migrator or superuser.
4. **Secrets are never printed.** Configuration errors name the variable and the rule, never the value.
   Logs redact `user:password@`. Health responses use fixed messages. **Implemented and tested.**
5. **Generated, long, unique.** Use at least 24 random bytes (48 hex characters), a different value per
   role and per environment. Example: `openssl rand -hex 24`. **Implemented** (development passwords were
   generated this way).
6. **CI uses disposable credentials.** The workflow generates random passwords per run, masks them, and
   starts a database that exists only on that runner. It has no access to developer or production secrets.
   **Implemented.**

## Where secrets live

| Environment | Location | Status |
| --- | --- | --- |
| Local development | `database/.env` (database roles, host connection strings); optional `apps/api/.env`, `services/intelligence/.env` for host-run processes | **Implemented** (git-ignored) |
| Docker Compose development | Values from `database/.env` interpolated by `compose.yaml`; the `api` container receives only the application-role URL; `db` receives the three role passwords for first-time initialisation | **Implemented**; visible to anyone who can inspect the containers |
| CI | Generated per run, masked, discarded | **Implemented** |
| Shared / staging / production | A secret manager or orchestrator secrets (not environment variables baked into compose files) | **Planned** |

Third-party keys (Groq, weather, routing, SMS/WhatsApp, Firebase service account) are blank placeholders in
`.env.example`. When introduced they follow the same rules and are server-only (Express or FastAPI, never
the browser).

## Docker environment-variable exposure

Environment variables are readable through `docker inspect`, `docker exec ... env`, and `/proc/<pid>/environ`
by anyone with access to the Docker daemon. This is accepted **for local development only**. For any shared
host: use Docker/Compose secrets (files mounted at `/run/secrets/...`) or a secret manager, and read them at
startup. Do not copy production credentials into a developer's `.env`.

## Rotation

Role passwords are applied only when the data volume is first initialised (see `database/README.md`), so a
rotation is a deliberate operation. Do not delete the volume to rotate a password.

**Rotate a role password (development), without losing data:**

1. Generate a new value (`openssl rand -hex 24`).
2. As the admin role, run `ALTER ROLE fasalytics_app PASSWORD '<new>'` (use `psql` with a variable, not shell
   interpolation into SQL text).
3. Update `database/.env` (and `apps/api/.env` if you use it), then recreate only the affected container:
   `docker compose --env-file database/.env up -d api`.
4. Confirm `GET /ready` returns 200 and the old password is rejected.

**Rotate after a suspected leak:** treat every secret in the exposed location as compromised, rotate all three
database roles, rotate third-party keys at their providers, and review `git log` for accidental commits.
If a secret was ever committed, rotating it is mandatory; deleting the commit does not make it safe.

**Cadence:** rotate on suspicion, on any collaborator change, and before the first deployment. A scheduled
rotation (for example every 90 days) with automation is **Planned** for any shared environment.

## Checks

- Before sharing a branch: `git diff` shows no real values; `git grep -n "postgresql://"` shows only
  placeholders and documentation.
- Tests assert that passwords do not appear in health responses, configuration errors, or log output.
- **Planned:** an automated secret scanner in CI.
