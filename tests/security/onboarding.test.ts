// M7.1 onboarding, run as the real application role: permissions and site
// scope, tenant isolation, template snapshots, task completion and
// exceptions, readiness versus final sign-off, audit, and database posture.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbClient } from "@/lib/db/create-client";
import { withTenant, type TenantTx } from "@/lib/tenancy";
import { resolveWorkspace, type Workspace } from "@/lib/workspace/resolve";
import * as ob from "@/modules/onboarding";

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
let otherOwner: Ready; // organisation B
let site2: string; // A's second site
let employee2: string; // at site2
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
const actorOf = (w: Ready): ob.Actor => ({
  tenantId: w.tenant.id,
  userId: w.ctx.userId!,
  membershipId: w.membershipId,
  grants: w.grants,
});
const run = <T>(w: Ready, fn: (tx: TenantTx, a: ob.Actor) => Promise<T>) =>
  withTenant(db, w.ctx, (tx) => fn(tx, actorOf(w)));

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

const ok = <T>(r: ob.Result<T>) => {
  if (!r.ok)
    throw new Error(
      `${r.code}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`,
    );
  return r.data;
};

async function template(
  w: Ready,
  name: string,
  tasks: {
    title: string;
    required: boolean;
    ownerKind?: string;
    due?: number;
  }[],
) {
  const { id } = ok(
    await run(w, (tx, a) =>
      ob.saveTemplate(tx, a, null, { name, scope: "organisation" }),
    ),
  );
  for (const t of tasks)
    ok(
      await run(w, (tx, a) =>
        ob.saveTemplateTask(tx, a, id, null, {
          title: t.title,
          category: "task",
          ownerKind: t.ownerKind ?? "manager",
          dueOffsetDays: t.due ?? 0,
          required: t.required,
        }),
      ),
    );
  return id;
}

const auditActions = (targetId: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ action: string; detail: string }>(
          `SELECT action, detail::text AS detail FROM audit_event WHERE target_id = $1 ORDER BY occurred_at`,
          [targetId],
        )
      ).rows,
  );

