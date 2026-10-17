// M5.1 MFA and platform staff, run as the real teamhappi_auth role:
// enrolment, replay, brute force, recovery codes, reset, staff guards,
// separation from tenant memberships, privileges and audit immutability.

import { randomBytes } from "node:crypto";

import { Secret, TOTP } from "otpauth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAuthDbClient, type AuthDbClient } from "@/lib/auth/db";
import * as mfa from "@/lib/auth/mfa";
import * as staff from "@/lib/auth/platform-staff";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  urls,
  withPg,
} from "../helpers/db";

const SECRET = randomBytes(32).toString("base64url");
const T0 = new Date("2026-10-21T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let db: AuthDbClient;

const deps = (now: Date): mfa.MfaDeps => ({
  db,
  secret: SECRET,
  now: () => now,
});

async function verifiedUser(label: string) {
  const id = await createUser(label);
  await admin((c) =>
    c.query(`UPDATE "user" SET email_verified = true WHERE id = $1`, [id]),
  );
  const email = (
    await admin((c) => c.query(`SELECT email FROM "user" WHERE id = $1`, [id]))
  ).rows[0].email;
  return { id, email: email as string };
}

async function newSession(userId: string): Promise<string> {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO session (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
          [userId, randomBytes(16).toString("hex")],
        )
      ).rows[0]!.id,
  );
}

const code = (manualKey: string, when: Date) =>
  new TOTP({
    secret: Secret.fromBase32(manualKey.replace(/\s/g, "")),
    digits: 6,
    period: 30,
  }).generate({
    timestamp: when.getTime(),
  });

/** A user with MFA enabled at T0; returns their key and recovery codes. */
async function enrolled(label: string) {
  const u = await verifiedUser(label);
  const session = await newSession(u.id);
  const started = await mfa.startEnrolment(deps(T0), {
    userId: u.id,
    email: u.email,
  });
  if (!started.ok) throw new Error("start failed");
  const confirmed = await mfa.confirmEnrolment(
    deps(T0),
    u.id,
    session,
    code(started.manualKey, T0),
  );
  if (!confirmed.ok) throw new Error("confirm failed");
  return {
    ...u,
    session,
    key: started.manualKey,
    recovery: confirmed.recoveryCodes,
  };
}

const events = (userId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: Record<string, unknown> }>(
          `SELECT action, detail FROM platform_audit_event WHERE target_user_id = $1 ORDER BY occurred_at, id`,
          [userId],
        )
      ).rows,
  );

beforeAll(() => {
  db = createAuthDbClient(urls.authUrl);
});
afterAll(async () => {
  await db.$disconnect();
});

describe("MFA enrolment", () => {
  it("enables MFA only after a correct code, stores secrets safely and elevates the session", async () => {
    const u = await verifiedUser("enrol");
    const session = await newSession(u.id);
    const started = await mfa.startEnrolment(deps(T0), {
      userId: u.id,
      email: u.email,
    });
    if (!started.ok) throw new Error();
    expect(started.uri).toMatch(/^otpauth:\/\/totp\/TeamHappi:/);

    expect(
      await mfa.confirmEnrolment(deps(T0), u.id, session, "000000"),
    ).toMatchObject({ ok: false, reason: "invalid" });
    const ok = await mfa.confirmEnrolment(
      deps(T0),
      u.id,
      session,
      code(started.manualKey, T0),
    );
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.recoveryCodes).toHaveLength(10);

    const stored = await admin(async (c) => ({
      mfa: (
        await c.query(
          `SELECT secret_ciphertext, enabled_at FROM user_mfa WHERE user_id = $1`,
          [u.id],
        )
      ).rows[0],
      codes: (
        await c.query(
          `SELECT code_hash FROM mfa_recovery_code WHERE user_id = $1`,
          [u.id],
        )
      ).rows,
      session: (
        await c.query(`SELECT mfa_verified_at FROM session WHERE id = $1`, [
          session,
        ])
      ).rows[0],
    }));
    expect(stored.mfa.enabled_at).not.toBeNull();
    expect(stored.mfa.secret_ciphertext).not.toContain(
      started.manualKey.replace(/\s/g, ""),
    );
    for (const c of ok.recoveryCodes) {
      expect(JSON.stringify(stored.codes)).not.toContain(c.replace("-", ""));
      expect(JSON.stringify(stored.codes)).not.toContain(c);
    }
    expect(stored.session.mfa_verified_at).not.toBeNull();
    expect((await events(u.id)).map((e) => e.action)).toEqual([
      "mfa.enrolment_started",
      "mfa.failed",
      "mfa.enabled",
    ]);
    expect(
      await mfa.startEnrolment(deps(T0), { userId: u.id, email: u.email }),
    ).toMatchObject({
      ok: false,
      reason: "already_enrolled",
    });
  });
});

