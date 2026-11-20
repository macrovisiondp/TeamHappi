# Neon record: M16 job titles and shift cover

**Status:** applied to Neon dev by Claude on 20 November 2026, under the product owner's standing approval for **add-only** development migrations once all tests pass. It adds one new table and one new column (default false). No existing rows change.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261117120000_job_titles_and_shift_cover/migration.sql` |
| **SHA-256** | `0c2713030850761469559e25dbba641622e19bfea95258b73f0ff1e778c25e5a` |
| **Before** | Read-only `migrate status`: this was the only pending migration |

## Read-only checks afterwards (all passed)

1. **Migrations:** 29 applied, none unfinished. Checksum `0c271303` matches the file.
2. **RLS:** `job_title` has RLS enabled and forced, with one policy.
3. **Grants:**
   - `job_title`: the app role has SELECT and INSERT only (no DELETE), and can UPDATE only `archived_at` and `archived_by`.
   - `training_course`: `shift_cover` was added to the app role's column-level UPDATE grant.
4. **Column:** `training_course.shift_cover` is boolean, default false.
5. **Data:** no job titles yet, and no course has `shift_cover` set (one organisation exists).

## Local test results (synthetic data only)

- **Tests:** 687 passed (63 files). The new tests are 6 security tests and 4 unit tests. They cover:
  - who can keep the list;
  - listed titles only, stored with the list's spelling;
  - free typing without a list;
  - archived titles;
  - isolation between organisations;
  - no approving your own hours;
  - cover gaps on the rota.
- **Lint, type check, formatting and production build:** pass.

## Rollback

The SQL is at the top of the migration file. It's safe only while `job_title` is empty and no course uses `shift_cover`, and it would be a separately approved run.
