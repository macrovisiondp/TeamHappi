# Neon record: M18 offboarding

**Status:** applied to Neon dev by Claude on 20 November 2026, under the product owner's standing approval for add-only development migrations once all tests pass. Changes:
- one new table;
- a `purpose` column on two tables, defaulting to `joining`, so existing rows keep their meaning;
- one unique index swapped for a wider one: one active checklist of each purpose per person, instead of one in total.

No data is deleted or changed.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261119120000_offboarding/migration.sql` |
| **SHA-256** | `7130f1313967a0dbfd652df5daf7227e9ff4b0ed36f34114980cf77c2d54bca8` |
| **Before** | Read-only `migrate status`: this was the only pending migration |

## Read-only checks afterwards (all passed)

1. **Migrations:** 31 applied, none unfinished. Checksum `7130f131` matches the file.
2. **RLS:** `employee_leaving` has RLS enabled and forced, with one policy.
3. **Grants:** the app role has SELECT and INSERT only, with no DELETE. It can UPDATE only `last_day`, `reason`, `note`, `cancelled_at`, `cancelled_by`, `finalised_at` and `access_ended_early`.
4. **Index:** `onboarding_case_one_active_per_purpose` is in place; the old one-active index is gone.
5. **Data:** no leavings and no leaving checklists yet. The 3 existing templates are all `joining`.

## Local test results (synthetic data only)

- **Tests:** 699 passed (65 files). The 6 new security tests cover:
  - who may record a leaving, and that other organisations can't;
  - the leaver checklist;
  - cancelling;
  - finalising after the last day: access ends, the record shows "left" and shifts are released;
  - "end access now";
  - no private note in the audit trail, and no deletes.
- **Lint, type check, formatting and production build:** pass.
- **Browser:** checked locally: marking someone as leaving, the Leaving card, and cancelling.

## Rollback

The SQL is at the top of the migration file. It's safe only while there are no leavings and no leaving checklists, and it would be a separately approved run.
