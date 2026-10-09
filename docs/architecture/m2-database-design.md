# Milestone 2 — Database Foundation: Design for Review

| Field | Value |
|---|---|
| Status | **Revision 2: review 1 changes addressed. Nothing has been run on Neon.** |
| Date | 9 October 2026 |
| Branch | `feat/m2-database-tenancy` |
| Implements | ADR-0001 (tenancy), data-model.md, TH-DEV-04 MT-01..05, IA-06 |

## 0. Changes since review 1 (CHANGES REQUESTED, 9 Oct 2026)

| # | Review request | Change | Where tested |
|---|---|---|---|
| 1 | Document the security boundary of custom settings; add compensating controls and tests | New §5a. Database guard: the context is honoured only when `app.context_token` matches the current transaction. Lint and static guards cover `set_config`, `SET app.*` and unparameterised SQL. Role lock-down was verified: the app role can't set login defaults, switch role, or create temp tables or functions. | `context-boundary.test.ts` (10), `static-guards.test.ts` (5) |
| 2 | `user_visible` doesn't require an active membership | The policy now requires `m.status = 'active'` | `user-visibility.test.ts` (7) |
| 3 | Guard against session-level context changes | Database token guard (session-level values are ignored in later transactions), plus ESLint `no-restricted-syntax` and a static source scan. Only `with-tenant.ts` may call `set_config`, and only with `is_local = true`. | `context-boundary.test.ts`, `tenant-context.test.ts`, `static-guards.test.ts` |
| 4 | `createTenant` must be unreachable without platform-staff authorisation | It now requires a `PlatformStaffActor` with `tenant.create`, checked before any database call. The only issuer is a test helper that throws outside Vitest, is lint-blocked from application code, and is referenced by no route, page or module. | `create-tenant.test.ts` (5 new), `static-guards.test.ts` |
| 5 | Keep the post-migration Neon verification plan | §8 expanded. `npm run verify:neon -- --approved` runs the security suites plus a pooled-connection reuse test against Neon. It's off by default, refuses without explicit approval, and never migrates. | `tests/neon-verify/`, `tests/setup/neon-verify-setup.ts` |

The migration file was edited in place. It has never been applied to Neon or to any persistent database, only to disposable test databases.

## 1. What is being reviewed

| Item | File |
|---|---|
| Role bootstrap SQL (you run this once in Neon) | [prisma/bootstrap/neon-dev.sql](../../prisma/bootstrap/neon-dev.sql) |
| Migration SQL (tables, constraints, RLS, grants, permission catalogue) | [prisma/migrations/20261009120000_foundation_tenancy/migration.sql](../../prisma/migrations/20261009120000_foundation_tenancy/migration.sql) |
| Prisma schema | [prisma/schema.prisma](../../prisma/schema.prisma) |
| Tenant context code | [src/lib/tenancy/](../../src/lib/tenancy/) |
| Tenant creation | [src/platform/tenancy/create-tenant.ts](../../src/platform/tenancy/create-tenant.ts) |
| Tests | [tests/security/](../../tests/security/), [tests/integration/](../../tests/integration/) |
| Env template (placeholders only) | [.env.example](../../.env.example) |

## 2. Role design

| Role | Purpose | Attributes | Owns | Privileges |
|---|---|---|---|---|
| `neondb_owner` (Neon) / `teamhappi_migrator` (tests) | **Migration role.** Runs `npm run db:migrate` over a direct connection. | LOGIN, BYPASSRLS (Neon platform default) | All schema objects | DDL |
| `teamhappi_app` | **Application role.** The only role the running app uses. | LOGIN, NOSUPERUSER, **NOBYPASSRLS**, NOCREATEDB, NOCREATEROLE, NOREPLICATION | **Nothing** | CONNECT on the database, USAGE on `public` and `app`, table DML as listed in §6. **Cannot create objects, change RLS, truncate, or read migration history.** |

- The application role isn't the table owner and has no BYPASSRLS, so RLS always applies to it. FORCE ROW LEVEL SECURITY is set as well, so even if ownership were ever changed by mistake, RLS would still apply.
- On Neon, `teamhappi_app` was created with SQL, not in the console, so it isn't a member of `neon_superuser`. This was checked by hand on Neon on 9 Oct 2026; the test suite now asserts the app role is a member of no other role, and the Neon verification (§8) repeats it there.
- Session guard rails on `teamhappi_app`: `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 15s` and a fixed `search_path`.

