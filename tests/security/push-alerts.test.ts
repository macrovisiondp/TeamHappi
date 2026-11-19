// M12 shift alerts, run as the real application role with a FAKE sender (no
// network): browser subscriptions are validated and stored per membership;
// only people whose PUBLISHED shifts changed are alerted; the alert says
// nothing private; gone endpoints are removed; isolation and posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as push from "@/lib/workspace/push";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";
import * as rota from "@/modules/rota";

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
let manager: Ready;
let anaW: Ready;
let benW: Ready;
let otherOwner: Ready;
let ana: string;
const TODAY = rota.todayIn("Europe/London");
const WEEK = rota.addDays(rota.mondayOf(TODAY), 14);

const key = (seed: string, n: number) =>
  (seed.repeat(n) + "A".repeat(n)).slice(0, n);
const sub = (id: string) => ({
  endpoint: `https://push.example.test/send/${id}`,
  keys: { p256dh: key("BPk", 87), auth: key("au", 22) },
});

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready) => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: rota.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code: string },
) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};
async function member(roleKey: string, link?: string) {
  const userId = await createUser(roleKey.replace("_", ""));
  const employeeId = await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $4 FROM role WHERE tenant_id = $1 AND key = $3`,
      [
        A.tenantId,
        m.rows[0]!.id,
        roleKey,
        roleKey === "worker" ? null : A.siteId,
      ],
    );
    if (!link) return null;
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status, membership_id)
         VALUES ($1, $2, $3, 'Push', $4, 'Server', '2026-10-01', 'active', $5) RETURNING id`,
        [A.tenantId, `PU-${link}`, link, A.siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { w: await ws(userId), employeeId };
}
const live = () =>
  admin(
    async (c) =>
      (
        await c.query(
          `SELECT membership_id, endpoint, removed_at, last_sent_at FROM push_subscription WHERE tenant_id = $1 ORDER BY created_at`,
          [A.tenantId],
        )
      ).rows as {
        membership_id: string;
        endpoint: string;
        removed_at: Date | null;
        last_sent_at: Date | null;
      }[],
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "delta");
  B = await createTenantFixture(db, "echo");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  manager = (await member("site_manager")).w;
  const a = await member("worker", "Ana");
  const b = await member("worker", "Ben");
  [anaW, ana, benW] = [a.w, a.employeeId!, b.w];
  ok(
    await run(owner, (tx, x) =>
      ob.recordRtwCheck(tx, x, ana, TODAY, {
        method: "manual_document",
        listType: "list_a",
        checkedOn: TODAY,
        personPresent: true,
        outcome: "confirmed",
      }),
    ),
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("subscriptions", () => {
  it("only accepts a well-formed https subscription", () => {
    expect(push.parseSubscription(sub("ok"))).not.toBeNull();
    for (const bad of [
      null,
      "x",
      { ...sub("x"), endpoint: "http://push.example.test/x" },
      { ...sub("x"), endpoint: "https://user:pw@push.example.test/x" },
      { ...sub("x"), endpoint: "javascript:alert(1)" },
      { ...sub("x"), keys: { p256dh: "short", auth: key("au", 22) } },
      { ...sub("x"), keys: { p256dh: key("BPk", 87), auth: "bad!" } },
    ])
      expect(push.parseSubscription(bad)).toBeNull();
  });

  it("are stored for the member's own membership; a shared phone moves over", async () => {
    expect((await push.saveSubscription(db, anaW, sub("ana"))).ok).toBe(true);
    expect((await push.saveSubscription(db, anaW, sub("ana"))).ok).toBe(true);
    expect(await push.hasSubscription(db, anaW)).toBe(true);
    expect(await push.hasSubscription(db, benW)).toBe(false);
    // Ben signs in on the same phone: Ana's alerts on it stop.
    expect((await push.saveSubscription(db, benW, sub("shared"))).ok).toBe(
      true,
    );
    expect((await push.saveSubscription(db, anaW, sub("shared"))).ok).toBe(
      true,
    );
    const rows = await live();
    expect(
      rows.filter((r) => r.endpoint.endsWith("/shared") && !r.removed_at),
    ).toHaveLength(1);
    expect(await push.hasSubscription(db, benW)).toBe(false);
    // Ben can't turn off Ana's device.
    expect(
      (await push.removeSubscription(db, benW, sub("ana").endpoint)).ok,
    ).toBe(false);
    // Another organisation sees none of it.
    expect(await push.hasSubscription(db, otherOwner)).toBe(false);
  });
});

describe("alerts", () => {
  it("go only to people whose published shifts changed, saying nothing private", async () => {
    expect((await push.saveSubscription(db, benW, sub("ben"))).ok).toBe(true);
    const sent: { endpoint: string; payload: string }[] = [];
    const sender: push.PushSender = async (s, payload) => {
      sent.push({ endpoint: s.endpoint, payload });
      return s.endpoint.endsWith("/shared") ? 410 : 201;
    };
    const since = new Date(Date.now() - 5_000);
    // Drafts alert nobody.
    const shiftId = ok(
      await run(manager, (tx, x) =>
        rota.saveShift(tx, x, A.siteId, WEEK, null, {
          day: rota.addDays(WEEK, 2),
          start: "10:00",
          end: "16:00",
          breakMinutes: "30",
        }),
      ),
    ).id;
    ok(
      await run(manager, (tx, x) => rota.assignShift(tx, x, shiftId, ana, "")),
    );
    expect(await push.notifyShiftChanges(db, manager, since, sender)).toEqual({
      sent: 0,
      removed: 0,
    });
    // Publishing alerts Ana's devices only (Ben has no shift).
    ok(await run(manager, (tx, x) => rota.publishWeek(tx, x, A.siteId, WEEK)));
    expect(await push.notifyShiftChanges(db, manager, since, sender)).toEqual({
      sent: 1,
      removed: 1,
    });
    expect(sent.map((s) => s.endpoint.split("/").pop()).sort()).toEqual([
      "ana",
      "shared",
    ]);
    for (const s of sent) {
      expect(JSON.parse(s.payload)).toEqual({
        title: "TeamHappi",
        body: "Your shifts have changed. Tap to see them.",
        url: "/rota/me",
      });
      expect(s.payload).not.toMatch(/Ana|10:00|delta|Server/);
    }
    // The gone device was removed; the other was marked sent.
    const rows = await live();
    expect(
      rows.find(
        (r) =>
          r.endpoint.endsWith("/shared") &&
          r.membership_id === anaW.membershipId,
      )?.removed_at,
    ).not.toBeNull();
    expect(
      rows.find((r) => r.endpoint.endsWith("/ana"))?.last_sent_at,
    ).not.toBeNull();
  });

  it("follow later changes, and one failing device never stops the rest", async () => {
    const since = new Date(Date.now() - 5_000);
    const shift = (await run(manager, (tx, x) =>
      rota.getWeek(tx, x, A.siteId, WEEK),
    ))!.shifts[0]!;
    ok(await run(manager, (tx, x) => rota.unassignShift(tx, x, shift.id)));
    const r = await push.notifyShiftChanges(db, manager, since, async () => {
      throw new Error("network down");
    });
    expect(r).toEqual({ sent: 0, removed: 0 });
  });
});

describe("the database itself", () => {
  it("has no DELETE, fixed endpoints, and checks the stored keys", async () => {
    await withPg(urls.appUrl, async (c) => {
      await expect(c.query(`DELETE FROM push_subscription`)).rejects.toThrow(
        /permission denied/,
      );
      for (const col of ["endpoint", "p256dh", "auth", "membership_id"])
        await expect(
          c.query(`UPDATE push_subscription SET ${col} = ${col}`),
          col,
        ).rejects.toThrow(/permission denied/);
    });
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO push_subscription (tenant_id, membership_id, endpoint, p256dh, auth)
           VALUES ($1, $2, 'http://insecure.example.test/x', $3, $4)`,
          [A.tenantId, anaW.membershipId, key("BPk", 87), key("au", 22)],
        ),
      ),
    ).rejects.toThrow(/push_subscription_endpoint/);
  });
});
