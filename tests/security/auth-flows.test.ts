// Milestone 3.1 authentication flows through the real Better Auth handler,
// the route allow-list and the teamhappi_auth database role.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AUTH_POLICY } from "@/lib/auth/config";
import { validateSession } from "@/lib/auth/session";

import {
  cookieHeader,
  createTestAuth,
  sessionCookie,
  sessionTokenFrom,
  syntheticPassword,
  type TestAuth,
} from "../helpers/auth";
import { admin } from "../helpers/db";

let t: TestAuth;

beforeAll(() => {
  t = createTestAuth();
});

afterAll(async () => {
  await t.close();
});

const signIn = (email: string, password: string, ip?: string) =>
  t.call("/sign-in/email", { body: { email, password }, ip });

const sessionRows = (userId: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT token, expires_at, created_at FROM session WHERE user_id = $1`,
          [userId],
        )
      ).rows as { token: string; expires_at: Date; created_at: Date }[],
  );

describe("sign-in", () => {
  it("signs in a verified user and sets a secure, HttpOnly, SameSite=Lax session cookie", async () => {
    const u = await t.provision();
    const res = await signIn(u.email, u.password);
    expect(res.status).toBe(200);

    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/^__Secure-teamhappi\.session_token=/);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=Lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);

    const body = JSON.stringify(await res.json());
    expect(body).not.toContain(u.password);
    expect(body).not.toMatch(/scrypt|\$argon|password"/i);

    const rows = await sessionRows(u.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(sessionTokenFrom(cookie));
  });

  it("gives identical responses for an unknown email and a wrong password", async () => {
    const u = await t.provision();
    const unknown = await signIn(
      "nobody-here@example.test",
      syntheticPassword(),
      "198.51.100.21",
    );
    const wrong = await signIn(u.email, syntheticPassword(), "198.51.100.22");
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(wrong.status);
    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(sessionCookie(unknown)).toBeUndefined();
    expect(sessionCookie(wrong)).toBeUndefined();
  });

  it("refuses an unverified account, creates no session, and sends a fresh verification link", async () => {
    const u = await t.provision({ verified: false });
    const before = t.outbox.length;
    const res = await signIn(u.email, u.password, "198.51.100.23");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(sessionCookie(res)).toBeUndefined();
    expect(await sessionRows(u.userId)).toHaveLength(0);
    expect(t.outbox.length).toBe(before + 1);
    expect(t.outbox.at(-1)!.to).toBe(u.email);
  });

  it("public sign-up is not available", async () => {
    const res = await t.call("/sign-up/email", {
      body: {
        name: "X",
        email: "self-signup@example.test",
        password: syntheticPassword(),
      },
    });
    expect(res.status).toBe(404);
    const exists = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT 1 FROM "user" WHERE email = 'self-signup@example.test'`,
          )
        ).rowCount,
    );
    expect(exists).toBe(0);
  });
});

describe("email verification", () => {
  it("the emailed link verifies the address and then allows sign-in", async () => {
    const u = await t.provision({ verified: false });
    await signIn(u.email, u.password, "198.51.100.31");
    const link = t.outbox.at(-1)!.text.match(/https?:\/\/\S+/)![0];
    const url = new URL(link);
    expect(url.pathname).toBe("/api/auth/verify-email");

    const verify = await t.call(`/verify-email${url.search}`, {
      ip: "198.51.100.31",
    });
    expect([200, 302]).toContain(verify.status);
    const verified = await admin(
      async (c) =>
        (
          await c.query(`SELECT email_verified FROM "user" WHERE id = $1`, [
            u.userId,
          ])
        ).rows[0].email_verified,
    );
    expect(verified).toBe(true);
    expect((await signIn(u.email, u.password, "198.51.100.32")).status).toBe(
      200,
    );
  });

  it("a tampered verification token is rejected", async () => {
    const u = await t.provision({ verified: false });
    await signIn(u.email, u.password, "198.51.100.33");
    const url = new URL(t.outbox.at(-1)!.text.match(/https?:\/\/\S+/)![0]);
    const token = url.searchParams.get("token")!;
    url.searchParams.set("token", `${token.slice(0, -4)}AAAA`);
    await t.call(`/verify-email${url.search}`, { ip: "198.51.100.34" });
    const verified = await admin(
      async (c) =>
        (
          await c.query(`SELECT email_verified FROM "user" WHERE id = $1`, [
            u.userId,
          ])
        ).rows[0].email_verified,
    );
    expect(verified).toBe(false);
  });

  it("resending a verification link looks the same for unknown, unverified and verified addresses", async () => {
    const unverified = await t.provision({ verified: false });
    const verified = await t.provision();
    const responses = [];
    for (const [email, ip] of [
      ["unknown-person@example.test", "198.51.100.41"],
      [unverified.email, "198.51.100.42"],
      [verified.email, "198.51.100.43"],
    ] as const) {
      const res = await t.call("/send-verification-email", {
        body: { email },
        ip,
      });
      responses.push({ status: res.status, body: await res.json() });
    }
    expect(responses[1]).toEqual(responses[0]);
    expect(responses[2]).toEqual(responses[0]);
  });
});

