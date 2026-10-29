-- M7.3: employee onboarding (docs/architecture/m7.3-employee-onboarding.md).
--
-- Additive. No existing rows change.
--
-- 1. "invitation"."employee_id": an invitation can be for a person's record.
--    Accepting it links that record to the new login ("employee"."membership_id"),
--    so the person can see and complete their own onboarding tasks.
-- 2. app.accept_invitation(hash) is replaced: the same checks and outcomes as
--    M6, plus the link. The app role still can't change "employee"."membership_id"
--    itself (column grants unchanged); only an accepted invitation sets it, and
--    only when the record isn't linked already, the person hasn't left, and the
--    login isn't linked to another record. Linking is audited.
--
-- Rollback (only while no invitation has an employee_id; see the approval request):
--   restore app.accept_invitation from 20261024120000_invitations_members;
--   DROP INDEX invitation_one_pending_per_employee;
--   ALTER TABLE invitation DROP CONSTRAINT invitation_employee_fkey, DROP COLUMN employee_id;

ALTER TABLE "invitation" ADD COLUMN "employee_id" UUID;
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_employee_fkey"
  FOREIGN KEY ("tenant_id", "employee_id") REFERENCES "employee"("tenant_id", "id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;
-- At most one open invitation per person's record.
CREATE UNIQUE INDEX "invitation_one_pending_per_employee" ON "invitation" ("tenant_id", "employee_id")
  WHERE "status" = 'pending' AND "employee_id" IS NOT NULL;

-- Accept: unchanged from M6 except the marked block, which links the record.
CREATE OR REPLACE FUNCTION "app"."accept_invitation"("p_token_hash" text)
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
      v_membership_id := v_membership."id";
      UPDATE "public"."invitation" SET "status" = 'accepted', "accepted_by" = v_user_id,
        "accepted_at" = now(), "updated_at" = now() WHERE "id" = v_inv."id";
      PERFORM "app"."link_invited_employee"(v_inv."tenant_id", v_inv."employee_id", v_membership_id, v_user_id, v_inv."id");
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
    -- M7.3: link the person's record, if the invitation was for one.
    PERFORM "app"."link_invited_employee"(v_inv."tenant_id", v_inv."employee_id", v_membership_id, v_user_id, v_inv."id");

    RETURN QUERY SELECT 'joined'::text, v_inv."tenant_id";
  END $$;

-- Links a person's record to a membership. Only called from accept_invitation
-- (no EXECUTE for any login role). Does nothing unless the record is unlinked,
-- still employed or about to start, and the login isn't linked to another record.
CREATE FUNCTION "app"."link_invited_employee"(
    "p_tenant_id" uuid, "p_employee_id" uuid, "p_membership_id" uuid,
    "p_user_id" uuid, "p_invitation_id" uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF "p_employee_id" IS NULL THEN RETURN; END IF;
    UPDATE "public"."employee" e SET "membership_id" = "p_membership_id", "updated_at" = now()
      WHERE e."tenant_id" = "p_tenant_id" AND e."id" = "p_employee_id"
        AND e."membership_id" IS NULL AND e."status" <> 'left'
        AND NOT EXISTS (
          SELECT 1 FROM "public"."employee" x
          WHERE x."tenant_id" = "p_tenant_id" AND x."membership_id" = "p_membership_id");
    IF FOUND THEN
      INSERT INTO "public"."audit_event" ("tenant_id", "actor_user_id", "action", "target_type", "target_id", "detail")
        VALUES ("p_tenant_id", "p_user_id", 'employee.login_linked', 'employee', "p_employee_id",
          jsonb_build_object('membershipId', "p_membership_id", 'invitationId', "p_invitation_id"));
    END IF;
  END $$;

REVOKE ALL ON FUNCTION "app"."link_invited_employee"(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
-- CREATE OR REPLACE keeps accept_invitation's existing grants (app role only).
