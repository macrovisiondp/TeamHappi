-- M6: invitations and member management
-- (docs/architecture/m6-invitations-members.md).
--
-- Additive. No existing rows change. Adds:
-- 1. "invitation" (tenant-owned): one-time invite links. Only the SHA-256 hash
--    of the 32-byte token is stored; links expire after 7 days.
-- 2. "audit_event" (tenant-owned, append-only): who changed memberships, roles
--    and invitations. Ids and role keys only, no names or email addresses.
-- 3. "user"."email_verified_via": how an address was confirmed ('email' or
--    'invitation'), so accounts confirmed by an invite link can be asked to
--    confirm by email once email delivery is approved.
-- 4. Two SECURITY DEFINER functions, because a link is opened before the person
--    belongs to the organisation (tenant RLS can't express that):
--    app.invitation_preview(hash) shows what the link is for;
--    app.accept_invitation(hash) joins the signed-in user, after checking the
--    link, its expiry, the organisation's status and that the user's CONFIRMED
--    email is the invited one.
-- 5. The "user_visible" policy also shows SUSPENDED members of the current
--    organisation (as it already shows active ones), so admins can see who is
--    suspended. Former members ("left") stay hidden.

-- 1. Invitations ---------------------------------------------------------------
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE "invitation" (
    "id"               UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"        UUID NOT NULL,
    "email"            TEXT NOT NULL,
    "role_id"          UUID NOT NULL,
    "site_id"          UUID,
    "token_hash"       TEXT NOT NULL,
    "status"           "invitation_status" NOT NULL DEFAULT 'pending',
    "expires_at"       TIMESTAMPTZ NOT NULL,
    "invited_by"       UUID NOT NULL,
    "accepted_by"      UUID,
    "accepted_at"      TIMESTAMPTZ,
    "revoked_at"       TIMESTAMPTZ,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitation_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "invitation_role_fkey" FOREIGN KEY ("tenant_id", "role_id")
      REFERENCES "role"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "invitation_site_fkey" FOREIGN KEY ("tenant_id", "site_id")
      REFERENCES "site"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "invitation_email_lower" CHECK ("email" = lower("email") AND "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT "invitation_token_hash_format" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "invitation_accepted_consistent" CHECK (("status" = 'accepted') = ("accepted_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "invitation_tenant_id_id_key" ON "invitation" ("tenant_id", "id");
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation" ("token_hash");
-- At most one open invitation per address per organisation.
CREATE UNIQUE INDEX "invitation_one_pending" ON "invitation" ("tenant_id", "email") WHERE "status" = 'pending';

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "invitation" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

-- No DELETE. Only the link (new token and expiry) and the status can change.
GRANT SELECT, INSERT ON "invitation" TO teamhappi_app;
GRANT UPDATE ("token_hash", "expires_at", "status", "revoked_at", "updated_at") ON "invitation" TO teamhappi_app;

-- 2. Tenant audit trail ---------------------------------------------------------
CREATE TABLE "audit_event" (
    "id"            UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id"     UUID NOT NULL,
    "actor_user_id" UUID,
    "action"        TEXT NOT NULL,
    "target_type"   TEXT NOT NULL,
    "target_id"     UUID,
    "detail"        JSONB NOT NULL DEFAULT '{}'::jsonb,
    "occurred_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_event_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "audit_event_action_format" CHECK ("action" ~ '^[a-z_]+\.[a-z_]+$'),
    CONSTRAINT "audit_event_detail_object" CHECK (jsonb_typeof("detail") = 'object')
);
CREATE UNIQUE INDEX "audit_event_tenant_id_id_key" ON "audit_event" ("tenant_id", "id");
CREATE INDEX "audit_event_tenant_time" ON "audit_event" ("tenant_id", "occurred_at" DESC);

ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_event" FOR ALL TO teamhappi_app
  USING ("tenant_id" = (SELECT "app"."current_tenant_id"()))
  WITH CHECK ("tenant_id" = (SELECT "app"."current_tenant_id"()));

GRANT SELECT, INSERT ON "audit_event" TO teamhappi_app;

-- Append-only even for roles that might later gain UPDATE/DELETE by mistake.
CREATE FUNCTION "app"."audit_event_immutable"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$ BEGIN RAISE EXCEPTION 'audit_event is append-only'; END $$;
REVOKE ALL ON FUNCTION "app"."audit_event_immutable"() FROM PUBLIC;
CREATE TRIGGER "audit_event_no_update" BEFORE UPDATE OR DELETE ON "audit_event"
  FOR EACH ROW EXECUTE FUNCTION "app"."audit_event_immutable"();

-- 3. How an email address was confirmed ----------------------------------------
ALTER TABLE "user" ADD COLUMN "email_verified_via" TEXT,
  ADD CONSTRAINT "user_email_verified_via" CHECK ("email_verified_via" IN ('email', 'invitation'));

-- 4. Opening and accepting a link ----------------------------------------------
-- Preview: what the link is for. Returns nothing for an unknown link, and the
-- state for a known one, so the page can say "expired" or "already used".
CREATE FUNCTION "app"."invitation_preview"("p_token_hash" text)
  RETURNS TABLE (
    "state" text,
    "email" text,
    "tenant_name" text,
    "role_name" text,
    "site_name" text
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT
      CASE
        WHEN i."status" = 'accepted' THEN 'used'
        WHEN i."status" = 'revoked' THEN 'revoked'
        WHEN i."expires_at" <= now() THEN 'expired'
        WHEN t."status" <> 'active' THEN 'unavailable'
        ELSE 'valid'
      END,
      -- Details only while the link is usable.
      CASE WHEN i."status" = 'pending' AND i."expires_at" > now() AND t."status" = 'active' THEN i."email" END,
      CASE WHEN i."status" = 'pending' AND i."expires_at" > now() AND t."status" = 'active' THEN t."legal_name" END,
      CASE WHEN i."status" = 'pending' AND i."expires_at" > now() AND t."status" = 'active' THEN r."name" END,
      CASE WHEN i."status" = 'pending' AND i."expires_at" > now() AND t."status" = 'active' THEN s."name" END
    FROM "public"."invitation" i
    JOIN "public"."tenant" t ON t."id" = i."tenant_id"
    JOIN "public"."role" r ON r."tenant_id" = i."tenant_id" AND r."id" = i."role_id"
    LEFT JOIN "public"."site" s ON s."tenant_id" = i."tenant_id" AND s."id" = i."site_id"
    WHERE "p_token_hash" ~ '^[0-9a-f]{64}$' AND i."token_hash" = "p_token_hash"
  $$;

-- Accept: joins app.current_user_id() (set from the validated session, valid only
-- in this transaction). Returns one of: joined, already_member, invalid,
-- expired, unavailable, wrong_account, unverified, suspended; and the tenant id
-- when joined or already a member.
CREATE FUNCTION "app"."accept_invitation"("p_token_hash" text)
  RETURNS TABLE ("outcome" text, "tenant_id" uuid)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    v_user_id uuid := "app"."current_user_id"();
    v_inv "public"."invitation"%ROWTYPE;
    v_user record;
    v_tenant_status "public"."tenant_status";
    v_membership record;
    v_membership_id uuid;
  BEGIN
    IF v_user_id IS NULL OR "p_token_hash" !~ '^[0-9a-f]{64}$' THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
    END IF;

    -- Lock the invitation so two tabs can't accept it twice.
    SELECT * INTO v_inv FROM "public"."invitation" i
      WHERE i."token_hash" = "p_token_hash" FOR UPDATE;
    IF NOT FOUND OR v_inv."status" <> 'pending' THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
    END IF;
    IF v_inv."expires_at" <= now() THEN
      RETURN QUERY SELECT 'expired'::text, NULL::uuid; RETURN;
    END IF;
    SELECT t."status" INTO v_tenant_status FROM "public"."tenant" t WHERE t."id" = v_inv."tenant_id";
    IF v_tenant_status <> 'active' THEN
      RETURN QUERY SELECT 'unavailable'::text, NULL::uuid; RETURN;
    END IF;

    SELECT u."email", u."email_verified" INTO v_user FROM "public"."user" u WHERE u."id" = v_user_id;
    IF NOT FOUND OR lower(v_user."email") <> v_inv."email" THEN
      RETURN QUERY SELECT 'wrong_account'::text, NULL::uuid; RETURN;
    END IF;
    IF NOT v_user."email_verified" THEN
      RETURN QUERY SELECT 'unverified'::text, NULL::uuid; RETURN;
    END IF;

    SELECT m."id", m."status" INTO v_membership FROM "public"."tenant_membership" m
      WHERE m."tenant_id" = v_inv."tenant_id" AND m."user_id" = v_user_id FOR UPDATE;
    IF FOUND AND v_membership."status" = 'suspended' THEN
      -- An invitation never lifts a suspension.
      RETURN QUERY SELECT 'suspended'::text, NULL::uuid; RETURN;
    END IF;
    IF FOUND AND v_membership."status" = 'active' THEN
      UPDATE "public"."invitation" SET "status" = 'accepted', "accepted_by" = v_user_id,
        "accepted_at" = now(), "updated_at" = now() WHERE "id" = v_inv."id";
      RETURN QUERY SELECT 'already_member'::text, v_inv."tenant_id"; RETURN;
    END IF;

    IF FOUND THEN
      -- A former member ("left" or "invited") rejoins with the invited role only.
      v_membership_id := v_membership."id";
      DELETE FROM "public"."role_assignment" a
        WHERE a."tenant_id" = v_inv."tenant_id" AND a."membership_id" = v_membership_id;
      UPDATE "public"."tenant_membership" SET "status" = 'active', "updated_at" = now()
        WHERE "id" = v_membership_id;
    ELSE
      INSERT INTO "public"."tenant_membership" ("tenant_id", "user_id", "status")
        VALUES (v_inv."tenant_id", v_user_id, 'active') RETURNING "id" INTO v_membership_id;
    END IF;

    INSERT INTO "public"."role_assignment" ("tenant_id", "membership_id", "role_id", "site_id")
      VALUES (v_inv."tenant_id", v_membership_id, v_inv."role_id", v_inv."site_id");
    UPDATE "public"."invitation" SET "status" = 'accepted', "accepted_by" = v_user_id,
      "accepted_at" = now(), "updated_at" = now() WHERE "id" = v_inv."id";
    INSERT INTO "public"."audit_event" ("tenant_id", "actor_user_id", "action", "target_type", "target_id", "detail")
      VALUES (v_inv."tenant_id", v_user_id, 'invitation.accepted', 'membership', v_membership_id,
        jsonb_build_object('invitationId', v_inv."id", 'roleId', v_inv."role_id", 'siteId', v_inv."site_id"));

    RETURN QUERY SELECT 'joined'::text, v_inv."tenant_id";
  END $$;

REVOKE ALL ON FUNCTION "app"."invitation_preview"(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "app"."accept_invitation"(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."invitation_preview"(text) TO teamhappi_app;
GRANT EXECUTE ON FUNCTION "app"."accept_invitation"(text) TO teamhappi_app;

-- 5. Admins can see suspended members' names ------------------------------------
DROP POLICY "user_visible" ON "user";
CREATE POLICY "user_visible" ON "user" FOR SELECT TO teamhappi_app
  USING (
    "id" = (SELECT "app"."current_user_id"())
    OR EXISTS (
      SELECT 1 FROM "public"."tenant_membership" m
      WHERE m."user_id" = "user"."id"
        AND m."tenant_id" = (SELECT "app"."current_tenant_id"())
        AND m."status" IN ('active', 'suspended')
    )
  );
