# TeamHappi — Engineering Rules

TeamHappi is a multi-tenant workforce management SaaS for UK hospitality, owned by Macrovision Digital Solution. Release 1 = Option A: the shared platform plus Recruitment, Onboarding, Training, Rota, and basic Attendance. **No payroll calculations** until specialists validate the rules.

Read first: `docs/architecture/solution-architecture.md`, `docs/decisions/`, `docs/development/backlog.md`.

## Non-negotiables

- **Tenant isolation.**
  - Business code uses `TenantDb`, which is created only from a server-resolved `TenantContext`. Never trust a tenant ID from the client.
  - Every tenant-owned table has `tenant_id`, RLS (ENABLE + FORCE + policy), `UNIQUE(tenant_id,id)` and composite FKs, all in the same migration that creates it.
  - Cross-tenant access returns 404.
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
