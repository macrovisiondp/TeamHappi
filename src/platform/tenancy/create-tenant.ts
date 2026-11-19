import { z } from "zod";

import type { DbClient } from "@/lib/db/create-client";
import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import {
  assertPlatformGrant,
  type PlatformStaffActor,
} from "@/platform/authz/internal";
import { trustedTenantContext } from "@/lib/tenancy/internal";
import { withTenant } from "@/lib/tenancy/with-tenant";

export const createTenantInput = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  legalName: z.string().trim().min(1).max(200),
  ownerUserId: z.uuid(),
});

export type CreateTenantInput = z.infer<typeof createTenantInput>;

/**
 * Creates a tenant with its default roles and the owner's membership, in one
 * transaction. Platform operation: requires a PlatformStaffActor holding
 * "tenant.create". No issuer exists in the application until Milestone 3, so
 * this cannot be reached by any route or module before then. Audit logging is
 * added in Milestone 4.
 *
 * No cross-tenant privilege is used: the new tenant's id is generated first and
 * set as the transaction's tenant context, so every insert passes RLS on its own.
 */
export async function createTenant(
  client: DbClient,
  actor: PlatformStaffActor,
  input: CreateTenantInput,
) {
  assertPlatformGrant(actor, "tenant.create");
  const { slug, legalName, ownerUserId } = createTenantInput.parse(input);
  const [row] = await client.$queryRaw<
    { id: string }[]
  >`SELECT uuidv7()::text AS id`;
  if (!row) throw new Error("Could not generate tenant id");
  const ctx = trustedTenantContext(row.id, ownerUserId);

  return withTenant(client, ctx, async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id: row.id, slug, legalName },
    });

    const roleIds = new Map<string, string>();
    for (const def of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          key: def.key,
          name: def.name,
          isSystem: true,
        },
      });
      roleIds.set(def.key, role.id);
      if (def.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: def.permissions.map((permissionCode) => ({
            tenantId: tenant.id,
            roleId: role.id,
            permissionCode,
          })),
        });
      }
    }

    const membership = await tx.tenantMembership.create({
      data: { tenantId: tenant.id, userId: ownerUserId, status: "active" },
    });
    await tx.roleAssignment.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        roleId: roleIds.get("owner")!,
      },
    });

    return { tenant, membershipId: membership.id };
  });
}

// --- Platform Admin: create an organisation (replaces the interim script) -------

export const createOrganisationInput = z.object({
  slug: createTenantInput.shape.slug,
  legalName: createTenantInput.shape.legalName,
  timezone: z.string().min(1).max(64),
  owner: z.union([
    z.object({ userId: z.uuid() }),
    z.object({
      inviteEmail: z.email().max(254),
      tokenHash: z.string().min(32).max(128),
      expiresAt: z.date(),
    }),
  ]),
});

export type CreateOrganisationInput = z.infer<typeof createOrganisationInput>;

/**
 * Creates an organisation from Platform Admin, in one transaction: the tenant,
 * its system roles, and EITHER an existing verified account as active owner OR
 * an owner invitation (the person creates their login from the link). Writes the
 * organisation's own audit event (ids only). Needs "tenant.create".
 */
export async function createOrganisation(
  client: DbClient,
  actor: PlatformStaffActor,
  input: CreateOrganisationInput,
) {
  assertPlatformGrant(actor, "tenant.create");
  const { slug, legalName, timezone, owner } =
    createOrganisationInput.parse(input);
  const [row] = await client.$queryRaw<
    { id: string }[]
  >`SELECT uuidv7()::text AS id`;
  if (!row) throw new Error("Could not generate tenant id");
  const ownerUserId = "userId" in owner ? owner.userId : null;
  const ctx = trustedTenantContext(row.id, ownerUserId ?? actor.userId);

  return withTenant(client, ctx, async (tx) => {
    const tenant = await tx.tenant.create({
      data: { id: row.id, slug, legalName, timezone },
      select: { id: true, slug: true },
    });
    const roleIds = new Map<string, string>();
    for (const def of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          tenantId: tenant.id,
          key: def.key,
          name: def.name,
          isSystem: true,
        },
        select: { id: true },
      });
      roleIds.set(def.key, role.id);
      if (def.permissions.length > 0)
        await tx.rolePermission.createMany({
          data: def.permissions.map((permissionCode) => ({
            tenantId: tenant.id,
            roleId: role.id,
            permissionCode,
          })),
        });
    }
    let invitationId: string | null = null;
    if (ownerUserId) {
      const membership = await tx.tenantMembership.create({
        data: { tenantId: tenant.id, userId: ownerUserId, status: "active" },
        select: { id: true },
      });
      await tx.roleAssignment.create({
        data: {
          tenantId: tenant.id,
          membershipId: membership.id,
          roleId: roleIds.get("owner")!,
        },
      });
    } else if ("inviteEmail" in owner) {
      const inv = await tx.invitation.create({
        data: {
          tenantId: tenant.id,
          email: owner.inviteEmail.trim().toLowerCase(),
          roleId: roleIds.get("owner")!,
          tokenHash: owner.tokenHash,
          expiresAt: owner.expiresAt,
          invitedBy: actor.userId,
        },
        select: { id: true },
      });
      invitationId = inv.id;
    }
    await tx.auditEvent.create({
      data: {
        tenantId: tenant.id,
        actorUserId: actor.userId,
        action: "tenant.created",
        targetType: "tenant",
        targetId: tenant.id,
        detail: {
          by: "platform_staff",
          owner: ownerUserId ? "existing_account" : "invitation",
          ...(invitationId ? { invitationId } : {}),
        },
      },
      select: { id: true },
    });
    return { tenantId: tenant.id, slug: tenant.slug, invitationId };
  });
}
