-- M14.2: new starters' personal and bank details (docs/architecture/m14-joining-flow.md,
-- D2 and D3; privacy assessment docs/security/dpia-personal-and-bank-details.md).
--
-- Additive. No existing rows change except that one new permission is added to
-- the catalogue and to every organisation's BUILT-IN owner, admin and hr_manager
-- roles. Custom roles are not touched.
--
-- One row per person. The National Insurance number and bank account are stored
-- ENCRYPTED by the application (AES-256-GCM, key only in the deployment's
-- settings); only their last 4 characters are kept readable, for masked display.
-- The app role can't delete rows: details are cleared by setting them empty.
--
-- Rollback (only while the table is empty; see the record):
--   DROP TABLE employee_personal;
--   DELETE FROM role_permission WHERE permission_code = 'employee.personal';
--   DELETE FROM permission WHERE code = 'employee.personal';

CREATE TABLE "employee_personal" (
    "id"                      UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"               UUID NOT NULL,
    "employee_id"             UUID NOT NULL,
    "address_line1"           TEXT,
    "address_line2"           TEXT,
    "town"                    TEXT,
    "postcode"                TEXT,
    "date_of_birth"           DATE,
    "emergency_name"          TEXT,
    "emergency_relationship"  TEXT,
    "emergency_phone"         TEXT,
    -- Encrypted by the application: "v<key version>:<base64>".
    "ni_ciphertext"           TEXT,
    "ni_last4"                TEXT,
    "bank_ciphertext"         TEXT,
    "bank_last4"              TEXT,
    "updated_by"              UUID NOT NULL,
    "updated_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_personal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_personal_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "employee_personal_text" CHECK (
      ("address_line1" IS NULL OR char_length("address_line1") BETWEEN 1 AND 100)
      AND ("address_line2" IS NULL OR char_length("address_line2") BETWEEN 1 AND 100)
      AND ("town" IS NULL OR char_length("town") BETWEEN 1 AND 60)
      AND ("postcode" IS NULL OR char_length("postcode") BETWEEN 2 AND 10)
      AND ("emergency_name" IS NULL OR char_length("emergency_name") BETWEEN 1 AND 100)
      AND ("emergency_relationship" IS NULL OR char_length("emergency_relationship") BETWEEN 1 AND 40)
      AND ("emergency_phone" IS NULL OR char_length("emergency_phone") BETWEEN 5 AND 30)),
    CONSTRAINT "employee_personal_dob" CHECK (
      "date_of_birth" IS NULL OR "date_of_birth" >= DATE '1900-01-01'),
    -- A plain value can never be stored where ciphertext belongs.
    CONSTRAINT "employee_personal_ni" CHECK (
      ("ni_ciphertext" IS NULL) = ("ni_last4" IS NULL)
      AND ("ni_ciphertext" IS NULL OR "ni_ciphertext" ~ '^v[0-9]{1,3}:[A-Za-z0-9+/]+={0,2}$')
      AND ("ni_last4" IS NULL OR char_length("ni_last4") = 4)),
    CONSTRAINT "employee_personal_bank" CHECK (
      ("bank_ciphertext" IS NULL) = ("bank_last4" IS NULL)
      AND ("bank_ciphertext" IS NULL OR "bank_ciphertext" ~ '^v[0-9]{1,3}:[A-Za-z0-9+/]+={0,2}$')
      AND ("bank_last4" IS NULL OR "bank_last4" ~ '^[0-9]{4}$'))
);
CREATE UNIQUE INDEX "employee_personal_tenant_id_id_key" ON "employee_personal" ("tenant_id", "id");
CREATE UNIQUE INDEX "employee_personal_one_per_person" ON "employee_personal" ("tenant_id", "employee_id");

ALTER TABLE "employee_personal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_personal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_personal" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Grants: SELECT and INSERT, column-level UPDATE of the details, no DELETE.
-- Which person a row belongs to never changes.
GRANT SELECT, INSERT ON "employee_personal" TO teamhappi_app;
GRANT UPDATE ("address_line1", "address_line2", "town", "postcode", "date_of_birth",
              "emergency_name", "emergency_relationship", "emergency_phone",
              "ni_ciphertext", "ni_last4", "bank_ciphertext", "bank_last4",
              "updated_by", "updated_at")
  ON "employee_personal" TO teamhappi_app;

-- Permission (mirrors src/lib/permissions/catalogue.ts) ---------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('employee.personal', 'View and correct staff personal and bank details (every reveal is audited)');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", 'employee.personal'
FROM "role" r
WHERE r."is_system" AND r."key" IN ('owner', 'admin', 'hr_manager')
ON CONFLICT DO NOTHING;
