// M5.2 client organisation management, run as the real teamhappi_platform
// role: what the role can and can't see, counts-only summaries, status changes
// with audit, and their effect on members.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { resolveWorkspace } from "@/lib/workspace/resolve";
import {
  issuePlatformStaffActorForTests,
  PlatformAuthorisationError,
} from "@/platform/authz/internal";
import { createPlatformDbClient, type PlatformDbClient } from "@/platform/db";
import {
  getOrganisation,
  listOrganisations,
  setOrganisationStatus,
} from "@/platform/tenants/organisations";

import {
  admin,
  appDb,
  createTenantFixture,
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

let app: DbClient;
let platform: PlatformDbClient;
let A: TenantFixture;
let B: TenantFixture;

const STAFF_ID = "01900000-0000-7000-8000-0000000000ff";
const suspender = issuePlatformStaffActorForTests(STAFF_ID, [
  "tenant.view",
  "tenant.suspend",
]);
const viewer = issuePlatformStaffActorForTests(STAFF_ID, ["tenant.view"]);
const user = (userId: string) => ({
  userId,
  name: "Owner",
  email: "o@example.test",
});

beforeAll(async () => {
  app = appDb();
  platform = createPlatformDbClient(urls.platformUrl!);
  A = await createTenantFixture(app, "juliet");
  B = await createTenantFixture(app, "kilo");
});

afterAll(async () => {
  await app.$disconnect();
  await platform.$disconnect();
});

describe("what the platform role can see", () => {
  it("reads every organisation in the registry", async () => {
    const orgs = await listOrganisations(platform);
    const ids = orgs.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([A.tenantId, B.tenantId]));
    expect(
      (await listOrganisations(platform, "juliet")).every((o) =>
        /juliet/i.test(o.name),
      ),
    ).toBe(true);
  });

  it("gets counts and owner contacts, never employee or site details", async () => {
    const org = await getOrganisation(platform, A.tenantId);
    expect(org).toMatchObject({
      activeSites: 1,
      archivedSites: 0,
      activeMembers: 1,
      people: 1,
      subscriptionStatus: "trial",
    });
    expect(org!.owners).toHaveLength(1);
    expect(JSON.stringify(org)).not.toMatch(/Sam|Central|Kitchen/); // fixture employee/site/team names
  });

  it("has no access to client data tables, sessions or MFA", async () => {
    await withPg(urls.platformUrl!, async (c) => {
      for (const table of [
        "site",
        "team",
        "employee",
        "document",
        "tenant_membership",
        "role_assignment",
        "user",
        "session",
        "account",
        "user_mfa",
        "mfa_recovery_code",
        "platform_staff",
      ])
        await expect(
          c.query(`SELECT 1 FROM "${table}" LIMIT 1`),
          table,
        ).rejects.toThrow(/permission denied/);
    });
  });

  it("can change only an organisation's status, nothing else", async () => {
    await withPg(urls.platformUrl!, async (c) => {
      await expect(
        c.query(`UPDATE tenant SET legal_name = 'Hijacked' WHERE id = $1`, [
          A.tenantId,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE tenant SET slug = 'x' WHERE id = $1`, [A.tenantId]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(
          `INSERT INTO tenant (slug, legal_name) VALUES ('evil', 'Evil')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`DELETE FROM tenant WHERE id = $1`, [A.tenantId]),
      ).rejects.toThrow(/permission denied/);
      await expect(c.query(`DELETE FROM platform_audit_event`)).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  it("only the platform role can run the summary function", async () => {
    for (const url of [urls.appUrl, urls.authUrl])
      await withPg(url, async (c) => {
        await expect(
          c.query(`SELECT * FROM app.platform_tenant_summaries()`),
        ).rejects.toThrow(/permission denied/);
      });
  });
});

describe("suspending and reactivating", () => {
  it("needs the tenant.suspend grant", async () => {
    await expect(
      setOrganisationStatus(
        platform,
        viewer,
        A.tenantId,
        "suspended",
        "Payment overdue",
      ),
    ).rejects.toThrow(PlatformAuthorisationError);
  });

  it("requires a reason and refuses unknown or repeated changes", async () => {
    expect(
      await setOrganisationStatus(
        platform,
        suspender,
        A.tenantId,
        "suspended",
        "no",
      ),
    ).toMatchObject({
      code: "invalid",
    });
    expect(
      await setOrganisationStatus(
        platform,
        suspender,
        "not-a-uuid",
        "suspended",
        "Payment overdue",
      ),
    ).toMatchObject({
      code: "not_found",
    });
    expect(
      await setOrganisationStatus(
        platform,
        suspender,
        A.tenantId,
        "active",
        "",
      ),
    ).toMatchObject({
      code: "conflict",
    });
  });

  it("suspension cuts members off on their next request; reactivation restores them; both are audited", async () => {
    expect(
      (await resolveWorkspace(app, user(A.ownerUserId), A.tenantId)).kind,
    ).toBe("ready");

    expect(
      await setOrganisationStatus(
        platform,
        suspender,
        A.tenantId,
        "suspended",
        "Payment overdue",
      ),
    ).toEqual({ ok: true });
    expect(
      (await resolveWorkspace(app, user(A.ownerUserId), A.tenantId)).kind,
    ).toBe("none");
    // Another organisation is unaffected.
    expect(
      (await resolveWorkspace(app, user(B.ownerUserId), B.tenantId)).kind,
    ).toBe("ready");

    expect(
      await setOrganisationStatus(
        platform,
        suspender,
        A.tenantId,
        "active",
        "",
      ),
    ).toEqual({ ok: true });
    expect(
      (await resolveWorkspace(app, user(A.ownerUserId), A.tenantId)).kind,
    ).toBe("ready");

    const events = await admin((c) =>
      c.query(
        `SELECT action, actor_user_id, detail FROM platform_audit_event
         WHERE target_type = 'tenant' AND target_id = $1 ORDER BY occurred_at, id`,
        [A.tenantId],
      ),
    );
    expect(events.rows.map((e) => e.action)).toEqual([
      "tenant.suspended",
      "tenant.reactivated",
    ]);
    expect(events.rows[0]).toMatchObject({
      actor_user_id: STAFF_ID,
      detail: { from: "active", to: "suspended", reason: "Payment overdue" },
    });
  });

  it("organisations being offboarded or closed can't be changed here", async () => {
    await admin((c) =>
      c.query(`UPDATE tenant SET status = 'offboarding' WHERE id = $1`, [
        B.tenantId,
      ]),
    );
    try {
      expect(
        await setOrganisationStatus(
          platform,
          suspender,
          B.tenantId,
          "suspended",
          "Payment overdue",
        ),
      ).toMatchObject({
        code: "conflict",
      });
    } finally {
      await admin((c) =>
        c.query(`UPDATE tenant SET status = 'active' WHERE id = $1`, [
          B.tenantId,
        ]),
      );
    }
  });
});
