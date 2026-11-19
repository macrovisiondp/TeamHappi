// Platform Admin: create an organisation (replaces the interim script), and the
// owner's invitation. Kept apart from organisations.ts because it needs the
// application database client, passed in by src/platform/tenants/app.ts (or a
// test).

import type { DbClient } from "@/lib/db/create-client";
import { trustedTenantContext } from "@/lib/tenancy/internal";
import { withTenant } from "@/lib/tenancy/with-tenant";
import type { PlatformStaffActor } from "@/platform/authz/internal";
import { assertPlatformGrant } from "@/platform/authz/internal";
import type { PlatformDbClient } from "@/platform/db";
import {
  createOrganisation,
  type CreateOrganisationInput,
} from "@/platform/tenancy/create-tenant";

/**
 * Creates an organisation (tenant, system roles, owner or owner invitation) in
 * the application database, then records it in the platform audit log. Needs
 * "tenant.create". A duplicate slug returns a conflict.
 */
export async function createOrganisationWithAudit(
  app: DbClient,
  pdb: PlatformDbClient,
  actor: PlatformStaffActor,
  input: CreateOrganisationInput,
): Promise<
  | { ok: true; tenantId: string }
  | { ok: false; code: "conflict"; message: string }
> {
  assertPlatformGrant(actor, "tenant.create");
  let created: { tenantId: string };
  try {
    created = await createOrganisation(app, actor, input);
  } catch (e) {
    if ((e as { code?: unknown }).code === "P2002")
      return {
        ok: false,
        code: "conflict",
        message: "That short name is already used. Choose another.",
      };
    throw e;
  }
  await pdb.platformAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      action: "tenant.created",
      targetType: "tenant",
      targetId: created.tenantId,
      detail: {
        owner: "userId" in input.owner ? "existing_account" : "invitation",
      },
    },
    select: { id: true },
  });
  return { ok: true, tenantId: created.tenantId };
}

// --- The owner's invitation ------------------------------------------------------------

export type OwnerInvite =
  | { state: "owner_joined" }
  | { state: "none" }
  | { state: "pending" | "expired"; email: string; expiresAt: Date }
  | { state: "revoked"; email: string };

const inTenant = <T>(
  app: DbClient,
  actor: PlatformStaffActor,
  tenantId: string,
  fn: Parameters<typeof withTenant<T>>[2],
) => withTenant(app, trustedTenantContext(tenantId, actor.userId), fn);

async function ownerRoleId(
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  tenantId: string,
) {
  const r = await tx.role.findFirst({
    where: { tenantId, key: "owner", isSystem: true },
    select: { id: true },
  });
  return r?.id ?? null;
}

/** Whether the organisation has an active owner, or where its owner invite stands. */
/**
 * Read-only. The caller (src/lib/platform-access) has already checked the
 * viewer holds "tenant.view"; no change is possible through this function.
 */
export async function ownerInvite(
  app: DbClient,
  viewerUserId: string,
  tenantId: string,
): Promise<OwnerInvite> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) return { state: "none" };
  return withTenant(
    app,
    trustedTenantContext(tenantId, viewerUserId),
    async (tx) => {
      const roleId = await ownerRoleId(tx, tenantId);
      if (!roleId) return { state: "none" } as const;
      const owners = await tx.roleAssignment.count({
        where: {
          tenantId,
          roleId,
          membership: { status: "active" },
        },
      });
      if (owners) return { state: "owner_joined" } as const;
      const inv = await tx.invitation.findFirst({
        where: { tenantId, roleId },
        orderBy: { createdAt: "desc" },
        select: { email: true, status: true, expiresAt: true },
      });
      if (!inv) return { state: "none" } as const;
      if (inv.status === "revoked")
        return { state: "revoked", email: inv.email } as const;
      if (inv.status === "accepted") return { state: "owner_joined" } as const;
      return {
        state: inv.expiresAt.getTime() <= Date.now() ? "expired" : "pending",
        email: inv.email,
        expiresAt: inv.expiresAt,
      } as const;
    },
  );
}

/**
 * Cancels any open owner invitation and, if `renew` is given, creates a new
 * one (new link) for that email. Needs "tenant.create". Platform-audited.
 */
export async function replaceOwnerInvite(
  app: DbClient,
  pdb: PlatformDbClient,
  actor: PlatformStaffActor,
  tenantId: string,
  renew: { email: string; tokenHash: string; expiresAt: Date } | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  assertPlatformGrant(actor, "tenant.create");
  if (!/^[0-9a-f-]{36}$/i.test(tenantId))
    return { ok: false, message: "That organisation couldn't be found." };
  const r = await inTenant(app, actor, tenantId, async (tx) => {
    const roleId = await ownerRoleId(tx, tenantId);
    if (!roleId)
      return {
        ok: false,
        message: "That organisation couldn't be found.",
      } as const;
    const owners = await tx.roleAssignment.count({
      where: { tenantId, roleId, membership: { status: "active" } },
    });
    if (owners)
      return { ok: false, message: "The owner has already joined." } as const;
    const now = new Date();
    await tx.invitation.updateMany({
      where: { tenantId, roleId, status: "pending" },
      data: { status: "revoked", revokedAt: now },
    });
    if (renew)
      await tx.invitation.create({
        data: {
          tenantId,
          email: renew.email.trim().toLowerCase(),
          roleId,
          tokenHash: renew.tokenHash,
          expiresAt: renew.expiresAt,
          invitedBy: actor.userId,
        },
        select: { id: true },
      });
    return { ok: true } as const;
  });
  if (!r.ok) return r;
  await pdb.platformAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      action: renew
        ? "tenant.owner_invite_renewed"
        : "tenant.owner_invite_cancelled",
      targetType: "tenant",
      targetId: tenantId,
      detail: {},
    },
    select: { id: true },
  });
  return { ok: true };
}
