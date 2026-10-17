// TOTP MFA with one-time recovery codes (M5.1, ADR-0013).
//
// - TOTP: RFC 6238 via the `otpauth` library (SHA-1, 6 digits, 30 s, ±1 step).
// - The TOTP secret is stored encrypted (Better Auth symmetricEncrypt, keyed
//   by BETTER_AUTH_SECRET). It is shown to the user once, during set-up.
// - Replay: the last accepted time step is stored; codes for that step or an
//   earlier one are refused.
// - Brute force: MFA_POLICY.maxFailures failed codes lock MFA for
//   MFA_POLICY.lockMinutes. Failures and locks are audited.
// - Recovery codes: random, shown once, stored only as HMAC-SHA-256 hashes,
//   single use (conditional update, so two concurrent uses can't both win).
// - Elevation is recorded on the session row (session.mfa_verified_at).

import { createHmac, randomInt } from "node:crypto";

import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Secret, TOTP } from "otpauth";

import type { AuthDbClient } from "./db";
import { recordPlatformEvent } from "./platform-audit";

export const MFA_POLICY = {
  issuer: "TeamHappi",
  digits: 6,
  periodSeconds: 30,
  window: 1,
  maxFailures: 5,
  lockMinutes: 15,
  recoveryCodes: 10,
  /** Platform Admin needs MFA in this session within this time. */
  accessHours: 12,
  /** Privileged actions need MFA this recently. */
  stepUpMinutes: 15,
} as const;

export interface MfaDeps {
  db: AuthDbClient;
  /** BETTER_AUTH_SECRET: encryption and recovery-code hashing key. */
  secret: string;
  now?: () => Date;
}

export interface MfaFailure {
  ok: false;
  reason: "invalid" | "locked" | "not_enrolled" | "already_enrolled";
  lockedUntil?: Date;
}