beforeAll(async () => {
  db = appDb();
  A = await createTenantFixture(db, "november");
  B = await createTenantFixture(db, "oscar");
  owner = await ready(A.ownerUserId);
  hr = await ready(await member(A.tenantId, "hr_manager"));
  siteManager = await ready(await member(A.tenantId, "site_manager", A.siteId));
  worker = await ready(await member(A.tenantId, "worker"));
  otherOwner = await ready(B.ownerUserId);
  [site2, employee2] = await admin(async (c) => {
    const s = await c.query<{ id: string }>(
      `INSERT INTO site (tenant_id, code, name) VALUES ($1, 'S2', 'november North') RETURNING id`,
      [A.tenantId],
    );
    const e = await c.query<{ id: string }>(
      `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
       VALUES ($1, 'E-N2', 'Noor', 'North', $2, 'pending') RETURNING id`,
      [A.tenantId, s.rows[0]!.id],
    );
    return [s.rows[0]!.id, e.rows[0]!.id];
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("templates", () => {
  it("only owners, admins and HR manage templates", async () => {
    expect(
      await run(siteManager, (tx, a) =>
        ob.saveTemplate(tx, a, null, { name: "X", scope: "organisation" }),
      ),
    ).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await run(worker, (tx, a) => ob.listTemplates(tx, a))).toBeNull();
    ok(
      await run(hr, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "HR made",
          scope: "organisation",
        }),
      ),
    );
  });

  it("validates scope targets and rejects another organisation's site", async () => {
    expect(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, { name: "Site t", scope: "site" }),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid",
      fieldErrors: { siteId: expect.any(String) },
    });
    expect(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "Site t",
          scope: "site",
          siteId: B.siteId,
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    // Task due offsets are limited to 90 days before and 365 days after the start.
    const { id } = ok(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "Offset limits",
          scope: "organisation",
        }),
      ),
    );
    for (const dueOffsetDays of [-91, 366, 1.5])
      expect(
        await run(owner, (tx, a) =>
          ob.saveTemplateTask(tx, a, id, null, {
            title: "T",
            category: "task",
            ownerKind: "manager",
            dueOffsetDays,
            required: true,
          }),
        ),
        String(dueOffsetDays),
      ).toMatchObject({ ok: false, code: "invalid" });
    // A duplicate active name is refused.
    expect(
      await run(owner, (tx, a) =>
        ob.saveTemplate(tx, a, null, {
          name: "offset LIMITS",
          scope: "organisation",
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid",
      fieldErrors: { name: expect.any(String) },
    });
  });

  it("adds the suggested templates once, labelled as suggested", async () => {
    const first = ok(
      await run(owner, (tx, a) => ob.addSuggestedTemplates(tx, a)),
    );
    expect(first.added).toBe(ob.SUGGESTED_TEMPLATES.length);
    expect(
      ok(await run(owner, (tx, a) => ob.addSuggestedTemplates(tx, a))).added,
    ).toBe(0);
    const list = (await run(owner, (tx, a) => ob.listTemplates(tx, a)))!;
    expect(list.filter((t) => t.isSuggested)).toHaveLength(
      ob.SUGGESTED_TEMPLATES.length,
    );
    expect(
      await run(siteManager, (tx, a) => ob.addSuggestedTemplates(tx, a)),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("starting onboarding (snapshots)", () => {
  it("copies the template's tasks with due dates; later template edits don't change it", async () => {
    const tid = await template(owner, "Snapshot test", [
      { title: "Contract", required: true, due: -2 },
      { title: "Uniform", required: false, due: 3 },
      { title: "Read handbook", required: true, ownerKind: "employee", due: 1 },
    ]);
    const { id: caseId } = ok(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: A.employeeId,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    );
    const before = (await run(owner, (tx, a) =>
      ob.getCase(tx, a, caseId, TODAY),
    ))!;
    expect(before.tasks.map((t) => [t.title, t.dueOn, t.required])).toEqual([
      ["Contract", "2026-10-18", true],
      ["Uniform", "2026-10-23", false],
      ["Read handbook", "2026-10-21", true],
    ]);
    // Manager tasks go to the owner of the case; employee tasks to nobody yet.
    expect(before.tasks[0]!.assigneeMembershipId).toBe(owner.membershipId);
    expect(before.tasks[2]!.assigneeMembershipId).toBeNull();

    const t = (await run(owner, (tx, a) => ob.getTemplate(tx, a, tid)))!;
    ok(
      await run(owner, (tx, a) =>
        ob.saveTemplateTask(tx, a, tid, t.tasks[0]!.id, {
          title: "Contract v2",
          category: "document",
          ownerKind: "hr",
          dueOffsetDays: 0,
          required: true,
        }),
      ),
    );
    ok(
      await run(owner, (tx, a) =>
        ob.saveTemplateTask(tx, a, tid, null, {
          title: "New task",
          category: "task",
          ownerKind: "manager",
          dueOffsetDays: 0,
          required: true,
        }),
      ),
    );
    const after = (await run(owner, (tx, a) =>
      ob.getCase(tx, a, caseId, TODAY),
    ))!;
    expect(after.tasks.map((x) => x.title)).toEqual([
      "Contract",
      "Uniform",
      "Read handbook",
    ]);
    expect(after.templateVersion).toBe(before.templateVersion);
    expect(
      (await run(owner, (tx, a) => ob.getTemplate(tx, a, tid)))!.version,
    ).toBe(before.templateVersion + 2);
    expect((await auditActions(caseId)).map((e) => e.action)).toEqual([
      "onboarding.case_started",
    ]);
  });

  it("allows one open onboarding per person, and refuses people who have left", async () => {
    const tid = await template(owner, "Once only", [
      { title: "One", required: true },
    ]);
    expect(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: A.employeeId,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    const left = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, status) VALUES ($1, 'E-L', 'Lee', 'Left', 'left') RETURNING id`,
            [A.tenantId],
          )
        ).rows[0]!.id,
    );
    expect(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: left,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: left,
          templateId: tid,
          startDate: "2026-02-30",
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });
});

describe("site scope and isolation", () => {
  let site2Case: string;

  it("a site manager works only on their own site's people", async () => {
    const tid = await template(owner, "Site scope", [
      { title: "Walk-round", required: true },
    ]);
    // employee2 is at site2, outside the site manager's scope: looks like nothing.
    expect(
      await run(siteManager, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee2,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    site2Case = ok(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee2,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    ).id;
    // The owner's site filter shows exactly that site's onboarding.
    const filtered = (await run(owner, (tx, a) =>
      ob.dashboard(tx, a, TODAY, { siteId: site2 }),
    ))!;
    expect(filtered.cases.map((c) => c.id)).toEqual([site2Case]);
    expect(
      await run(siteManager, (tx, a) => ob.getCase(tx, a, site2Case, TODAY)),
    ).toBeNull();
    const dash = (await run(siteManager, (tx, a) =>
      ob.dashboard(tx, a, TODAY),
    ))!;
    expect(dash.cases.map((c) => c.id)).not.toContain(site2Case);
    expect(dash.cases.every((c) => c.siteName === "november Central")).toBe(
      true,
    );
    const options = (await run(siteManager, (tx, a) =>
      ob.startOptions(tx, a),
    ))!;
    expect(options.employees.map((e) => e.id)).not.toContain(employee2);
  });

  it("workers and recruiters see no onboarding", async () => {
    expect(await run(worker, (tx, a) => ob.dashboard(tx, a, TODAY))).toBeNull();
    expect(
      await run(worker, (tx, a) => ob.getCase(tx, a, site2Case, TODAY)),
    ).toBeNull();
    expect(await run(worker, (tx, a) => ob.startOptions(tx, a))).toBeNull();
  });

  it("another organisation can't see, change or link to any of it", async () => {
    expect(
      await run(otherOwner, (tx, a) => ob.getCase(tx, a, site2Case, TODAY)),
    ).toBeNull();
    expect(
      (await run(otherOwner, (tx, a) => ob.dashboard(tx, a, TODAY)))!.cases,
    ).toEqual([]);
    const ownCase = (await run(owner, (tx, a) =>
      ob.getCase(tx, a, site2Case, TODAY),
    ))!;
    expect(
      await run(otherOwner, (tx, a) =>
        ob.updateTask(tx, a, site2Case, ownCase.tasks[0]!.id, {
          kind: "complete",
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(otherOwner, (tx, a) =>
        ob.signOffCase(tx, a, site2Case, TODAY, ""),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    const theirTemplate = await template(otherOwner, "Oscar template", [
      { title: "T", required: true },
    ]);
    // A's employee with B's session, and B's template in A's organisation, are both refused.
    expect(
      await run(otherOwner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee2,
          templateId: theirTemplate,
          startDate: TODAY,
        }),
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee2,
          templateId: theirTemplate,
          startDate: TODAY,
        }),
      ),
    ).toMatchObject({ ok: false });
    // A's templates are invisible to B, even by id.
    const aTemplates = (await run(owner, (tx, a) => ob.listTemplates(tx, a)))!;
    expect(
      await run(otherOwner, (tx, a) =>
        ob.getTemplate(tx, a, aTemplates[0]!.id),
      ),
    ).toBeNull();
    const bNames = (await run(otherOwner, (tx, a) =>
      ob.listTemplates(tx, a),
    ))!.map((t) => t.name);
    expect(bNames).toEqual(["Oscar template"]);
  });
});

describe("tasks, exceptions, readiness and final sign-off", () => {
  let caseId: string;
  let tasks: { id: string; title: string; required: boolean }[];
  let employee3: string;

  beforeAll(async () => {
    employee3 = await admin(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employee (tenant_id, employee_number, given_name, family_name, primary_site_id, status)
             VALUES ($1, 'E-N3', 'Tam', 'Tester', $2, 'pending') RETURNING id`,
            [A.tenantId, A.siteId],
          )
        ).rows[0]!.id,
    );
    const tid = await template(owner, "Sign-off flow", [
      { title: "Required A", required: true, due: -1 },
      { title: "Required B", required: true },
      { title: "Optional C", required: false },
      { title: "Employee D", required: true, ownerKind: "employee" },
    ]);
    caseId = ok(
      await run(siteManager, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee3,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    ).id;
    tasks = (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!
      .tasks;
  });

  const task = (title: string) => tasks.find((t) => t.title === title)!.id;

  it("site managers complete tasks; employee tasks are recorded as done on their behalf", async () => {
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required A"), { kind: "complete" }),
      ),
    );
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Employee D"), { kind: "complete" }),
      ),
    );
    const c = (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!;
    expect(c.tasks.find((t) => t.title === "Employee D")).toMatchObject({
      status: "done",
      onBehalf: true,
    });
    expect(c.tasks.find((t) => t.title === "Required A")).toMatchObject({
      status: "done",
      onBehalf: false,
    });
    expect(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required A"), { kind: "complete" }),
      ),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(
      (await auditActions(task("Required A"))).map((e) => e.action),
    ).toEqual(["onboarding.task_completed"]);
  });

  it("exceptions: optional by managers, required only by owner/admin/HR, always with a reason", async () => {
    expect(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required B"), {
          kind: "waive",
          reason: "Not needed",
        }),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await run(hr, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required B"), {
          kind: "waive",
          reason: "",
        }),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid",
    });
    ok(
      await run(siteManager, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Optional C"), {
          kind: "waive",
          reason: "Brings own uniform",
        }),
      ),
    );
    const events = await auditActions(task("Optional C"));
    expect(events.map((e) => e.action)).toEqual(["onboarding.task_waived"]);
    expect(events[0]!.detail).not.toContain("Brings own uniform"); // free text stays off the audit trail
  });

  it("final sign-off waits for readiness, needs an authorised role, and isn't for your own record", async () => {
    expect(
      await run(owner, (tx, a) => ob.signOffCase(tx, a, caseId, TODAY, "")),
    ).toMatchObject({
      ok: false,
      code: "conflict",
      message: "1 required task is still open.",
    });
    ok(
      await run(hr, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required B"), {
          kind: "waive",
          reason: "Agreed with owner",
        }),
      ),
    );
    const c = (await run(owner, (tx, a) => ob.getCase(tx, a, caseId, TODAY)))!;
    expect(c.progress.operationallyReady).toBe(true);
    expect(c.status).toBe("active"); // readiness is not sign-off
    expect(
      await run(siteManager, (tx, a) =>
        ob.signOffCase(tx, a, caseId, TODAY, ""),
      ),
    ).toMatchObject({ ok: false, code: "forbidden" });
    // An HR manager whose own employee record this is can't sign it off.
    await admin((c2) =>
      c2.query(`UPDATE employee SET membership_id = $1 WHERE id = $2`, [
        hr.membershipId,
        employee3,
      ]),
    );
    expect(
      await run(hr, (tx, a) => ob.signOffCase(tx, a, caseId, TODAY, "")),
    ).toMatchObject({ ok: false, code: "conflict" });
    ok(
      await run(owner, (tx, a) =>
        ob.signOffCase(tx, a, caseId, TODAY, "All good"),
      ),
    );
    const done = (await run(owner, (tx, a) =>
      ob.getCase(tx, a, caseId, TODAY),
    ))!;
    expect(done.status).toBe("completed");
    expect(done.signedOff).toMatchObject({ note: "All good" });
    expect((await auditActions(caseId)).map((e) => e.action)).toContain(
      "onboarding.case_signed_off",
    );
    // Closed onboarding can't be changed.
    expect(
      await run(owner, (tx, a) =>
        ob.updateTask(tx, a, caseId, task("Required A"), { kind: "reopen" }),
      ),
    ).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("cancelling needs a reason and is audited", async () => {
    const tid = await template(owner, "Cancel flow", [
      { title: "One", required: true },
    ]);
    const { id } = ok(
      await run(owner, (tx, a) =>
        ob.startCase(tx, a, {
          employeeId: employee3,
          templateId: tid,
          startDate: TODAY,
        }),
      ),
    );
    expect(
      await run(owner, (tx, a) => ob.cancelCase(tx, a, id, "")),
    ).toMatchObject({ ok: false, code: "invalid" });
    ok(await run(owner, (tx, a) => ob.cancelCase(tx, a, id, "Didn't start")));
    expect((await auditActions(id)).map((e) => e.action)).toEqual([
      "onboarding.case_started",
      "onboarding.case_cancelled",
    ]);
  });
});

