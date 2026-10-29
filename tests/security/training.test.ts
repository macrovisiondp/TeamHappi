// M8.1 training, run as the real application role: course and rule
// management permissions, automatic recalculation (site moves, job-title
// changes, leaving, archived courses), overlapping rules, recording and
// correcting completions, site scope, tenant isolation, audit and posture.

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
  urls,
  withPg,
  type TenantFixture,
} from "../helpers/db";

type Ready = Extract<Workspace, { kind: "ready" }>;

let db: DbClient;
let A: TenantFixture;
let B: TenantFixture;
let owner: Ready;
let hr: Ready;
let siteManager: Ready; // A's first site only
let worker: Ready;
let otherOwner: Ready;
let site2: string;
let bartender: string; // at A's site
let chef: string; // at site2
const TODAY = "2026-10-20";

const user = (userId: string) => ({
  userId,
  name: "U",
  email: "u@example.test",
});
async function ready(userId: string) {
  const w = await resolveWorkspace(db, user(userId), undefined);
  if (w.kind !== "ready") throw new Error(`expected ready, got ${w.kind}`);
  return w;
}
const actorOf = (w: Ready): tr.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: tr.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));
const ok = <T>(r: tr.Result<T>) => {
  if (!r.ok)
    throw new Error(
      `${r.code}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`,
    );
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
async function employee(
  number: string,
  siteId: string,
  jobTitle: string,
  start: string | null,
) {
  return admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, job_title, start_date, status)
           VALUES ($1, $2, 'Ari', $2, $3, $4, $5, 'active') RETURNING id`,
          [A.tenantId, number, siteId, jobTitle, start],
        )
      ).rows[0]!.id,
  );
}
const setEmployee = (
  id: string,
  col: "primary_site_id" | "job_title" | "status",
  v: string,
) =>
  admin((c) =>
    c.query(`UPDATE employee SET ${col} = $1 WHERE id = $2`, [v, id]),
  );
const auditFor = (targetId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1 ORDER BY occurred_at`,
          [targetId],
        )
      ).rows,
  );
const course = (w: Ready, name: string, extra: Record<string, unknown> = {}) =>
  run(w, (tx, a) =>
    tr.saveCourse(tx, a, null, {
      name,
      category: "other",
      kind: "internal",
      completionMethod: "in_person",
      certificateExpected: false,
      validityMonths: "",
      warnDays: 60,
      ...extra,
    }),
  );
const rule = (w: Ready, courseId: string, raw: Record<string, unknown>) =>
  run(w, (tx, a) =>
    tr.saveRule(tx, a, courseId, null, {
      mandatory: true,
      dueDays: 14,
      ...raw,
    }),
  );
const personOf = (w: Ready, id: string) =>
  run(w, (tx, a) => tr.personTraining(tx, a, id, TODAY));

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "tango");
  B = await createTenantFixture(db, "uniform");
  owner = await ready(A.ownerUserId);
  hr = await ready(await member(A.tenantId, "hr_manager"));
  siteManager = await ready(await member(A.tenantId, "site_manager", A.siteId));
  worker = await ready(await member(A.tenantId, "worker"));
  otherOwner = await ready(B.ownerUserId);
  site2 = await admin(
    async (c) =>
      (
        await c.query<{ id: string }>(
          `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'T2', 'tango North') RETURNING id`,
          [A.tenantId],
        )
      ).rows[0]!.id,
  );
  bartender = await employee("E-T1", A.siteId, "Bartender", "2026-11-01");
  chef = await employee("E-T2", site2, "Chef", "2020-01-01");
});

afterAll(async () => {
  await db.$disconnect();
});

