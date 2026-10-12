-- TeamHappi — authentication database role (Milestone 3.1, ADR-0008).
--
-- NOT YET APPROVED FOR NEON. Prepared for review only.
-- When approved: run ONCE, as neondb_owner, on database "teamhappi" (Neon dev),
-- BEFORE migration 20261012120000_auth_foundation, inside one transaction.
-- Re-running steps 2–4 is safe; step 1 fails if the role already exists.
-- Also sets timezone = 'UTC' on the existing teamhappi_app role (step 3b).
--
-- teamhappi_auth  Used only by Better Auth (src/lib/auth) for identity tables:
--                 user, session, account, verification, rate_limit.
--                 LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing, cannot create
--                 objects, no access to tenant data. Table grants and RLS policies
--                 come from the reviewed migration.

-- Step 1 — create the role. The password is generated locally at execution time
-- and written only to .env.local (AUTH_DATABASE_URL); it never appears in Git,
-- logs or chat. The placeholder below is replaced by the approved runner.
--
--   CREATE ROLE teamhappi_auth WITH LOGIN PASSWORD '<generated>'
--     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- Step 2 — may connect to this database and use the public schema; nothing else.
GRANT CONNECT ON DATABASE teamhappi TO teamhappi_auth;
GRANT USAGE ON SCHEMA public TO teamhappi_auth;

-- Step 3 — session guard rails (applied at connection start, including via the pooler).
ALTER ROLE teamhappi_auth SET statement_timeout = '15s';
ALTER ROLE teamhappi_auth SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE teamhappi_auth SET search_path = public;

-- Step 3b — UTC for every application connection. Prisma's PostgreSQL adapter
-- sends timestamps as UTC wall-clock time without an offset and reads them back
-- assuming UTC; on a non-UTC session every stored time (including session
-- expiry) would be shifted. Neon defaults to UTC; this makes it explicit and
-- also covers teamhappi_app, which predates this finding (M3.1).
ALTER ROLE teamhappi_auth SET timezone = 'UTC';
ALTER ROLE teamhappi_app SET timezone = 'UTC';

-- Step 4 — verify. Expected: teamhappi_auth with all four flags false, and both
-- roles listing timezone=UTC among their settings.
SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
       array_to_string(s.setconfig, ', ') AS settings
FROM pg_roles r LEFT JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
WHERE r.rolname IN ('teamhappi_auth', 'teamhappi_app') ORDER BY 1;
