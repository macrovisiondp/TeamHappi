// Members and invitations (M6). Every function takes a READY workspace from the
// server session and runs inside withTenant(), so RLS confines it to that
// organisation. Permissions and the rules in member-policy.ts are checked here,
// on the server, for every change; each change writes an audit event in the
// same transaction.

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db/create-client";
import { newInvitationToken } from "@/lib/invitations/token";
import { isUuid, withTenant, type TenantTx } from "@/lib/tenancy";

import {
  canViewMembers,
  hasOrgWide,
  INVITATION_DAYS,
  keepsAnOwner,
  mayChangeMember,
  mayGrantRole,
  type TargetFacts,
} from "./member-policy";
import type { MutationResult } from "./mutations";
import type { Workspace } from "./resolve";

type Ready = Extract<Workspace, { kind: "ready" }>;

export interface MemberRow {
  membershipId: string;
  name: string;
  email: string;
  status: "active" | "suspended";
  roles: {
    roleId: string;
    key: string;
    name: string;
    siteId: string | null;
    siteName: string | null;
  }[];
  isSelf: boolean;
  isOwner: boolean;
  joinedAt: Date;
}

export interface InvitationRow {
  id: string;
  email: string;
  roleName: string;
  siteName: string | null;
  expiresAt: Date;
  expired: boolean;
  createdAt: Date;
}

export interface MembersPage {
  members: MemberRow[];
  invitations: InvitationRow[];
  roles: { id: string; key: string; name: string; grantable: boolean }[];
  sites: { id: string; name: string }[];
  canInvite: boolean;
  canAssign: boolean;
  actorIsOwner: boolean;
}

const forbidden = (message = "Your role doesn't allow this change.") =>
  ({ ok: false, code: "forbidden", message }) as const;
const notFound = (what: string) =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
const invalidField = (field: string, message: string) =>
  ({
    ok: false,
    code: "invalid",
    message,
    fieldErrors: { [field]: message } as Record<string, string>,
  }) as const;
const refused = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;

const run = <T>(
  client: DbClient,
  ws: Ready,
  fn: (tx: TenantTx) => Promise<T>,
) => withTenant(client, ws.ctx, fn);

async function audit(
  tx: TenantTx,
  ws: Ready,
  action: string,
  targetType: "membership" | "invitation",
  targetId: string,
  detail: Record<string, string | null> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: ws.tenant.id,
      actorUserId: ws.ctx.userId,
      action,
      targetType,
      targetId,
      detail,
    },
    select: { id: true },
  });
}

/** Owner = holds the owner role organisation-wide. */
const OWNER = { role: { key: "owner" }, siteId: null } as const;

async function actorIsOwner(tx: TenantTx, ws: Ready): Promise<boolean> {
  return (
    (await tx.roleAssignment.count({
      where: {
        tenantId: ws.tenant.id,
        membershipId: ws.membershipId,
        ...OWNER,
      },
    })) > 0
  );
}

async function activeOwners(tx: TenantTx, ws: Ready): Promise<number> {
  return tx.tenantMembership.count({
    where: {
      tenantId: ws.tenant.id,
      status: "active",
      roleAssignments: { some: OWNER },
    },
  });
}

async function loadRole(tx: TenantTx, ws: Ready, roleId: unknown) {
  if (typeof roleId !== "string" || !isUuid(roleId)) return null;
  return tx.role.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: roleId } },
    select: {
      id: true,
      key: true,
      name: true,
      permissions: { select: { permissionCode: true } },
    },
  });
}

async function loadActiveSite(tx: TenantTx, ws: Ready, siteId: unknown) {
  if (siteId === null || siteId === undefined || siteId === "")
    return { id: null };
  if (typeof siteId !== "string" || !isUuid(siteId)) return null;
  const site = await tx.site.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: siteId } },
    select: { id: true, status: true },
  });
  return site?.status === "active" ? { id: site.id } : null;
}

