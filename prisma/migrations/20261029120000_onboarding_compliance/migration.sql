-- M7.2: onboarding compliance (docs/architecture/m7.2-onboarding-compliance.md).
--
-- Additive. No existing rows change except that two new permissions are added
-- to the permission catalogue and to every organisation's BUILT-IN owner,
-- admin and hr_manager roles, matching src/lib/permissions/catalogue.ts.
-- Site managers get neither (decision D1). Custom roles are not touched.
--
-- 1. "rtw_check": the EMPLOYER'S record of a right-to-work check. TeamHappi
--    records the check; it never makes the legal decision. Restricted data
--    (IS-03): no document numbers, share codes, nationality or images are
--    stored (decision D4). APPEND-ONLY for every role (trigger): a correction
--    or follow-up is a new row that supersedes the current one, so history
--    can't be rewritten. One linear chain per employee (unique indexes).
-- 2. "onboarding_document": a per-onboarding checklist of documents SEEN,
--    metadata only. No file is stored (ADR-0007 storage is not approved);
--    "document_id" is reserved for that and stays NULL.
--
-- No app-role DELETE anywhere.
-- Rollback (only while both tables are empty; see the approval request):
--   DROP TABLE onboarding_document, rtw_check;
--   DROP FUNCTION app.rtw_check_immutable();
--   DROP TYPE onboarding_document_status, rtw_check_kind, rtw_outcome, rtw_list, rtw_method;
--   DELETE FROM role_permission WHERE permission_code LIKE 'rtw.%';
--   DELETE FROM permission WHERE code LIKE 'rtw.%';

CREATE TYPE "rtw_method" AS ENUM ('manual_document', 'online_check', 'idsp');
CREATE TYPE "rtw_list" AS ENUM ('list_a', 'list_b_group_1', 'list_b_group_2');
CREATE TYPE "rtw_outcome" AS ENUM ('confirmed', 'time_limited', 'not_confirmed');
CREATE TYPE "rtw_check_kind" AS ENUM ('initial', 'follow_up', 'correction');
CREATE TYPE "onboarding_document_status" AS ENUM ('requested', 'seen', 'verified', 'rejected', 'waived');

