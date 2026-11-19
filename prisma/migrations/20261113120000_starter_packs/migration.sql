-- M14.1: starter packs (docs/architecture/m14-joining-flow.md, D4; approved by the
-- product owner on 19 November 2026).
--
-- Additive. No existing rows change.
--
-- A starter pack is a named set of library policies (sign_document, kind
-- 'policy') for a job title, or for everyone. At hire, or from a person's
-- record, TeamHappi sends every policy in the packs that match their job title.
-- Managed with documents.manage. No app-role DELETE: packs are archived, and
-- their contents are replaced by archiving the pack and making a new one.
--
-- Rollback (only while both tables are empty; see the record):
--   DROP TABLE starter_pack_document, starter_pack;

CREATE TABLE "starter_pack" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "name"        TEXT NOT NULL,
    -- Matched case-insensitively against the person's job title; empty = everyone.
    "job_title"   TEXT,
    "created_by"  UUID NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    CONSTRAINT "starter_pack_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "starter_pack_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "starter_pack_name" CHECK (char_length("name") BETWEEN 1 AND 80),
    CONSTRAINT "starter_pack_job_title" CHECK ("job_title" IS NULL OR char_length("job_title") BETWEEN 1 AND 100),
    CONSTRAINT "starter_pack_archived" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL))
);
CREATE UNIQUE INDEX "starter_pack_tenant_id_id_key" ON "starter_pack" ("tenant_id", "id");
CREATE INDEX "starter_pack_live" ON "starter_pack" ("tenant_id") WHERE "archived_at" IS NULL;

CREATE TABLE "starter_pack_document" (
    "id"               UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID NOT NULL,
    "starter_pack_id"  UUID NOT NULL,
    "sign_document_id" UUID NOT NULL,
    CONSTRAINT "starter_pack_document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "starter_pack_document_pack_fkey" FOREIGN KEY ("tenant_id", "starter_pack_id")
      REFERENCES "starter_pack"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "starter_pack_document_document_fkey" FOREIGN KEY ("tenant_id", "sign_document_id")
      REFERENCES "sign_document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "starter_pack_document_tenant_id_id_key" ON "starter_pack_document" ("tenant_id", "id");
CREATE UNIQUE INDEX "starter_pack_document_once" ON "starter_pack_document" ("tenant_id", "starter_pack_id", "sign_document_id");

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['starter_pack', 'starter_pack_document']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON %I FOR ALL TO teamhappi_app
      USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
      WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON "starter_pack", "starter_pack_document" TO teamhappi_app;
GRANT UPDATE ("archived_at", "archived_by") ON "starter_pack" TO teamhappi_app;
