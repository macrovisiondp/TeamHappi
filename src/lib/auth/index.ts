import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { serverEnv } from "@/lib/env";

import { createAuth, type Auth } from "./config";
import { createAuthDbClient, type AuthDbClient } from "./db";
import * as mfa from "./mfa";
import { listPlatformEvents } from "./platform-audit";
import * as staff from "./platform-staff";
import { defaultMailer } from "./mailer";
import { validateSession, type AuthenticatedUser } from "./session";

export type { AuthenticatedUser } from "./session";

const globalForAuth = globalThis as unknown as {
  teamhappiAuth?: Auth | null;
  teamhappiAuthDb?: AuthDbClient;
};

/**
 * The server's Better Auth instance, or null when authentication is not
 * configured (AUTH_DATABASE_URL / BETTER_AUTH_SECRET missing). Missing
 * configuration fails closed: every visitor is treated as signed out.
 */
export function getAuth(): Auth | null {
  if (globalForAuth.teamhappiAuth !== undefined)
    return globalForAuth.teamhappiAuth;
  const env = serverEnv();
  if (!env.AUTH_DATABASE_URL || !env.BETTER_AUTH_SECRET) {
    if (env.NODE_ENV === "production") {
      console.error(
        "[auth] Authentication is not configured (AUTH_DATABASE_URL, BETTER_AUTH_SECRET); all requests are treated as signed out.",
      );
    }
    globalForAuth.teamhappiAuth = null;
    return null;
  }
  const auth = createAuth({
    db: (globalForAuth.teamhappiAuthDb = createAuthDbClient(
      env.AUTH_DATABASE_URL,
    )),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    mailer: defaultMailer(),
    secureCookies: new URL(env.APP_URL).protocol === "https:",
  });
  globalForAuth.teamhappiAuth = auth;
  return auth;
}

/**
 * The signed-in user for this request, validated against the database.
 * Memoised per request (React cache), never across requests.
 */
export const getCurrentUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    // Request-time only: session checks read the clock and the database, so
    // they must never be prerendered.
    await connection();
    const requestHeaders = await headers();
    const auth = getAuth();
    if (!auth) return null;
    return validateSession(auth, requestHeaders);
  },
);

// --- Platform staff and MFA (M5.1, ADR-0013) --------------------------------
// Everything below runs as teamhappi_auth for the CURRENT validated session.
// Authorisation for privileged changes (grant + recent MFA) is enforced by
// src/lib/platform-access, the only caller allowed to use platformStaffAdmin.

export { MFA_POLICY } from "./mfa";
export {
  GRANT_LABELS,
  PLATFORM_GRANTS,
  type PlatformGrantCode,
  type StaffRecord,
  type StaffResult,
  type StaffRow,
  type StaffStatus,
} from "./platform-staff";
export type { PlatformAuditRow } from "./platform-audit";
export type { MfaResult } from "./mfa";

function mfaDeps(): mfa.MfaDeps | null {
  getAuth();
  const db = globalForAuth.teamhappiAuthDb;
  const secret = serverEnv().BETTER_AUTH_SECRET;
  return db && secret ? { db, secret } : null;
}

export interface PlatformIdentity {
  user: AuthenticatedUser;
  staff: staff.StaffRecord | null;
  mfaEnrolled: boolean;
  mfaLockedUntil: Date | null;
  mfaVerifiedAt: Date | null;
}

/** Platform staff and MFA state for this request's session (memoised per request). */
export const getPlatformIdentity = cache(
  async (): Promise<PlatformIdentity | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const deps = mfaDeps();
    const none = {
      user,
      staff: null,
      mfaEnrolled: false,
      mfaLockedUntil: null,
      mfaVerifiedAt: null,
    };
    if (!deps) return none;
    const record = await staff.getStaffRecord(deps.db, user.userId);
    if (!record || record.status !== "active")
      return { ...none, staff: record };
    const status = await mfa.mfaStatus(deps, user.userId);
    return {
      user,
      staff: record,
      mfaEnrolled: status.enrolled,
      mfaLockedUntil: status.lockedUntil,
      mfaVerifiedAt: await mfa.sessionMfaVerifiedAt(deps.db, user.sessionId),
    };
  },
);

/** MFA operations for the signed-in ACTIVE platform staff member. */
export const platformMfa = {
  async start() {
    const id = await getPlatformIdentity();
    const deps = mfaDeps();
    if (!id || id.staff?.status !== "active" || !deps) return null;
    return mfa.startEnrolment(deps, {
      userId: id.user.userId,
      email: id.user.email,
    });
  },
  async confirm(code: string) {
    const id = await getPlatformIdentity();
    const deps = mfaDeps();
    if (!id || id.staff?.status !== "active" || !deps) return null;
    return mfa.confirmEnrolment(deps, id.user.userId, id.user.sessionId, code);
  },
  async verify(code: string) {
    const id = await getPlatformIdentity();
    const deps = mfaDeps();
    if (!id || id.staff?.status !== "active" || !deps) return null;
    return mfa.verifyTotp(deps, id.user.userId, id.user.sessionId, code);
  },
  async verifyRecovery(code: string) {
    const id = await getPlatformIdentity();
    const deps = mfaDeps();
    if (!id || id.staff?.status !== "active" || !deps) return null;
    return mfa.verifyRecoveryCode(
      deps,
      id.user.userId,
      id.user.sessionId,
      code,
    );
  },
};

/**
 * Privileged staff administration. ONLY src/lib/platform-access may call
 * these, after checking the grant and recent MFA (enforced by a static test).
 */
export const platformStaffAdmin = {
  list: () => withDeps((d) => staff.listStaff(d.db)),
  grant: (actor: string, email: string, grants: readonly string[]) =>
    withDeps((d) => staff.grantStaff(d.db, actor, email, grants)),
  update: (
    actor: string,
    target: string,
    change: { grants?: readonly string[]; status?: staff.StaffStatus },
  ) => withDeps((d) => staff.updateStaff(d.db, actor, target, change)),
  resetMfa: (actor: string, target: string) =>
    withDeps((d) => mfa.resetMfa(d, actor, target)),
  regenerateRecoveryCodes: (userId: string) =>
    withDeps((d) => mfa.regenerateRecoveryCodes(d, userId)),
  audit: (limit?: number, target?: { type: string; id: string }) =>
    withDeps((d) => listPlatformEvents(d.db, limit, target)),
};

async function withDeps<T>(fn: (deps: mfa.MfaDeps) => Promise<T>): Promise<T> {
  const deps = mfaDeps();
  if (!deps) throw new Error("Authentication is not configured");
  return fn(deps);
}
