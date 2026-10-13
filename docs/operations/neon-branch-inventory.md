# Neon branch inventory and cleanup proposal

- **Project:** `teamhappi-dev` (`withered-butterfly-10806816`), Neon Free, AWS London. Prepared 13 Oct 2026.
- **Nothing has been changed:** no branch, SQL, migration, credential or data change was made.

> The Neon branch named **`production` is a development database.** It holds synthetic data only. Deployment environments are decided by Vercel, never by a database branch name.

## Inventory

The source of truth is our operations log from 9 Oct 2026 (Milestone 2).

**Live console check: pending.** The Neon console did not finish loading in the connected Chrome on 13 Oct (the page stayed on a loading spinner), so branch state, expiry and attached compute have not been re-read today. The check is read-only and must be completed before any deletion.

| Branch | ID | Created | Contents (point in time) | Used by |
|---|---|---|---|---|
| `production` (keep) | `br-fancy-king-zaxcbsao` | project default | Roles from the bootstrap; migration `20261009120000_foundation_tenancy` applied; `20261012120000_auth_foundation` **not** applied; synthetic verification data (about 21 tenants and 42 users, `@example.test`) | `.env.local` points at one endpoint, `ep-ancient-shape-zan162ud`, expected to be this branch's. To confirm in the console. |
| `pre-bootstrap-2026-10-09` | `br-fragrant-wind-zaropc4c` | 9 Oct, before the bootstrap SQL | An empty database; TeamHappi roles not yet created | Nothing in the repo or local configuration references it |
| `pre-migration-2026-10-09` | `br-late-fire-zat117l0` | 9 Oct, after the bootstrap, before the M2 migration | Roles only, no tables | Nothing references it |
| `pre-verify-2026-10-09` | `br-shiny-bread-zapwtyr0` | 9 Oct, after the M2 migration, before `verify:neon` | Full M2 schema, **no synthetic data**: the only clean "migrated, empty" snapshot | Nothing references it |

## Read-only checks to finish before deletion

1. **Branches page:** confirm the four branches, their parents, "expires: never", and that none has a compute endpoint in use.
2. **Endpoint:** confirm `ep-ancient-shape-zan162ud` belongs to `br-fancy-king-zaxcbsao`.
3. **Health of the active branch:**
   - compute starts;
   - `npx prisma migrate status` shows 1 applied and 1 pending (the M3.1 auth migration).

   `migrate status` only reads `_prisma_migrations`, but it is a remote database command, so it needs your go-ahead.
4. **Children:** confirm that no branch is a child of a recovery branch. Deleting a parent with children is blocked by Neon.

## What deletion loses

Each recovery branch is the only way back to its point in time. Neon Free's restore window covers about the last day, and these snapshots are four days old. After deletion:

- **pre-bootstrap:** the "empty database" state can no longer be restored. It can be recreated by making a new empty branch, so the loss is low.
- **pre-migration:** the "roles only" state can no longer be restored. It can be recreated by rerunning `neon-dev.sql` on an empty branch, so the loss is low.
- **pre-verify:** the clean, migrated, data-free M2 database can no longer be restored. It is recreatable, but takes longer: bootstrap, then migrate on a new branch. The loss is medium, because it is the natural rollback point if the M3.1 auth migration goes wrong.

## Recommendation

| Branch | ID | Recommendation |
|---|---|---|
| `pre-bootstrap-2026-10-09` | `br-fragrant-wind-zaropc4c` | **Delete** after the read-only checks pass |
| `pre-migration-2026-10-09` | `br-late-fire-zat117l0` | **Delete** after the read-only checks pass |
| `pre-verify-2026-10-09` | `br-shiny-bread-zapwtyr0` | Two choices for you: **(a) delete it with the others** (one branch from today); or **(b) keep it until the M3.1 auth migration is applied and verified, then delete it.** I recommend (b): it costs nothing extra on the Free plan and keeps a clean rollback point for the next schema change. |

**Final state:** only `production` (`br-fancy-king-zaxcbsao`) remains.

**Approval needed:** list the exact IDs you approve for deletion. No deletion happens until then, and the active branch is never reset.
