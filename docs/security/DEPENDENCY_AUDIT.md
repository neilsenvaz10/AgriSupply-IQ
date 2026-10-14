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
| TypeScript pinned to 6.0.x | `typescript-eslint@8.71.2` declares `typescript <6.1.0`; TypeScript 7.0.2 is the npm "latest" |
| `jsdom` pinned to 29.1.1 (web) | `jsdom@30` requires Node ≥ 24.15; the project machine runs 24.13.1 |
| Express 5 | Current stable line; native async error propagation |

## Actions required before deployment

1. Decide on **React Router 7** (and migrate) or document an accepted risk with the "no user-controlled navigation targets" rule enforced in code review.
2. Decide on **Tailwind CSS 4** or accept dev-tooling-only exposure.
3. Re-run `npm audit` in both workspaces in CI and fail on new high/critical runtime findings.
4. Pin and review lock files (`package-lock.json`) for both workspaces.
