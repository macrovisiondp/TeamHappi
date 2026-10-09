-- TeamHappi — database role bootstrap for the Neon development project.
--
-- Run ONCE, by a person, in the Neon SQL Editor:
--   project teamhappi-dev, branch "production" (Neon's default name; this is dev),
--   database "teamhappi", role "neondb_owner".
-- Not a Prisma migration: roles are cluster-wide objects, and passwords must never
-- appear in Git. Re-running is safe (every statement is idempotent).
--
-- Role design
--   neondb_owner   Migration role. Owns all tables. BYPASSRLS on Neon (platform default).
--                  Used only by `npm run db:migrate`, over a direct connection.
--   teamhappi_app  Application role. LOGIN, NOSUPERUSER, NOBYPASSRLS, owns nothing,
--                  cannot create objects. DML grants come from reviewed migrations.

-- Step 1 — application role. ALREADY DONE on 2026-10-09 (password generated locally
-- and written only to .env.local). Shown for the record; do not run again:
--
--   CREATE ROLE teamhappi_app WITH LOGIN PASSWORD '<generated>'
--     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;

-- Step 2 — database and schema defaults: only named roles may connect or create.
REVOKE ALL ON DATABASE teamhappi FROM PUBLIC;
GRANT CONNECT ON DATABASE teamhappi TO teamhappi_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO teamhappi_app;

-- Step 3 — guard rails on every application session (applied at connection start,
-- including through Neon's pooler).
ALTER ROLE teamhappi_app SET statement_timeout = '15s';
ALTER ROLE teamhappi_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE teamhappi_app SET search_path = public;

-- Step 4 — verify. Expected: one row, all four flags false.
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
FROM pg_roles WHERE rolname = 'teamhappi_app';