-- Right-to-work checks (append-only) -----------------------------------------------
CREATE TABLE "rtw_check" (
    "id"                       UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"                UUID NOT NULL,
    "employee_id"              UUID NOT NULL,
    "kind"                     "rtw_check_kind" NOT NULL,
    "supersedes_id"            UUID,
    "method"                   "rtw_method" NOT NULL,
    "list_type"                "rtw_list",
    "checked_on"               DATE NOT NULL,
    "checked_by_membership_id" UUID NOT NULL,
    "person_present"           BOOLEAN NOT NULL,
    "outcome"                  "rtw_outcome" NOT NULL,
    "permission_ends_on"       DATE,
    "follow_up_due_on"         DATE,
    "note"                     TEXT,
    "correction_reason"        TEXT,
    "evidence_document_id"     UUID,
    "recorded_by"              UUID NOT NULL,
    "recorded_at"              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rtw_check_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rtw_check_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "rtw_check_checked_by_fkey" FOREIGN KEY ("tenant_id", "checked_by_membership_id")
      REFERENCES "tenant_membership"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "rtw_check_evidence_fkey" FOREIGN KEY ("tenant_id", "evidence_document_id")
      REFERENCES "document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "rtw_check_note_length" CHECK ("note" IS NULL OR char_length("note") <= 500),
    CONSTRAINT "rtw_check_reason_length" CHECK ("correction_reason" IS NULL OR char_length("correction_reason") BETWEEN 3 AND 500),
    -- The Home Office list applies to manual document checks only.
    CONSTRAINT "rtw_check_list_matches_method" CHECK (("method" = 'manual_document') = ("list_type" IS NOT NULL)),
    -- Time-limited permission always has an end date and a follow-up date on or before it.
    CONSTRAINT "rtw_check_time_limited_dates" CHECK (
      ("outcome" = 'time_limited'
        AND "permission_ends_on" IS NOT NULL AND "follow_up_due_on" IS NOT NULL
        AND "permission_ends_on" > "checked_on" AND "follow_up_due_on" <= "permission_ends_on")
      OR ("outcome" <> 'time_limited' AND "permission_ends_on" IS NULL AND "follow_up_due_on" IS NULL)),
    -- The first check supersedes nothing; every later one supersedes the current one.
    CONSTRAINT "rtw_check_chain" CHECK (("kind" = 'initial') = ("supersedes_id" IS NULL)),
    -- A correction always says why.
    CONSTRAINT "rtw_check_correction_reason" CHECK (("kind" = 'correction') = ("correction_reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "rtw_check_tenant_id_id_key" ON "rtw_check" ("tenant_id", "id");
CREATE UNIQUE INDEX "rtw_check_tenant_employee_id_key" ON "rtw_check" ("tenant_id", "employee_id", "id");
-- A check can only supersede an earlier check for the SAME employee.
ALTER TABLE "rtw_check" ADD CONSTRAINT "rtw_check_supersedes_fkey"
  FOREIGN KEY ("tenant_id", "employee_id", "supersedes_id")
  REFERENCES "rtw_check"("tenant_id", "employee_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- One linear history per employee: one first check, and each check superseded at most once.
CREATE UNIQUE INDEX "rtw_check_one_initial" ON "rtw_check" ("tenant_id", "employee_id") WHERE "supersedes_id" IS NULL;
CREATE UNIQUE INDEX "rtw_check_superseded_once" ON "rtw_check" ("tenant_id", "supersedes_id") WHERE "supersedes_id" IS NOT NULL;
CREATE INDEX "rtw_check_follow_up" ON "rtw_check" ("tenant_id", "follow_up_due_on") WHERE "follow_up_due_on" IS NOT NULL;

-- Append-only for every role, including the table owner.
CREATE FUNCTION "app"."rtw_check_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'rtw_check is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."rtw_check_immutable"() FROM PUBLIC;
CREATE TRIGGER "rtw_check_no_update" BEFORE UPDATE OR DELETE ON "rtw_check"
  FOR EACH ROW EXECUTE FUNCTION "app"."rtw_check_immutable"();

-- Document checklist (metadata only) --------------------------------------------------
CREATE TABLE "onboarding_document" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"   UUID NOT NULL,
    "case_id"     UUID NOT NULL,
    "title"       TEXT NOT NULL,
    "required"    BOOLEAN NOT NULL,
    "status"      "onboarding_document_status" NOT NULL DEFAULT 'requested',
    "expires_on"  DATE,
    "reason"      TEXT,
    "status_by"   UUID,
    "status_at"   TIMESTAMPTZ,
    "document_id" UUID,
    "created_by"  UUID,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "onboarding_document_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "onboarding_document_case_fkey" FOREIGN KEY ("tenant_id", "case_id")
      REFERENCES "onboarding_case"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_document_document_fkey" FOREIGN KEY ("tenant_id", "document_id")
      REFERENCES "document"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "onboarding_document_title_length" CHECK (char_length("title") BETWEEN 1 AND 120),
    CONSTRAINT "onboarding_document_reason_length" CHECK ("reason" IS NULL OR char_length("reason") BETWEEN 3 AND 500),
    -- Every status after "requested" records who and when; rejections and waivers say why.
    CONSTRAINT "onboarding_document_status_consistent" CHECK (
      ("status" = 'requested' AND "status_by" IS NULL AND "status_at" IS NULL AND "reason" IS NULL)
      OR ("status" IN ('seen', 'verified') AND "status_by" IS NOT NULL AND "status_at" IS NOT NULL AND "reason" IS NULL)
      OR ("status" IN ('rejected', 'waived') AND "status_by" IS NOT NULL AND "status_at" IS NOT NULL AND "reason" IS NOT NULL))
);
CREATE UNIQUE INDEX "onboarding_document_tenant_id_id_key" ON "onboarding_document" ("tenant_id", "id");
CREATE INDEX "onboarding_document_case" ON "onboarding_document" ("tenant_id", "case_id");
CREATE INDEX "onboarding_document_expiry" ON "onboarding_document" ("tenant_id", "expires_on") WHERE "expires_on" IS NOT NULL;

-- Row-level security: one tenant policy per table (same as every tenant table).
ALTER TABLE "rtw_check" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rtw_check" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "rtw_check" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

ALTER TABLE "onboarding_document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_document" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "onboarding_document" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- Grants: right-to-work checks are SELECT and INSERT only. Document checks
-- change status, expiry and reason only; their title, case and requirement never change.
GRANT SELECT, INSERT ON "rtw_check", "onboarding_document" TO teamhappi_app;
GRANT UPDATE ("status", "expires_on", "reason", "status_by", "status_at", "updated_at")
  ON "onboarding_document" TO teamhappi_app;

-- Permissions (mirrors src/lib/permissions/catalogue.ts) --------------------------
INSERT INTO "permission" ("code", "description") VALUES
  ('rtw.view', 'View right-to-work check records (every view is audited)'),
  ('rtw.record', 'Record right-to-work checks, follow-ups and corrections');

INSERT INTO "role_permission" ("tenant_id", "role_id", "permission_code")
SELECT r."tenant_id", r."id", p.code
FROM "role" r
JOIN (VALUES
  ('owner', 'rtw.view'), ('owner', 'rtw.record'),
  ('admin', 'rtw.view'), ('admin', 'rtw.record'),
  ('hr_manager', 'rtw.view'), ('hr_manager', 'rtw.record')
) AS p(role_key, code) ON p.role_key = r."key"
WHERE r."is_system"
ON CONFLICT DO NOTHING;
