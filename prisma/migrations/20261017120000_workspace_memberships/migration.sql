-- M4.1: real organisation workspaces (docs/architecture/m4.1-workspaces-design.md).
--
-- Additive and non-destructive: one read-only function and its grants. No table,
-- column, policy or data changes. Rollback: DROP FUNCTION "app"."my_memberships"();
--
-- Lets a signed-in user list THEIR OWN memberships across organisations, which
-- tenant-scoped RLS cannot express, without granting the application role any
-- cross-tenant table access. It returns a fixed projection (organisation id,
-- name, slug and the two statuses) only for rows whose user_id equals
-- app.current_user_id(), which the server sets from the validated session and
-- which is valid only inside the transaction that set it. Without that context
-- it returns no rows.
--
-- SECURITY DEFINER so the lookup can cross tenants; search_path is pinned and
-- every reference is schema-qualified. Invited memberships are excluded until
-- invitations exist (M3.6); left memberships are excluded permanently.

CREATE FUNCTION "app"."my_memberships"()
  RETURNS TABLE (
    "tenant_id" uuid,
    "tenant_name" text,
    "tenant_slug" text,
    "tenant_status" "public"."tenant_status",
    "membership_status" "public"."membership_status"
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT t."id", t."legal_name", t."slug", t."status", m."status"
    FROM "public"."tenant_membership" m
    JOIN "public"."tenant" t ON t."id" = m."tenant_id"
    WHERE m."user_id" = "app"."current_user_id"()
      AND m."status" IN ('active', 'suspended')
    ORDER BY t."legal_name", t."id"
  $$;

REVOKE ALL ON FUNCTION "app"."my_memberships"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "app"."my_memberships"() TO teamhappi_app;
