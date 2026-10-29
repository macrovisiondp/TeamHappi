-- M9.2b: CVs on applications (docs/architecture/m9.2b-cv-documents.md).
--
-- Additive. No existing rows change.
--
-- One row per uploaded CV. The file itself lives in private storage (Amazon S3
-- in production, a local folder in development) under a random key inside the
-- organisation's prefix; this table records where, who uploaded it and when.
-- Rows are never deleted by the app: removing a CV (or anonymising the
-- candidate) blanks the file name and moves the row from 'stored' to
-- 'deleting'; once the file is gone from storage it becomes 'deleted'. A
-- trigger allows only those transitions and keeps every other column fixed.
--
-- Rollback (only while the table is empty; see the approval request):
--   DROP TABLE application_document;
--   DROP FUNCTION app.application_document_guard();

CREATE TABLE "application_document" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"      UUID NOT NULL,
    "application_id" UUID NOT NULL,
    -- The uploader's file name (cleaned). Blanked when the file is removed.
    "file_name"      TEXT,
    "content_type"   TEXT NOT NULL,
    "size_bytes"     INTEGER NOT NULL,
    "sha256"         TEXT NOT NULL,
    "provider_id"    TEXT NOT NULL,
    "storage_key"    TEXT NOT NULL,
    "status"         TEXT NOT NULL DEFAULT 'stored',
    "uploaded_by"    UUID NOT NULL,
    "uploaded_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_by"     UUID,
    "deleted_at"     TIMESTAMPTZ,
    "delete_reason"  TEXT,
    CONSTRAINT "application_document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_document_application_fkey" FOREIGN KEY ("tenant_id", "application_id")
      REFERENCES "application"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "application_document_content_type" CHECK ("content_type" IN
      ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
    -- 4 MB: what a Vercel function can receive in one request.
    CONSTRAINT "application_document_size" CHECK ("size_bytes" BETWEEN 1 AND 4194304),
    CONSTRAINT "application_document_sha256" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "application_document_provider" CHECK ("provider_id" IN ('aws-s3', 'local-disk')),
    -- Keys always sit inside this organisation's prefix.
    CONSTRAINT "application_document_key" CHECK (
      "storage_key" ~ ('^tenants/' || "tenant_id"::text || '/objects/[A-Za-z0-9_-]{16,64}$')),
    CONSTRAINT "application_document_status" CHECK (
      ("status" = 'stored' AND char_length("file_name") BETWEEN 1 AND 200
         AND "deleted_at" IS NULL AND "deleted_by" IS NULL AND "delete_reason" IS NULL)
      OR ("status" IN ('deleting', 'deleted') AND "file_name" IS NULL
         AND "deleted_at" IS NOT NULL AND "delete_reason" IN ('removed', 'anonymised')))
);
CREATE UNIQUE INDEX "application_document_tenant_id_id_key" ON "application_document" ("tenant_id", "id");
CREATE UNIQUE INDEX "application_document_storage_key_key" ON "application_document" ("storage_key");
CREATE INDEX "application_document_application" ON "application_document" ("tenant_id", "application_id", "uploaded_at");
CREATE INDEX "application_document_deleting" ON "application_document" ("tenant_id") WHERE "status" = 'deleting';

-- stored -> deleting -> deleted, nothing else; only the deletion columns change.
CREATE FUNCTION "app"."application_document_guard"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'application_document rows are never deleted'; END IF;
    IF (NEW."id", NEW."tenant_id", NEW."application_id", NEW."content_type", NEW."size_bytes", NEW."sha256",
        NEW."provider_id", NEW."storage_key", NEW."uploaded_by", NEW."uploaded_at")
       IS DISTINCT FROM
       (OLD."id", OLD."tenant_id", OLD."application_id", OLD."content_type", OLD."size_bytes", OLD."sha256",
        OLD."provider_id", OLD."storage_key", OLD."uploaded_by", OLD."uploaded_at") THEN
      RAISE EXCEPTION 'application_document: only deletion details can change';
    END IF;
    IF NOT ((OLD."status" = 'stored' AND NEW."status" = 'deleting')
         OR (OLD."status" = 'deleting' AND NEW."status" = 'deleted'
             AND (NEW."deleted_by", NEW."deleted_at", NEW."delete_reason")
                 IS NOT DISTINCT FROM (OLD."deleted_by", OLD."deleted_at", OLD."delete_reason"))) THEN
      RAISE EXCEPTION 'application_document: status can only go stored -> deleting -> deleted';
    END IF;
    RETURN NEW;
  END $$;
REVOKE ALL ON FUNCTION "app"."application_document_guard"() FROM PUBLIC;
CREATE TRIGGER "application_document_guard" BEFORE UPDATE OR DELETE ON "application_document"
  FOR EACH ROW EXECUTE FUNCTION "app"."application_document_guard"();

ALTER TABLE "application_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_document" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "application_document" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- SELECT and INSERT; UPDATE of the deletion columns only; no DELETE.
GRANT SELECT, INSERT ON "application_document" TO teamhappi_app;
GRANT UPDATE ("file_name", "status", "deleted_by", "deleted_at", "delete_reason")
  ON "application_document" TO teamhappi_app;
