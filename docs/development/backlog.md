# Prioritised Implementation Backlog

Status key: ☐ not started · ◐ in progress · ☑ done.
**Blocked** items name what they are waiting for.

## Sprint 0 — Architecture (this delivery)

- ☑ Architecture package (docs/). Direction provisionally approved 8 Oct 2026.
- ☑ Product-owner decisions D-1..D-8 recorded ([sprint-0-report](sprint-0-report.md#product-owner-decisions-8-october-2026))
- ☐ Product owner: review the [interim specifications](../requirements/interim-specifications.md) (IS-03/07 before M3, IS-06/08 before M4)

## M1 — Repository and application setup (no paid services needed)

1. ☐ Scaffold Next.js 16.4 + TS 5.9 + Tailwind 4 with exact pins; `src/` layout
2. ☐ ESLint (next, typescript-eslint strict, boundary rules), Prettier, `.editorconfig`
3. ☐ Vitest (unit) + Playwright (smoke) set-up; one real test each
4. ☐ `src/lib/env.ts` Zod env validation; `.env.example`
5. ☐ Security headers and CSP middleware skeleton
6. ☐ App shell: layout, design tokens, shadcn/ui base components, accessible nav, error and not-found pages
7. ☐ GitHub Actions: lint, typecheck, test, build, gitleaks, npm audit
8. ☐ README, CLAUDE.md, contributor workflow
9. ☐ (Product owner, optional now) Connect the GitHub repo to Vercel Hobby (private development only, risk R-1)

## M2 — Database and tenancy

1. ☐ Neon Free project `teamhappi-dev` in London (**product owner creates it and supplies the connection strings**); roles `migrator` and `teamhappi_app`. CI uses a Postgres service container (free).
2. ☐ Prisma 7.10 + adapter-pg; prisma.config; migration workflow
3. ☐ Schema: tenant, user (auth tables), tenant_membership, role, permission, role_permission, role_assignment, site, team, employee (core)
4. ☐ RLS + FORCE + composite FKs + grants (hand-written SQL migration)
5. ☐ `TenantContext` + `TenantDb` (transaction-local `set_config`)
6. ☐ Tenant creation service (platform) + seed of system roles + audit
7. ☐ **Isolation test suite** + RLS coverage check (CI Postgres service)
8. ☐ Clean-environment reproducibility: migrate from zero in CI

## M3 — Authentication and administration — *sign-off needs interim specs IS-03 and IS-07 approved*

1. ☐ Better Auth: email+password, email OTP, sessions; TOTP + passkey MFA
2. ☐ Active-tenant switching; membership re-validation per request
3. ☐ Permission catalogue + `require()` + site scoping; MFA enforcement for privileged roles
4. ☐ Client admin: sites, teams, invitations, role assignment
5. ☐ Platform console: tenant create/suspend; support-access grants
6. ☐ Rate limiting, Postgres-backed (free; ADR-0008)
7. ☐ Phone OTP: **deferred** (CR-002). Email provider decision needed before first non-developer sign-in (R-4).
8. ☐ Auth and authz security tests

## M4 — Shared platform services — *real documents blocked on storage approval (R-3); retention on IS-06*

1. ☐ Audit service + immutability + tenant audit search
2. ☐ Outbox + `after()` dispatch + daily cron sweep (free tier) + idempotent consumers + retry tests
3. ☐ Documents: `storage` interface + dev-only local adapter + scan-status workflow + download audit (S3/GuardDuty adapter when approved)
4. ☐ Notifications: in-app + email through a `mailer` interface (log-only in dev); preferences
5. ☐ Tenant settings + module activation (`requireModule`)
6. ☐ Observability: pino with tenant tags + redaction, request IDs (Sentry when approved)
7. ☐ Terraform for AWS/Neon/Vercel; data-processing register

## Release 1 modules (each starts with a written spec, then build)

1. Recruitment · 2. Onboarding & compliance · 3. Training · 4. Rota & scheduling · 5. Basic time & attendance · 6. Worker self-service & management views (PWA install, push, offline clock queue)

## Release 1 validation

E2E, isolation, authz, document security, load/concurrency, mobile usability, accessibility (WCAG 2.2 AA provisional), backup restore, failure/recovery, deployment verification, operational readiness, independent pen test.
