-- M4.2: client organisation setup (docs/architecture/m4.2-organisation-setup.md).
--
-- Additive columns plus a narrowing of the application role's privileges.
-- No data is changed or removed. Rollback steps are at the end of this file.

-- 1. Site location: business address only (no personal data).
ALTER TABLE "site"
  ADD COLUMN "address_line" text,
  ADD COLUMN "town" text,
  ADD COLUMN "postcode" text;
ALTER TABLE "site" ADD CONSTRAINT "site_location_lengths" CHECK (
  char_length("address_line") <= 200
  AND char_length("town") <= 100
  AND char_length("postcode") <= 10
);

-- 2. Employee job title (free text, optional).
ALTER TABLE "employee" ADD COLUMN "job_title" text;
ALTER TABLE "employee" ADD CONSTRAINT "employee_job_title_length"
  CHECK (char_length("job_title") <= 100);

-- 3. Least privilege for teamhappi_app (column-level UPDATE).
--    Organisations: the app may change only the display name and time zone;
--    status and slug are platform-controlled.
REVOKE UPDATE ON "tenant" FROM teamhappi_app;
GRANT UPDATE ("legal_name", "timezone", "updated_at") ON "tenant" TO teamhappi_app;
--    Employees: the app may never change tenant_id, id, membership_id (the link
--    to a login account, which is managed by invitations) or created_at.
REVOKE UPDATE ON "employee" FROM teamhappi_app;
GRANT UPDATE (
  "employee_number", "given_name", "family_name", "preferred_name", "email",
  "phone_number", "job_title", "status", "start_date", "end_date",
  "primary_site_id", "updated_at"
) ON "employee" TO teamhappi_app;

-- Rollback (manual, if ever needed):
--   GRANT UPDATE ON "tenant", "employee" TO teamhappi_app;
--   ALTER TABLE "employee" DROP CONSTRAINT "employee_job_title_length", DROP COLUMN "job_title";
--   ALTER TABLE "site" DROP CONSTRAINT "site_location_lengths",
--     DROP COLUMN "address_line", DROP COLUMN "town", DROP COLUMN "postcode";
