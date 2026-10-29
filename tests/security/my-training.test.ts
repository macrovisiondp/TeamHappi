// M8.2 "My training", run as the real application role: ownership (not role)
// gives access; people confirm only read-and-confirm courses that apply to
// them, at the current content version; they can't record or verify
// external or in-person training, change anyone's records, or see anyone
// else's; confirmations are audited.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
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
let me: Ready; // a worker linked to their staff record
let stranger: Ready; // a worker with no linked record
let otherOwner: Ready;
let myRecord: string;
let colleague: string;
let policy: string; // read-and-confirm, required for everyone
let cert: string; // external, required for everyone
let optional: string; // read-and-confirm, no rule
const TODAY = "2026-10-20";

const ws = async (userId: string) => {
  const w = await resolveWorkspace(
    db,
    { userId, name: "U", email: "u@example.test" },
    undefined,
  );
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
};
const actorOf = (w: Ready): tr.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: tr.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: tr.Result<T>) => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.data;
};

async function worker(tenantId: string) {
  const userId = await createUser("worker");
  const membershipId = await admin(async (c) => {
    const m = await c.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [tenantId, userId],
    );
    await c.query(
      `INSERT INTO role_assignment (tenant_id, membership_id, role_id)
       SELECT $1, $2, id FROM role WHERE tenant_id = $1 AND key = 'worker'`,
      [tenantId, m.rows[0]!.id],
    );
    return m.rows[0]!.id;
  });
  return { userId, membershipId };
}
const course = async (name: string, extra: Record<string, unknown>) =>
  ok(
    await run(owner, (tx, a) =>
      tr.saveCourse(tx, a, null, {
        name,
        category: "other",
        kind: "internal",
        completionMethod: "read_and_confirm",
        certificateExpected: false,
        validityMonths: 12,
        warnDays: 60,
        content: "Version one of the policy.",
        ...extra,
      }),
    ),
  ).id;