## 3. How tenant context is set for each transaction

```
request → session (M3) → resolveTenantContext(userId, requestedTenantId)
        → withTenant(ctx, tx => …queries…)

BEGIN;
  SELECT set_config('app.tenant_id',     $1,                  true),  -- true = transaction-local
         set_config('app.user_id',       $2,                  true),  -- values are bind parameters
         set_config('app.context_token', app.context_token(), true);  -- pid + transaction start time
  …queries, every one filtered by RLS…
  COMMIT;   -- or ROLLBACK: both settings are discarded
```

1. **`resolveTenantContext`** treats the requested tenant ID as untrusted:
   - It rejects malformed IDs without querying.
   - It looks up the tenant and the user's membership **inside RLS scoped to that tenant**.
   - It returns a context only if the tenant is `active` **and** the membership is `active`. Unknown, other-tenant, invited, suspended and left memberships, and suspended tenants, all return `null`, and the API answers 404.
2. **`TenantContext` can't be faked.**
   - It is a frozen object with a private symbol brand, and `withTenant` refuses anything else at runtime (a test covers a forged object).
   - Its constructor lives in `src/lib/tenancy/internal.ts`. ESLint blocks importing that file, the raw database client, or the generated Prisma client from anywhere outside the tenancy layer (a probe confirmed this).
3. **`withTenant` is the only way business code queries tenant data.** It opens an interactive Prisma transaction, sets the context first, and passes `fn` the transaction client.
4. **The database honours a context only in the transaction that set it.**
   - `app.current_tenant_id()` and `app.current_user_id()` return NULL unless `app.context_token` equals `app.context_token()`, which is the backend PID plus the current transaction's start time in microseconds.
   - A value left at session level, by `SET app.tenant_id` or `set_config(…, false)`, carries a stale token in every later transaction, so it's ignored there.
5. **Precision on authorisation order.** `resolveTenantContext` applies the *requested* tenant only inside its own internal, read-only transaction. That transaction checks the tenant's status and the user's own membership row. No caller code runs in it, and only a yes/no comes out.
6. **Tenant creation is a platform operation.** `createTenant(client, actor, input)` first checks for a `PlatformStaffActor` holding `tenant.create`, before any database call. Until Milestone 3 the application can't obtain one:
   - the only issuer is a test helper that throws outside Vitest;
   - ESLint blocks `@/platform/*` imports from application code;
   - a static test fails if any file outside `src/platform` references `createTenant`.

## 4. Prisma, RLS and Neon connection pooling

