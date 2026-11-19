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
import { createOrganisation } from "@/platform/tenancy/create-tenant";

import { admin, appDb, createUser, platformStaff } from "../helpers/db";

let db: DbClient;
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
});

afterAll(async () => {
  await db.$disconnect();
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