describe("sessions", () => {
  it("the session is validated on the server and sign-out revokes it", async () => {
    const u = await t.provision();
    const res = await signIn(u.email, u.password, "198.51.100.51");
    const cookie = cookieHeader(res);

    const user = await validateSession(t.auth, new Headers({ cookie }));
    expect(user).toEqual({
      userId: u.userId,
      sessionId: expect.any(String),
      name: "Synthetic User",
      email: u.email,
    });
    expect(Object.keys(user!)).not.toContain("token");

    const out = await t.call("/sign-out", {
      body: {},
      cookie,
      ip: "198.51.100.51",
    });
    expect(out.status).toBe(200);
    expect(await sessionRows(u.userId)).toHaveLength(0);
    expect(await validateSession(t.auth, new Headers({ cookie }))).toBeNull();
  });

  it("an expired session is rejected", async () => {
    const u = await t.provision();
    const cookie = cookieHeader(
      await signIn(u.email, u.password, "198.51.100.52"),
    );
    await admin((c) =>
      c.query(
        `UPDATE session SET expires_at = now() - interval '1 second' WHERE user_id = $1`,
        [u.userId],
      ),
    );
    expect(await validateSession(t.auth, new Headers({ cookie }))).toBeNull();
  });

  it("idle expiry is 7 days from sign-in", async () => {
    const u = await t.provision();
    await signIn(u.email, u.password, "198.51.100.53");
    const [row] = await sessionRows(u.userId);
    const seconds =
      (row!.expires_at.getTime() - row!.created_at.getTime()) / 1000;
    expect(Math.abs(seconds - AUTH_POLICY.sessionIdleSeconds)).toBeLessThan(60);
  });

  it("a session older than the absolute limit is rejected and deleted, even if recently used", async () => {
    const u = await t.provision();
    const cookie = cookieHeader(
      await signIn(u.email, u.password, "198.51.100.54"),
    );
    await admin((c) =>
      c.query(
        `UPDATE session SET created_at = now() - interval '31 days', expires_at = now() + interval '6 days'
         WHERE user_id = $1`,
        [u.userId],
      ),
    );
    expect(await validateSession(t.auth, new Headers({ cookie }))).toBeNull();
    expect(await sessionRows(u.userId)).toHaveLength(0);
  });

  it("session fixation: a pre-set cookie is never adopted; each sign-in issues a new token", async () => {
    const u = await t.provision();
    const planted =
      "__Secure-teamhappi.session_token=attacker-chosen-value.fakesignature";
    expect(
      await validateSession(t.auth, new Headers({ cookie: planted })),
    ).toBeNull();

    const first = await t.call("/sign-in/email", {
      body: { email: u.email, password: u.password },
      cookie: planted,
      ip: "198.51.100.55",
    });
    const second = await signIn(u.email, u.password, "198.51.100.56");
    const t1 = sessionTokenFrom(sessionCookie(first)!);
    const t2 = sessionTokenFrom(sessionCookie(second)!);
    expect(t1).not.toBe("attacker-chosen-value");
    expect(t1).not.toBe(t2);
    const tokens = (await sessionRows(u.userId)).map((r) => r.token);
    expect(tokens).not.toContain("attacker-chosen-value");
    expect(tokens.sort()).toEqual([t1, t2].sort());
  });

  it("a forged (unsigned) cookie carrying a real token is rejected", async () => {
    const u = await t.provision();
    const real = sessionTokenFrom(
      sessionCookie(await signIn(u.email, u.password, "198.51.100.57"))!,
    );
    const forged = `__Secure-teamhappi.session_token=${real}.not-the-signature`;
    expect(
      await validateSession(t.auth, new Headers({ cookie: forged })),
    ).toBeNull();
  });
});

describe("rate limiting (database-backed)", () => {
  it("blocks the 6th sign-in attempt from one IP within a minute, without affecting other IPs", async () => {
    const u = await t.provision();
    const ip = "203.0.113.77";
    const statuses: number[] = [];
    for (let i = 0; i < AUTH_POLICY.rateLimit.signIn.max + 1; i++) {
      statuses.push(
        (await signIn(u.email, "wrong-password-attempt", ip)).status,
      );
    }
    expect(statuses.slice(0, -1).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    // Even the correct password is refused while limited.
    expect((await signIn(u.email, u.password, ip)).status).toBe(429);
    // Another client is unaffected.
    expect((await signIn(u.email, u.password, "203.0.113.78")).status).toBe(
      200,
    );

    const stored = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM rate_limit WHERE key LIKE $1`,
            [`%${ip}%`],
          )
        ).rows[0].n,
    );
    expect(stored).toBeGreaterThan(0);
  });
});

describe("endpoint allow-list", () => {
  it.each([
    ["POST", "/sign-up/email"],
    ["POST", "/request-password-reset"],
    ["POST", "/reset-password"],
    ["POST", "/change-password"],
    ["POST", "/update-user"],
    ["POST", "/delete-user"],
    ["GET", "/list-sessions"],
    ["POST", "/revoke-sessions"],
    ["GET", "/list-accounts"],
    ["POST", "/sign-in/social"],
    ["GET", "/sign-in/email"],
  ])("%s %s is not exposed", async (method, path) => {
    const res = await t.call(path, {
      method,
      body: method === "POST" ? {} : undefined,
    });
    expect(res.status).toBe(404);
  });
});
