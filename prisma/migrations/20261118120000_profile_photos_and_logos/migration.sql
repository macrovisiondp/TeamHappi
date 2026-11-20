-- M17: profile photos and organisation logos (docs/architecture/m17-polish.md;
-- requested by the product owner on 20 November 2026).
--
-- Additive. One new table; no existing rows change.
--
-- media_image holds small images an organisation uploads: a staff member's
-- profile photo (one per person) and the organisation's logo (one per
-- organisation). Images are resized in the browser before upload and checked
-- on the server (PNG, JPEG or WebP only, never SVG; at most 300 KB). They're
-- kept in the database so they work without file storage being switched on.
--
-- A photo is personal data the person can remove, so the app role may DELETE
-- rows here (replacing an image is delete + insert). Who may change what is
-- checked by the application: the person themselves or staff managers for
-- photos, owners and administrators for the logo.
--
-- The TeamHappi logo itself is a platform setting (platform_setting
-- 'brand.logo'), not stored here.
--
-- Rollback (only while the table is empty; see the record):
--   DROP TABLE media_image;

CREATE TABLE "media_image" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "kind"         TEXT NOT NULL,
    "employee_id"  UUID,
    "content_type" TEXT NOT NULL,
    "bytes"        BYTEA NOT NULL,
    "created_by"   UUID NOT NULL,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_image_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "media_image_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "media_image_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "media_image_kind" CHECK (
      ("kind" = 'employee_photo' AND "employee_id" IS NOT NULL)
      OR ("kind" = 'organisation_logo' AND "employee_id" IS NULL)),
    CONSTRAINT "media_image_type" CHECK ("content_type" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "media_image_size" CHECK (octet_length("bytes") BETWEEN 1 AND 307200)
);
CREATE UNIQUE INDEX "media_image_tenant_id_id_key" ON "media_image" ("tenant_id", "id");
CREATE UNIQUE INDEX "media_image_one_photo" ON "media_image" ("tenant_id", "employee_id") WHERE "kind" = 'employee_photo';
CREATE UNIQUE INDEX "media_image_one_logo" ON "media_image" ("tenant_id") WHERE "kind" = 'organisation_logo';

ALTER TABLE "media_image" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_image" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "media_image" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

GRANT SELECT, INSERT, DELETE ON "media_image" TO teamhappi_app;