describe("TOTP verification", () => {
  it("accepts a fresh code once and refuses replay of the same code", async () => {
    const u = await enrolled("replay");
    const session = await newSession(u.id);
    const when = at(90);
    const c = code(u.key, when);
    expect(await mfa.verifyTotp(deps(when), u.id, session, c)).toEqual({
      ok: true,
    });
    expect(await mfa.verifyTotp(deps(when), u.id, session, c)).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    // The enrolment code (an older step) can't be reused either.
    expect(
      await mfa.verifyTotp(deps(at(5)), u.id, session, code(u.key, T0)),
    ).toMatchObject({ ok: false });
  });

  it("locks after 5 failures, refuses even correct codes while locked, then recovers", async () => {
    const u = await enrolled("brute");
    const session = await newSession(u.id);
    for (let i = 0; i < 4; i++)
      expect(
        await mfa.verifyTotp(deps(at(60)), u.id, session, "123456"),
      ).toMatchObject({ reason: "invalid" });
    expect(
      await mfa.verifyTotp(deps(at(60)), u.id, session, "123456"),
    ).toMatchObject({ reason: "locked" });
    expect(
      await mfa.verifyTotp(deps(at(120)), u.id, session, code(u.key, at(120))),
    ).toMatchObject({
      reason: "locked",
    });
    expect(
      await mfa.verifyRecoveryCode(
        deps(at(120)),
        u.id,
        session,
        u.recovery[0]!,
      ),
    ).toMatchObject({
      reason: "locked",
    });
    const later = at(16 * 60 + 60);
    expect(
      await mfa.verifyTotp(deps(later), u.id, session, code(u.key, later)),
    ).toEqual({ ok: true });
    expect((await events(u.id)).map((e) => e.action)).toContain("mfa.locked");
  });

  it("rejects malformed codes without crashing", async () => {
    const u = await enrolled("malformed");
    const session = await newSession(u.id);
    for (const bad of ["", "abc", "1234567", "12 34 56", "' OR 1=1"])
      expect(
        await mfa.verifyTotp(deps(at(60)), u.id, session, bad),
      ).toMatchObject({ ok: false });
  });
});

describe("recovery codes", () => {
  it("work once each, ignore formatting and are revoked when regenerated", async () => {
    const u = await enrolled("recovery");
    const session = await newSession(u.id);
    const first = u.recovery[0]!;
    expect(
      await mfa.verifyRecoveryCode(
        deps(at(60)),
        u.id,
        session,
        first.toLowerCase().replace("-", " "),
      ),
    ).toEqual({
      ok: true,
      remaining: 9,
    });
    expect(
      await mfa.verifyRecoveryCode(deps(at(61)), u.id, session, first),
    ).toMatchObject({ reason: "invalid" });

    const fresh = await mfa.regenerateRecoveryCodes(deps(at(70)), u.id);
    expect(fresh).toHaveLength(10);
    expect(
      await mfa.verifyRecoveryCode(deps(at(80)), u.id, session, u.recovery[1]!),
    ).toMatchObject({ ok: false });
    expect(
      await mfa.verifyRecoveryCode(deps(at(80)), u.id, session, fresh[0]!),
    ).toMatchObject({ ok: true });
  });

  it("a code from one user never works for another", async () => {
    const a = await enrolled("owner-a");
    const b = await enrolled("owner-b");
    const session = await newSession(b.id);
    expect(
      await mfa.verifyRecoveryCode(deps(at(60)), b.id, session, a.recovery[0]!),
    ).toMatchObject({ ok: false });
  });
});

