# Dependency security audit

> **Status:** open findings, **to be reviewed before any deployment**. Nothing was suppressed or ignored.
> **Audited:** 14 October 2026 with `npm audit` (data from the npm advisory database as returned that day).
> **Scope:** `apps/web` and `apps/api`. No fixes were applied: every available fix is a major version change that needs approval.

## Summary

| Workspace | Vulnerabilities | Runtime (shipped to users/servers) | Dev/build tooling only |
|---|---:|---:|---:|
| `apps/api` | **0** | 0 | 0 |
| `apps/web` | **9** (5 high, 4 moderate) | **2 moderate** (React Router) | 7 (Tailwind 3 dependency chain) |

`npm audit fix` (non-breaking) was run in **dry-run mode** for `apps/web`: it would change **0 packages**. The vulnerable ranges can only be cleared by major upgrades of Tailwind CSS (3 → 4) and React Router (6 → 7), both outside the approved stack.

## Findings: `apps/web`

### Runtime dependency (ships in the browser bundle)

| Package | Installed | Severity | Advisory | Issue | Affects this app today? |
|---|---|---|---|---|---|
| `react-router` / `react-router-dom` (direct) | 6.30.6 | moderate | GHSA-wrjc-x8rr-h8h6 | Open redirect via a backslash in `<Link>` / `useNavigate` (bypass of CVE-2025-68470) | **Low.** The only link target is the fixed internal path `/status`; no navigation target is built from user input or the URL. Becomes relevant if a feature ever navigates to a user-supplied path (for example a `?next=` parameter). |
| same | 6.30.6 | moderate | GHSA-337j-9hxr-rhxg | Arbitrary constructor injection in `deserializeErrors()` during **SSR hydration** | **No.** The app is client-rendered only; there is no server rendering or hydration of serialized errors. |

**Remediation:** upgrade to `react-router-dom@7.x` (breaking change; npm suggests 7.18.4). No patched 6.x release exists in the reported range.
**Recommendation:** accept for development; re-evaluate before deployment and before adding any redirect-by-parameter behaviour.

### Development/build-time dependencies (not shipped to users)

All reached through the direct dev dependency `tailwindcss@3.4.19`, used only by the build tool and dev server.

| Package | Severity | Advisory | Issue | Relevant? |
|---|---|---|---|---|
| `braces` | high | GHSA-vfj7-8cjw-p6xm | Stack exhaustion (DoS) via deeply nested brace patterns | Tooling only. Patterns come from the project's own files, not from users. |
| `micromatch` | high | via `braces` | Inherits the above | Same |
| `chokidar` (2.0.0–3.6.0) | high | via `braces` | Inherits the above | Same |
| `fast-glob` | high | via `micromatch` | Inherits the above | Same |
| `postcss-selector-parser` (<7.1.6) | moderate | GHSA-rj75-hqrm-r3gf | Quadratic CPU cost on flat selectors | Tooling only; parses the project's own CSS. |
| `postcss-nested` | moderate | via `postcss-selector-parser` | Inherits the above | Same |
| `tailwindcss` | high | via the packages above | Aggregates the chain | Same |

**Remediation:** Tailwind CSS 4 (major; changes configuration and plugin model). No non-breaking fix is available.
**Risk assessment:** denial of service against a developer's or CI machine would require a malicious file in the repository; none of this code runs in production.

## Findings: `apps/api`

`npm audit` reports **0 vulnerabilities** (including with `--omit=dev`) for Express 5.3.0, Helmet 8.3.0, CORS 2.8.6 and the test/build tooling.

## Version-selection notes (compatibility, not vulnerabilities)

| Choice | Reason |
|---|---|
| TypeScript removed | Both apps were migrated to JavaScript; `typescript`, `typescript-eslint`, `tsx` and all `@types/*` packages are no longer dependencies |
| `jsdom` pinned to 29.1.1 (web) | `jsdom@30` requires Node ≥ 24.15; the project machine runs 24.13.1 |
| Express 5 | Current stable line; native async error propagation |

