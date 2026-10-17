-- M5.1: platform staff register, MFA and platform audit (ADR-0013,
-- docs/architecture/m5-platform-administration.md).
--
-- Additive: four new global tables and one nullable session column. Managed
-- only by teamhappi_auth (RLS ENABLE + FORCE, auth-only policies);
-- teamhappi_app gets no access. No existing data changes.

-- 1. Platform staff register (separate from tenant memberships).
CREATE TYPE "platform_staff_status" AS ENUM ('active', 'suspended', 'revoked');

CREATE TABLE "platform_staff" (
    "user_id"    UUID NOT NULL,
    "status"     "platform_staff_status" NOT NULL DEFAULT 'active',
    "grants"     TEXT[] NOT NULL DEFAULT '{}',
    "granted_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_staff_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "platform_staff_user_fkey" FOREIGN KEY ("user_id")
      REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "platform_staff_granted_by_fkey" FOREIGN KEY ("granted_by")
      REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "platform_staff_grants_known" CHECK ("grants" <@ ARRAY[
      'staff.manage', 'tenant.view', 'tenant.suspend', 'tenant.create',
      'integrations.manage', 'audit.view'
    ]::text[])
);

-- 2. TOTP enrolment. The secret is encrypted by the application
--    (Better Auth symmetricEncrypt); last_used_step blocks code replay.
CREATE TABLE "user_mfa" (
    "user_id"           UUID NOT NULL,
    "secret_ciphertext" TEXT NOT NULL,
    "enabled_at"        TIMESTAMPTZ,
    "last_used_step"    BIGINT,
    "failed_attempts"   INTEGER NOT NULL DEFAULT 0,
    "locked_until"      TIMESTAMPTZ,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_mfa_user_fkey" FOREIGN KEY ("user_id")
      REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "user_mfa_failed_attempts_range" CHECK ("failed_attempts" >= 0)
);

-- 3. One-time recovery codes, stored only as keyed hashes.
CREATE TABLE "mfa_recovery_code" (
    "id"         UUID NOT NULL DEFAULT uuidv7(),
    "user_id"    UUID NOT NULL,
    "code_hash"  TEXT NOT NULL,
    "used_at"    TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_recovery_code_user_fkey" FOREIGN KEY ("user_id")
      REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX "mfa_recovery_code_code_hash_key" ON "mfa_recovery_code"("code_hash");
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code"("user_id");

-- 4. Append-only platform audit trail.
CREATE TABLE "platform_audit_event" (
    "id"             UUID NOT NULL DEFAULT uuidv7(),
    "occurred_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id"  UUID,
    "action"         TEXT NOT NULL,
    "target_user_id" UUID,
    "target_type"    TEXT,
    "target_id"      TEXT,
    "detail"         JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT "platform_audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_audit_event_action_format" CHECK ("action" ~ '^[a-z_]+\.[a-z_]+$')
);
CREATE INDEX "platform_audit_event_occurred_at_idx" ON "platform_audit_event"("occurred_at" DESC);
CREATE INDEX "platform_audit_event_target_user_id_idx" ON "platform_audit_event"("target_user_id");

CREATE FUNCTION "app"."platform_audit_immutable"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_event is append-only';
END $$;
REVOKE ALL ON FUNCTION "app"."platform_audit_immutable"() FROM PUBLIC;
CREATE TRIGGER "platform_audit_event_immutable"
  BEFORE UPDATE OR DELETE ON "platform_audit_event"
  FOR EACH ROW EXECUTE FUNCTION "app"."platform_audit_immutable"();
CREATE TRIGGER "platform_audit_event_no_truncate"
  BEFORE TRUNCATE ON "platform_audit_event"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."platform_audit_immutable"();

-- 5. Session-bound MFA elevation.
ALTER TABLE "session" ADD COLUMN "mfa_verified_at" TIMESTAMPTZ;

-- 6. Row-level security: auth role only.
ALTER TABLE "platform_staff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_staff" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON "platform_staff" FOR ALL TO teamhappi_auth
  USING (true) WITH CHECK (true);

ALTER TABLE "user_mfa" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_mfa" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON "user_mfa" FOR ALL TO teamhappi_auth
  USING (true) WITH CHECK (true);

ALTER TABLE "mfa_recovery_code" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mfa_recovery_code" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_only" ON "mfa_recovery_code" FOR ALL TO teamhappi_auth
  USING (true) WITH CHECK (true);

ALTER TABLE "platform_audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_audit_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "auth_insert" ON "platform_audit_event" FOR INSERT TO teamhappi_auth
  WITH CHECK (true);
CREATE POLICY "auth_read" ON "platform_audit_event" FOR SELECT TO teamhappi_auth
  USING (true);

-- 7. Least-privilege grants (no DELETE anywhere; audit is insert/read only).
GRANT SELECT, INSERT, UPDATE ON "platform_staff" TO teamhappi_auth;
GRANT SELECT, INSERT, UPDATE ON "user_mfa" TO teamhappi_auth;
GRANT SELECT, INSERT, UPDATE ON "mfa_recovery_code" TO teamhappi_auth;
GRANT SELECT, INSERT ON "platform_audit_event" TO teamhappi_auth;
