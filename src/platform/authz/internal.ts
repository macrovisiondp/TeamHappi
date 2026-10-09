// Platform-staff authorisation for Macrovision operations (tenant creation,
// suspension, support access).
//
// Until Milestone 3 the application has no way to obtain a PlatformStaffActor,
// so platform operations are unreachable from routes, server actions and
// modules. The only issuer below is for tests: it throws outside the test
// runner, ESLint forbids importing this file outside src/platform/**, and no
// route, action or module references platform operations. Milestone 3 replaces
// it with an issuer that verifies the signed-in session, an active
// platform_staff grant and MFA.
//
// tests/unit/static-guards.test.ts and tests/integration/create-tenant.test.ts
// check that this holds.

const PLATFORM_STAFF = Symbol("PlatformStaffActor");

export type PlatformGrant = "tenant.create";

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
