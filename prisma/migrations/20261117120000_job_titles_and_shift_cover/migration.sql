-- M16: before HotRock's opening (docs/architecture/m16-pre-opening.md; approved by
-- the product owner on 20 November 2026).
--
-- Additive. No existing rows change.
--
-- job_title: each organisation's list of job titles. Once an organisation has
-- any, staff records, vacancies, training rules, onboarding templates and
-- starter packs only accept titles from the list (checked by the application),
-- so a typo can't silently drop someone's training or onboarding.
-- Titles are archived, never deleted.
--
-- training_course.shift_cover: "at least one person on every shift must hold
-- this course" (for example first aid). The rota warns about any time when
-- nobody working holds a valid record for it.
--
-- Rollback (only while job_title is empty and no course uses shift_cover):
--   DROP TABLE job_title;
--   ALTER TABLE training_course DROP COLUMN shift_cover;

CREATE TABLE "job_title" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "name"        TEXT NOT NULL,
    "created_by"  UUID NOT NULL,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    CONSTRAINT "job_title_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_title_tenant_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "job_title_name" CHECK (char_length("name") BETWEEN 1 AND 100 AND "name" = btrim("name")),
    CONSTRAINT "job_title_archived" CHECK (("archived_at" IS NULL) = ("archived_by" IS NULL))
);
CREATE UNIQUE INDEX "job_title_tenant_id_id_key" ON "job_title" ("tenant_id", "id");
CREATE UNIQUE INDEX "job_title_live_name" ON "job_title" ("tenant_id", lower("name")) WHERE "archived_at" IS NULL;

ALTER TABLE "job_title" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_title" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "job_title" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

GRANT SELECT, INSERT ON "job_title" TO teamhappi_app;
GRANT UPDATE ("archived_at", "archived_by") ON "job_title" TO teamhappi_app;

ALTER TABLE "training_course" ADD COLUMN "shift_cover" BOOLEAN NOT NULL DEFAULT false;
GRANT UPDATE ("shift_cover") ON "training_course" TO teamhappi_app;
