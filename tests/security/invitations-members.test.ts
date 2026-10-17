// M6 invitations and member management, run as the real application role:
// who can invite and change members, one-time links (hash only, expiry,
// reuse, revocation, wrong or unconfirmed account, cross-organisation),
// owner protections, suspension and removal, and the append-only audit trail.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import {
  acceptInvitation,
  previewInvitation,
} from "@/lib/workspace/invitations";
import * as mm from "@/lib/workspace/members";
import type { MutationResult } from "@/lib/workspace/mutations";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let adminWs: Ready;
let workerWs: Ready;
let workerUserId: string;
let workerMembershipId: string;

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};

async function memberWithRole(tenantId: string, roleKey: string) {
  const userId = await createUser(roleKey.replace("_", ""));
  const membershipId = await admin(async (c) => {
    const mem = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM role WHERE tenant_id = $1 AND key = $3`,
      [tenantId, mem.rows[0]!.id, roleKey],
    );
    return mem.rows[0]!.id;
  });
  return { userId, membershipId };
}

/** A confirmed account with a known address (who opens the link). */
async function verifiedUser(email: string) {
  return admin(async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO "user" (name, email, email_verified) VALUES ('Invitee', $1, true) RETURNING id`,
      [email],
    );
    return r.rows[0]!.id;
  });
}

const roleId = (tenantId: string, key: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `SELECT id FROM role WHERE tenant_id = $1 AND key = $2`,
          [tenantId, key],
        )
      ).rows[0]!.id,
  );

const ok = <T>(r: MutationResult<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};