async function loadTarget(tx: TenantTx, ws: Ready, membershipId: string) {
  if (!isUuid(membershipId)) return null;
  const m = await tx.tenantMembership.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id: membershipId } },
    select: {
      id: true,
      userId: true,
      status: true,
      roleAssignments: {
        select: { siteId: true, role: { select: { key: true } } },
      },
    },
  });
  if (!m) return null;
  const facts: TargetFacts = {
    isSelf: m.id === ws.membershipId,
    isOwner: m.roleAssignments.some(
      (a) => a.role.key === "owner" && a.siteId === null,
    ),
    status: m.status,
  };
  return { ...m, facts };
}

// --- Reading -------------------------------------------------------------------

export async function membersPage(
  client: DbClient,
  ws: Ready,
): Promise<MembersPage | null> {
  if (!canViewMembers(ws.grants)) return null;
  return run(client, ws, async (tx) => {
    const [memberships, invitations, roles, sites, isOwner] = await Promise.all(
      [
        tx.tenantMembership.findMany({
          where: {
            tenantId: ws.tenant.id,
            status: { in: ["active", "suspended"] },
          },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            roleAssignments: {
              select: {
                siteId: true,
                role: { select: { id: true, key: true, name: true } },
                site: { select: { name: true } },
              },
            },
          },
        }),
        tx.invitation.findMany({
          where: { tenantId: ws.tenant.id, status: "pending" },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            email: true,
            expiresAt: true,
            createdAt: true,
            role: { select: { name: true } },
            site: { select: { name: true } },
          },
        }),
        tx.role.findMany({
          where: { tenantId: ws.tenant.id },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            key: true,
            name: true,
            permissions: { select: { permissionCode: true } },
          },
        }),
        tx.site.findMany({
          where: { tenantId: ws.tenant.id, status: "active" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
        actorIsOwner(tx, ws),
      ],
    );
    // Names come from "user", visible to the app only for active and
    // suspended members of this organisation (RLS policy user_visible).
    const users = await tx.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const now = Date.now();
    return {
      members: memberships.map((m) => ({
        membershipId: m.id,
        name: byId.get(m.userId)?.name ?? "Unknown",
        email: byId.get(m.userId)?.email ?? "",
        status: m.status as "active" | "suspended",
        roles: m.roleAssignments.map((a) => ({
          roleId: a.role.id,
          key: a.role.key,
          name: a.role.name,
          siteId: a.siteId,
          siteName: a.site?.name ?? null,
        })),
        isSelf: m.id === ws.membershipId,
        isOwner: m.roleAssignments.some(
          (a) => a.role.key === "owner" && a.siteId === null,
        ),
        joinedAt: m.createdAt,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        roleName: i.role.name,
        siteName: i.site?.name ?? null,
        expiresAt: i.expiresAt,
        expired: i.expiresAt.getTime() <= now,
        createdAt: i.createdAt,
      })),
      roles: roles.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        grantable: mayGrantRole(
          ws.grants,
          isOwner,
          {
            key: r.key,
            permissions: r.permissions.map((p) => p.permissionCode),
          },
          null,
        ).ok,
      })),
      sites,
      canInvite: hasOrgWide(ws.grants, "member.invite"),
      canAssign: hasOrgWide(ws.grants, "role.assign"),
      actorIsOwner: isOwner,
    };
  });
}

export interface AuditRow {
  id: string;
  action: string;
  actor: string | null;
  occurredAt: Date;
}

/** Recent membership activity (same permission as viewing members). */
export async function memberActivity(
  client: DbClient,
  ws: Ready,
  limit = 20,
): Promise<AuditRow[] | null> {
  if (!canViewMembers(ws.grants)) return null;
  return run(client, ws, async (tx) => {
    const events = await tx.auditEvent.findMany({
      where: {
        tenantId: ws.tenant.id,
        targetType: { in: ["membership", "invitation"] },
      },
      orderBy: { occurredAt: "desc" },
      take: limit,
      select: { id: true, action: true, actorUserId: true, occurredAt: true },
    });
    const ids = [
      ...new Set(
        events.map((e) => e.actorUserId).filter((v): v is string => !!v),
      ),
    ];
    const users = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return events.map((e) => ({
      id: e.id,
      action: e.action,
      actor: e.actorUserId
        ? (names.get(e.actorUserId) ?? "A former member")
        : null,
      occurredAt: e.occurredAt,
    }));
  });
}

