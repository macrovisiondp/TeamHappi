-- M13: documents to sign (docs/architecture/m13-documents-to-sign.md; approved by
-- the product owner on 19 November 2026, "as recommended").
--
-- Additive. No existing rows change except that one new permission is added to
-- the catalogue and to every organisation's BUILT-IN owner, admin and hr_manager
-- roles. Custom roles are not touched.
--
-- Organisations upload PDFs to private storage: policies once (a library), and
-- each person's filled-in contract for that person. They send them to a new
-- starter, who reads and signs in TeamHappi (typed name and agreement: a simple
-- electronic signature). Contracts are then countersigned by someone with
-- documents.manage. TeamHappi adds a signature page and keeps the signed PDF.
-- What was signed is fixed by the file's SHA-256. No pay or other contract
-- details are stored as data: they live only inside the private files. No
-- app-role DELETE.
--
-- Rollback (only while both tables are empty; see the record):
--   DROP TABLE sign_request, sign_document;
--   DELETE FROM role_permission WHERE permission_code = 'documents.manage';
--   DELETE FROM permission WHERE code = 'documents.manage';

CREATE TABLE "sign_document" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    -- policy: one file for everyone (library); contract: one person's own file.
    "kind"         TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "employee_id"  UUID,
    "file_name"    TEXT NOT NULL,
    "size_bytes"   INTEGER NOT NULL,
    "sha256"       TEXT NOT NULL,
    "provider_id"  TEXT NOT NULL,
    "storage_key"  TEXT NOT NULL,
    "uploaded_by"  UUID NOT NULL,
    "uploaded_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at"  TIMESTAMPTZ,
    "archived_by"  UUID,
    CONSTRAINT "sign_document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sign_document_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sign_document_kind" CHECK (
      ("kind" = 'policy' AND "employee_id" IS NULL)
      OR ("kind" = 'contract' AND "employee_id" IS NOT NULL)),
    CONSTRAINT "sign_document_title" CHECK (char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "sign_document_file_name" CHECK (char_length("file_name") BETWEEN 1 AND 200),
    CONSTRAINT "sign_document_size" CHECK ("size_bytes" BETWEEN 1 AND 4194304),
    CONSTRAINT "sign_document_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    -- Files live under the organisation's own prefix.
    CONSTRAINT "sign_document_storage_key" CHECK ("storage_key" LIKE 'tenants/' || "tenant_id"::text || '/objects/%'),
    CONSTRAINT "sign_document_archived" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL))
);
CREATE UNIQUE INDEX "sign_document_tenant_id_id_key" ON "sign_document" ("tenant_id", "id");
CREATE UNIQUE INDEX "sign_document_storage_key_key" ON "sign_document" ("storage_key");
CREATE INDEX "sign_document_library" ON "sign_document" ("tenant_id", "kind") WHERE "archived_at" IS NULL;

