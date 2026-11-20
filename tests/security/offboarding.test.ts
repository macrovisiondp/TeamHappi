// M18 offboarding, run as the real application role: only people who manage
// staff record a leaving; a leaving checklist starts from a leaving template;
// cancelling works until it's final; after the last day (or "end access now")
// the record is "left", the login stops working for this organisation, and
// later shifts are released; other organisations can do nothing; the private
// note never reaches the audit trail. Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as leaving from "@/lib/workspace/leaving";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";
import * as rota from "@/modules/rota";

import {
  admin,
  appDb,
  createTenantFixture,
  createUser,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let otherOwner: Ready;
let leaverUser: string;
let leaver: Ready;
let leaverRecord: string;
let quickUser: string;
let quickRecord: string;

const TZ = "Europe/London";
const TODAY = rota.todayIn(TZ);
const NEXT_WEEK = rota.addDays(rota.mondayOf(TODAY), 7);

const ws = async (userId: string) =>
  resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
const ready = async (userId: string) => {
  const w = await ws(userId);
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready) => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const inWs = <T>(w: Ready, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(db, w.ctx, fn);
const ok = <T>(r: { ok: true; data?: T } | { ok: false; message: string }) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

async function linkedWorker(n: string) {
  const userId = await createUser("worker");
  const employeeId = await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM role WHERE tenant_id = $1 AND key = 'worker'`,
      [A.tenantId, m.rows[0]!.id],
    );
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, status, start_date, membership_id)
         VALUES ($1, $2, $3, 'Leaver', $4, 'Server', 'active', '2026-01-05', $5) RETURNING id`,
        [A.tenantId, `LV-${n}`, n, A.siteId, m.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  return { userId, employeeId };
}

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "leavers");
  B = await createTenantFixture(db, "leavers-b");
  owner = await ready(A.ownerUserId);
  otherOwner = await ready(B.ownerUserId);
  ({ userId: leaverUser, employeeId: leaverRecord } =
    await linkedWorker("Lee"));
  ({ userId: quickUser, employeeId: quickRecord } = await linkedWorker("Quin"));
  leaver = await ready(leaverUser);
  for (const id of [leaverRecord, quickRecord])
    ok(
      await inWs(owner, (tx) =>
        ob.recordRtwCheck(tx, actorOf(owner), id, TODAY, {
          method: "manual_document",
          listType: "list_a",
          checkedOn: TODAY,
          personPresent: true,
          outcome: "confirmed",
        }),
      ),
    );
  // The suggested templates include a leaver checklist.
  ok(await inWs(owner, (tx) => ob.addSuggestedTemplates(tx, actorOf(owner))));
});

afterAll(async () => {
  await db.$disconnect();
});

