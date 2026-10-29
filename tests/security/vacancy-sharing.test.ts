// M9.2a vacancy sharing, run as the real application role: who can create,
// regenerate and remove share links; the public lookup returns only published
// fields of an open vacancy (pay only when ticked), counts views but nothing
// else, refuses malformed and old codes; the app can't change counters
// directly; the code never appears in the audit trail.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { publicVacancy } from "@/lib/workspace/public-vacancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as rc from "@/modules/recruitment";

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
let siteManager: Ready;
let worker: Ready;
let otherOwner: Ready;
let vacancy: string;

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready): rc.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rc.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: rc.Result<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
async function member(
  tenantId: string,
  roleKey: string,
  siteId: string | null = null,
) {
  const userId = await createUser(roleKey.replace("_", ""));
  await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [tenantId, m.rows[0]!.id, roleKey, siteId],
    );
  });
  return userId;
}
const codeOf = () =>
  admin(
    async (c) =>
      (
        await c.query(`SELECT public_code FROM vacancy WHERE id = $1`, [
          vacancy,
        ])
      ).rows[0].public_code as string | null,
  );
const counts = () =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT share_views_link AS link, share_views_qr AS qr FROM vacancy WHERE id = $1`,
          [vacancy],
        )
      ).rows[0] as {
        link: number;
        qr: number;
      },
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "zulu");
  B = await createTenantFixture(db, "alfa");
  owner = await ws(A.ownerUserId);
  siteManager = await ws(await member(A.tenantId, "site_manager", A.siteId));
  worker = await ws(await member(A.tenantId, "worker"));
  otherOwner = await ws(B.ownerUserId);
  vacancy = ok(
    await run(owner, (tx, a) =>
      rc.saveVacancy(tx, a, null, {
        title: "Sous chef",
        jobTitle: "Chef",
        siteId: A.siteId,
        employmentType: "full_time",
        openings: 1,
        description: "Busy kitchen, great team.",
        payMin: "30000",
        payPeriod: "year",
      }),
    ),
  ).id;
});

afterAll(async () => {
  await db.$disconnect();
});

describe("share links", () => {
  it("anyone who manages the vacancy creates one; workers and other organisations can't", async () => {
    expect(
      await run(worker, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    ok(
      await run(siteManager, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
      ),
    );
    expect(await codeOf()).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(
      await run(siteManager, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    // The code is never written to the audit trail.
    const code = await codeOf();
    const audit = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1`,
            [vacancy],
          )
        ).rows,
    );
    expect(audit.map((e) => e.action)).toContain(
      "recruitment.share_link_created",
    );
    for (const e of audit) expect(e.detail).not.toContain(code!);
  });

  it("the public page shows only published fields while open, pay only when ticked", async () => {
    const code = (await codeOf())!;
    // A draft vacancy isn't open: title and organisation only.
    expect(await publicVacancy(db, code, "none")).toEqual({
      state: "closed",
      organisation: "zulu Hospitality Ltd",
      title: "Sous chef",
    });
    ok(
      await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")),
    );
    ok(
      await run(owner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, {
          kind: "details",
          howToApply: "Ask for Sam at the pass",
          showPay: false,
        }),
      ),
    );
    const open = await publicVacancy(db, code, "none");
    expect(open).toMatchObject({
      state: "open",
      title: "Sous chef",
      siteName: "zulu Central",
      employmentType: "full_time",
      description: "Busy kitchen, great team.",
      howToApply: "Ask for Sam at the pass",
      pay: null, // not ticked
    });
    expect(JSON.stringify(open)).not.toMatch(
      /hiring_manager|tenant|site_id|"id"/,
    );
    ok(
      await run(owner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, {
          kind: "details",
          howToApply: "Ask for Sam at the pass",
          showPay: true,
        }),
      ),
    );
    expect(
      (await publicVacancy(db, code, "none")).state === "open" &&
        (await publicVacancy(db, code, "none")),
    ).toMatchObject({
      pay: { min: "30000.00", max: null, period: "year" },
    });
    expect(
      await run(owner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, {
          kind: "details",
          howToApply: "x".repeat(1001),
          showPay: true,
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });

  it("counts link and QR opens only (previews count nothing), and the app can't change counts directly", async () => {
    const code = (await codeOf())!;
    const before = await counts();
    await publicVacancy(db, code, "link");
    await publicVacancy(db, code, "qr");
    await publicVacancy(db, code, "qr");
    await publicVacancy(db, code, "none");
    expect(await counts()).toEqual({
      link: before.link + 1,
      qr: before.qr + 2,
    });
    await withPg(urls.appUrl, async (c) => {
      await expect(
        c.query(`UPDATE vacancy SET share_views_qr = 999`),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it("refuses malformed and unknown codes; a new link switches the old one off; removing it does too", async () => {
    for (const bad of [
      "",
      "short",
      "x".repeat(12) + "'",
      "../../etc",
      "ABCDEFGHIJKLM",
    ])
      expect(await publicVacancy(db, bad, "link"), bad).toEqual({
        state: "missing",
      });
    expect(await publicVacancy(db, "AAAAAAAAAAAA", "link")).toEqual({
      state: "missing",
    });
    const old = (await codeOf())!;
    ok(
      await run(owner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "regenerate" }),
      ),
    );
    const fresh = (await codeOf())!;
    expect(fresh).not.toBe(old);
    expect(await publicVacancy(db, old, "link")).toEqual({ state: "missing" });
    expect((await publicVacancy(db, fresh, "none")).state).toBe("open");
    ok(
      await run(siteManager, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "disable" }),
      ),
    );
    expect(await publicVacancy(db, fresh, "link")).toEqual({
      state: "missing",
    });
  });

  it("closed vacancies and suspended organisations stop showing details", async () => {
    ok(
      await run(owner, (tx, a) =>
        rc.updateSharing(tx, a, vacancy, { kind: "enable" }),
      ),
    );
    const code = (await codeOf())!;
    ok(
      await run(owner, (tx, a) =>
        rc.setVacancyStatus(tx, a, vacancy, "closed"),
      ),
    );
    expect((await publicVacancy(db, code, "link")).state).toBe("closed");
    ok(
      await run(owner, (tx, a) => rc.setVacancyStatus(tx, a, vacancy, "open")),
    );
    await admin((c) =>
      c.query(`UPDATE tenant SET status = 'suspended' WHERE id = $1`, [
        A.tenantId,
      ]),
    );
    expect(await publicVacancy(db, code, "link")).toEqual({ state: "missing" });
    await admin((c) =>
      c.query(`UPDATE tenant SET status = 'active' WHERE id = $1`, [
        A.tenantId,
      ]),
    );
  });

  it("only the application role can call the public lookup", async () => {
    for (const url of [urls.authUrl, urls.platformUrl!])
      await withPg(url, async (c) => {
        await expect(
          c.query(`SELECT * FROM app.public_vacancy('AAAAAAAAAAAA', 'link')`),
        ).rejects.toThrow(/permission denied/);
      });
  });

  it("codes are well formed and unique", () => {
    const codes = new Set(
      Array.from({ length: 2000 }, () => rc.newPublicCode()),
    );
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(rc.isPublicCode(c)).toBe(true);
  });
});
