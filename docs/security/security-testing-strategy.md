# Security Testing Strategy

## Test layers

| Layer | Tool | Runs | Covers |
|---|---|---|---|
| Static | ESLint (incl. boundary and unsafe-API rules), TypeScript strict, gitleaks | Every PR | Module boundaries, `$queryRawUnsafe` ban, `dangerouslySetInnerHTML` ban, secrets |
| Dependencies | `npm audit --audit-level=high`, Dependabot | Every PR plus weekly | Known CVEs |
| Unit | Vitest | Every PR | Permission resolution, validation schemas, redaction |
| **Integration (real Postgres)** | Vitest against a Postgres 18 service container in GitHub Actions, migrated from scratch | Every PR | RLS, composite FKs, audit immutability, outbox, idempotency |
| **Security suite** (`tests/security`) | Vitest (API level) | Every PR. **Required check.** (Enforced by branch protection once GitHub is upgraded. Until then, a process rule: no merge while it fails.) | Tenant isolation matrix, authz matrix, candidate isolation, document access, support-grant rules |
| E2E | Playwright (+ axe) | PR (smoke), nightly (full) | Sign-in, tenant switch, role-gated UI, accessibility |
| Load / concurrency | k6 or Artillery | Before launch | Noisy-neighbour fairness, double-submit / race conditions |
| External | Independent penetration test | Before commercial launch | Everything |

## Tenant isolation matrix (Milestone 2 acceptance)

Fixtures: tenants **A** and **B**, each with sites, users, employees and documents. User **U** is a member of both tenants with different roles.

For **every** tenant-owned entity, assert that a context for tenant A:

1. cannot `find`/`list` B's rows: they are empty, not an error that leaks existence;
2. cannot `update`/`delete` B's rows: 0 rows affected, and the API returns 404;
3. cannot `create` a row with `tenant_id = B`: rejected by RLS `WITH CHECK`;
4. cannot create a row referencing B's parent, for example a role assignment to B's site: rejected by the composite FK;
5. with **no** tenant context, raw queries as `teamhappi_app` return 0 rows (fail closed);
6. for U: switching to tenant B shows only B's data, with B's permissions; switching to tenant C (not a member) is rejected;
7. files: a download URL for B's document cannot be issued in A's context;
8. jobs: a job carrying `tenantId = B` cannot touch A's rows;
9. **coverage check:** a SQL query asserts that every table with a `tenant_id` column has RLS enabled and forced, plus a policy.

## Rule

Never claim a test passed unless it ran. CI output is the evidence.
