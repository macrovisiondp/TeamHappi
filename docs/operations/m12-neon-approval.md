# Neon record: M12 installable app and shift alerts

**Status:** applied to Neon dev by Claude on 19 November 2026, under the product owner's standing approval (19 November 2026) for **add-only** development migrations once all tests pass. This migration adds one table; it changes no existing rows.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **File** | `prisma/migrations/20261112120000_push_subscriptions/migration.sql` |
| **SHA-256** | `62f30e1b3f7cba3cadf420928d34696a843c47c7074061fe44d4b04cc284f97d` |
| **Before** | Read-only `migrate status`: this was the only pending migration |

## Read-only checks afterwards (all passed)

1. **Migrations:** 23 applied, none unfinished; checksum `62f30e1b`.
2. **RLS:** `push_subscription` has RLS enabled and forced, with one policy.
3. **Grants:** the app role has SELECT and INSERT only (no DELETE). UPDATE is limited to `last_sent_at` and `removed_at`.
4. **Structure:** `push_subscription_one_live` and `push_subscription_membership` indexes are present.
5. **Data:** no subscriptions yet.

## Local test results (synthetic data only)

- **Tests:** 621 passed (55 files), including 7 new security tests with a fake sender (no network):
  - which subscriptions are accepted, and that they're per membership;
  - a shared phone moving over to the new person;
  - only people whose published shifts changed are alerted, drafts alert nobody;
  - the message is generic, with nothing private;
  - gone devices are removed, and one failure never stops the rest;
  - isolation and database posture.
- **Lint, type check, formatting and production build:** pass.
- **Production server check:**
  - manifest, all icons and `/sw.js` are served with the right types and headers (`/sw.js` is no-cache);
  - an unknown icon size returns "not found";
  - the icon was checked by eye.

## Not yet checked

A real alert arriving on a phone. That needs the VAPID keys set in Vercel and a deploy (alerts are off until then).

## Rollback

`DROP TABLE push_subscription;`, safe only while it's empty, and as a separately approved run. Older code ignores the table.
