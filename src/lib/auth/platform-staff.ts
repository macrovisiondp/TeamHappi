// Platform staff register (M5.1, ADR-0013). Separate from tenant memberships:
// being staff never makes anyone a member of a client organisation, and being
// a tenant owner never makes anyone staff. Nobody becomes staff because of an
// email address: only an existing staff member with "staff.manage" (or the
// approved bootstrap procedure) can grant it, and every change is audited.

import {
  knownGrants,
  type PlatformGrantCode,
} from "@/lib/permissions/platform";

import type { AuthDbClient } from "./db";
import { recordPlatformEvent } from "./platform-audit";

export {
  GRANT_LABELS,
  PLATFORM_GRANTS,
  type PlatformGrantCode,
} from "@/lib/permissions/platform";

export type StaffStatus = "active" | "suspended" | "revoked";

export interface StaffRecord {
  status: StaffStatus;
  grants: PlatformGrantCode[];
}

export type StaffResult =
  | { ok: true }
  | {
      ok: false;
      code: "not_found" | "invalid" | "conflict" | "forbidden";
      message: string;
    };

const known = knownGrants;

export async function getStaffRecord(
  db: AuthDbClient,
  userId: string,
): Promise<StaffRecord | null> {
  const row = await db.platformStaff.findUnique({
    where: { userId },
    select: { status: true, grants: true },
  });
  return row ? { status: row.status, grants: known(row.grants) } : null;
}

export interface StaffRow {
  userId: string;
  name: string;
  email: string | null;
  status: StaffStatus;
  grants: PlatformGrantCode[];
  mfaEnrolled: boolean;
  createdAt: Date;
}

export async function listStaff(db: AuthDbClient): Promise<StaffRow[]> {
  const rows = await db.platformStaff.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      userId: true,
      status: true,
      grants: true,
      createdAt: true,
      user: {
        select: {
          name: true,
          email: true,
          mfa: { select: { enabledAt: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    email: r.user.email,
    status: r.status,
    grants: known(r.grants),
    mfaEnrolled: Boolean(r.user.mfa?.enabledAt),
    createdAt: r.createdAt,
  }));
}

async function activeManagers(db: AuthDbClient): Promise<number> {
  return db.platformStaff.count({
    where: { status: "active", grants: { has: "staff.manage" } },
  });
}

/** Adds an existing, verified account as platform staff. */
export async function grantStaff(
  db: AuthDbClient,
  actorUserId: string,
  email: string,
  grants: readonly string[],
): Promise<StaffResult> {
  const chosen = known(grants);
  if (!chosen.length)
    return {
      ok: false,
      code: "invalid",
      message: "Choose at least one permission.",
    };
  const user = await db.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, emailVerified: true },
  });
  // Same message whether the account is missing or unverified.
  if (!user || !user.emailVerified)
    return {
      ok: false,
      code: "not_found",
      message: "No verified TeamHappi account uses that email address.",
    };
  if (user.id === actorUserId)
    return {
      ok: false,
      code: "forbidden",
      message: "You can't change your own access.",
    };
  const existing = await db.platformStaff.findUnique({
    where: { userId: user.id },
  });
  if (existing && existing.status !== "revoked")
    return {
      ok: false,
      code: "conflict",
      message: "That person is already platform staff.",
    };
  await db.platformStaff.upsert({
    where: { userId: user.id },
    create: { userId: user.id, grants: chosen, grantedBy: actorUserId },
    update: { status: "active", grants: chosen, grantedBy: actorUserId },
    select: { userId: true },
  });
  await recordPlatformEvent(db, {
    action: "staff.granted",
    actorUserId,
    targetUserId: user.id,
    detail: { grants: chosen },
  });
  return { ok: true };
}

/** Changes another staff member's grants or status. */
export async function updateStaff(
  db: AuthDbClient,
  actorUserId: string,
  targetUserId: string,
  change: { grants?: readonly string[]; status?: StaffStatus },
): Promise<StaffResult> {
  if (targetUserId === actorUserId)
    return {
      ok: false,
      code: "forbidden",
      message: "You can't change your own access.",
    };
  const current = await db.platformStaff.findUnique({
    where: { userId: targetUserId },
  });
  if (!current)
    return {
      ok: false,
      code: "not_found",
      message: "That staff member couldn't be found.",
    };
  if (
    current.status === "revoked" &&
    change.status !== undefined &&
    change.status !== "revoked"
  )
    return {
      ok: false,
      code: "conflict",
      message: "Revoked access can't be reactivated. Add them again instead.",
    };
  const grants = change.grants ? known(change.grants) : known(current.grants);
  if (change.grants && !grants.length)
    return {
      ok: false,
      code: "invalid",
      message: "Choose at least one permission.",
    };
  const status = change.status ?? current.status;

  const losesManage =
    current.status === "active" &&
    current.grants.includes("staff.manage") &&
    (status !== "active" || !grants.includes("staff.manage"));
  if (losesManage && (await activeManagers(db)) <= 1)
    return {
      ok: false,
      code: "conflict",
      message:
        "At least one active person must be able to manage platform staff.",
    };

  await db.platformStaff.update({
    where: { userId: targetUserId },
    data: { grants, status },
    select: { userId: true },
  });
  if (status !== "active")
    // End any elevated platform session immediately.
    await db.session.updateMany({
      where: { userId: targetUserId },
      data: { mfaVerifiedAt: null },
    });
  const action =
    status !== current.status
      ? status === "active"
        ? "staff.reactivated"
        : status === "suspended"
          ? "staff.suspended"
          : "staff.revoked"
      : "staff.updated";
  await recordPlatformEvent(db, {
    action,
    actorUserId,
    targetUserId,
    detail: { grants, status },
  });
  return { ok: true };
}
