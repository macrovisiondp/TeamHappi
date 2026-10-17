// Workspace resolution against the database. Takes the DbClient explicitly so
// the security tests can run it as the real application role.

import type { DbClient } from "@/lib/db/create-client";
import type { PermissionCode } from "@/lib/permissions/catalogue";
import {
  resolveTenantContext,
  withTenant,
  withUserContext,
  type TenantContext,
  type TenantTx,
} from "@/lib/tenancy";

import {
  chooseOrganisation,
  grantsFrom,
  isUsable,
  type Grants,
  type MembershipStatus,
  type MembershipSummary,
  type TenantStatus,
} from "./policy";

export interface WorkspaceUser {
  userId: string;
  name: string;
  email: string;
}

export type Workspace =
  | {
      kind: "ready";
      user: WorkspaceUser;
      tenant: { id: string; name: string; slug: string; timezone: string };
      membershipId: string;
      roles: string[];
      grants: Grants;
      /** Usable memberships, for the organisation switcher. */
      memberships: MembershipSummary[];
      /** Server-only. Never pass to a client component. */
      ctx: TenantContext;
    }
  | { kind: "choose"; user: WorkspaceUser; memberships: MembershipSummary[] }
  | { kind: "none"; user: WorkspaceUser; blocked: MembershipSummary[] };

/** The signed-in user's own memberships (active or suspended), via app.my_memberships(). */
export async function listMemberships(
  client: DbClient,
  userId: string,
): Promise<MembershipSummary[]> {
  const rows = await (async () => {
    try {
      return await withUserContext(
        client,
        userId,
        (tx) => tx.$queryRaw<
          {
            tenant_id: string;
            tenant_name: string;
            tenant_slug: string;
            tenant_status: TenantStatus;
            membership_status: MembershipStatus;
          }[]
        >`SELECT tenant_id::text, tenant_name, tenant_slug, tenant_status::text, membership_status::text
        FROM app.my_memberships()`,
      );
    } catch (error) {
      // Deployed before the M4.1 migration: fail safe (no organisations)
      // instead of breaking every page. Any other error is re-thrown.
      if (isMissingFunction(error)) {
        console.error(
          "[workspace] app.my_memberships() is missing: apply migration 20261017120000_workspace_memberships",
        );
        return [];
      }
      throw error;
    }
  })();
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    name: r.tenant_name,
    slug: r.tenant_slug,
    tenantStatus: r.tenant_status,
    membershipStatus: r.membership_status,
  }));
}

/**
 * Resolves the workspace for one request. `user` must come from the validated
 * session; `preferredTenantId` (a cookie) is untrusted and only a preference.
 * The chosen organisation is re-checked by resolveTenantContext() under RLS.
 */
export async function resolveWorkspace(
  client: DbClient,
  user: WorkspaceUser,
  preferredTenantId: string | undefined,
): Promise<Workspace> {
  const memberships = await listMemberships(client, user.userId);
  const choice = chooseOrganisation(memberships, preferredTenantId);
  if (choice.kind === "choose")
    return { kind: "choose", user, memberships: choice.options };
  if (choice.kind === "none")
    return { kind: "none", user, blocked: choice.blocked };

  const ctx = await resolveTenantContext(client, {
    userId: user.userId,
    tenantId: choice.tenantId,
  });
  // Status changed between the two lookups: treat as no access.
  if (!ctx) return { kind: "none", user, blocked: [] };

  const loaded = await withTenant(client, ctx, (tx) =>
    loadMember(tx, ctx.tenantId, user.userId),
  );
  if (!loaded) return { kind: "none", user, blocked: [] };

  return {
    kind: "ready",
    user,
    tenant: loaded.tenant,
    membershipId: loaded.membershipId,
    roles: loaded.roles,
    grants: loaded.grants,
    memberships: memberships.filter(isUsable),
    ctx,
  };
}

async function loadMember(tx: TenantTx, tenantId: string, userId: string) {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      legalName: true,
      slug: true,
      timezone: true,
      status: true,
    },
  });
  const membership = await tx.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: {
      id: true,
      status: true,
      roleAssignments: {
        select: {
          siteId: true,
          role: {
            select: {
              name: true,
              permissions: { select: { permissionCode: true } },
            },
          },
        },
      },
    },
  });
  if (tenant?.status !== "active" || membership?.status !== "active")
    return null;
  return {
    tenant: {
      id: tenant.id,
      name: tenant.legalName,
      slug: tenant.slug,
      timezone: tenant.timezone,
    },
    membershipId: membership.id,
    roles: [...new Set(membership.roleAssignments.map((a) => a.role.name))],
    grants: grantsFrom(
      membership.roleAssignments.map((a) => ({
        siteId: a.siteId,
        permissions: a.role.permissions.map(
          (p) => p.permissionCode as PermissionCode,
        ),
      })),
    ),
  };
}

function isMissingFunction(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /my_memberships/.test(text) && /does not exist|42883/.test(text);
}