CREATE TABLE "sign_request" (
    "id"                  UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"           UUID NOT NULL,
    "employee_id"         UUID NOT NULL,
    "sign_document_id"    UUID NOT NULL,
    "needs_countersign"   BOOLEAN NOT NULL,
    -- awaiting_employee -> (awaiting_countersign ->) completed; or withdrawn.
    "status"              TEXT NOT NULL DEFAULT 'awaiting_employee',
    "sent_by"             UUID NOT NULL,
    "sent_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The employee's signature: the name they typed, who, when, and the exact file.
    "signed_name"         TEXT,
    "signed_by"           UUID,
    "signed_at"           TIMESTAMPTZ,
    "signed_sha256"       TEXT,
    "countersigned_name"  TEXT,
    "countersigned_by"    UUID,
    "countersigned_at"    TIMESTAMPTZ,
    -- The signed PDF (original plus signature page).
    "final_provider_id"   TEXT,
    "final_storage_key"   TEXT,
    "final_sha256"        TEXT,
    "withdrawn_by"        UUID,
    "withdrawn_at"        TIMESTAMPTZ,
    CONSTRAINT "sign_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sign_request_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sign_request_document_fkey" FOREIGN KEY ("tenant_id", "sign_document_id")
      REFERENCES "sign_document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "sign_request_status" CHECK ("status" IN
      ('awaiting_employee', 'awaiting_countersign', 'completed', 'withdrawn')),
    CONSTRAINT "sign_request_signed" CHECK (
      ("signed_at" IS NULL) = ("signed_name" IS NULL)
      AND ("signed_at" IS NULL) = ("signed_by" IS NULL)
      AND ("signed_at" IS NULL) = ("signed_sha256" IS NULL)
      AND ("signed_name" IS NULL OR char_length("signed_name") BETWEEN 2 AND 100)
      AND ("signed_sha256" IS NULL OR "signed_sha256" ~ '^[0-9a-f]{64}$')),
    CONSTRAINT "sign_request_countersigned" CHECK (
      ("countersigned_at" IS NULL) = ("countersigned_name" IS NULL)
      AND ("countersigned_at" IS NULL) = ("countersigned_by" IS NULL)
      AND ("countersigned_name" IS NULL OR char_length("countersigned_name") BETWEEN 2 AND 100)
      AND ("countersigned_at" IS NULL OR "needs_countersign")),
    CONSTRAINT "sign_request_final" CHECK (
      ("final_storage_key" IS NULL) = ("final_provider_id" IS NULL)
      AND ("final_storage_key" IS NULL) = ("final_sha256" IS NULL)
      AND ("final_storage_key" IS NULL OR "final_storage_key" LIKE 'tenants/' || "tenant_id"::text || '/objects/%')),
    CONSTRAINT "sign_request_flow" CHECK (
      ("status" = 'awaiting_employee' AND "signed_at" IS NULL)
      OR ("status" = 'awaiting_countersign' AND "needs_countersign" AND "signed_at" IS NOT NULL
          AND "countersigned_at" IS NULL)
      OR ("status" = 'completed' AND "signed_at" IS NOT NULL AND "final_storage_key" IS NOT NULL
          AND ("countersigned_at" IS NOT NULL OR NOT "needs_countersign"))
      OR ("status" = 'withdrawn' AND "withdrawn_at" IS NOT NULL AND "withdrawn_by" IS NOT NULL))
);
CREATE UNIQUE INDEX "sign_request_tenant_id_id_key" ON "sign_request" ("tenant_id", "id");
-- One open request per person and document.
CREATE UNIQUE INDEX "sign_request_one_open" ON "sign_request" ("tenant_id", "employee_id", "sign_document_id")
  WHERE "status" IN ('awaiting_employee', 'awaiting_countersign');
CREATE INDEX "sign_request_employee" ON "sign_request" ("tenant_id", "employee_id");
CREATE UNIQUE INDEX "sign_request_final_key" ON "sign_request" ("final_storage_key")
  WHERE "final_storage_key" IS NOT NULL;

-- Row-level security ------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sign_document', 'sign_request']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

-- Grants: SELECT and INSERT, column-level UPDATE, no DELETE. Files, owners and
-- fingerprints never change once written.
GRANT SELECT, INSERT ON "sign_document", "sign_request" TO teamhappi_app;
GRANT UPDATE ("archived_at", "archived_by") ON "sign_document" TO teamhappi_app;
GRANT UPDATE ("status", "signed_name", "signed_by", "signed_at", "signed_sha256",
              "countersigned_name", "countersigned_by", "countersigned_at",
              "final_provider_id", "final_storage_key", "final_sha256",
              "withdrawn_by", "withdrawn_at")
  ON "sign_request" TO teamhappi_app;

-- Permission (mirrors src/lib/permissions/catalogue.ts) ---------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('documents.manage', 'Upload documents, send them for signing, countersign and view signed copies');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", 'documents.manage'
FROM "role" r
WHERE r."is_system" AND r."key" IN ('owner', 'admin', 'hr_manager')
ON CONFLICT DO NOTHING;
