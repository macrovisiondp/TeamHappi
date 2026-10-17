-- TeamHappi — platform console database role (M5.2, ADR-0009).
--
-- NOT YET APPROVED FOR NEON. Prepared for review only.
-- When approved: the product owner creates the role (step 1) in the Neon SQL
-- Editor with a password they choose, then steps 2–4 run as neondb_owner on
-- database "teamhappi", BEFORE migration 20261022120000_platform_tenant_admin.
-- Re-running steps 2–4 is safe.
--
-- teamhappi_platform  Used only by Platform Admin server code (src/platform),
--                     after platform-staff + MFA checks. LOGIN, NOSUPERUSER,
--                     NOBYPASSRLS, owns nothing. Its table access (tenant
--                     registry, platform audit, a counts-only summary function)
--                     comes from the reviewed migration.

-- Step 1 — create the role (product owner, with their own password):
--
--   CREATE ROLE teamhappi_platform WITH LOGIN PASSWORD '<choose-a-password>'
--     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- Step 2 — may connect to this database and use the public schema; nothing else.
GRANT CONNECT ON DATABASE teamhappi TO teamhappi_platform;
GRANT USAGE ON SCHEMA public TO teamhappi_platform;

-- Step 3 — session guard rails (applied at connection start, including via the pooler).
ALTER ROLE teamhappi_platform SET statement_timeout = '15s';
ALTER ROLE teamhappi_platform SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE teamhappi_platform SET search_path = public;
ALTER ROLE teamhappi_platform SET timezone = 'UTC';

-- Step 4 — verify. Expected: teamhappi_platform with all four flags false and
-- timezone=UTC among its settings.
SELECT r.rolname, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
       array_to_string(s.setconfig, ', ') AS settings
FROM pg_roles r LEFT JOIN pg_db_role_setting s ON s.setrole = r.oid AND s.setdatabase = 0
WHERE r.rolname = 'teamhappi_platform';
