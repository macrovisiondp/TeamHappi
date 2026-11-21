-- M18: offboarding (docs/architecture/m18-offboarding.md; approved by the
-- product owner on 20 November 2026, "Yes, as recommended").
--
-- Additive apart from one widened unique index (see 3). No existing rows change
-- except that every existing template and case is a "joining" one (the column
-- default).
--
-- 1. employee_leaving: someone's leaving, recorded by HR, owners or admins:
--    last working day, reason, an optional private note. Once their last day
--    has passed (or access is ended straight away), TeamHappi finalises it:
--    the record becomes "left", the login stops working for this organisation,
--    later shifts are unassigned, and open invitations and signature requests
--    are cancelled. History is kept. Cancelled only before it's finalised.
--
-- 2. onboarding_template.purpose / onboarding_case.purpose: checklists are for
--    joining (as now) or leaving. A leaving case's start date is the last day.
--
-- 3. One active checklist of EACH kind per person (was: one active in total),
--    so a leaver whose joining checklist is still open can have a leaving one.
--
-- Rollback (only while no leaving records or leaving checklists exist):
--   DROP TABLE employee_leaving;
--   DROP INDEX onboarding_case_one_active_per_purpose;
--   CREATE UNIQUE INDEX onboarding_case_one_active ON onboarding_case (tenant_id, employee_id) WHERE status = 'active';
--   ALTER TABLE onboarding_case DROP COLUMN purpose;
--   ALTER TABLE onboarding_template DROP COLUMN purpose;

CREATE TABLE "employee_leaving" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"    UUID NOT NULL,
    "employee_id"  UUID NOT NULL,
    "last_day"     DATE NOT NULL,
    "reason"       TEXT NOT NULL,
    "note"         TEXT,
    "recorded_by"  UUID NOT NULL,
    "recorded_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ,
    "cancelled_by" UUID,
    "finalised_at" TIMESTAMPTZ,
    "access_ended_early" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "employee_leaving_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_leaving_employee_fkey" FOREIGN KEY ("tenant_id", "employee_id")
      REFERENCES "employee"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "employee_leaving_reason" CHECK ("reason" IN ('resigned', 'end_of_contract', 'dismissed', 'other')),
    CONSTRAINT "employee_leaving_note" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 1000),
    CONSTRAINT "employee_leaving_cancelled" CHECK (("cancelled_at" IS NULL) = ("cancelled_by" IS NULL)),
    CONSTRAINT "employee_leaving_one_outcome" CHECK ("cancelled_at" IS NULL OR "finalised_at" IS NULL)
);
CREATE UNIQUE INDEX "employee_leaving_tenant_id_id_key" ON "employee_leaving" ("tenant_id", "id");
-- At most one leaving in progress (not cancelled) per person.
CREATE UNIQUE INDEX "employee_leaving_one_open" ON "employee_leaving" ("tenant_id", "employee_id") WHERE "cancelled_at" IS NULL;
CREATE INDEX "employee_leaving_due" ON "employee_leaving" ("tenant_id", "last_day")
  WHERE "cancelled_at" IS NULL AND "finalised_at" IS NULL;

ALTER TABLE "employee_leaving" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_leaving" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "employee_leaving" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- No DELETE. The last day can be moved (until finalised, checked by the app);
-- cancelling and finalising are recorded.
GRANT SELECT, INSERT ON "employee_leaving" TO teamhappi_app;
GRANT UPDATE ("last_day", "reason", "note", "cancelled_at", "cancelled_by",
              "finalised_at", "access_ended_early")
  ON "employee_leaving" TO teamhappi_app;

-- Joining or leaving checklists -------------------------------------------------------
ALTER TABLE "onboarding_template" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'joining';
ALTER TABLE "onboarding_template" ADD CONSTRAINT "onboarding_template_purpose"
  CHECK ("purpose" IN ('joining', 'leaving'));
ALTER TABLE "onboarding_case" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'joining';
ALTER TABLE "onboarding_case" ADD CONSTRAINT "onboarding_case_purpose"
  CHECK ("purpose" IN ('joining', 'leaving'));

CREATE UNIQUE INDEX "onboarding_case_one_active_per_purpose" ON "onboarding_case" ("tenant_id", "employee_id", "purpose")
  WHERE "status" = 'active';
DROP INDEX "onboarding_case_one_active";
