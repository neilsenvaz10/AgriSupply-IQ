# Repository and branch policy

> Applies to humans and coding assistants. Branch protection itself is a GitHub repository setting; this
> document states what must be configured and what the code enforces (CI). Nothing here changes Git
> configuration automatically.

## Branches

- **`main` is always releasable.** It builds, passes every CI job, and starts with
  `docker compose --env-file database/.env up -d --build --wait`. Nothing is committed to it directly once
  branch protection is on; it changes only by merging a reviewed pull request.
- **Short-lived feature branches** from `main`, merged back within days, then deleted. One concern per
  branch. Naming: `<type>/<short-description>`, for example `feat/ingestion-registry`,
  `fix/ready-timeout`, `docs/threat-model`, `chore/ci-cache`.
- **No long-running integration branches.** Rebase or merge `main` into the branch regularly; unfinished
  work hides behind a clearly labelled, disabled code path, not a stale branch.
- **Releases and demo snapshots** are tags on `main` (for example `v0.1.0`, `demo-2026-xx`).

## Pull requests

- Every change to `main` arrives through a pull request with a description of **what changed, why, and how it
  was verified**. Link the PROJECT.md phase or section it implements.
- At least **one review** by someone other than the author (the author may self-review only while the team
  has a single member, and must then wait for CI and re-read the diff before merging).
- Reviewers check: scope matches the description; tests exist for new behaviour (including failure
  paths); no secrets or generated data; documentation and `.env.example` updated; security-sensitive code
  (queries, input handling, credentials, container settings) reviewed against
  [../security/THREAT_MODEL.md](../security/THREAT_MODEL.md); no hardcoded geography or commodities.
- Prefer small pull requests (a reviewer should finish in about 30 minutes). Squash-merge with a clean
  title unless the individual commits tell a useful story.

## CI requirements before merging

All jobs in `.github/workflows/ci.yml` must pass (configure them as **required status checks**):

| Job | What it enforces |
| --- | --- |
| `web` | JSDoc type check, ESLint, Prettier, Vitest, production build |
| `api` | JSDoc type check, ESLint, Prettier, Vitest (unit and OpenAPI contract tests) |
| `intelligence` | Ruff lint, Ruff format check, pytest (including the OpenAPI document check) |
| `database` | Drizzle checks, ESLint, Prettier, repeatable migrations, privilege verification, tests, and the API's real-PostgreSQL integration tests against a disposable database (`REQUIRE_DB=1`: a missing database fails, never skips) |
| `docker` | `compose.yaml` validates and the three images build |

Recommended GitHub settings for `main`: require pull requests, require the five checks above and an up-to-date
branch, require conversation resolution, block force pushes and deletion, and dismiss stale approvals.
(**Not configured by this repository**; a maintainer must set them.)

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) style, imperative mood, subject at most 72
characters:

```text
<type>(<scope>): <summary>

<why, not what, when it is not obvious>
```

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `perf`, `security`. Scopes:
`web`, `api`, `intelligence`, `database`, `compose`, `ci`, `docs`. Examples:
`feat(api): add GET /ready`, `fix(database): keep app role off the migration journal`.
Milestone close-out commits may use the existing `complete Milestone N <summary>` form.

Never commit: `.env` files, credentials, datasets in `data/raw/` or `data/processed/`, model artifacts,
generated build output, or personal files. Keep unrelated files (for example reference PDFs) out of commits
unless the change is about them.

## Coding assistants

Assistants (Claude Code and similar) **must not** commit, stage, push, pull, fetch, create or delete
branches, change remotes, or alter Git configuration without explicit approval for that specific action
from the repository owner. They may read the repository, edit working-tree files, and run local checks.
Approval to commit one change does not extend to later changes. Assistant-authored commits, when approved,
are made by the owner or carry a visible co-author trailer, and go through the same pull-request review and
CI as everyone else. Assistants must not use blanket staging commands (`git add -A`, `git add .`) because
the working tree may contain files that must stay untracked.

## Milestone discipline

Work proceeds phase by phase as defined in `PROJECT.md`. A milestone ends with a written report and a stop for
approval; the next milestone does not begin until it is approved.
