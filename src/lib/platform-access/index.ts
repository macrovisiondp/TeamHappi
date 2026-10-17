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
import {
  issuePlatformStaffActor,
  type PlatformStaffActor,
} from "@/platform/authz/internal";
import { createPlatformDbClient, type PlatformDbClient } from "@/platform/db";
import * as organisations from "@/platform/tenants/organisations";
import { serverEnv } from "@/lib/env";

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
  fn: (actorUserId: string, actor: PlatformStaffActor) => Promise<T>,
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
  return { ok: true, data: await fn(actor.userId, actor) };
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

// --- Client organisations (M5.2, ADR-0009) ----------------------------------

const globalForPlatform = globalThis as unknown as {
  teamhappiPlatformDb?: PlatformDbClient | null;
};

/** The teamhappi_platform client, or null when PLATFORM_DATABASE_URL is unset. */
function platformDb(): PlatformDbClient | null {
  if (globalForPlatform.teamhappiPlatformDb !== undefined)
    return globalForPlatform.teamhappiPlatformDb;
  const url = serverEnv().PLATFORM_DATABASE_URL;
  globalForPlatform.teamhappiPlatformDb = url
    ? createPlatformDbClient(url)
    : null;
  return globalForPlatform.teamhappiPlatformDb;
}

export type OrganisationSummary = organisations.OrganisationSummary;

export type OrganisationRead<T> =
  { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "not_configured" };

async function viewOrganisations<T>(
  fn: (db: PlatformDbClient) => Promise<T>,
): Promise<OrganisationRead<T>> {
  const access = await getPlatformAccess();
  if (!hasGrant(access, "tenant.view")) return { kind: "forbidden" };
  const db = platformDb();
  if (!db) return { kind: "not_configured" };
  return { kind: "ok", data: await fn(db) };
}

/** Client organisation management (view: tenant.view; changes: tenant.suspend + MFA within 15 minutes). */
export const organisationAdmin = {
  list: (query?: string) =>
    viewOrganisations((db) => organisations.listOrganisations(db, query)),
  get: (tenantId: string) =>
    viewOrganisations((db) => organisations.getOrganisation(db, tenantId)),
  async history(tenantId: string): Promise<PlatformAuditRow[] | null> {
    const access = await getPlatformAccess();
    if (!hasGrant(access, "tenant.view")) return null;
    return platformStaffAdmin.audit(100, { type: "tenant", id: tenantId });
  },
  async setStatus(
    tenantId: string,
    next: "active" | "suspended",
    reason: string,
  ): Promise<PrivilegedResult<null>> {
    const db = platformDb();
    if (!db)
      return {
        ok: false,
        reason: "rejected",
        message: "Organisation management isn't configured on this deployment.",
      };
    const r = await privileged("tenant.suspend", (_id, actor) =>
      organisations.setOrganisationStatus(db, actor, tenantId, next, reason),
    );
    if (!r.ok) return r;
    return r.data.ok
      ? { ok: true, data: null }
      : { ok: false, reason: "rejected", message: r.data.message };
  },
};