const auditFor = (targetId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1`,
          [targetId],
        )
      ).rows,
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "victor");
  B = await createTenantFixture(db, "whiskey");
  owner = await ws(A.ownerUserId);
  otherOwner = await ws(B.ownerUserId);
  const w = await worker(A.tenantId);
  me = await ws(w.userId);
  stranger = await ws((await worker(A.tenantId)).userId);
  [myRecord, colleague] = await admin(async (c) => {
    const mine = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, membership_id, status, start_date)
       VALUES ($1, 'E-V1', 'Vi', 'Mine', $2, $3, 'active', '2026-10-01') RETURNING id`,
      [A.tenantId, A.siteId, w.membershipId],
    );
    const other = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
       VALUES ($1, 'E-V2', 'Col', 'League', $2, 'active') RETURNING id`,
      [A.tenantId, A.siteId],
    );
    return [mine.rows[0]!.id, other.rows[0]!.id];
  });
  policy = await course("Customer safety policy", {});
  cert = await course("Food hygiene", {
    kind: "external",
    completionMethod: "external_certificate",
    content: "",
    validityMonths: 36,
  });
  optional = await course("Optional reading", {});
  for (const id of [policy, cert])
    ok(
      await run(owner, (tx, a) =>
        tr.saveRule(tx, a, id, null, {
          scope: "organisation",
          mandatory: true,
          dueDays: 14,
        }),
      ),
    );
  // A manager records the colleague's certificate (must stay invisible to "me").
  ok(
    await run(owner, (tx, a) =>
      tr.recordTraining(tx, a, colleague, TODAY, {
        courseId: cert,
        completedOn: "2026-10-01",
        provider: "Colleague Provider",
      }),
    ),
  );
});

afterAll(async () => {
  await db.$disconnect();
});

describe("my training", () => {
  it("is reached by a linked record, not by role, and shows only what applies to me", async () => {
    expect(
      await run(stranger, (tx, a) => tr.myTraining(tx, a, TODAY)),
    ).toBeNull();
    expect(
      await run(otherOwner, (tx, a) => tr.myTraining(tx, a, TODAY)),
    ).toBeNull();
    const mine = (await run(me, (tx, a) => tr.myTraining(tx, a, TODAY)))!;
    expect(mine.required.map((c) => c.name).sort()).toEqual([
      "Customer safety policy",
      "Food hygiene",
    ]);
    expect(mine.required.find((c) => c.courseId === policy)).toMatchObject({
      canConfirm: true,
      content: "Version one of the policy.",
      status: "due",
    });
    // External courses: no content, can't confirm.
    expect(mine.required.find((c) => c.courseId === cert)).toMatchObject({
      canConfirm: false,
      content: null,
    });
    expect(JSON.stringify(mine)).not.toContain("Colleague Provider");
    // Workers still have no management access.
    expect(await run(me, (tx, a) => tr.matrix(tx, a, TODAY))).toBeNull();
    expect(
      await run(me, (tx, a) => tr.personTraining(tx, a, myRecord, TODAY)),
    ).toBeNull();
  });

  it("confirming needs the tick and the current version, and is recorded as mine with the version", async () => {
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, policy, TODAY, { version: 1 }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, policy, TODAY, {
          acknowledge: true,
          version: 0,
        }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const { id } = ok(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, policy, TODAY, {
          acknowledge: true,
          version: "1",
        }),
      ),
    );
    const row = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT employee_id, method, course_version, self_completed, completed_on::text, expires_on::text, recorded_by
             FROM training_record WHERE id = $1`,
            [id],
          )
        ).rows[0],
    );
    expect(row).toMatchObject({
      employee_id: myRecord,
      method: "read_and_confirm",
      course_version: 1,
      self_completed: true,
      completed_on: TODAY,
      expires_on: "2027-10-20",
      recorded_by: me.ctx.userId,
    });
    expect((await auditFor(id)).map((e) => e.action)).toEqual([
      "training.self_confirmed",
    ]);
    const mine = (await run(me, (tx, a) => tr.myTraining(tx, a, TODAY)))!;
    expect(mine.required.find((c) => c.courseId === policy)).toMatchObject({
      status: "up_to_date",
      confirmedVersion: 1,
    });
    expect(mine.history[0]).toMatchObject({ selfCompleted: true });
  });

  it("an updated policy shows as changed since I confirmed it", async () => {
    ok(
      await run(owner, (tx, a) =>
        tr.saveCourse(tx, a, policy, {
          name: "Customer safety policy",
          category: "other",
          certificateExpected: false,
          validityMonths: 12,
          warnDays: 60,
          content: "Version two of the policy.",
        }),
      ),
    );
    const c = (await run(me, (tx, a) =>
      tr.myTraining(tx, a, TODAY),
    ))!.required.find((x) => x.courseId === policy)!;
    expect(c).toMatchObject({ contentVersion: 2, confirmedVersion: 1 });
    ok(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, policy, TODAY, {
          acknowledge: true,
          version: 2,
        }),
      ),
    );
  });

  it("can't self-complete external courses, courses that don't apply, or other organisations' courses", async () => {
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, cert, TODAY, {
          acknowledge: true,
          version: 1,
        }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, optional, TODAY, {
          acknowledge: true,
          version: 1,
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    const theirs = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO training_course (tenant_id, name, kind, completion_method, content)
             VALUES ($1, 'Theirs', 'internal', 'read_and_confirm', 'x') RETURNING id`,
            [B.tenantId],
          )
        ).rows[0]!.id,
    );
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, theirs, TODAY, {
          acknowledge: true,
          version: 1,
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Nor record or void anything as a manager would.
    expect(
      await run(me, (tx, a) =>
        tr.recordTraining(tx, a, myRecord, TODAY, {
          courseId: cert,
          completedOn: TODAY,
        }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const anyRecord = (await run(owner, (tx, a) =>
      tr.personTraining(tx, a, myRecord, TODAY),
    ))!.history[0]!.id;
    expect(
      await run(me, (tx, a) =>
        tr.voidRecord(tx, a, myRecord, anyRecord, "Mine"),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("archived courses and people who have left drop out", async () => {
    ok(await run(owner, (tx, a) => tr.archiveCourse(tx, a, cert)));
    const mine = (await run(me, (tx, a) => tr.myTraining(tx, a, TODAY)))!;
    expect(mine.required.map((c) => c.courseId)).not.toContain(cert);
    await admin((c) =>
      c.query(`UPDATE employee SET status = 'left' WHERE id = $1`, [myRecord]),
    );
    expect(await run(me, (tx, a) => tr.myTraining(tx, a, TODAY))).toBeNull();
    expect(
      await run(me, (tx, a) =>
        tr.confirmMyCourse(tx, a, policy, TODAY, {
          acknowledge: true,
          version: 2,
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
  });
});
