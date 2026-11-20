# Neon record: M15 interactive training courses

**Status:** applied to Neon dev by Claude on 20 November 2026, under the product owner's standing approval for **add-only** development migrations once all tests pass. Two new enum values, two new tables, and one CHECK widened so internal courses may also be `interactive` (every existing row already satisfied it). No existing rows changed.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **Files** | `prisma/migrations/20261116120000_course_methods/migration.sql`, `prisma/migrations/20261116130000_course_packages/migration.sql` |
| **SHA-256** | `6f7680992c743d65c0fff7f7507897a646ed2e24eb0340d5345c4e1402030544` (methods), `12ff3163c0a8f3b54d91fd6c933dd0ae00760dde085786444e24db0bb805118b` (packages) |
| **Before** | Read-only `migrate status`: these were the only two pending migrations |

## Read-only checks afterwards (all passed)

1. **Migrations:** 28 applied, none unfinished. Checksums `6f768099` and `12ff3163` match the files.
2. **RLS:** `training_course_package` and `training_attempt` each have RLS enabled and forced, with one policy.
3. **Grants:** the app role has SELECT and INSERT only on both tables (no DELETE). On `training_attempt`, UPDATE is limited to `submitted_at`, `correct`, `score_percent` and `passed`. The trigger `training_attempt_submit_once` is present: a marked attempt can't change, and attempts are never deleted.
4. **Enums and CHECK:** `interactive` and `assessment` were added. `training_course_method_matches_kind` now allows internal `read_and_confirm`, `in_person` or `interactive`; external courses are unchanged.
5. **Data:** no packages or attempts yet (one organisation exists).

## Local test results (synthetic data only)

- **Tests:** 677 passed (61 files). The new tests: 9 unit tests on course files, and 14 security tests. They cover:
  - who can import;
  - invalid files;
  - rules and versions;
  - that the answer key is never sent to the learner;
  - the server-drawn final, including safety questions;
  - one marking per attempt and time-outs;
  - records and certificates;
  - practical sign-off;
  - the database trigger;
  - cross-organisation isolation;
  - an audit trail that holds no answers.
- **Lint, type check, formatting and production build:** pass.

## Rollback

The SQL is at the top of each migration file. It's safe only while both tables are empty, and it would be a separately approved run.
