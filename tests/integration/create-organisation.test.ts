// Platform Admin "Create organisation": the tenant, its system roles and
// EITHER an existing verified account as active owner OR an owner invitation
// (which the standard accept flow turns into an owner membership), with the
// organisation's own audit event. Platform staff with tenant.create only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { newInvitationToken } from "@/lib/invitations/token";
import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { acceptInvitation } from "@/lib/workspace/invitations";
import {
  issuePlatformStaffActorForTests,
  PlatformAuthorisationError,
} from "@/platform/authz/internal";
import { createPlatformDbClient, type PlatformDbClient } from "@/platform/db";
import { createOrganisation } from "@/platform/tenancy/create-tenant";
import { ownerInvite, replaceOwnerInvite } from "@/platform/tenants/create";
import { getStarted } from "@/lib/workspace/get-started";
import { resolveWorkspace } from "@/lib/workspace/resolve";

import { admin, appDb, createUser, platformStaff, urls } from "../helpers/db";

let db: DbClient;
let pdb: PlatformDbClient;
const slug = (label: string) =>
  `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const membership = (tenantId: string, userId: string) =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT m.status, r.key FROM tenant_membership m
           JOIN role_assignment a ON a.membership_id = m.id AND a.tenant_id = m.tenant_id
           JOIN role r ON r.id = a.role_id AND r.tenant_id = a.tenant_id
           WHERE m.tenant_id = $1 AND m.user_id = $2`,
          [tenantId, userId],
        )
      ).rows as { status: string; key: string }[],
  );

beforeAll(() => {
  db = appDb();
  pdb = createPlatformDbClient(urls.platformUrl!);
});

afterAll(async () => {
  await db.$disconnect();
  await pdb.$disconnect();
});

