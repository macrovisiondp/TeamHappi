// M16 before HotRock's opening, run as the real application role:
// - job titles: only settings managers keep the list; once it has titles,
//   staff records and training rules accept only listed titles (stored with
//   the list's spelling); organisations without a list type freely;
// - nobody approves a timesheet week that contains their own hours;
// - the rota warns managers when people are working but nobody holds a
//   course needed on every shift. Synthetic data only.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import * as titles from "@/lib/workspace/job-titles";
import * as m from "@/lib/workspace/mutations";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as att from "@/modules/attendance";
import * as ob from "@/modules/onboarding";
import * as rota from "@/modules/rota";
import * as tr from "@/modules/training";

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
let manager: Ready;
let otherOwner: Ready;
let managerEmployee: string;

const TZ = "Europe/London";
const TODAY = rota.todayIn(TZ);
const PAST_WEEK = rota.addDays(rota.mondayOf(TODAY), -14);
const NEXT_WEEK = rota.addDays(rota.mondayOf(TODAY), 7);
const NEXT_DAY = rota.addDays(NEXT_WEEK, 2);

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
const run = <T>(w: Ready, fn: (tx: TenantTx, a: tr.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const inWs = <T>(w: Ready, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(db, w.ctx, fn);
const ok = <T>(
  r: { ok: true; data: T } | { ok: false; message: string; code?: string },
) => {
  if (!r.ok) throw new Error(r.message);
  return r.data;
};
const person = (extra: Record<string, unknown> = {}) => ({
  givenName: "Pat",
  familyName: "Opening",
  status: "active",
  startDate: "2026-11-01",
  primarySiteId: A.siteId,
  teamIds: [],
  ...extra,
});

async function staff(given: string, siteId: string) {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status)
           VALUES ($1, $2, $3, 'Cover', $4, 'Server', '2026-10-01', 'active') RETURNING id`,
          [A.tenantId, `PO-${given}`, given, siteId],
        )
      ).rows[0]!.id,
  );
}

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "opening");
  B = await createTenantFixture(db, "opening-b");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  // A site manager who also works shifts (their own staff record).
  const userId = await createUser("sitemanager");
  managerEmployee = await admin(async (c) => {
    const mem = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [A.tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id, site_id)
       SELECT $1, $2, id, $3 FROM role WHERE tenant_id = $1 AND key = 'site_manager'`,
      [A.tenantId, mem.rows[0]!.id, A.siteId],
    );
    return (
      await c.query<{ id: string }>(
        `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status, membership_id)
         VALUES ($1, 'PO-M', 'Mia', 'Manager', $2, 'Restaurant Manager', '2026-10-01', 'active', $3) RETURNING id`,
        [A.tenantId, A.siteId, mem.rows[0]!.id],
      )
    ).rows[0]!.id;
  });
  manager = await ws(userId);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("job titles", () => {
  it("only settings managers keep the list", async () => {
    const r = await inWs(manager, (tx) =>
      titles.addTitles(tx, manager, "Chef"),
    );
    expect(r.ok).toBe(false);
    const added = await inWs(owner, (tx) =>
      titles.addTitles(
        tx,
        owner,
        "Server\nHead Chef\n  server  \nSupervisor / Head Waiter",
      ),
    );
    expect(added).toMatchObject({ ok: true, added: 3 });
    const list = await inWs(owner, titles.listTitles);
    expect(list.titles.map((t) => t.name)).toEqual([
      "Head Chef",
      "Server",
      "Supervisor / Head Waiter",
    ]);
    // Staff with an unlisted title are pointed out.
    expect(list.unlisted.map((u) => u.name)).toContain("Restaurant Manager");
    // Another organisation sees none of it.
    expect((await inWs(otherOwner, titles.listTitles)).titles).toEqual([]);
  });

  it("staff records accept only listed titles, stored with the list's spelling", async () => {
    const id = ok(
      await m.createEmployee(db, owner, person({ jobTitle: "  head   chef " })),
    ).id;
    const row = await admin(
      async (c) =>
        (await c.query(`SELECT job_title FROM employee WHERE id = $1`, [id]))
          .rows[0],
    );
    expect(row).toEqual({ job_title: "Head Chef" });
    const typo = await m.createEmployee(
      db,
      owner,
      person({ jobTitle: "Hed Chef" }),
    );
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.fieldErrors?.jobTitle).toMatch(/list/);
    // No title at all is still fine.
    expect(
      (await m.createEmployee(db, owner, person({ jobTitle: "" }))).ok,
    ).toBe(true);
  });

  it("training rules follow the list too; organisations without a list type freely", async () => {
    const course = ok(
      await run(owner, (tx, a) =>
        tr.saveCourse(tx, a, null, {
          name: "Opening induction",
          category: "other",
          kind: "internal",
          completionMethod: "in_person",
          certificateExpected: false,
          validityMonths: "",
          warnDays: 60,
        }),
      ),
    ).id;
    const bad = await run(owner, (tx, a) =>
      tr.saveRule(tx, a, course, null, {
        scope: "job_title",
        jobTitle: "Waiter",
        mandatory: true,
        dueDays: 0,
      }),
    );
    expect(bad.ok).toBe(false);
    ok(
      await run(owner, (tx, a) =>
        tr.saveRule(tx, a, course, null, {
          scope: "job_title",
          jobTitle: "supervisor / head waiter",
          mandatory: true,
          dueDays: 0,
        }),
      ),
    );
    const c = await run(owner, (tx, a) => tr.getCourse(tx, a, course));
    expect(c!.rules[0]!.target).toBe("Job title: Supervisor / Head Waiter");
    // B keeps no list: anything typed is accepted.
    expect(
      (
        await m.createEmployee(db, otherOwner, {
          ...person({ jobTitle: "Mixologist" }),
          primarySiteId: B.siteId,
        })
      ).ok,
    ).toBe(true);
  });

  it("an archived title is no longer accepted", async () => {
    const list = await inWs(owner, titles.listTitles);
    const server = list.titles.find((t) => t.name === "Server")!;
    expect(
      (await inWs(owner, (tx) => titles.archiveTitle(tx, owner, server.id))).ok,
    ).toBe(true);
    const r = await m.createEmployee(db, owner, person({ jobTitle: "Server" }));
    expect(r.ok).toBe(false);
    // Other organisations can't archive it (not found).
    const head = list.titles.find((t) => t.name === "Head Chef")!;
    expect(
      (
        await inWs(otherOwner, (tx) =>
          titles.archiveTitle(tx, otherOwner, head.id),
        )
      ).ok,
    ).toBe(false);
  });
});

