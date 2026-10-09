# TeamHappi — Engineering Rules

TeamHappi is a multi-tenant workforce management SaaS for UK hospitality, owned by Macrovision Digital Solution. Release 1 = Option A: the shared platform plus Recruitment, Onboarding, Training, Rota, and basic Attendance. **No payroll calculations** until specialists validate the rules.

Read first: `docs/architecture/solution-architecture.md`, `docs/decisions/`, `docs/development/backlog.md`.

Next.js 16.4 differs from older versions. Check `node_modules/next/dist/docs/` before using an API (see AGENTS.md).

@AGENTS.md

## Commands

- `npm run dev`: local server (http://localhost:3000)
- `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm test` / `npm run build`
- `npm run check`: all of the above in one go (run before every commit)
- `npm run test:e2e`: Playwright against a production build (`npm run build` first; set `PORT` if 3000 is taken)

Development is **free-tier only** (docs/architecture/free-tier-limits.md). Use synthetic data only. Never add a paid service without product-owner approval.

## Non-negotiables

- **Tenant isolation.**
  - Business code uses `TenantDb`, which is created only from a server-resolved `TenantContext`. Never trust a tenant ID from the client.
  - Every tenant-owned table has `tenant_id`, RLS (ENABLE + FORCE + policy), `UNIQUE(tenant_id,id)` and composite FKs, all in the same migration that creates it.
  - Cross-tenant access returns 404.
  - Tenant context is set **only** by `withTenant()` (`src/lib/tenancy/with-tenant.ts`), transaction-locally. Never `SET app.*` or `set_config` anywhere else (lint and static tests enforce this).
  - RLS doesn't defend against arbitrary SQL run as the app role (design doc §5a). Use parameterised SQL only, never `$queryRawUnsafe` or `Prisma.raw`.
- **Platform operations** (tenant creation and similar) need a `PlatformStaffActor`. Application code can't import `@/platform/*` until Milestone 3 adds the session-backed issuer.
- **Authorisation** happens on the server in the service or API layer. Hiding UI is never the control.
- Modules touch other modules only through `src/modules/<m>/index.ts` or domain events (outbox). Never through another module's tables.
- Documents go to private storage only. Downloads use short-lived presigned URLs. Every view of restricted documents is audited.
- Audit events are append-only. Never log passwords, tokens, bank details, ID document numbers or pay amounts.
- Job payloads carry IDs only, always including `tenantId`. Handlers are idempotent.
- Money is decimal (`numeric`, decimal strings in JSON). Never floating point.
- No custom cryptography. No secrets in the repo. Use `.env.example` for names only.

## Workflow

- Work incrementally, one milestone at a time. Don't build modules before the foundation is approved.
- Before committing, run lint, typecheck, tests and build, and check for secrets. Report actual output only.
- Migrations: review the SQL by hand. Destructive migrations, production changes, paid services and production deploys need **product-owner approval**.
- Keep commits small and descriptive. No force-pushes to shared branches.
- Exact version pins with the lockfile committed. Don't add dependencies without a reason.
- Record significant decisions as ADRs in `docs/decisions/`. Supersede them; never rewrite an accepted one.
- After each milestone, write a report using the format in `docs/development/sprint-0-report.md`: Milestone, Implemented, Files Changed, Database Changes, Security Review, Tests, Deployment, Outstanding Issues, Next Step.

## Communication

The product owner is not a full-time engineer. Explain decisions plainly. Ask only about cost, security, irreversible or architectural choices, and give a recommendation each time.
