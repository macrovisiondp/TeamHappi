# ADR-0009: Platform console database role

- **Status:** Proposed (21 Oct 2026)
- **Date:** 2026-10-21
- **Requirements:** M3 plan decision 3, master directive M5.2 (client organisation management)
- **Related:** ADR-0001 (tenancy), ADR-0008 (auth role), ADR-0013 (platform staff and MFA)

## Context

Platform Admin must list every client organisation, show summaries, and suspend or reactivate organisations. The application role (`teamhappi_app`) is deliberately limited by RLS to one tenant per transaction. Giving it cross-tenant reads would weaken the tenant boundary for all application code.

## Decision

1. **A fourth login role, `teamhappi_platform`:** LOGIN, NOSUPERUSER, **NOBYPASSRLS**, NOCREATEDB, NOCREATEROLE, NOREPLICATION. It owns nothing and is a member of no other role. Session settings: 15-second timeouts, `search_path = public`, `timezone = UTC`.
2. **Grants, nothing more:**
   - `tenant`: SELECT on all rows (RLS policy `platform_read`), and UPDATE of **`status` and `updated_at` only** (column grant plus policy `platform_status`).
   - `platform_audit_event`: INSERT and SELECT, so a status change and its audit event commit in **one transaction**.
   - `app.platform_tenant_summaries()` (SECURITY DEFINER): returns **counts** for each organisation (sites, active members, people) plus **owner names and emails** for support contact.
   - **No** access to sites, teams, employees, documents, memberships, sessions, accounts or MFA data.
3. **Who uses it:** only server code in `src/platform/**`, reached through `src/lib/platform-access`, after the staff and MFA checks (ADR-0013). Changes need a `PlatformStaffActor` with `tenant.suspend`, which requires MFA within the last 15 minutes.
4. **Credentials:** the product owner creates the role and its password, as with `teamhappi_auth`. The connection string goes only into `PLATFORM_DATABASE_URL`, which is server-side; it is never in Git or the browser.

## Alternatives

- **Cross-tenant RLS policies for `teamhappi_app`.** Rejected: this widens the most-used role.
- **Using the migrator (`neondb_owner`) from the app.** Rejected: it has BYPASSRLS and owns every table.

## Consequences

- Platform staff can see that an organisation exists, its status, its subscription fields, summary counts and owner contacts, but **not** its employee records.
- A new environment variable (`PLATFORM_DATABASE_URL`) must be added to Vercel. Without it, the organisation pages explain that they aren't configured, and nothing else is affected.
