# Neon record: M13 documents to sign

**Status:** applied to Neon dev by Claude on 19 November 2026, under the product owner's standing approval (19 November 2026) for **add-only** development migrations once all tests pass. This migration adds two tables and one permission; it changes no existing rows.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261111120000_documents_to_sign/migration.sql` |
| **SHA-256** | `d739d953bf7c0589c305e630e5a6760954ede7c530a7170d4f5f444c8b572e77` |
| **Before** | Read-only `migrate status`: this was the only pending migration |

## Read-only checks afterwards (all passed)

1. **Migrations:** 22 applied, none unfinished; checksum `d739d953`.
2. **RLS:** `sign_document` and `sign_request` each have RLS enabled and forced, with one policy.
3. **Grants:** the app role has SELECT and INSERT only (no DELETE). UPDATE is limited to `sign_document` `archived_at` and `archived_by`, and to the signing, countersigning, signed-copy and withdrawal columns of `sign_request`. Files, owners and fingerprints can't be changed.
4. **Permission:** `documents.manage` is on the owner, admin and HR manager roles of all 22 organisations.
5. **Data:** no documents or requests yet.

## Local test results (synthetic data only)

- **Tests:** 616 passed (54 files). These include 9 new end-to-end security tests with real PDFs and a temporary file store:
  - who can upload, send, open, sign and countersign;
  - the tamper check;
  - the signed copy (original pages plus one signature page);
  - withdrawal and isolation;
  - ids-only audit and database posture.
- **Lint, type check, formatting and production build:** pass.
- **Signature page:** a synthetic sample was generated and checked by eye in the browser's PDF viewer.

## Rollback

The SQL is at the top of the migration file. It's safe only while both tables are empty, and it would be a separately approved run. Older code ignores the new tables.

## Still needed before real use

- Private storage switched on in production (`aws-s3` in `APPROVED_LIVE_PROVIDERS`, then a deploy).
- Merging to `main` and deploying need the product owner's approval.