const uniq = () => Math.random().toString(36).slice(2, 8);

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "lima");
  B = await createTenantFixture(db, "mike");
  owner = await ws(A.ownerUserId);
  adminWs = await ws((await memberWithRole(A.tenantId, "admin")).userId);
  const w = await memberWithRole(A.tenantId, "worker");
  workerUserId = w.userId;
  workerMembershipId = w.membershipId;
  workerWs = await ws(workerUserId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("creating invitations", () => {
  it("stores only the token's hash, expiring in 7 days, with an audit event", async () => {
    const email = `new-${uniq()}@example.test`;
    const { id, token } = ok(
      await mm.createInvitation(db, owner, {
        email: email.toUpperCase(),
        roleId: await roleId(A.tenantId, "worker"),
      }),
    );
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT email, token_hash, round(extract(epoch FROM expires_at - created_at) / 3600) AS ttl_hours, row_to_json(i)::text AS json FROM invitation i WHERE id = $1`,
            [id],
          )
        ).rows[0],
    );
    expect(row.email).toBe(email); // normalised to lower case
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.json).not.toContain(token);
    expect(Number(row.ttl_hours)).toBe(7 * 24);
    const events = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS d FROM audit_event WHERE target_id = $1`,
            [id],
          )
        ).rows,
    );
    expect(events).toEqual([
      { action: "invitation.created", d: expect.not.stringContaining(email) },
    ]);
  });

  it("refuses people without member.invite, and refuses duplicates and existing members", async () => {
    const worker = await roleId(A.tenantId, "worker");
    expect(
      await mm.createInvitation(db, workerWs, {
        email: "x@example.test",
        roleId: worker,
      }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const email = `dup-${uniq()}@example.test`;
    ok(await mm.createInvitation(db, owner, { email, roleId: worker }));
    expect(
      await mm.createInvitation(db, owner, { email, roleId: worker }),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    const ownerEmail = await admin(
      async (c) =>
        (
          await c.query(`SELECT email FROM "user" WHERE id = $1`, [
            A.ownerUserId,
          ])
        ).rows[0].email,
    );
    expect(
      await mm.createInvitation(db, adminWs, {
        email: ownerEmail,
        roleId: worker,
      }),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(
      await mm.createInvitation(db, owner, {
        email: "not-an-email",
        roleId: worker,
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("an admin can't invite an owner; nobody can use another organisation's role or site", async () => {
    expect(
      await mm.createInvitation(db, adminWs, {
        email: `o-${uniq()}@example.test`,
        roleId: await roleId(A.tenantId, "owner"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await mm.createInvitation(db, owner, {
        email: `x-${uniq()}@example.test`,
        roleId: await roleId(B.tenantId, "worker"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await mm.createInvitation(db, owner, {
        email: `x-${uniq()}@example.test`,
        roleId: await roleId(A.tenantId, "worker"),
        siteId: B.siteId,
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("opening and accepting a link", () => {
  it("previews a valid link, and nothing for an unknown or malformed one", async () => {
    const email = `p-${uniq()}@example.test`;
    const { token } = ok(
      await mm.createInvitation(db, owner, {
        email,
        roleId: await roleId(A.tenantId, "site_manager"),
        siteId: A.siteId,
      }),
    );
    expect(await previewInvitation(db, token)).toEqual({
      state: "valid",
      email,
      organisation: "lima Hospitality Ltd",
      role: "Site manager",
      site: "lima Central",
    });
    expect((await previewInvitation(db, "A".repeat(43))).state).toBe("invalid");
    expect((await previewInvitation(db, "' OR 1=1 --")).state).toBe("invalid");
  });

  it("joins only the confirmed account with the invited address, exactly once", async () => {
    const email = `j-${uniq()}@example.test`;
    const { token } = ok(
      await mm.createInvitation(db, owner, {
        email,
        roleId: await roleId(A.tenantId, "site_manager"),
        siteId: A.siteId,
      }),
    );
    const someoneElse = await verifiedUser(`other-${uniq()}@example.test`);
    expect((await acceptInvitation(db, someoneElse, token)).outcome).toBe(
      "wrong_account",
    );
    const invitee = await verifiedUser(email);
    const joined = await acceptInvitation(db, invitee, token);
    expect(joined).toEqual({ outcome: "joined", tenantId: A.tenantId });
    const member = await ws(invitee);
    expect(member.tenant.id).toBe(A.tenantId);
    expect(member.roles).toEqual(["Site manager"]);
    expect(member.grants.get("team.manage")).toEqual(new Set([A.siteId]));
    // Single use.
    expect((await acceptInvitation(db, invitee, token)).outcome).toBe(
      "invalid",
    );
    expect((await previewInvitation(db, token)).state).toBe("used");
  });

  it("refuses an unconfirmed account, expired and cancelled links, and a call without a session", async () => {
    const worker = await roleId(A.tenantId, "worker");
    const e1 = `u-${uniq()}@example.test`;
    const { token: t1 } = ok(
      await mm.createInvitation(db, owner, { email: e1, roleId: worker }),
    );
    const unverified = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO "user" (name, email) VALUES ('U', $1) RETURNING id`,
            [e1],
          )
        ).rows[0]!.id,
    );
    expect((await acceptInvitation(db, unverified, t1)).outcome).toBe(
      "unverified",
    );

    const e2 = `e-${uniq()}@example.test`;
    const { id: id2, token: t2 } = ok(
      await mm.createInvitation(db, owner, { email: e2, roleId: worker }),
    );
    await admin((c) =>
      c.query(
        `UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE id = $1`,
        [id2],
      ),
    );
    expect(await previewInvitation(db, t2)).toMatchObject({
      state: "expired",
      email: null,
      organisation: null,
    });
    expect(
      (await acceptInvitation(db, await verifiedUser(e2), t2)).outcome,
    ).toBe("expired");

    const e3 = `r-${uniq()}@example.test`;
    const { id: id3, token: t3 } = ok(
      await mm.createInvitation(db, owner, { email: e3, roleId: worker }),
    );
    ok(await mm.revokeInvitation(db, owner, id3));
    expect((await previewInvitation(db, t3)).state).toBe("revoked");
    expect(
      (await acceptInvitation(db, await verifiedUser(e3), t3)).outcome,
    ).toBe("invalid");

    // Without app.user_id (no validated session) the function does nothing.
    const e4 = `n-${uniq()}@example.test`;
    const { token: t4 } = ok(
      await mm.createInvitation(db, owner, { email: e4, roleId: worker }),
    );
    const { hashInvitationToken } = await import("@/lib/invitations/token");
    await withPg(urls.appUrl, async (c) => {
      const r = await c.query(`SELECT outcome FROM app.accept_invitation($1)`, [
        hashInvitationToken(t4),
      ]);
      expect(r.rows).toEqual([{ outcome: "invalid" }]);
    });
  });

  it("a new link replaces the old one", async () => {
    const email = `n-${uniq()}@example.test`;
    const { id, token: old } = ok(
      await mm.createInvitation(db, owner, {
        email,
        roleId: await roleId(A.tenantId, "worker"),
      }),
    );
    const { token: fresh } = ok(await mm.renewInvitation(db, owner, id));
    expect((await previewInvitation(db, old)).state).toBe("invalid");
    expect((await previewInvitation(db, fresh)).state).toBe("valid");
    expect(await mm.renewInvitation(db, workerWs, id)).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("can't be used to lift a suspension", async () => {
    const email = `s-${uniq()}@example.test`;
    const userId = await verifiedUser(email);
    const membershipId = await admin(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'suspended') RETURNING id`,
        [A.tenantId, userId],
      );
      return r.rows[0]!.id;
    });
    // The app won't invite a suspended member...
    expect(
      await mm.createInvitation(db, owner, {
        email,
        roleId: await roleId(A.tenantId, "admin"),
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    // ...and even an invitation created another way can't lift the suspension.
    const { newInvitationToken } = await import("@/lib/invitations/token");
    const { token, hash } = newInvitationToken();
    await admin((c) =>
      c.query(
        `INSERT INTO invitation (tenant_id, email, role_id, token_hash, expires_at, invited_by)
         SELECT $1, $2, id, $3, now() + interval '1 day', $4 FROM role WHERE tenant_id = $1 AND key = 'admin'`,
        [A.tenantId, email, hash, A.ownerUserId],
      ),
    );
    expect((await acceptInvitation(db, userId, token)).outcome).toBe(
      "suspended",
    );
    const status = await admin(
      async (c) =>
        (
          await c.query(`SELECT status FROM tenant_membership WHERE id = $1`, [
            membershipId,
          ])
        ).rows[0].status,
    );
    expect(status).toBe("suspended");
  });

  it("is invisible to another organisation", async () => {
    const otherOwner = await ws(B.ownerUserId);
    const page = await mm.membersPage(db, otherOwner);
    const ids = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT id FROM invitation WHERE tenant_id = $1 AND status = 'pending'`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const { id } of ids)
      expect(await mm.revokeInvitation(db, otherOwner, id)).toMatchObject({
        ok: false,
        code: "not_found",
      });
    expect(page!.invitations).toEqual([]);
  });
});

describe("managing members", () => {
  it("lists members with names, and refuses people without the permission", async () => {
    const page = await mm.membersPage(db, owner);
    expect(page!.members.map((m) => m.membershipId)).toContain(
      workerMembershipId,
    );
    expect(page!.members.find((m) => m.isSelf)!.isOwner).toBe(true);
    expect(page!.roles.find((r) => r.key === "owner")!.grantable).toBe(true);
    expect(
      (await mm.membersPage(db, adminWs))!.roles.find((r) => r.key === "owner")!
        .grantable,
    ).toBe(false);
    expect(await mm.membersPage(db, workerWs)).toBeNull();
  });

  it("changes roles within the rules, audited", async () => {
    const siteManager = await roleId(A.tenantId, "site_manager");
    ok(
      await mm.changeMemberRole(db, adminWs, workerMembershipId, {
        roleId: siteManager,
        siteId: A.siteId,
      }),
    );
    expect((await ws(workerUserId)).roles).toEqual(["Site manager"]);
    const events = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action FROM audit_event WHERE target_id = $1 ORDER BY occurred_at`,
            [workerMembershipId],
          )
        ).rows,
    );
    expect(events.at(-1)).toEqual({ action: "member.role_changed" });
    // Back to worker for later tests.
    ok(
      await mm.changeMemberRole(db, owner, workerMembershipId, {
        roleId: await roleId(A.tenantId, "worker"),
      }),
    );
    workerWs = await ws(workerUserId);

    const ownerMembership = owner.membershipId;
    expect(
      await mm.changeMemberRole(db, adminWs, ownerMembership, {
        roleId: await roleId(A.tenantId, "worker"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" }); // only owners change owners
    expect(
      await mm.changeMemberRole(db, owner, ownerMembership, {
        roleId: await roleId(A.tenantId, "worker"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" }); // not yourself
    expect(
      await mm.changeMemberRole(db, workerWs, adminWs.membershipId, {
        roleId: await roleId(A.tenantId, "worker"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("suspends, restores and removes; access follows on the next request", async () => {
    ok(await mm.setMemberStatus(db, adminWs, workerMembershipId, "suspended"));
    expect(
      (
        await resolveWorkspace(
          db,
          { userId: workerUserId, name: "W", email: "w@example.test" },
          undefined,
        )
      ).kind,
    ).toBe("none");
    // Suspended members' names stay visible to admins.
    expect(
      (await mm.membersPage(db, owner))!.members.find(
        (m) => m.membershipId === workerMembershipId,
      ),
    ).toMatchObject({
      status: "suspended",
      name: expect.not.stringMatching(/^Unknown$/),
    });
    ok(await mm.setMemberStatus(db, adminWs, workerMembershipId, "active"));
    expect((await ws(workerUserId)).tenant.id).toBe(A.tenantId);
    ok(await mm.setMemberStatus(db, adminWs, workerMembershipId, "left"));
    expect(
      (await mm.membersPage(db, owner))!.members.map((m) => m.membershipId),
    ).not.toContain(workerMembershipId);
    expect(
      await mm.setMemberStatus(db, adminWs, workerMembershipId, "active"),
    ).toMatchObject({ ok: false });
    expect(
      await mm.setMemberStatus(db, adminWs, owner.membershipId, "suspended"),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("a former member can be invited back, with the new role only", async () => {
    const email = await admin(
      async (c) =>
        (
          await c.query(`SELECT email FROM "user" WHERE id = $1`, [
            workerUserId,
          ])
        ).rows[0].email,
    );
    await admin((c) =>
      c.query(`UPDATE "user" SET email_verified = true WHERE id = $1`, [
        workerUserId,
      ]),
    );
    const { token } = ok(
      await mm.createInvitation(db, owner, {
        email,
        roleId: await roleId(A.tenantId, "hr_manager"),
      }),
    );
    expect((await acceptInvitation(db, workerUserId, token)).outcome).toBe(
      "joined",
    );
    expect((await ws(workerUserId)).roles).toEqual(["HR manager"]);
  });
});

describe("the database itself", () => {
  it("keeps the audit trail append-only and invitations undeletable", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(
        c.query(`UPDATE audit_event SET action = 'x.y'`),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM audit_event`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(c.query(`DELETE FROM invitation`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        c.query(`UPDATE invitation SET email = 'x@example.test'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE invitation SET role_id = gen_random_uuid()`),
      ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) => c.query(`UPDATE audit_event SET action = 'x.y'`)),
    ).rejects.toThrow(/append-only/);
  });

  it("shows nothing without an organisation context", async () => {
    await withPg(urls.appUrl, async (c) => {
      expect((await c.query(`SELECT 1 FROM invitation`)).rows).toEqual([]);
      expect((await c.query(`SELECT 1 FROM audit_event`)).rows).toEqual([]);
    });
  });

  it("only the application role can call the invitation functions", async () => {
    for (const url of [urls.authUrl, urls.platformUrl!])
      await withPg(url, async (c) => {
        await expect(
          c.query(`SELECT * FROM app.invitation_preview('x')`),
        ).rejects.toThrow(/permission denied/);
        await expect(
          c.query(`SELECT * FROM app.accept_invitation('x')`),
        ).rejects.toThrow(/permission denied/);
      });
  });
});