describe("createOrganisation", () => {
  it("makes an existing verified account the active owner, with the time zone", async () => {
    const owner = await createUser("orgowner");
    const r = await createOrganisation(db, platformStaff, {
      slug: slug("golf"),
      legalName: "Golf Kitchens Ltd",
      timezone: "Europe/Dublin",
      owner: { userId: owner },
    });
    expect(r.invitationId).toBeNull();
    expect(await membership(r.tenantId, owner)).toEqual([
      { status: "active", key: "owner" },
    ]);
    const t = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT timezone, (SELECT count(*)::int FROM role WHERE tenant_id = $1 AND is_system) AS roles,
                    (SELECT detail->>'owner' FROM audit_event WHERE tenant_id = $1 AND action = 'tenant.created') AS audited
             FROM tenant WHERE id = $1`,
            [r.tenantId],
          )
        ).rows[0],
    );
    expect(t).toEqual({
      timezone: "Europe/Dublin",
      roles: SYSTEM_ROLES.length,
      audited: "existing_account",
    });
  });

  it("invites an owner without a login; accepting makes them owner", async () => {
    const invite = newInvitationToken();
    const r = await createOrganisation(db, platformStaff, {
      slug: slug("hotel"),
      legalName: "Hotel Group Ltd",
      timezone: "Europe/London",
      owner: {
        inviteEmail: "New.Owner@Example.test",
        tokenHash: invite.hash,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    expect(r.invitationId).not.toBeNull();
    const members = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT count(*)::int AS n FROM tenant_membership WHERE tenant_id = $1`,
            [r.tenantId],
          )
        ).rows[0].n as number,
    );
    expect(members).toBe(0);
    // They sign up with that address (verified) and accept the link.
    const user = await createUser("newowner");
    await admin((c) =>
      c.query(
        `UPDATE "user" SET email = $2, email_verified = true WHERE id = $1`,
        [user, "new.owner@example.test"],
      ),
    );
    const accepted = await acceptInvitation(db, user, invite.token);
    expect(accepted).toEqual({ outcome: "joined", tenantId: r.tenantId });
    expect(await membership(r.tenantId, user)).toEqual([
      { status: "active", key: "owner" },
    ]);
  });

  it("refuses a duplicate short name", async () => {
    const s = slug("india");
    const owner = await createUser("dup");
    const input = {
      slug: s,
      legalName: "India Ltd",
      timezone: "Europe/London",
      owner: { userId: owner },
    };
    await createOrganisation(db, platformStaff, input);
    await expect(
      createOrganisation(db, platformStaff, input),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("needs a platform actor with tenant.create", async () => {
    const s = slug("juliet");
    await expect(
      createOrganisation(
        db,
        issuePlatformStaffActorForTests(
          "01900000-0000-7000-8000-000000000002",
          ["tenant.view"],
        ),
        {
          slug: s,
          legalName: "Juliet Ltd",
          timezone: "Europe/London",
          owner: { userId: await createUser("juliet") },
        },
      ),
    ).rejects.toBeInstanceOf(PlatformAuthorisationError);
    expect(
      await admin(
        async (c) =>
          (await c.query(`SELECT 1 FROM tenant WHERE slug = $1`, [s])).rowCount,
      ),
    ).toBe(0);
  });
});

describe("the owner's invitation", () => {
  const staffId = "01900000-0000-7000-8000-0000000000fd";
  const viewer = issuePlatformStaffActorForTests(staffId, ["tenant.view"]);

  it("shows where it stands, and can be sent again (old link dies) or cancelled", async () => {
    const first = newInvitationToken();
    const r = await createOrganisation(db, platformStaff, {
      slug: slug("kilo"),
      legalName: "Kilo Kitchens Ltd",
      timezone: "Europe/London",
      owner: {
        inviteEmail: "owner@example.test",
        tokenHash: first.hash,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    expect(await ownerInvite(db, staffId, r.tenantId)).toMatchObject({
      state: "pending",
      email: "owner@example.test",
    });
    // Viewing needs no change rights; changing needs tenant.create.
    await expect(
      replaceOwnerInvite(db, pdb, viewer, r.tenantId, null),
    ).rejects.toBeInstanceOf(PlatformAuthorisationError);
    const second = newInvitationToken();
    expect(
      await replaceOwnerInvite(db, pdb, platformStaff, r.tenantId, {
        email: "Owner@Example.test",
        tokenHash: second.hash,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      }),
    ).toEqual({ ok: true });
    const user = await createUser("kiloowner");
    await admin((c) =>
      c.query(
        `UPDATE "user" SET email = 'owner@example.test', email_verified = true WHERE id = $1`,
        [user],
      ),
    );
    // The first link no longer works; the new one does.
    expect((await acceptInvitation(db, user, first.token)).outcome).not.toBe(
      "joined",
    );
    expect(await acceptInvitation(db, user, second.token)).toEqual({
      outcome: "joined",
      tenantId: r.tenantId,
    });
    expect(await ownerInvite(db, staffId, r.tenantId)).toEqual({
      state: "owner_joined",
    });
    expect(
      await replaceOwnerInvite(db, pdb, platformStaff, r.tenantId, null),
    ).toEqual({ ok: false, message: "The owner has already joined." });
    const audit = await admin(async (c) =>
      (
        await c.query(
          `SELECT action FROM platform_audit_event WHERE target_id = $1::text ORDER BY occurred_at`,
          [r.tenantId],
        )
      ).rows.map((x) => x.action as string),
    );
    expect(audit).toContain("tenant.owner_invite_renewed");
  });

  it("can be cancelled while waiting", async () => {
    const t = newInvitationToken();
    const r = await createOrganisation(db, platformStaff, {
      slug: slug("lima"),
      legalName: "Lima Ltd",
      timezone: "Europe/London",
      owner: {
        inviteEmail: "lima@example.test",
        tokenHash: t.hash,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    expect(
      await replaceOwnerInvite(db, pdb, platformStaff, r.tenantId, null),
    ).toEqual({ ok: true });
    expect(await ownerInvite(db, staffId, r.tenantId)).toEqual({
      state: "revoked",
      email: "lima@example.test",
    });
  });
});

describe("Get started", () => {
  it("shows owners their first steps, ticked from what exists", async () => {
    const owner = await createUser("gsowner");
    const r = await createOrganisation(db, platformStaff, {
      slug: slug("mike"),
      legalName: "Mike Ltd",
      timezone: "Europe/London",
      owner: { userId: owner },
    });
    const ws = await resolveWorkspace(
      db,
      { userId: owner, name: "O", email: "o@example.test" },
      r.tenantId,
    );
    if (ws.kind !== "ready") throw new Error(ws.kind);
    const steps = (await getStarted(db, ws))!;
    expect(steps.map((x) => [x.id, x.done])).toEqual([
      ["details", false],
      ["sites", false],
      ["teams", false],
      ["people", false],
      ["invite", false],
      ["documents", false],
      ["rota", false],
    ]);
    await admin((c) =>
      c.query(
        `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'M1', 'Mike Hove')`,
        [r.tenantId],
      ),
    );
    expect(
      (await getStarted(db, ws))!.find((x) => x.id === "sites")!.done,
    ).toBe(true);
  });
});
