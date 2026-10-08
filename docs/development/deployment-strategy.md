# Deployment Strategy

## Branching

- `main` is always deployable. Short-lived `feat/…`, `fix/…` and `docs/…` branches merge through a PR. No force-pushes to `main`.
- Branch protection on `main` (target): PR required, CI required (lint, typecheck, unit, integration, **security suite**, build, secret scan), and linear history.
- **On GitHub Free, branch protection can't be enforced for a private repo** (risk R-2). Until upgraded, this is a process rule: **no merge while CI is red, and no direct pushes to `main`.**

## Pipeline

```
PR opened ─► GitHub Actions CI (Postgres service container, migrations from zero, all tests)
          ─► Vercel preview + Neon branch (from staging project) + synthetic seed
merge main ─► CI ─► migrate staging (migrator role) ─► deploy staging ─► smoke E2E
release   ─► product-owner approval (manual; GitHub environment protection needs a paid plan for private repos)
          ─► migrate production ─► promote the same build to production ─► smoke check
```

## Migrations

- Prisma Migrate generates the SQL. **Every migration file is reviewed by hand.** RLS policies, grants, triggers and composite FKs are added in the same migration as the table.
- **Expand/contract**: add columns or tables first, deploy code that writes both, backfill, then remove the old ones in a later release. The running app version must work with both the old and new schema.
- **Destructive changes** (drop, narrowing type change, delete data) need a written note in the PR and **explicit product-owner approval**. A production backup/PITR point is confirmed first.
- `prisma migrate deploy` runs only in CI with the `migrator` credentials. The app's runtime role cannot run DDL.

## Environment variables

- `.env.example` lists the names with placeholders. Real values live in Vercel (scoped per environment), GitHub Actions secrets, and local `.env.local` (gitignored).
- Validated at startup by a Zod schema (`src/lib/env.ts`). The app refuses to start if a value is missing or malformed.

## Rollback

- App: Vercel instant rollback to the previous deployment. Expand/contract means the schema remains compatible.
- Data: Neon point-in-time restore into a branch, then verify, then promote. The procedure is documented and rehearsed before launch.
