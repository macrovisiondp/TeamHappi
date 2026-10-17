-- M5.2: client organisation management (ADR-0009,
-- docs/architecture/m5-platform-administration.md §3).
--
-- Requires the role teamhappi_platform (prisma/bootstrap/neon-dev-platform-role.sql).
-- Additive: subscription fields on tenant, platform-role policies and grants,
-- and one counts-only summary function. No data is changed.

-- 1. Subscription and trial (display only in M5.2; billing comes later).
CREATE TYPE "subscription_status" AS ENUM ('trial', 'active', 'past_due', 'cancelled');
ALTER TABLE "tenant"
  ADD COLUMN "subscription_status" "subscription_status" NOT NULL DEFAULT 'trial',
  ADD COLUMN "trial_ends_at" TIMESTAMPTZ,
  ADD COLUMN "plan" TEXT;
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_plan_length" CHECK (char_length("plan") <= 40);

-- 2. Tenant registry for the platform role: read every organisation; change
--    only status (column grant). No other tenant-owned table is granted.
CREATE POLICY "platform_read" ON "tenant" FOR SELECT TO teamhappi_platform
  USING (true);
CREATE POLICY "platform_status" ON "tenant" FOR UPDATE TO teamhappi_platform
  USING (true) WITH CHECK (true);
GRANT SELECT ON "tenant" TO teamhappi_platform;
GRANT UPDATE ("status", "updated_at") ON "tenant" TO teamhappi_platform;

-- 3. Platform audit: a status change and its audit event commit together.
CREATE POLICY "platform_insert" ON "platform_audit_event" FOR INSERT TO teamhappi_platform
  WITH CHECK (true);
CREATE POLICY "platform_read" ON "platform_audit_event" FOR SELECT TO teamhappi_platform
  USING (true);
GRANT SELECT, INSERT ON "platform_audit_event" TO teamhappi_platform;

-- 4. Per-organisation summary: COUNTS only, plus owner contacts for support.
--    No employee, site, team or document details leave this function.
CREATE FUNCTION "app"."platform_tenant_summaries"()
  RETURNS TABLE (
    "tenant_id" uuid,
    "active_sites" integer,
    "archived_sites" integer,
    "active_members" integer,
    "people" integer,
    "owner_names" text[],
    "owner_emails" text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t."id",
      (SELECT count(*)::int FROM "public"."site" s WHERE s."tenant_id" = t."id" AND s."status" = 'active'),
      (SELECT count(*)::int FROM "public"."site" s WHERE s."tenant_id" = t."id" AND s."status" = 'archived'),
      (SELECT count(*)::int FROM "public"."tenant_membership" m WHERE m."tenant_id" = t."id" AND m."status" = 'active'),
      (SELECT count(*)::int FROM "public"."employee" e WHERE e."tenant_id" = t."id" AND e."status" <> 'left'),
      COALESCE((
        SELECT array_agg(u."name" ORDER BY u."name")
        FROM "public"."tenant_membership" m
        JOIN "public"."role_assignment" ra ON ra."tenant_id" = m."tenant_id" AND ra."membership_id" = m."id"
        JOIN "public"."role" r ON r."tenant_id" = ra."tenant_id" AND r."id" = ra."role_id" AND r."key" = 'owner'
        JOIN "public"."user" u ON u."id" = m."user_id"
        WHERE m."tenant_id" = t."id" AND m."status" = 'active'), '{}'),
      COALESCE((
        SELECT array_agg(u."email" ORDER BY u."name")
        FROM "public"."tenant_membership" m
        JOIN "public"."role_assignment" ra ON ra."tenant_id" = m."tenant_id" AND ra."membership_id" = m."id"
        JOIN "public"."role" r ON r."tenant_id" = ra."tenant_id" AND r."id" = ra."role_id" AND r."key" = 'owner'
        JOIN "public"."user" u ON u."id" = m."user_id"
        WHERE m."tenant_id" = t."id" AND m."status" = 'active'), '{}')
    FROM "public"."tenant" t
  $$;
REVOKE ALL ON FUNCTION "app"."platform_tenant_summaries"() FROM PUBLIC;
GRANT USAGE ON SCHEMA "app" TO teamhappi_platform;
GRANT EXECUTE ON FUNCTION "app"."platform_tenant_summaries"() TO teamhappi_platform;