describe("approving your own hours", () => {
  it("a manager can't approve a week with their own hours; someone else can", async () => {
    const day = rota.addDays(PAST_WEEK, 1);
    await admin((c) =>
      c.query(
        `INSERT INTO time_entry (tenant_id, employee_id, site_id, clock_in_at, clock_out_at, source, created_by)
         VALUES ($1, $2, $3, $4, $5, 'manager', $6)`,
        [
          A.tenantId,
          managerEmployee,
          A.siteId,
          rota.zonedToUtc(`${day}T10:00`, TZ),
          rota.zonedToUtc(`${day}T16:00`, TZ),
          A.ownerUserId,
        ],
      ),
    );
    const mine = await run(manager, (tx, a) =>
      att.approveTimesheet(tx, a, A.siteId, PAST_WEEK),
    );
    expect(mine).toMatchObject({ ok: false, code: "forbidden" });
    if (!mine.ok) expect(mine.message).toMatch(/your own hours/);
    ok(
      await run(owner, (tx, a) =>
        att.approveTimesheet(tx, a, A.siteId, PAST_WEEK),
      ),
    );
  });
});

describe("shift cover", () => {
  it("the rota shows managers when nobody working holds a cover course", async () => {
    const firstAider = await staff("Fay", A.siteId);
    const other = await staff("Ned", A.siteId);
    for (const id of [firstAider, other])
      ok(
        await run(owner, (tx, a) =>
          ob.recordRtwCheck(tx, a, id, TODAY, {
            method: "manual_document",
            listType: "list_a",
            checkedOn: TODAY,
            personPresent: true,
            outcome: "confirmed",
          }),
        ),
      );
    const course = ok(
      await run(owner, (tx, a) =>
        tr.saveCourse(tx, a, null, {
          name: "Emergency first aid",
          category: "first_aid",
          kind: "external",
          completionMethod: "external_certificate",
          certificateExpected: true,
          shiftCover: true,
          validityMonths: 36,
          warnDays: 60,
        }),
      ),
    ).id;
    ok(
      await run(owner, (tx, a) =>
        tr.recordTraining(tx, a, firstAider, TODAY, {
          courseId: course,
          completedOn: TODAY,
          provider: "Synthetic provider",
        }),
      ),
    );
    const shift = async (start: string, end: string, who: string) => {
      const id = ok(
        await run(owner, (tx, a) =>
          rota.saveShift(tx, a, A.siteId, NEXT_WEEK, null, {
            day: NEXT_DAY,
            start,
            end,
            breakMinutes: "0",
          }),
        ),
      ).id;
      const r = await run(owner, (tx, a) =>
        rota.assignShift(tx, a, id, who, ""),
      );
      if (!r.ok)
        ok(
          await run(owner, (tx, a) =>
            rota.assignShift(tx, a, id, who, "Cover test"),
          ),
        );
    };
    await shift("10:00", "14:00", firstAider);
    await shift("12:00", "18:00", other);
    const week = await run(owner, (tx, a) =>
      rota.getWeek(tx, a, A.siteId, NEXT_WEEK),
    );
    expect(week!.coverGaps).toEqual([
      {
        day: NEXT_DAY,
        course: "Emergency first aid",
        from: "14:00",
        to: "18:00",
      },
    ]);
    // Other organisations can't see the site at all.
    expect(
      await run(otherOwner, (tx, a) =>
        rota.getWeek(tx, a, A.siteId, NEXT_WEEK),
      ),
    ).toBeNull();
  });
});