describe("recording a leaving", () => {
  it("only people who manage staff can record it; other organisations can't", async () => {
    const mine = await inWs(leaver, (tx) =>
      leaving.markLeaving(
        tx,
        leaver,
        leaverRecord,
        { lastDay: TODAY, reason: "resigned" },
        TODAY,
      ),
    );
    expect(mine.ok).toBe(false);
    const other = await inWs(otherOwner, (tx) =>
      leaving.markLeaving(
        tx,
        otherOwner,
        leaverRecord,
        { lastDay: TODAY, reason: "resigned" },
        TODAY,
      ),
    );
    expect(other.ok).toBe(false);
    const bad = await inWs(owner, (tx) =>
      leaving.markLeaving(
        tx,
        owner,
        leaverRecord,
        { lastDay: "2025-01-01", reason: "nope" },
        TODAY,
      ),
    );
    expect(bad.ok).toBe(false);
  });

  it("records it, starts the leaver checklist, and keeps access until the last day", async () => {
    // A shift next week that should be released when they go.
    const shift = (
      ok(
        await inWs(owner, (tx) =>
          rota.saveShift(tx, actorOf(owner), A.siteId, NEXT_WEEK, null, {
            day: rota.addDays(NEXT_WEEK, 1),
            start: "10:00",
            end: "16:00",
            breakMinutes: "0",
          }),
        ),
      ) as { data: { id: string } }
    ).data.id;
    const assigned = await inWs(owner, (tx) =>
      rota.assignShift(tx, actorOf(owner), shift, leaverRecord, "Leaver test"),
    );
    expect(assigned.ok).toBe(true);

    ok(
      await inWs(owner, (tx) =>
        leaving.markLeaving(
          tx,
          owner,
          leaverRecord,
          { lastDay: TODAY, reason: "resigned", note: "Private: moving city" },
          TODAY,
        ),
      ),
    );
    const view = await inWs(owner, (tx) =>
      leaving.leavingFor(tx, owner, leaverRecord),
    );
    expect(view?.leaving).toMatchObject({
      lastDay: TODAY,
      reason: "resigned",
      finalised: false,
    });
    expect(view?.checklist?.total).toBe(6);
    expect((await ws(leaverUser)).kind).toBe("ready");
  });

  it("can be cancelled before it's final (the checklist closes), then recorded again", async () => {
    ok(
      await inWs(owner, (tx) => leaving.cancelLeaving(tx, owner, leaverRecord)),
    );
    const view = await inWs(owner, (tx) =>
      leaving.leavingFor(tx, owner, leaverRecord),
    );
    expect(view?.leaving).toBeNull();
    expect(view?.checklist?.status).toBe("cancelled");
    ok(
      await inWs(owner, (tx) =>
        leaving.markLeaving(
          tx,
          owner,
          leaverRecord,
          { lastDay: TODAY, reason: "end_of_contract" },
          TODAY,
        ),
      ),
    );
  });
});

describe("after the last day", () => {
  it("ends access, marks the record left and releases later shifts", async () => {
    // Move the last day into the past, as if time had passed.
    await admin((c) =>
      c.query(
        `UPDATE employee_leaving SET last_day = $2::date - 1 WHERE employee_id = $1 AND cancelled_at IS NULL`,
        [leaverRecord, TODAY],
      ),
    );
    // Anyone loading the organisation finalises it; then the leaver can't get in.
    await ready(A.ownerUserId);
    const w = await ws(leaverUser);
    expect(w.kind).not.toBe("ready");
    const facts = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT e.status, m.status AS membership,
                    (SELECT count(*)::int FROM shift_assignment a WHERE a.employee_id = e.id AND a.removed_at IS NULL) AS shifts
             FROM employee e JOIN tenant_membership m ON m.id = e.membership_id WHERE e.id = $1`,
            [leaverRecord],
          )
        ).rows[0],
    );
    expect(facts).toEqual({ status: "left", membership: "left", shifts: 0 });
    // Final: it can't be cancelled now.
    expect(
      (
        await inWs(owner, (tx) =>
          leaving.cancelLeaving(tx, owner, leaverRecord),
        )
      ).ok,
    ).toBe(false);
  });

  it("“end access now” works straight away", async () => {
    ok(
      await inWs(owner, (tx) =>
        leaving.markLeaving(
          tx,
          owner,
          quickRecord,
          { lastDay: rota.addDays(TODAY, 14), reason: "dismissed" },
          TODAY,
        ),
      ),
    );
    expect((await ws(quickUser)).kind).toBe("ready");
    ok(
      await inWs(owner, (tx) =>
        leaving.endAccessNow(tx, owner, quickRecord, TODAY),
      ),
    );
    expect((await ws(quickUser)).kind).not.toBe("ready");
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT status, end_date::text AS end FROM employee WHERE id = $1`,
            [quickRecord],
          )
        ).rows[0],
    );
    expect(row).toEqual({ status: "left", end: TODAY });
  });
});

describe("privacy and posture", () => {
  it("the private note never reaches the audit trail; leavings can't be deleted", async () => {
    const audit = await admin(
      async (c) =>
        (
          await c.query<{ detail: string }>(
            `SELECT detail::text AS detail FROM audit_event WHERE tenant_id = $1 AND action LIKE 'employee.%'`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(audit.length).toBeGreaterThan(0);
    for (const r of audit) expect(r.detail).not.toContain("moving city");
    await expect(
      inWs(owner, (tx) =>
        tx.employeeLeaving.deleteMany({ where: { employeeId: quickRecord } }),
      ),
    ).rejects.toThrow();
  });
});
