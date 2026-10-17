// Who may open Macrovision Platform Admin, decided on the server only (M5.1).
//
// Access needs an ACTIVE platform_staff record AND MFA verified in this
// session within MFA_ACCESS_MS. Privileged actions additionally need the
// specific grant and MFA within STEP_UP_MS (enforced again by the
// PlatformStaffActor issuer). Nothing here trusts the browser, and no email
// address ever grants access by itself.

import type { PlatformGrantCode } from "@/lib/permissions/platform";

export interface PlatformViewer {
  userId: string;
  name: string;
  email: string;
}

export const MFA_ACCESS_MS = 12 * 60 * 60_000;
export const STEP_UP_MS = 15 * 60_000;

export type PlatformAccess =
  | { kind: "none" }
  | { kind: "enrol"; viewer: PlatformViewer }
  | { kind: "verify"; viewer: PlatformViewer; lockedUntil: Date | null }
  | {
      kind: "staff";
      viewer: PlatformViewer;
      grants: readonly PlatformGrantCode[];
      mfaVerifiedAt: Date;
    };

export interface IdentityInput {
  user: PlatformViewer;
  staff: { status: string; grants: readonly PlatformGrantCode[] } | null;
  mfaEnrolled: boolean;
  mfaLockedUntil: Date | null;
  mfaVerifiedAt: Date | null;
}

export function decidePlatformAccess(
  identity: IdentityInput | null,
  now: Date,
): PlatformAccess {
  if (!identity || identity.staff?.status !== "active") return { kind: "none" };
  const viewer = {
    userId: identity.user.userId,
    name: identity.user.name,
    email: identity.user.email,
  };
  if (!identity.mfaEnrolled) return { kind: "enrol", viewer };
  const at = identity.mfaVerifiedAt;
  if (!at || now.getTime() - at.getTime() > MFA_ACCESS_MS)
    return { kind: "verify", viewer, lockedUntil: identity.mfaLockedUntil };
  return {
    kind: "staff",
    viewer,
    grants: identity.staff.grants,
    mfaVerifiedAt: at,
  };
}

export function hasGrant(access: PlatformAccess, grant: PlatformGrantCode) {
  return access.kind === "staff" && access.grants.includes(grant);
}

export function stepUpFresh(access: PlatformAccess, now: Date): boolean {
  return (
    access.kind === "staff" &&
    now.getTime() - access.mfaVerifiedAt.getTime() <= STEP_UP_MS
  );
}

export type PrivilegeCheck =
  { ok: true } | { ok: false; reason: "forbidden" | "step_up" };

/** The grant and a recent MFA check, or the reason they are missing. */
export function checkPrivilege(
  access: PlatformAccess,
  grant: PlatformGrantCode,
  now: Date,
): PrivilegeCheck {
  if (!hasGrant(access, grant)) return { ok: false, reason: "forbidden" };
  if (!stepUpFresh(access, now)) return { ok: false, reason: "step_up" };
  return { ok: true };
}

export class PlatformActionUnavailableError extends Error {
  constructor() {
    super(
      "This action isn't available yet: it needs approved live integrations.",
    );
    this.name = "PlatformActionUnavailableError";
  }
}

/**
 * Integration changes stay disabled until live connections are approved
 * (M5.3), whatever the caller's grants.
 */
export function assertPrivilegedPlatformAction(access: PlatformAccess): never {
  void access;
  throw new PlatformActionUnavailableError();
}

/** Why an integration control is disabled, shown next to it. */
export const PRIVILEGED_DISABLED_REASON =
  "Live integration changes need owner approval (Milestone 5.3)";