describe("courses", () => {
  it("only owners, admins and HR manage the catalogue", async () => {
    expect(await course(siteManager, "SM course")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await run(worker, (tx, a) => tr.listCourses(tx, a))).toBeNull();
    ok(await course(hr, "HR course"));
    expect(await run(otherOwner, (tx, a) => tr.listCourses(tx, a))).toEqual([]);
  });

  it("validates type and content, refuses duplicates, fixes the type and versions content", async () => {
    expect(
      await course(owner, "Mismatch", {
        kind: "external",
        completionMethod: "in_person",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { completionMethod: expect.any(String) },
    });
    expect(
      await course(owner, "No content", {
        completionMethod: "read_and_confirm",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { content: expect.any(String) },
    });
    expect(await course(owner, "hr COURSE")).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String) },
    });
    const { id } = ok(
      await course(owner, "Policy read", {
        completionMethod: "read_and_confirm",
        content: "v1",
      }),
    );
    // Changing the type is ignored; changing content makes version 2.
    ok(
      await run(owner, (tx, a) =>
        tr.saveCourse(tx, a, id, {
          name: "Policy read",
          category: "safeguarding",
          kind: "external",
          completionMethod: "external_certificate",
          certificateExpected: false,
          validityMonths: 12,
          warnDays: 30,
          content: "v2",
        }),
      ),
    );
    const c = (await run(owner, (tx, a) => tr.getCourse(tx, a, id)))!;
    expect(c).toMatchObject({
      kind: "internal",
      completionMethod: "read_and_confirm",
      content: "v2",
      contentVersion: 2,
      validityMonths: 12,
      category: "safeguarding",
    });
    // Another organisation's course id: not found.
    expect(
      await run(otherOwner, (tx, a) => tr.getCourse(tx, a, id)),
    ).toBeNull();
  });

  it("adds the suggested courses once, with no rules", async () => {
    const first = ok(
      await run(owner, (tx, a) => tr.addSuggestedCourses(tx, a)),
    );
    expect(first.added).toBe(tr.SUGGESTED_COURSES.length);
    expect(
      ok(await run(owner, (tx, a) => tr.addSuggestedCourses(tx, a))).added,
    ).toBe(0);
    const list = (await run(owner, (tx, a) => tr.listCourses(tx, a)))!;
    expect(list.filter((c) => c.isSuggested).every((c) => c.rules === 0)).toBe(
      true,
    );
  });
});