| Concern | Design |
|---|---|
| Driver | Prisma 7 with `@prisma/adapter-pg`, using a `pg` connection pool on the app role |
| Runtime URL | Neon **pooled** endpoint (PgBouncer, *transaction* mode) |
| Migration URL | Neon **direct** endpoint (DDL and Prisma's migration lock need a real session) |
| Why transaction-local settings | With transaction pooling, consecutive transactions from one app instance can land on different server connections, and one server connection serves many app instances. A **session-level** `SET` would leak to whoever uses that connection next. `set_config(…, true)` lives exactly as long as our `BEGIN…COMMIT`, which is the unit PgBouncer pins, so it can't leak. |
| Reused connections | Once a setting has been used, Postgres returns `''` (not NULL) for it on later transactions in that session. `app.current_tenant_id()` turns `''` and NULL into NULL, and `tenant_id = NULL` matches nothing. **A reused connection with no context sees zero rows.** Tested with a pool of one connection, confirmed by an identical backend PID. |
| Prepared statements | `pg` uses unnamed statements, which work with Neon's pooler |
| Where context can't be forgotten | Every RLS policy depends on `app.current_tenant_id()`. A query outside `withTenant` returns nothing, and inserts are rejected (tested). |
| Long transactions | `withTenant` caps a transaction at 10 s, and the role-level `idle_in_transaction_session_timeout` is 15 s, so a stuck request can't hold a pooled connection |

## 5. Default-deny policies

- **RLS ENABLE + FORCE** on all 11 tables that hold client data or identity: `tenant`, `user`, `tenant_membership`, `role`, `role_permission`, `role_assignment`, `site`, `team`, `team_member`, `employee`, `document`.
- **Exactly one policy per table, granted only `TO teamhappi_app`.** No policy applies to PUBLIC. In PostgreSQL, a table with RLS enabled and no matching policy returns no rows and rejects writes.
- **Tenant-owned tables:** `USING (tenant_id = app.current_tenant_id()) WITH CHECK (same)`. The same predicate covers reads, updates, deletes and inserts, so a row can't be read, changed, moved or created outside the current tenant.
- **`tenant`:** a tenant can see only itself (`id = current tenant`).
  - A new tenant is created by generating its ID first and using that as the context. **Tenant creation needs no cross-tenant privilege.**
  - There is no DELETE privilege at all.
- **`user`:** read-only. The app sees only the signed-in user and **active** members of the current tenant.
  - Invited, suspended and former members' user records are hidden, though their membership rows stay visible to the tenant.
  - Any admin view that needs their names must be designed and reviewed in Milestone 3.
  - Writes are part of the M3 authentication design (see §9).
- **`permission`:** a global, non-sensitive catalogue. No RLS, SELECT only.
- **A test asserts these rules hold for every table, including future ones:**
  - any table with a `tenant_id` column must have RLS enabled, forced, and a policy;
  - every policy must target only the app role.

## 5a. Security boundary of the custom settings

**What RLS protects against here:**
- forgotten or wrong tenant filters in application code;
- cross-tenant references (composite FKs);
- context missing from a query (default deny);
- context leaking between requests on a pooled connection (transaction-local settings plus the token guard).

**What it does not protect against:** `app.tenant_id`, `app.user_id` and `app.context_token` are ordinary PostgreSQL custom settings, and `teamhappi_app` can set them. Any SQL that runs as the application role, through SQL injection or compromised application code, can therefore choose a tenant for its own transaction and read or write that tenant's rows within the app role's grants. `context-boundary.test.ts` pins this down as a characterisation test, so the limit is explicit and can't be forgotten.

**Compensating controls (each tested):**

| Control | Effect | Test |
|---|---|---|
| Parameterised SQL only: `$queryRawUnsafe`, `$executeRawUnsafe` and `Prisma.raw` are banned | Makes SQL injection, the main route to arbitrary SQL, structurally hard | ESLint; `static-guards.test.ts` |
| `set_config` / `SET app.*` / `RESET app.*` allowed only in `with-tenant.ts`, always transaction-local | Application code can't change tenant context any other way | ESLint `no-restricted-syntax`; `static-guards.test.ts` |
| Token guard in `app.current_tenant_id()` | A session-level value, whether by mistake or by an injected statement, never applies to a later transaction or another request | `context-boundary.test.ts`, `tenant-context.test.ts` |
| App role can't set its own login defaults for `app.*` (PostgreSQL 15+) | A tenant can't be persisted onto every future connection | `context-boundary.test.ts` (also checks `pg_db_role_setting`) |
| App role can't `SET ROLE` / `SET SESSION AUTHORIZATION`, create temp tables or functions, or run DDL | No escalation or staging inside the database | `context-boundary.test.ts`, `db-roles.test.ts` |
| Least-privilege DML: no DELETE on people, tenants, sites, memberships or documents; no TRUNCATE | Limits damage even inside a valid context | `db-roles.test.ts`, `context-boundary.test.ts` |
| `statement_timeout = 15s`, `idle_in_transaction_session_timeout = 15s` | Limits bulk extraction and held connections | `context-boundary.test.ts` |
| Tenant IDs are random UUIDv7 and `tenant` is visible only to itself | An attacker can't list other tenants from inside one tenant | `tenant-isolation.test.ts` |
| Audit logging (M4), rate limits (M3), a WAF and dependency auditing | Detection and blast-radius limits outside the database | Later milestones; `npm audit` gate in CI |

**Stronger option, not proposed for Release 1:** a signed context. The app would set `app.tenant_sig = HMAC(secret, tenant_id | expiry)`, and a `SECURITY DEFINER` check would verify it with a key the app role can't read. That would stop SQL injection from switching tenants, but not compromised application code, which holds the key. It adds `pgcrypto`, a secret stored in two places, and a provisioning step. If wanted, it can follow as a separate ADR.

## 6. Defence in depth beyond RLS

| Control | Where |
|---|---|
| Composite foreign keys `(tenant_id, x_id) → parent(tenant_id, id)` | Every tenant-owned relationship. Foreign-key checks run as the table owner and ignore RLS, so **this is what stops cross-tenant links.** Tested for employee→site, role assignment→site, team member→employee, document→employee. |
| `UNIQUE (tenant_id, id)` | On every tenant-owned table (required by the composite keys) |
| **File references:** `CHECK (starts_with(storage_key, 'tenants/' \|\| tenant_id \|\| '/'))` | `document`. A manipulated storage key can't point into another tenant's files, including `..` path tricks (tested). |
| Least-privilege grants | DELETE only on link tables (`role_permission`, `role_assignment`, `team_member`). Employees, tenants, sites, memberships and documents can't be hard-deleted by the app (tested). |
| No cascades | All foreign keys are `ON DELETE RESTRICT ON UPDATE RESTRICT` |
| Identity constraints | Case-insensitive unique email, unique phone, at least one of the two required |

## 7. Tests (actual results)

All tests run against a **throwaway PostgreSQL 18**, never Neon:

- **Locally:** real Postgres binaries started in a temp folder and deleted afterwards. No Docker.
- **In CI:** a `postgres:18` service container. The harness refuses to run against any host other than localhost.
- **Setup:** the harness creates the same two roles, runs the **same bootstrap SQL** you'll run on Neon, then `prisma migrate deploy` as the migration role. So the tests also check the reviewed SQL.

| Requirement | Tests | File |
|---|---|---|
| Cross-tenant reads | List every table; look up B's IDs from A; users of other tenants hidden | tenant-isolation (23) |
| Cross-tenant writes | Update, delete, insert with B's ID; move a row to B; rename B | tenant-isolation |
| Joins | Prisma includes; raw `CROSS JOIN`; join keyed on B's ID | tenant-isolation |
| File references | Own prefix OK; other prefix, path trick and other tenant's owner rejected; re-pointing rejected | tenant-isolation |
| Manipulated identifiers | Malformed and injection-style IDs; non-member asking for B; forged context; injection in a filter | tenant-isolation |
| Missing tenant context | 0 rows in all 11 tables; functions return NULL; inserts rejected; updates touch nothing; malformed setting ignored (no token) or errors (valid token) | tenant-context (18) |
| Unauthorised membership | Non-member; invited, suspended, left; suspended tenant; one user in two tenants sees each separately | tenant-context |
| Connection reuse | Context gone after commit and after rollback; tenants alternated on one connection; session-level setting ignored; 12 concurrent transactions | tenant-context |
| Custom-settings boundary | Characterisation of the boundary; session-level `SET` and `set_config(…, false)` ignored in later transactions; unique token per transaction; stale token rejected; no login defaults; no `SET ROLE`; no temp tables or functions; statement timeout; no DELETE inside a valid context | context-boundary (10) |
| User visibility | Active members visible; invited, suspended and left hidden; membership rows still visible; other tenants hidden; becomes hidden on suspension | user-visibility (7) |
| Role posture and coverage | Flags; member of no other role (covers `neon_superuser`); owns nothing; can't create, alter or truncate; exact grant table; RLS coverage; policy roles; catalogue sync | db-roles (10) |
| Tenant creation and its gate | Roles and owner assignment; validation; rollback; duplicate slug; rejected with no actor, a forged actor or a missing grant, with no database write; test issuer inert outside Vitest | create-tenant (9) |
| Static guards | Only `with-tenant.ts` sets context, always `is_local`; no unsafe raw SQL; no application code imports platform code or references `createTenant` | static-guards (5, unit) |

**Result (revision 2, local):** `npm test` → **9 files, 90 tests passed** (13 unit + 77 database). Lint, type check, formatting and build also passed. CI results are recorded in PR #1.

## 8. Migration plan

| Step | Who | Action | Reversible? |
|---|---|---|---|
| 0 | You | Review this document, `neon-dev.sql` and `migration.sql` | — |
| 1 | You | Run **steps 2–4** of `prisma/bootstrap/neon-dev.sql` in the Neon SQL Editor (database `teamhappi`, role `neondb_owner`). Step 4 should show one row with four `false` values. | Yes (grants can be re-granted) |
| 2 | You | Reply "approved" for migration `20261009120000_foundation_tenancy` | — |
| 3 | Me | `npm run db:status`, then `npm run db:migrate` (reads the direct owner URL from `.env.local`) | The database is empty, so there's nothing to lose. Undoing it would mean dropping objects, which is destructive, so I'd ask you first. |
| 4 | Me, after your explicit approval | `npm run verify:neon -- --approved` (detail below), and report the actual output | Read-mostly. It creates synthetic tenants and users, which stay in dev unless removed. |

**Post-migration Neon verification (step 4).** It runs against Neon dev only:
- the app role on the **pooled** endpoint;
- the owner role on the direct endpoint, for fixtures and catalogue inspection.

It refuses to start unless all of these hold: `--approved` is passed, both hosts are `*.neon.tech`, the app URL is pooled and connects as `teamhappi_app`, and the migration is recorded as applied. It never runs bootstrap SQL or migrations.

| Check | Suite |
|---|---|
| Role privileges: flags, `neon_superuser` membership, owns nothing, exact grants, no DDL, TRUNCATE or temp tables, no `SET ROLE` to the owner, no `app.*` login defaults, statement timeout applied | `db-roles`, `context-boundary` |
| RLS checks: ENABLE + FORCE + a policy on every `tenant_id` table; policies target only the app role; default deny without context | `db-roles`, `tenant-context` |
| Cross-tenant tests: reads, writes, joins, file references, manipulated identifiers, user visibility | `tenant-isolation`, `user-visibility` |
| Pooled connection reuse: 200 interleaved transactions for two tenants on a pool of 2, plus a context-free query after each; zero leaks; reports how many server backends were shared | `neon-verify/pooled-reuse` |

**Optional safety step (free):** before step 3, create a Neon branch of the current state as a restore point. Neon Free allows this.

The exact SQL you'll execute in step 1:

```sql
REVOKE ALL ON DATABASE teamhappi FROM PUBLIC;
GRANT CONNECT ON DATABASE teamhappi TO teamhappi_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO teamhappi_app;

ALTER ROLE teamhappi_app SET statement_timeout = '15s';
ALTER ROLE teamhappi_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE teamhappi_app SET search_path = public;

SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolname = 'teamhappi_app';
```

The role itself was already created on 9 Oct 2026 with this statement (password generated locally, never displayed):

```sql
CREATE ROLE teamhappi_app WITH LOGIN PASSWORD '<generated>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
```

## 9. Open points for your decision or awareness

1. **User table writes (M3).** Sign-up and sign-in happen before any tenant context exists, so the authentication library needs to write `user` / `session` rows without one. Proposed for M3: a third role, `teamhappi_auth`, limited to the authentication tables. I'll write it up as ADR-0008 before building it.
2. **Platform console (M3).** Listing all tenants needs cross-tenant read access to the `tenant` registry only. It will be a separate, narrow role or a security-definer function. I'll put it to you as a decision then.
3. **Audit events** for tenant creation arrive with the audit service in M4.
4. **Upstream watch-items:**
   - Prisma's Postgres adapter triggers a `pg` deprecation warning about overlapping queries inside a transaction. It's harmless on the pinned `pg` 8, but must be resolved before upgrading to `pg` 9.
   - Four high npm advisories come only through the `prisma` CLI and lint tooling, never the runtime app. They're accepted with an expiry in `scripts/audit-check.mjs`, and CI fails on any new one.
5. **Signed tenant context** (§5a). This optional hardening against SQL injection isn't proposed for Release 1. It can follow as an ADR if you want it.
6. **Synthetic verification data.** Step 4 leaves clearly named synthetic tenants (`verify-a-…`, `alpha-…` and so on) in Neon dev. Removing them needs the owner role and your approval.
7. **The Neon branch is named `production`** (Neon's default). Renaming it `dev` in the Neon console would avoid confusion later. It's optional and cosmetic.
