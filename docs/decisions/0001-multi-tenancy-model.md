# ADR-0001: Multi-tenancy model

- **Status:** Direction provisionally approved by the product owner (2026-10-08); details pending final review
- **Date:** 2026-10-08
- **Requirements:** MT-01..MT-09, AR-REQ-05, REP-01

## Context

TH-DEV-04 §4 asks the developers to recommend one of three models: shared schema with RLS, schema per tenant, or database per tenant. Tenants range from single restaurants to multi-site groups. Tenant isolation is non-negotiable. A missed filter must not leak data.

## Decision

**Shared database, shared schema, with two independent enforcement layers.** We also keep a documented path to a dedicated database for a large tenant.

1. **Mandatory tenant-scoped data-access layer (application).**
   - Business code never receives a raw Prisma client.
   - It receives a `TenantDb`, which is created only from a server-verified `TenantContext`: authenticated session → active membership → tenant not suspended.
   - The tenant ID is never read from a request body, query string, header or cookie without being checked against the user's memberships.
2. **PostgreSQL Row-Level Security (database).**
   - Every tenant-owned table has `tenant_id uuid NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and a policy: `tenant_id = current_setting('app.tenant_id')::uuid`. The policy covers both `USING` and `WITH CHECK`.
   - `TenantDb` runs each operation inside a transaction that first calls `set_config('app.tenant_id', $1, true)`. Because the setting is transaction-local, it is safe with Neon's PgBouncer transaction pooling.
   - The application connects as `teamhappi_app`: not the table owner, `NOBYPASSRLS`, and only DML grants.
   - Migrations run as a separate owner role. If `app.tenant_id` is not set, `current_setting(..., true)` returns NULL and **no rows match**. The system fails closed.
3. **Database-level cross-tenant relationship prevention.**
   - Every tenant-owned table has `UNIQUE (tenant_id, id)`.
   - Tenant-owned foreign keys are **composite**: `(tenant_id, site_id) REFERENCES site (tenant_id, id)`. A row cannot point at another tenant's row, even through a code bug.
4. **Platform-level (cross-tenant) access** is limited to global tables (tenant registry, users, platform staff).
   - Support access to a tenant's data goes through the same `TenantDb` path. It requires a time-boxed `SupportAccessGrant`, and it is audited and visible to the tenant (AUD-04).
   - Cross-tenant jobs, such as expiry sweeps, read the tenant registry and then fan out **one job per tenant**, each with its own context.
5. **Everything else is keyed by tenant:**
   - Object storage keys: `tenants/{tenantId}/...`
   - Cache keys: prefixed `t:{tenantId}:`
   - Job payloads: always include `tenantId`, which is re-checked when the job runs
   - Logs: `tenantId` on every line
   - Exports and reports: built through `TenantDb`

## Alternatives considered

| Option | Why not chosen now |
|---|---|
| Schema per tenant | Migrations fan out across N schemas. Prisma has poor support for dynamic schemas. Connection and catalog bloat grow with thousands of small tenants. Isolation is still only logical. |
| Database per tenant | Strongest isolation, but provisioning, migrations, cost and cross-tenant platform reporting scale linearly. Unjustified for single-site restaurants. |
| Shared schema, app-layer filter only | One missed `where` clause leaks data. TH-DEV-04 MT-03 explicitly warns about this. RLS is the backstop. |

## Consequences

- Every query pays the cost of a small transaction plus `set_config`. This is acceptable, and we will measure it in Milestone 2.
- Prisma cannot express RLS policies or composite tenant FKs fully. Those parts live in hand-reviewed SQL migrations. A CI check fails if a table with `tenant_id` has no RLS policy.
- **Noisy neighbours (MT-08)** are handled by per-tenant API rate limits, per-tenant job concurrency keys, and heavy reports running as background jobs.
- **Dedicated resources (MT-09):** because every row carries `tenant_id` and nothing depends on sharing, a tenant can be copied to its own Neon project. Its connection string is then resolved per tenant in the `TenantDb` factory. This is designed for but not built.
- **Tenant export and deletion (MT-07)** is a scripted, audited, ordered procedure, not `ON DELETE CASCADE` (see [data model](../architecture/data-model.md#deletion-and-retention)).
- **Acceptance:** an automated suite proves that tenant A cannot read, write, update, delete, upload, download or export tenant B's data through each layer. The foundation is not complete until it passes.
