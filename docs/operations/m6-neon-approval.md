# Neon approval request: M6 invitations and members

**Status:** awaiting product-owner approval. Nothing has been run on Neon.

| | |
|---|---|
| **Target** | Neon `teamhappi-dev`, branch `production` (`br-fancy-king-zaxcbsao`), database `teamhappi` |
| **Migration** | `prisma/migrations/20261024120000_invitations_members/migration.sql` |
| **SHA-256** | `5142329be851dcc7c5f2f594dbe0784c925c8bdffca7a03180e5f3a0594738db` |
| **Adds** | Tables `invitation` and `audit_event` (both empty, RLS forced, no DELETE), column `user.email_verified_via` (empty), functions `app.invitation_preview` and `app.accept_invitation` |
| **Changes** | The `user_visible` policy also shows suspended members of an organisation to that organisation (former members stay hidden) |
| **Data** | None changed. Joemis Kitchen and every existing account are untouched. |
| **Vercel** | No change needed |

## Deployment order (important)

1. **Run the migration on Neon first.** The Members page and invite links use the new tables, so merging first would make them fail.
2. Then merge. Vercel deploys `main` to production.

## How to run it (you run it, as before)

```powershell
cd C:\Users\DELL\TeamHappi
git fetch
git checkout feat/m6-invitations-members
$env:TEAMHAPPI_REMOTE_MIGRATION = "approved"
npx prisma migrate deploy
Remove-Item Env:TEAMHAPPI_REMOTE_MIGRATION
git checkout main
```

It should say `Applying migration 20261024120000_invitations_members`.

## Checks afterwards (read-only, I run them)

- Eight migrations are applied.
- `invitation` and `audit_event` have RLS enabled and forced, one tenant policy each.
- The app role's grants: `invitation` SELECT and INSERT plus UPDATE on the five link/status columns only; `audit_event` SELECT and INSERT; no DELETE on either.
- The audit trigger exists; both functions are SECURITY DEFINER with a pinned `search_path`, executable only by the app role.
- Both new tables are empty.

## What this does NOT approve

- Sending email (Resend) or registering a TeamHappi domain. Invitations work by copied link until then.