export type MfaResult = { ok: true } | MfaFailure;

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateRecoveryCode(): string {
  const part = () =>
    Array.from(
      { length: 5 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join("");
  return `${part()}-${part()}`;
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashRecoveryCode(
  secret: string,
  userId: string,
  code: string,
): string {
  return createHmac("sha256", secret)
    .update(`teamhappi-mfa-recovery:${userId}:${normaliseRecoveryCode(code)}`)
    .digest("hex");
}

function totp(base32: string, label: string) {
  return new TOTP({
    issuer: MFA_POLICY.issuer,
    label,
    algorithm: "SHA1",
    digits: MFA_POLICY.digits,
    period: MFA_POLICY.periodSeconds,
    secret: Secret.fromBase32(base32),
  });
}

/** The time step a code was generated for, or null if it doesn't match. */
export function matchTotp(
  base32: string,
  code: string,
  at: Date,
): number | null {
  if (!/^\d{6}$/.test(code.trim())) return null;
  const delta = totp(base32, "check").validate({
    token: code.trim(),
    timestamp: at.getTime(),
    window: MFA_POLICY.window,
  });
  if (delta === null) return null;
  return Math.floor(at.getTime() / 1000 / MFA_POLICY.periodSeconds) + delta;
}

const minutes = (n: number) => n * 60_000;

export async function mfaStatus(deps: MfaDeps, userId: string) {
  const row = await deps.db.userMfa.findUnique({
    where: { userId },
    select: { enabledAt: true, lockedUntil: true },
  });
  const now = deps.now?.() ?? new Date();
  return {
    enrolled: Boolean(row?.enabledAt),
    lockedUntil:
      row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null,
  };
}

/**
 * Starts (or restarts) set-up for a user who has no enabled MFA. Returns the
 * otpauth URI and the manual key to show ONCE.
 */
export async function startEnrolment(
  deps: MfaDeps,
  user: { userId: string; email: string },
): Promise<{ ok: true; uri: string; manualKey: string } | MfaFailure> {
  const existing = await deps.db.userMfa.findUnique({
    where: { userId: user.userId },
    select: { enabledAt: true },
  });
  if (existing?.enabledAt) return { ok: false, reason: "already_enrolled" };
  const secret = new Secret({ size: 20 });
  const secretCiphertext = await symmetricEncrypt({
    key: deps.secret,
    data: secret.base32,
  });
  await deps.db.userMfa.upsert({
    where: { userId: user.userId },
    create: { userId: user.userId, secretCiphertext },
    update: {
      secretCiphertext,
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
    select: { userId: true },
  });
  await recordPlatformEvent(deps.db, {
    action: "mfa.enrolment_started",
    actorUserId: user.userId,
    targetUserId: user.userId,
  });
  return {
    ok: true,
    uri: totp(secret.base32, user.email).toString(),
    manualKey: secret.base32.replace(/(.{4})/g, "$1 ").trim(),
  };
}

async function recordFailure(
  deps: MfaDeps,
  userId: string,
  kind: "totp" | "recovery",
): Promise<MfaFailure> {
  const now = deps.now?.() ?? new Date();
  const row = await deps.db.userMfa.update({
    where: { userId },
    data: { failedAttempts: { increment: 1 } },
    select: { failedAttempts: true },
  });
  await recordPlatformEvent(deps.db, {
    action: "mfa.failed",
    actorUserId: userId,
    targetUserId: userId,
    detail: { kind, attempt: row.failedAttempts },
  });
  if (row.failedAttempts >= MFA_POLICY.maxFailures) {
    const lockedUntil = new Date(
      now.getTime() + minutes(MFA_POLICY.lockMinutes),
    );
    await deps.db.userMfa.update({
      where: { userId },
      data: { lockedUntil, failedAttempts: 0 },
      select: { userId: true },
    });
    await recordPlatformEvent(deps.db, {
      action: "mfa.locked",
      actorUserId: userId,
      targetUserId: userId,
      detail: { minutes: MFA_POLICY.lockMinutes },
    });
    return { ok: false, reason: "locked", lockedUntil };
  }
  return { ok: false, reason: "invalid" };
}

async function loadForVerification(
  deps: MfaDeps,
  userId: string,
): Promise<
  | { kind: "error"; error: MfaFailure }
  | {
      kind: "ok";
      row: NonNullable<
        Awaited<ReturnType<AuthDbClient["userMfa"]["findUnique"]>>
      >;
      now: Date;
    }
> {
  const now = deps.now?.() ?? new Date();
  const row = await deps.db.userMfa.findUnique({ where: { userId } });
  if (!row)
    return { kind: "error", error: { ok: false, reason: "not_enrolled" } };
  if (row.lockedUntil && row.lockedUntil > now)
    return {
      kind: "error",
      error: { ok: false, reason: "locked", lockedUntil: row.lockedUntil },
    };
  return { kind: "ok", row, now };
}

async function elevate(deps: MfaDeps, sessionId: string, at: Date) {
  await deps.db.session.update({
    where: { id: sessionId },
    data: { mfaVerifiedAt: at },
    select: { id: true },
  });
}

async function issueRecoveryCodes(
  deps: MfaDeps,
  userId: string,
  at: Date,
): Promise<string[]> {
  await deps.db.mfaRecoveryCode.updateMany({
    where: { userId, usedAt: null, revokedAt: null },
    data: { revokedAt: at },
  });
  const codes = Array.from(
    { length: MFA_POLICY.recoveryCodes },
    generateRecoveryCode,
  );
  await deps.db.mfaRecoveryCode.createMany({
    data: codes.map((code) => ({
      userId,
      codeHash: hashRecoveryCode(deps.secret, userId, code),
    })),
  });
  return codes;
}

/**
 * Confirms set-up with a first valid code. Enables MFA, elevates the current
 * session and returns the recovery codes (shown once).
 */
export async function confirmEnrolment(
  deps: MfaDeps,
  userId: string,
  sessionId: string,
  code: string,
): Promise<{ ok: true; recoveryCodes: string[] } | MfaFailure> {
  const loaded = await loadForVerification(deps, userId);
  if (loaded.kind === "error") return loaded.error;
  const { row, now } = loaded;
  if (row.enabledAt) return { ok: false, reason: "already_enrolled" };
  const base32 = await symmetricDecrypt({
    key: deps.secret,
    data: row.secretCiphertext,
  });
  const step = matchTotp(base32, code, now);
  if (step === null) return recordFailure(deps, userId, "totp");
  await deps.db.userMfa.update({
    where: { userId },
    data: {
      enabledAt: now,
      lastUsedStep: BigInt(step),
      failedAttempts: 0,
      lockedUntil: null,
    },
    select: { userId: true },
  });
  const recoveryCodes = await issueRecoveryCodes(deps, userId, now);
  await elevate(deps, sessionId, now);
  await recordPlatformEvent(deps.db, {
    action: "mfa.enabled",
    actorUserId: userId,
    targetUserId: userId,
  });
  return { ok: true, recoveryCodes };
}

/** Verifies a TOTP code for an enrolled user and elevates the session. */
export async function verifyTotp(
  deps: MfaDeps,
  userId: string,
  sessionId: string,
  code: string,
): Promise<MfaResult> {
  const loaded = await loadForVerification(deps, userId);
  if (loaded.kind === "error") return loaded.error;
  const { row, now } = loaded;
  if (!row.enabledAt) return { ok: false, reason: "not_enrolled" };
  const base32 = await symmetricDecrypt({
    key: deps.secret,
    data: row.secretCiphertext,
  });
  const step = matchTotp(base32, code, now);
  if (step === null) return recordFailure(deps, userId, "totp");
  // Replay: only a step newer than the last accepted one is valid. The
  // conditional update makes concurrent use of the same code fail too.
  const accepted = await deps.db.userMfa.updateMany({
    where: {
      userId,
      OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
    },
    data: { lastUsedStep: BigInt(step), failedAttempts: 0 },
  });
  if (accepted.count !== 1) return recordFailure(deps, userId, "totp");
  await elevate(deps, sessionId, now);
  await recordPlatformEvent(deps.db, {
    action: "mfa.verified",
    actorUserId: userId,
    targetUserId: userId,
    detail: { method: "totp" },
  });
  return { ok: true };
}

/** Uses one recovery code (single use) and elevates the session. */
export async function verifyRecoveryCode(
  deps: MfaDeps,
  userId: string,
  sessionId: string,
  code: string,
): Promise<MfaResult & { remaining?: number }> {
  const loaded = await loadForVerification(deps, userId);
  if (loaded.kind === "error") return loaded.error;
  const { row, now } = loaded;
  if (!row.enabledAt) return { ok: false, reason: "not_enrolled" };
  const used = await deps.db.mfaRecoveryCode.updateMany({
    where: {
      userId,
      codeHash: hashRecoveryCode(deps.secret, userId, code),
      usedAt: null,
      revokedAt: null,
    },
    data: { usedAt: now },
  });
  if (used.count !== 1) return recordFailure(deps, userId, "recovery");
  await deps.db.userMfa.update({
    where: { userId },
    data: { failedAttempts: 0 },
    select: { userId: true },
  });
  await elevate(deps, sessionId, now);
  const remaining = await deps.db.mfaRecoveryCode.count({
    where: { userId, usedAt: null, revokedAt: null },
  });
  await recordPlatformEvent(deps.db, {
    action: "mfa.recovery_used",
    actorUserId: userId,
    targetUserId: userId,
    detail: { remaining },
  });
  return { ok: true, remaining };
}

/** New recovery codes (old ones revoked). Callers must require step-up. */
export async function regenerateRecoveryCodes(
  deps: MfaDeps,
  userId: string,
): Promise<string[]> {
  const now = deps.now?.() ?? new Date();
  const codes = await issueRecoveryCodes(deps, userId, now);
  await recordPlatformEvent(deps.db, {
    action: "mfa.recovery_regenerated",
    actorUserId: userId,
    targetUserId: userId,
  });
  return codes;
}

/**
 * Resets another person's MFA (they must enrol again). Ends their elevated
 * sessions. Callers must check staff.manage and step-up first.
 */
export async function resetMfa(
  deps: MfaDeps,
  actorUserId: string,
  targetUserId: string,
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const placeholder = await symmetricEncrypt({
    key: deps.secret,
    data: new Secret({ size: 20 }).base32,
  });
  await deps.db.userMfa.updateMany({
    where: { userId: targetUserId },
    data: {
      enabledAt: null,
      secretCiphertext: placeholder,
      lastUsedStep: null,
      failedAttempts: 0,
      lockedUntil: null,
    },
  });
  await deps.db.mfaRecoveryCode.updateMany({
    where: { userId: targetUserId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  await deps.db.session.updateMany({
    where: { userId: targetUserId },
    data: { mfaVerifiedAt: null },
  });
  await recordPlatformEvent(deps.db, {
    action: "mfa.reset",
    actorUserId,
    targetUserId,
  });
}

/** When this session last passed MFA, or null. */
export async function sessionMfaVerifiedAt(
  db: AuthDbClient,
  sessionId: string,
): Promise<Date | null> {
  const s = await db.session.findUnique({
    where: { id: sessionId },
    select: { mfaVerifiedAt: true },
  });
  return s?.mfaVerifiedAt ?? null;
}
