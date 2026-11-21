# Neon record: M19 contract templates

**Status:** applied to Neon dev by Claude on 21 November 2026, under the product owner's standing approval for add-only development migrations once all tests pass. It widens one CHECK so the document library can hold contract templates. Every existing row already fitted, and no rows changed.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261120120000_contract_templates/migration.sql` |
| **SHA-256** | `b4a99b930ab3ed1deda94716ada40e0d03c2f01286fb1f8cb22e126bec6f3884` |
| **Before** | Read-only `migrate status`: this one was pending. Neon also already holds `20261119120000_offboarding`, which was applied on 20 November from the offboarding branch; that branch isn't merged yet. |

## Read-only checks afterwards (all passed)

1. **Migrations:** 32 applied, none unfinished.
2. **CHECK:** `sign_document_kind` now allows `policy` or `contract_template` with no person, or `contract` with a person.
3. **Data:** existing documents are unchanged.

## Local test results (synthetic data only)

- **Tests:** the full run passed except for one test that timed out while starting its database; it passed when run again on its own. The guard test that failed on the first run was fixed, then passed. The new tests:
  - 3 unit tests for first steps;
  - a security test showing a contract template in a starter pack is sent as a contract that needs countersigning.
- **Lint, type check, formatting and production build:** pass.
- **Browser (local):**
  - a new starter is sent to Your first steps;
  - saving About you moves them to step 3;
  - completing everything shows "You're all set" with confetti.

## Rollback

The SQL is at the top of the migration file. It's safe only while no contract templates exist.