describe("MFA reset", () => {
  it("forces re-enrolment, revokes codes and ends elevated sessions", async () => {
    const actor = await verifiedUser("resetter");
    const u = await enrolled("reset-target");
    await mfa.resetMfa(deps(at(60)), actor.id, u.id);
    expect((await mfa.mfaStatus(deps(at(61)), u.id)).enrolled).toBe(false);
    const s = await admin((c) =>
      c.query(`SELECT mfa_verified_at FROM session WHERE user_id = $1`, [u.id]),
    );
    expect(s.rows.every((r) => r.mfa_verified_at === null)).toBe(true);
    expect(
      await mfa.verifyRecoveryCode(
        deps(at(62)),
        u.id,
        u.session,
        u.recovery[2]!,
      ),
    ).toMatchObject({ ok: false });
    expect((await events(u.id)).at(-1)?.action).toBe("mfa.reset");
  });
});

describe("platform staff register", () => {
  it("adds only existing verified accounts, never yourself, never twice", async () => {
    const manager = await verifiedUser("manager");
    const newcomer = await verifiedUser("newcomer");
    const unverified = await createUser("unverified");
    const unverifiedEmail = (
      await admin((c) =>
        c.query(`SELECT email FROM "user" WHERE id = $1`, [unverified]),
      )
    ).rows[0].email;

    expect(
      await staff.grantStaff(db, manager.id, "nobody@example.test", [
        "audit.view",
      ]),
    ).toMatchObject({ code: "not_found" });
    expect(
      await staff.grantStaff(db, manager.id, unverifiedEmail, ["audit.view"]),
    ).toMatchObject({ code: "not_found" });
    expect(
      await staff.grantStaff(db, manager.id, manager.email, ["audit.view"]),
    ).toMatchObject({ code: "forbidden" });
    expect(
      await staff.grantStaff(db, manager.id, newcomer.email, ["not.a.grant"]),
    ).toMatchObject({ code: "invalid" });
    expect(
      await staff.grantStaff(db, manager.id, newcomer.email, [
        "audit.view",
        "tenant.view",
      ]),
    ).toEqual({ ok: true });
    expect(
      await staff.grantStaff(db, manager.id, newcomer.email, ["audit.view"]),
    ).toMatchObject({ code: "conflict" });
    expect(await staff.getStaffRecord(db, newcomer.id)).toEqual({
      status: "active",
      grants: ["audit.view", "tenant.view"],
    });
  });

  it("protects self-changes and the last staff manager; suspension ends elevation", async () => {
    // Isolate: make every existing manager inactive except ours.
    await admin((c) =>
      c.query(
        `UPDATE platform_staff SET status = 'suspended' WHERE 'staff.manage' = ANY(grants)`,
      ),
    );
    const boss = await verifiedUser("boss");
    const other = await enrolled("other-staff");
    await admin((c) =>
      c.query(
        `INSERT INTO platform_staff (user_id, grants) VALUES ($1, '{staff.manage}'), ($2, '{staff.manage,audit.view}')`,
        [boss.id, other.id],
      ),
    );
    expect(
      await staff.updateStaff(db, boss.id, boss.id, { status: "suspended" }),
    ).toMatchObject({ code: "forbidden" });
    expect(
      await staff.updateStaff(db, boss.id, other.id, { status: "suspended" }),
    ).toEqual({ ok: true });
    const s = await admin((c) =>
      c.query(`SELECT mfa_verified_at FROM session WHERE user_id = $1`, [
        other.id,
      ]),
    );
    expect(s.rows.every((r) => r.mfa_verified_at === null)).toBe(true);
    // Now boss is the only active manager: other can't remove boss's access.
    await staff.updateStaff(db, boss.id, other.id, { status: "active" });
    expect(
      await staff.updateStaff(db, other.id, boss.id, {
        grants: ["audit.view"],
      }),
    ).toEqual({ ok: true });
    // "other" is now the last active manager, so suspending them is refused.
    // (Whether the ACTOR holds staff.manage is checked by platform-access.)
    expect(
      await staff.updateStaff(db, boss.id, other.id, { status: "suspended" }),
    ).toMatchObject({ code: "conflict" });
    expect(
      await staff.updateStaff(db, other.id, other.id, { status: "revoked" }),
    ).toMatchObject({ code: "forbidden" });
    const third = await verifiedUser("third");
    await admin((c) =>
      c.query(
        `INSERT INTO platform_staff (user_id, grants) VALUES ($1, '{audit.view}')`,
        [third.id],
      ),
    );
    expect(
      await staff.updateStaff(db, third.id, other.id, { status: "suspended" }),
    ).toMatchObject({ code: "conflict" });
    expect(
      await staff.updateStaff(db, other.id, third.id, { status: "revoked" }),
    ).toEqual({ ok: true });
    expect(
      await staff.updateStaff(db, other.id, third.id, { status: "active" }),
    ).toMatchObject({ code: "conflict" });
  });

  it("platform staff and tenant membership are independent", async () => {
    const app = appDb();
    const tenant = await createTenantFixture(app, "india");
    await app.$disconnect();
    expect(await staff.getStaffRecord(db, tenant.ownerUserId)).toBeNull();
    const member = await verifiedUser("staff-only");
    await admin((c) =>
      c.query(
        `INSERT INTO platform_staff (user_id, grants) VALUES ($1, '{tenant.view}')`,
        [member.id],
      ),
    );
    const memberships = await admin((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM tenant_membership WHERE user_id = $1`,
        [member.id],
      ),
    );
    expect(memberships.rows[0].n).toBe(0);
  });
});

describe("database privileges and audit immutability", () => {
  it("the application role can't read MFA, staff or audit tables", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const table of [
        "platform_staff",
        "user_mfa",
        "mfa_recovery_code",
        "platform_audit_event",
      ])
        await expect(
          c.query(`SELECT 1 FROM ${table} LIMIT 1`),
          table,
        ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`SELECT mfa_verified_at FROM session LIMIT 1`),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("the auth role can't delete staff or alter audit history; nobody can", async () => {
    await withPg(urls.authUrl, async (c) => {
      await expect(c.query(`DELETE FROM platform_staff`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query(`DELETE FROM user_mfa`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        c.query(`UPDATE platform_audit_event SET action = 'x.y'`),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM platform_audit_event`)).rejects.toThrow(
        /permission denied/,
      );
    });
    await expect(
      admin((c) => c.query(`UPDATE platform_audit_event SET action = 'x.y'`)),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) => c.query(`DELETE FROM platform_audit_event`)),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin((c) => c.query(`TRUNCATE platform_audit_event`)),
    ).rejects.toThrow(/append-only/);
  });

  it("only known grants can be stored", async () => {
    const u = await verifiedUser("badgrant");
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO platform_staff (user_id, grants) VALUES ($1, '{superuser}')`,
          [u.id],
        ),
      ),
    ).rejects.toThrow(/platform_staff_grants_known/);
  });

  it("audit details never contain codes or secrets", async () => {
    const rows = await admin((c) =>
      c.query(`SELECT detail::text AS d FROM platform_audit_event`),
    );
    for (const r of rows.rows)
      expect(r.d).not.toMatch(
        /secret|ciphertext|[A-Z2-9]{5}-[A-Z2-9]{5}|\b\d{6}\b/,
      );
  });
});