describe("rules and automatic requirements", () => {
  let food: string;
  let licence: string;

  beforeAll(async () => {
    food = ok(
      await course(owner, "Food hygiene", {
        kind: "external",
        completionMethod: "external_certificate",
        validityMonths: 36,
      }),
    ).id;
    licence = ok(
      await course(owner, "Licence awareness", {
        kind: "external",
        completionMethod: "external_certificate",
      }),
    ).id;
  });

  it("refuses other organisations' sites and people, people who have left, and duplicate targets", async () => {
    expect(
      await rule(owner, food, { scope: "site", siteId: B.siteId }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { siteId: expect.any(String) },
    });
    expect(
      await rule(owner, food, { scope: "employee", employeeId: B.employeeId }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { employeeId: expect.any(String) },
    });
    expect(
      await rule(siteManager, food, { scope: "organisation" }),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    ok(await rule(owner, food, { scope: "site", siteId: A.siteId }));
    expect(
      await rule(owner, food, { scope: "site", siteId: A.siteId }),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("overlapping rules make one requirement: mandatory if any, earliest due date", async () => {
    ok(
      await rule(owner, food, {
        scope: "job_title",
        jobTitle: "bartender",
        dueDays: 7,
      }),
    );
    ok(
      await rule(owner, food, {
        scope: "employee",
        employeeId: bartender,
        mandatory: false,
        dueDays: 0,
      }),
    );
    const p = (await personOf(owner, bartender))!;
    const f = p.required.filter((r) => r.courseId === food);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      mandatory: true,
      status: "due",
      dueOn: "2026-11-08",
    });
  });

  it("recalculates when someone moves site or changes job title, and drops people who leave", async () => {
    ok(await rule(owner, licence, { scope: "job_title", jobTitle: "Chef" }));
    const need = async (id: string) =>
      (await personOf(owner, id))!.required.map((r) => r.courseId);
    expect(await need(chef)).toEqual([licence]); // site2, Chef
    expect(await need(chef)).not.toContain(food);
    await setEmployee(chef, "primary_site_id", A.siteId); // moves to the food-rule site
    expect(await need(chef)).toEqual(expect.arrayContaining([food, licence]));
    await setEmployee(chef, "job_title", "Porter");
    expect(await need(chef)).toEqual([food]);
    // Existing staff (started 2020): due from the rule's date, not their start.
    const f = (await personOf(owner, chef))!.required[0]!;
    expect(f.dueOn! > "2026-01-01").toBe(true);
    await setEmployee(chef, "status", "left");
    expect(await need(chef)).toEqual([]);
    const m = (await run(owner, (tx, a) => tr.matrix(tx, a, TODAY)))!;
    expect(m.rows.map((r) => r.id)).not.toContain(chef);
    await setEmployee(chef, "status", "active");
    await setEmployee(chef, "primary_site_id", site2);
    await setEmployee(chef, "job_title", "Chef");
  });

  it("editing a rule changes strength and due days only; removing it stops the requirement", async () => {
    const c = (await run(owner, (tx, a) => tr.getCourse(tx, a, licence)))!;
    const r = c.rules[0]!;
    ok(
      await run(owner, (tx, a) =>
        tr.saveRule(tx, a, licence, r.id, { mandatory: false, dueDays: 3 }),
      ),
    );
    expect((await personOf(owner, chef))!.required[0]).toMatchObject({
      mandatory: false,
    });
    ok(await run(owner, (tx, a) => tr.archiveRule(tx, a, licence, r.id)));
    expect((await personOf(owner, chef))!.required).toEqual([]);
    expect((await auditFor(r.id)).map((e) => e.action)).toEqual([
      "training.rule_added",
      "training.rule_updated",
      "training.rule_removed",
    ]);
  });
});

describe("recording and correcting completions (D5)", () => {
  let food: string;

  beforeAll(async () => {
    food = (await run(owner, (tx, a) => tr.listCourses(tx, a)))!.find(
      (c) => c.name === "Food hygiene",
    )!.id;
  });

  it("site managers record for their sites only; workers and other organisations can't", async () => {
    const raw = {
      courseId: food,
      completedOn: "2026-10-01",
      provider: "Acme Training",
      reference: "CERT-778",
    };
    expect(
      await run(siteManager, (tx, a) =>
        tr.recordTraining(tx, a, chef, TODAY, raw),
      ),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    }); // chef is at site2
    expect(
      await run(worker, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, raw),
      ),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(
      await run(otherOwner, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, raw),
      ),
    ).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await run(siteManager, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, {
          ...raw,
          completedOn: "2026-10-21",
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { completedOn: expect.any(String) },
    });
    const { id } = ok(
      await run(siteManager, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, raw),
      ),
    );
    const p = (await personOf(siteManager, bartender))!;
    expect(p.required.find((r) => r.courseId === food)).toMatchObject({
      status: "up_to_date",
      expiresOn: "2029-10-01", // 36 months from the course
    });
    expect(p.history[0]).toMatchObject({
      method: "external_certificate",
      provider: "Acme Training",
    });
    // The audit trail has ids only: no provider or certificate reference.
    const events = await auditFor(id);
    expect(events.map((e) => e.action)).toEqual(["training.record_added"]);
    expect(events[0]!.detail).not.toMatch(/Acme|CERT-778/);
    // Site managers see only their sites' people.
    expect(await personOf(siteManager, chef)).toBeNull();
    const m = (await run(siteManager, (tx, a) => tr.matrix(tx, a, TODAY)))!;
    expect(m.rows.map((r) => r.id)).toEqual(
      expect.arrayContaining([bartender]),
    );
    expect(m.rows.map((r) => r.id)).not.toContain(chef);
  });

  it("a correction voids the old record with a reason and keeps both in the history", async () => {
    const p = (await personOf(owner, bartender))!;
    const old = p.history.find((h) => h.courseId === food && !h.voided)!;
    expect(
      await run(owner, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, {
          courseId: food,
          completedOn: "2026-09-30",
          replacesId: old.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { voidReason: expect.any(String) },
    });
    const { id } = ok(
      await run(owner, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, {
          courseId: food,
          completedOn: "2026-09-30",
          expiresOn: "2026-11-30",
          replacesId: old.id,
          voidReason: "Wrong date entered",
        }),
      ),
    );
    const after = (await personOf(owner, bartender))!;
    expect(after.history.find((h) => h.id === old.id)!.voided).toMatchObject({
      reason: "Wrong date entered",
    });
    expect(after.history.find((h) => h.id === id)).toMatchObject({
      replacesId: old.id,
      voided: null,
    });
    expect(after.required.find((r) => r.courseId === food)!.status).toBe(
      "expiring",
    );
    // It can't be corrected twice, or voided again.
    expect(
      await run(owner, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, {
          courseId: food,
          completedOn: "2026-09-30",
          replacesId: old.id,
          voidReason: "Again",
        }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      await run(owner, (tx, a) =>
        tr.voidRecord(tx, a, bartender, old.id, "Again"),
      ),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    // Voiding the replacement leaves nothing valid: the requirement is due again.
    ok(
      await run(owner, (tx, a) =>
        tr.voidRecord(tx, a, bartender, id, "Recorded for the wrong person"),
      ),
    );
    expect(
      (await personOf(owner, bartender))!.required.find(
        (r) => r.courseId === food,
      )!.status,
    ).toBe("due");
    expect((await auditFor(old.id)).map((e) => e.action)).toEqual([
      "training.record_added",
      "training.record_voided",
    ]);
  });

  it("archiving a course takes it out of requirements and the matrix, keeping history", async () => {
    ok(await run(owner, (tx, a) => tr.archiveCourse(tx, a, food)));
    const p = (await personOf(owner, bartender))!;
    expect(p.required.map((r) => r.courseId)).not.toContain(food);
    expect(p.history.some((h) => h.courseId === food)).toBe(true);
    const m = (await run(owner, (tx, a) => tr.matrix(tx, a, TODAY)))!;
    expect(m.courses.map((c) => c.id)).not.toContain(food);
    expect(
      await run(owner, (tx, a) =>
        tr.recordTraining(tx, a, bartender, TODAY, {
          courseId: food,
          completedOn: TODAY,
        }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { courseId: expect.any(String) },
    });
  });
});

describe("the database itself", () => {
  it("has no DELETE, protects record facts, and voids once for every role", async () => {
    await withPg(urls.appUrl, async (c) => {
      for (const t of [
        "training_course",
        "training_requirement",
        "training_record",
      ])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(`UPDATE training_record SET completed_on = now()`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE training_course SET kind = 'external'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE training_requirement SET site_id = NULL`),
      ).rejects.toThrow(/permission denied/);
      for (const t of [
        "training_course",
        "training_requirement",
        "training_record",
      ])
        expect((await c.query(`SELECT 1 FROM ${t}`)).rows, t).toEqual([]);
    });
    const voided = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id FROM training_record WHERE voided_at IS NOT NULL LIMIT 1`,
          )
        ).rows[0]!.id,
    );
    await expect(
      admin((c) =>
        c.query(
          `UPDATE training_record SET voided_at = NULL, voided_by = NULL, void_reason = NULL WHERE id = $1`,
          [voided],
        ),
      ),
    ).rejects.toThrow(/voided record can't change/);
    const live = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO training_record (tenant_id, employee_id, course_id, course_version, method, completed_on, recorded_by)
           SELECT tenant_id, $1, id, 1, 'in_person', '2026-10-01', $2 FROM training_course WHERE tenant_id = $3 LIMIT 1 RETURNING id`,
            [bartender, A.ownerUserId, A.tenantId],
          )
        ).rows[0]!.id,
    );
    await expect(
      admin((c) =>
        c.query(
          `UPDATE training_record SET completed_on = '2020-01-01' WHERE id = $1`,
          [live],
        ),
      ),
    ).rejects.toThrow(/only a void can change/);
    await expect(
      admin((c) =>
        c.query(`DELETE FROM training_record WHERE id = $1`, [live]),
      ),
    ).rejects.toThrow(/append-only/);
    // A rule can't point at another organisation's site.
    await expect(
      admin((c) =>
        c.query(
          `INSERT INTO training_requirement (tenant_id, course_id, scope, site_id)
           SELECT tenant_id, id, 'site', $1 FROM training_course WHERE tenant_id = $2 LIMIT 1`,
          [B.siteId, A.tenantId],
        ),
      ),
    ).rejects.toThrow(/training_requirement_site_fkey/);
  });

  it("built-in roles have exactly the training permissions in the code", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ key: string; perms: string }>(
            `SELECT r.key, string_agg(rp.permission_code, ',' ORDER BY rp.permission_code) AS perms
             FROM role r JOIN role_permission rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
             WHERE r.tenant_id = $1 AND rp.permission_code LIKE 'training.%' GROUP BY r.key ORDER BY r.key`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(rows).toEqual([
      { key: "admin", perms: "training.manage,training.record,training.view" },
      {
        key: "hr_manager",
        perms: "training.manage,training.record,training.view",
      },
      { key: "owner", perms: "training.manage,training.record,training.view" },
      { key: "site_manager", perms: "training.record,training.view" },
    ]);
  });
});
