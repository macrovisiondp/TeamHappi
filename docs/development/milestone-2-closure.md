# Milestone 2 — Closure Note

| Field | Value |
|---|---|
| Accepted | 12 October 2026, by the product owner |
| Final commit | `de4f212a53f9342ae230afc2e265643776a91cac` (PR #1, branch `feat/m2-database-tenancy`) |
| Merge | **Pending.** The Chrome profile available to the assistant isn't signed in to the GitHub account that owns the repository, so PR #1 can't be marked ready, retargeted or merged from there. See "To finish" below. |

## Evidence

| Check | Result |
|---|---|
| Local and CI (commit `de4f212`) | 116/116 tests; lint, type check, format, build, e2e, dependency audit, secret scan all green |
| Neon verification (re-run, 9 Oct 2026, 08:53, 1,237 s) | **69/69 passed**, 0 failed, 0 skipped, exit 0 |
| Pooled reuse (from the test's assertions) | 200/200 transactions completed; 0 cross-tenant rows; 0 context leaks; fewer than 200 server backends used, and at least one served both tenants |
| Neon state | Bootstrap and migration `20261009120000_foundation_tenancy` applied. Recovery branches `pre-bootstrap`, `pre-migration` and `pre-verify` are kept (never expire). Synthetic data: 21 tenants, 42 users. |

## To finish (product owner, about 1 minute)

1. Open PR #1, change its base from `feat/m1-app-setup` to **`main`**. The Sprint 0 docs and Milestone 1 commits are ancestors of Milestone 2, so `main` receives docs → M1 → M2.
2. Click **Ready for review**, check the three CI checks are green, then **Merge pull request** (create a merge commit).
3. Record the merge commit here.

## Non-blocking follow-ups

| ID | Item | Plan |
|---|---|---|
| F-1 | The verification runner doesn't capture the 200-transaction summary (exact backend counts), because Vitest hides console output of passing tests unless `--silent=false` is passed | One-line fix in `scripts/verify-neon.mjs`; ship with the next approved Neon verification |
| F-2 | A `pg` 9 deprecation warning ("client.query() while already executing a query") comes from inside `@prisma/adapter-pg` | Keep `pg` on 8.x. Check Prisma release notes before any `pg` 9 upgrade. |
