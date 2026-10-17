// Platform-staff authorisation for Macrovision operations (tenant creation,
// suspension, support access).
//
// Since M5.1 the real issuer (issuePlatformStaffActor) is used only by
// src/lib/platform-access, after reading an active platform_staff record and
// this session's MFA time from the database. The test issuer below throws
// outside the test runner. ESLint and static tests keep both out of routes,
// pages, components and modules.
//
// tests/unit/static-guards.test.ts and tests/integration/create-tenant.test.ts
// check that this holds.

import type { PlatformGrantCode } from "@/lib/permissions/platform";

const PLATFORM_STAFF = Symbol("PlatformStaffActor");

export type PlatformGrant = PlatformGrantCode;

/** Privileged platform actions need MFA at least this recently (M5.1). */
export const STEP_UP_MS = 15 * 60_000;

export interface PlatformStaffActor {
  readonly userId: string;
  readonly grants: readonly PlatformGrant[];
  readonly [PLATFORM_STAFF]: true;
}

export class PlatformAuthorisationError extends Error {
  constructor() {
    super("Platform staff authorisation required");
    this.name = "PlatformAuthorisationError";
  }
}

/**
 * The real issuer (M5.1). Called only by src/lib/platform-access after it has
 * read, from the validated session, an ACTIVE platform_staff record and this
 * session's MFA time. Refuses unless MFA was verified within STEP_UP_MS.
 */
export function issuePlatformStaffActor(input: {
  userId: string;
  status: string;
  grants: readonly PlatformGrant[];
  mfaVerifiedAt: Date | null;
  now: Date;
}): PlatformStaffActor {
  const fresh =
    input.mfaVerifiedAt !== null &&
    input.now.getTime() - input.mfaVerifiedAt.getTime() <= STEP_UP_MS &&
    input.mfaVerifiedAt.getTime() <= input.now.getTime() + 60_000;
  if (input.status !== "active" || !fresh)
    throw new PlatformAuthorisationError();
  return Object.freeze({
    userId: input.userId,
    grants: Object.freeze([...input.grants]),
    [PLATFORM_STAFF]: true as const,
  });
}

/**
 * Test-only issuer until Milestone 3 replaces it with the session-backed one.
 * Throws unless running under Vitest; never call from application code.
 */
export function issuePlatformStaffActorForTests(
  userId: string,
  grants: readonly PlatformGrant[],
): PlatformStaffActor {
  if (process.env.VITEST !== "true") throw new PlatformAuthorisationError();
  return Object.freeze({
    userId,
    grants: Object.freeze([...grants]),
    [PLATFORM_STAFF]: true as const,
  });
}

export function assertPlatformGrant(
  actor: unknown,
  grant: PlatformGrant,
): void {
  const ok =
    typeof actor === "object" &&
    actor !== null &&
    (actor as Record<symbol, unknown>)[PLATFORM_STAFF] === true &&
    (actor as PlatformStaffActor).grants.includes(grant);
  if (!ok) throw new PlatformAuthorisationError();
}