## Actions required before deployment

1. Decide on **React Router 7** (and migrate) or document an accepted risk with the "no user-controlled navigation targets" rule enforced in code review.
2. Decide on **Tailwind CSS 4** or accept dev-tooling-only exposure.
3. Re-run `npm audit` in both workspaces in CI and fail on new high/critical runtime findings.
4. Pin and review lock files (`package-lock.json`) for both workspaces.

## Findings: `services/intelligence` (Python)

| Item | Result |
|---|---|
| Audited | 15 October 2026 with `pip-audit` against the fully pinned `requirements.lock` (27 packages) |
| Known vulnerabilities | **0** ("No known vulnerabilities found") |
| Scope | FastAPI 0.143.1, Uvicorn 0.54.0, Pydantic 2.14.1, pydantic-settings 2.16.0 and dev tools (pytest, httpx2, Ruff) |
| Heavy ML libraries | None installed (no pandas, scikit-learn, XGBoost, PyTorch or TensorFlow) |

Notes:
- `pip-audit` was run with `--no-deps`; hashes are not pinned in `requirements.lock` (it pins exact versions only).
- Starlette 1.8 deprecates `httpx` for its test client, so the dev dependency is `httpx2` (the package Starlette itself imports).
- Re-run the audit whenever `requirements.lock` changes and before deployment.

## Findings: `database` (Drizzle, pg)

| Item | Result |
|---|---|
| Audited | 18 October 2026 with `npm audit` |
| Total | 4 moderate, 0 high, 0 critical |
| **Runtime dependencies** (`npm audit --omit=dev`) | **0** (drizzle-orm 0.45.4, pg 8.23.1) |
| Non-breaking remediation | None (`npm audit fix --dry-run` changes 0 packages) |

All four findings are in the **development-only** `drizzle-kit` CLI (0.31.11), through a nested old
`esbuild` (0.18.20, via `@esbuild-kit/esm-loader`):

| Package | Severity | Issue | Relevant? |
|---|---|---|---|
| `esbuild` <= 0.24.2 | moderate | GHSA-67mh-4wv8-2f99: any website can send requests to esbuild's own development server and read the response | **No.** `drizzle-kit` uses esbuild only to load config/schema files; it never starts esbuild's dev server. Nothing here listens on a network port. |
| `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` | moderate | via `esbuild` (the loader is also deprecated upstream in favour of `tsx`) | Same |
| `drizzle-kit` | moderate | via the above | Same |

npm suggests "fixing" this by downgrading `drizzle-kit` to 0.18.1, which is not a real remediation
(an older release with other limitations), so it was not applied. Re-check when `drizzle-kit`
replaces the deprecated loader, and keep `drizzle-kit` a dev dependency.

Other database-security measures (least-privilege roles, loopback-only port, secret redaction) are
described in `database/README.md`.

## Container images (Milestone 9)

| Image | Base (pinned) | Dependencies | Runs as |
|---|---|---|---|
| `fasalytics-web:dev` | `node:24.22-slim` | `npm ci` from `package-lock.json` (includes dev tooling; development image) | `node` (uid 1000) |
| `fasalytics-api:dev` | `node:24.22-slim` | `npm ci --omit=dev` (runtime dependencies only: 0 known vulnerabilities) | `node` (uid 1000) |
| `fasalytics-intelligence:dev` | `python:3.12.15-slim` | `requirements.txt` constrained by `requirements.lock` | `fasalytics` (uid 10001) |

No `.env`, credentials, datasets or model artifacts are copied into any image (`.dockerignore`).
Containers drop all Linux capabilities, set `no-new-privileges` and use an init process; `api` and
`intelligence` have read-only root filesystems. Base images are version-pinned but not
digest-pinned: re-pull and re-audit before any deployment, and move to digests and a production
web build then.
