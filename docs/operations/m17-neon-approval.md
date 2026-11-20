# Neon record: M17 profile photos and logos

**Status:** applied to Neon dev by Claude on 20 November 2026, under the product owner's standing approval for **add-only** development migrations once all tests pass. One new table; no existing rows change.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261118120000_profile_photos_and_logos/migration.sql` |
| **SHA-256** | `4b5bdd1b10d495160c22287d95953385b81b23cadffba7355b8843819dc865af` |
| **Before** | Read-only `migrate status`: this was the only pending migration |

## Read-only checks afterwards (all passed)

1. **Migrations:** 30 applied, none unfinished. Checksum `4b5bdd1b` matches the file.
2. **RLS:** `media_image` has RLS enabled and forced, with one policy.
3. **Grants:** the app role has SELECT, INSERT and DELETE (a photo can be removed), and no UPDATE.
4. **Checks:** `media_image_kind`, `media_image_type` (PNG, JPEG or WebP only) and `media_image_size` (at most 300 KB) are present.
5. **Data:** no images yet (one organisation exists).

## Local test results (synthetic data only)

- **Tests:** 693 passed (64 files). The 6 new security tests cover:
  - real file types only (no SVG, nothing oversized);
  - people changing their own photo;
  - managers changing staff photos, and colleagues being refused;
  - only owners and administrators changing the logo;
  - nothing visible to other organisations;
  - the database type check.
- **Lint, type check, formatting and production build:** pass.
- **Browser:** checked locally:
  - organisation logo upload, which then shows in the top bar;
  - a staff photo, set from the Edit page and shown in People;
  - Help search and guides;
  - the new error page.

## Rollback

`DROP TABLE media_image;`. It's safe only while the table is empty, and it would be a separately approved run.
