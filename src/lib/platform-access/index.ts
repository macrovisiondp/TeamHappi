import "server-only";

import { cache } from "react";

import {
  getPlatformIdentity,
  platformStaffAdmin,
  type PlatformAuditRow,
  type StaffResult,
  type StaffRow,
  type StaffStatus,
} from "@/lib/auth";
import { knownGrants } from "@/lib/permissions/platform";
import { issuePlatformStaffActor } from "@/platform/authz/internal";

import {
  checkPrivilege,
  decidePlatformAccess,
  hasGrant,
  type PlatformAccess,
} from "./policy";

export {
  assertPrivilegedPlatformAction,
  hasGrant,
  PlatformActionUnavailableError,
  PRIVILEGED_DISABLED_REASON,
  stepUpFresh,
  type PlatformAccess,
} from "./policy";

/**
 * Platform access for this request, from the server-validated session, the
 * platform_staff register and this session's MFA state. Never from a cookie,
 * header or parameter the browser controls.
 */
export const getPlatformAccess = cache(async (): Promise<PlatformAccess> => {
  const identity = await getPlatformIdentity();
  return decidePlatformAccess(
    identity && {
      user: {
        userId: identity.user.userId,
        name: identity.user.name,
        email: identity.user.email,
      },
      staff: identity.staff && {
        status: identity.staff.status,
        grants: knownGrants(identity.staff.grants),
      },
      mfaEnrolled: identity.mfaEnrolled,
      mfaLockedUntil: identity.mfaLockedUntil,
      mfaVerifiedAt: identity.mfaVerifiedAt,
    },
    new Date(),
  );
});

export type PrivilegedResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "forbidden" | "step_up" | "rejected";
      message: string;
    };

const MESSAGES = {
  forbidden: "Your platform role doesn't allow this.",
  step_up: "For your security, confirm it's you with your authenticator first.",
} as const;

/** Grant + recent MFA, then the real PlatformStaffActor (which re-checks MFA). */
async function privileged<T>(
  grant: Parameters<typeof checkPrivilege>[1],
  fn: (actorUserId: string) => Promise<T>,
): Promise<PrivilegedResult<T>> {
  const access = await getPlatformAccess();
  const now = new Date();
  const check = checkPrivilege(access, grant, now);
  if (!check.ok) return { ...check, message: MESSAGES[check.reason] };
  if (access.kind !== "staff")
    return { ok: false, reason: "forbidden", message: MESSAGES.forbidden };
  const actor = issuePlatformStaffActor({
    userId: access.viewer.userId,
    status: "active",
    grants: access.grants,
    mfaVerifiedAt: access.mfaVerifiedAt,
    now,
  });
  return { ok: true, data: await fn(actor.userId) };
}

function fromStaffResult(
  r: PrivilegedResult<StaffResult>,
): PrivilegedResult<null> {
  if (!r.ok) return r;
  return r.data.ok
    ? { ok: true, data: null }
    : { ok: false, reason: "rejected", message: r.data.message };
}

/** Platform staff administration (grant: staff.manage; MFA within 15 minutes). */
export const staffAdmin = {
  async list(): Promise<StaffRow[] | null> {
    const access = await getPlatformAccess();
    return hasGrant(access, "staff.manage") ? platformStaffAdmin.list() : null;
  },
  grant: async (email: string, grants: readonly string[]) =>
    fromStaffResult(
      await privileged("staff.manage", (actor) =>
        platformStaffAdmin.grant(actor, email, grants),
      ),
    ),
  update: async (
    targetUserId: string,
    change: { grants?: readonly string[]; status?: StaffStatus },
  ) =>
    fromStaffResult(
      await privileged("staff.manage", (actor) =>
        platformStaffAdmin.update(actor, targetUserId, change),
      ),
    ),
  async resetMfa(targetUserId: string): Promise<PrivilegedResult<null>> {
    const access = await getPlatformAccess();
    if (access.kind === "staff" && access.viewer.userId === targetUserId)
      return {
        ok: false,
        reason: "rejected",
        message: "You can't reset your own MFA.",
      };
    return privileged("staff.manage", async (actor) => {
      await platformStaffAdmin.resetMfa(actor, targetUserId);
      return null;
    });
  },
};

/** New recovery codes for yourself (MFA within 15 minutes). */
export async function regenerateMyRecoveryCodes(): Promise<
  PrivilegedResult<string[]>
> {
  const access = await getPlatformAccess();
  if (access.kind !== "staff")
    return { ok: false, reason: "forbidden", message: MESSAGES.forbidden };
  if (Date.now() - access.mfaVerifiedAt.getTime() > 15 * 60_000)
    return { ok: false, reason: "step_up", message: MESSAGES.step_up };
  return {
    ok: true,
    data: await platformStaffAdmin.regenerateRecoveryCodes(
      access.viewer.userId,
    ),
  };
}

/** The platform audit trail (grant: audit.view). */
export async function platformAudit(
  limit?: number,
): Promise<PlatformAuditRow[] | null> {
  const access = await getPlatformAccess();
  return hasGrant(access, "audit.view")
    ? platformStaffAdmin.audit(limit)
    : null;
}