describe("the database itself", () => {
  it("has no DELETE for the app and protects copied content and case identity", async () => {
    const caseRow = await admin(
      async (c) =>
        (
          await c.query(
            `SELECT id FROM onboarding_case WHERE tenant_id = $1 LIMIT 1`,
            [A.tenantId],
          )
        ).rows[0],
    );
    await withPg(urls.appUrl, async (c) => {
      for (const t of [
        "onboarding_template",
        "onboarding_template_task",
        "onboarding_case",
        "onboarding_task",
      ])
        await expect(c.query(`DELETE FROM ${t}`), t).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(`UPDATE onboarding_case SET employee_id = gen_random_uuid()`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE onboarding_case SET start_date = now()`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE onboarding_task SET title = 'x'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE onboarding_task SET required = false`),
      ).rejects.toThrow(/permission denied/);
      // Without an organisation context, nothing is visible.
      for (const t of [
        "onboarding_template",
        "onboarding_case",
        "onboarding_task",
      ])
        expect((await c.query(`SELECT 1 FROM ${t}`)).rows, t).toEqual([]);
    });
    // Status rules hold even for the database owner.
    await expect(
      admin((c) =>
        c.query(
          `UPDATE onboarding_case SET status = 'completed' WHERE id = $1`,
          [caseRow.id],
        ),
      ),
    ).rejects.toThrow(/onboarding_case_completed_consistent/);
    await expect(
      admin((c) =>
        c.query(
          `UPDATE onboarding_task SET status = 'waived', completed_at = now(), completed_by = gen_random_uuid() WHERE case_id = $1`,
          [caseRow.id],
        ),
      ),
    ).rejects.toThrow(/onboarding_task_status_consistent/);
  });

  it("the permission catalogue and every built-in role match the code", async () => {
    const rows = await admin(
      async (c) =>
        (
          await c.query<{ key: string; perms: string }>(
            `SELECT r.key, string_agg(rp.permission_code, ',' ORDER BY rp.permission_code) AS perms
             FROM role r JOIN role_permission rp ON rp.tenant_id = r.tenant_id AND rp.role_id = r.id
             WHERE r.tenant_id = $1 AND rp.permission_code LIKE 'onboarding.%' GROUP BY r.key ORDER BY r.key`,
            [A.tenantId],
          )
        ).rows,
    );
    expect(rows).toEqual([
      {
        key: "admin",
        perms:
          "onboarding.manage,onboarding.signoff,onboarding.template.manage,onboarding.view",
      },
      {
        key: "hr_manager",
        perms:
          "onboarding.manage,onboarding.signoff,onboarding.template.manage,onboarding.view",
      },
      {
        key: "owner",
        perms:
          "onboarding.manage,onboarding.signoff,onboarding.template.manage,onboarding.view",
      },
      { key: "site_manager", perms: "onboarding.manage,onboarding.view" },
    ]);
  });
});