// --- Invitations ---------------------------------------------------------------

const inviteSchema = z.object({
  email: z
    .email("Enter an email address")
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  roleId: z.string(),
  siteId: z.string().optional(),
});

const expiry = () =>
  new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

/** Creates an invitation and returns its one-time token (shown once). */
export async function createInvitation(
  client: DbClient,
  ws: Ready,
  raw: unknown,
): Promise<MutationResult<{ id: string; token: string }>> {
  if (!hasOrgWide(ws.grants, "member.invite")) return forbidden();
  const parsed = inviteSchema.safeParse(
    typeof raw === "object" && raw
      ? {
          ...raw,
          email: String((raw as { email?: unknown }).email ?? "").trim(),
        }
      : raw,
  );
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      ),
    };
  const { email } = parsed.data;
  try {
    return await run(client, ws, async (tx) => {
      const role = await loadRole(tx, ws, parsed.data.roleId);
      if (!role) return invalidField("roleId", "Choose a role.");
      const site = await loadActiveSite(tx, ws, parsed.data.siteId);
      if (!site) return invalidField("siteId", "Choose an active site.");
      const decision = mayGrantRole(
        ws.grants,
        await actorIsOwner(tx, ws),
        {
          key: role.key,
          permissions: role.permissions.map((p) => p.permissionCode),
        },
        site.id,
      );
      if (!decision.ok) return forbidden(decision.message);
      // Already an active or suspended member? (Names are visible for both.)
      const existing = await tx.user.findFirst({
        where: {
          email,
          memberships: {
            some: {
              tenantId: ws.tenant.id,
              status: { in: ["active", "suspended"] },
            },
          },
        },
        select: { id: true },
      });
      if (existing)
        return refused(
          "This person is already a member. Change their role from the members list instead.",
        );
      const { token, hash } = newInvitationToken();
      const invitation = await tx.invitation.create({
        data: {
          tenantId: ws.tenant.id,
          email,
          roleId: role.id,
          siteId: site.id,
          tokenHash: hash,
          expiresAt: expiry(),
          invitedBy: ws.ctx.userId!, // a ready workspace always has a user
        },
        select: { id: true },
      });
      await audit(tx, ws, "invitation.created", "invitation", invitation.id, {
        role: role.key,
        siteId: site.id,
      });
      return { ok: true, data: { id: invitation.id, token } } as const;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return {
        ok: false,
        code: "conflict",
        message:
          "There's already an open invitation for this address. Copy a new link for it from the list below.",
        fieldErrors: { email: "Already invited" },
      };
    throw error;
  }
}

async function pendingInvitation(tx: TenantTx, ws: Ready, id: string) {
  if (!isUuid(id)) return null;
  const inv = await tx.invitation.findUnique({
    where: { tenantId_id: { tenantId: ws.tenant.id, id } },
    select: {
      id: true,
      status: true,
      siteId: true,
      role: {
        select: {
          key: true,
          permissions: { select: { permissionCode: true } },
        },
      },
    },
  });
  return inv?.status === "pending" ? inv : null;
}

/** A fresh link (new token, new 7-day expiry). The old link stops working. */
export async function renewInvitation(
  client: DbClient,
  ws: Ready,
  id: string,
): Promise<MutationResult<{ id: string; token: string }>> {
  if (!hasOrgWide(ws.grants, "member.invite")) return forbidden();
  return run(client, ws, async (tx) => {
    const inv = await pendingInvitation(tx, ws, id);
    if (!inv) return notFound("invitation");
    const decision = mayGrantRole(
      ws.grants,
      await actorIsOwner(tx, ws),
      {
        key: inv.role.key,
        permissions: inv.role.permissions.map((p) => p.permissionCode),
      },
      inv.siteId,
    );
    if (!decision.ok) return forbidden(decision.message);
    const { token, hash } = newInvitationToken();
    await tx.invitation.update({
      where: { id: inv.id },
      data: { tokenHash: hash, expiresAt: expiry(), updatedAt: new Date() },
      select: { id: true },
    });
    await audit(tx, ws, "invitation.renewed", "invitation", inv.id);
    return { ok: true, data: { id: inv.id, token } } as const;
  });
}

export async function revokeInvitation(
  client: DbClient,
  ws: Ready,
  id: string,
): Promise<MutationResult> {
  if (!hasOrgWide(ws.grants, "member.invite")) return forbidden();
  return run(client, ws, async (tx) => {
    const inv = await pendingInvitation(tx, ws, id);
    if (!inv) return notFound("invitation");
    await tx.invitation.update({
      where: { id: inv.id },
      data: { status: "revoked", revokedAt: new Date(), updatedAt: new Date() },
      select: { id: true },
    });
    await audit(tx, ws, "invitation.revoked", "invitation", inv.id);
    return { ok: true, data: { id: inv.id } } as const;
  });
}

// --- Members ---------------------------------------------------------------------

/** Replaces a member's role (one role per member, optionally at one site). */
export async function changeMemberRole(
  client: DbClient,
  ws: Ready,
  membershipId: string,
  raw: { roleId?: unknown; siteId?: unknown },
): Promise<MutationResult> {
  if (!hasOrgWide(ws.grants, "role.assign")) return forbidden();
  return run(client, ws, async (tx) => {
    const target = await loadTarget(tx, ws, membershipId);
    if (!target) return notFound("member");
    const isOwner = await actorIsOwner(tx, ws);
    const may = mayChangeMember(isOwner, target.facts);
    if (!may.ok) return forbidden(may.message);
    const role = await loadRole(tx, ws, raw.roleId);
    if (!role) return invalidField("roleId", "Choose a role.");
    const site = await loadActiveSite(tx, ws, raw.siteId);
    if (!site) return invalidField("siteId", "Choose an active site.");
    const grant = mayGrantRole(
      ws.grants,
      isOwner,
      {
        key: role.key,
        permissions: role.permissions.map((p) => p.permissionCode),
      },
      site.id,
    );
    if (!grant.ok) return forbidden(grant.message);
    const owner = keepsAnOwner(
      target.facts,
      role.key === "owner" && site.id === null,
      true,
      await activeOwners(tx, ws),
    );
    if (!owner.ok) return refused(owner.message);
    await tx.roleAssignment.deleteMany({
      where: { tenantId: ws.tenant.id, membershipId: target.id },
    });
    await tx.roleAssignment.create({
      data: {
        tenantId: ws.tenant.id,
        membershipId: target.id,
        roleId: role.id,
        siteId: site.id,
      },
      select: { id: true },
    });
    await audit(tx, ws, "member.role_changed", "membership", target.id, {
      role: role.key,
      siteId: site.id,
    });
    return { ok: true, data: { id: target.id } } as const;
  });
}

const STATUS_ACTION = {
  suspended: "member.suspended",
  active: "member.reactivated",
  left: "member.removed",
} as const;

/** Suspend, reactivate or remove (status "left"; history is kept). */
export async function setMemberStatus(
  client: DbClient,
  ws: Ready,
  membershipId: string,
  next: "active" | "suspended" | "left",
): Promise<MutationResult> {
  if (!hasOrgWide(ws.grants, "member.invite")) return forbidden();
  if (!(next in STATUS_ACTION)) return forbidden();
  return run(client, ws, async (tx) => {
    const target = await loadTarget(tx, ws, membershipId);
    if (!target) return notFound("member");
    const may = mayChangeMember(await actorIsOwner(tx, ws), target.facts);
    if (!may.ok) return forbidden(may.message);
    if (target.status === next)
      return { ok: true, data: { id: target.id } } as const;
    const owner = keepsAnOwner(
      target.facts,
      true,
      next === "active",
      await activeOwners(tx, ws),
    );
    if (!owner.ok) return refused(owner.message);
    await tx.tenantMembership.update({
      where: { tenantId_id: { tenantId: ws.tenant.id, id: target.id } },
      data: { status: next, updatedAt: new Date() },
      select: { id: true },
    });
    await audit(tx, ws, STATUS_ACTION[next], "membership", target.id);
    return { ok: true, data: { id: target.id } } as const;
  });
}
