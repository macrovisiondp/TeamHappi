// "My onboarding" (M7.3): an employee's own view, reached through OWNERSHIP
// (the employee record linked to the signed-in member), never through a role.
//
// The employee sees only their own onboarding: the tasks that are theirs to
// do, the other tasks as progress only, and which documents to bring. Never
// right-to-work details, "cleared to start" (it depends on right to work),
// notes, exception reasons or anyone else's records.

import { isUuid, type TenantTx } from "@/lib/tenancy";

import { isOverdue, progressOf, type Actor } from "./policy";
import {
  audit,
  conflict,
  invalid,
  isoOf,
  notFound,
  type Result,
} from "./shared";

/** The signed-in member's own employee record, if linked and still employed. */
async function ownRecord(tx: TenantTx, actor: Actor) {
  const e = await tx.employee.findUnique({
    where: {
      tenantId_membershipId: {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
      },
    },
    select: {
      id: true,
      givenName: true,
      preferredName: true,
      status: true,
    },
  });
  return e && e.status !== "left" ? e : null;
}

/** Their current onboarding: the open one, else the latest signed off. */
async function ownCase(tx: TenantTx, actor: Actor, employeeId: string) {
  return tx.onboardingCase.findFirst({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      status: { in: ["active", "completed"] },
    },
    // "active" sorts before "completed" in the enum.
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      status: true,
      startDate: true,
      site: { select: { name: true } },
      tasks: {
        orderBy: [{ sortOrder: "asc" }],
        select: {
          id: true,
          title: true,
          guidance: true,
          category: true,
          ownerKind: true,
          required: true,
          dueOn: true,
          status: true,
          completedAt: true,
          onBehalf: true,
        },
      },
      documents: {
        where: { status: { not: "waived" } },
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, title: true, required: true, status: true },
      },
    },
  });
}

export async function myOnboarding(tx: TenantTx, actor: Actor, today: string) {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const c = await ownCase(tx, actor, me.id);
  if (!c)
    return { firstName: me.preferredName || me.givenName, onboarding: null };
  const facts = (t: (typeof c.tasks)[number]) => ({
    required: t.required,
    status: t.status,
    dueOn: isoOf(t.dueOn),
  });
  const mine = c.tasks.filter((t) => t.ownerKind === "employee");
  return {
    firstName: me.preferredName || me.givenName,
    onboarding: {
      id: c.id,
      status: c.status,
      startDate: isoOf(c.startDate)!,
      siteName: c.site?.name ?? null,
      // Everything, as progress only: they can see how far along it is.
      overall: progressOf(c.tasks.map(facts), today),
      myTasks: mine.map((t) => ({
        id: t.id,
        title: t.title,
        guidance: t.guidance,
        category: t.category,
        required: t.required,
        dueOn: isoOf(t.dueOn),
        overdue: isOverdue(facts(t), today),
        // An exception counts as finished; its reason stays with managers.
        done: t.status !== "to_do",
        byManager: t.status === "waived" || t.onBehalf,
        completedAt: t.completedAt,
      })),
      // Which documents to bring; nothing about who checked them or why.
      documents: c.documents.map((d) => ({
        id: d.id,
        title: d.title,
        required: d.required,
        needed: d.status === "requested" || d.status === "rejected",
      })),
    },
  };
}

/**
 * The employee completes one of their own tasks. Policy tasks need an
 * explicit acknowledgement ("I've read and understood this"); the policy text
 * they acknowledged is the task's guidance, copied when onboarding started.
 */
export async function completeMyTask(
  tx: TenantTx,
  actor: Actor,
  taskId: string,
  raw: { acknowledge?: unknown },
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me || !isUuid(taskId)) return notFound("task");
  const task = await tx.onboardingTask.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: taskId } },
    select: {
      id: true,
      caseId: true,
      ownerKind: true,
      category: true,
      status: true,
      case: { select: { employeeId: true, status: true } },
    },
  });
  // Someone else's task, a manager's task, or another organisation's: not found.
  if (!task || task.case.employeeId !== me.id || task.ownerKind !== "employee")
    return notFound("task");
  if (task.case.status !== "active")
    return conflict("This onboarding is closed.");
  if (task.status !== "to_do") return conflict("This task is already done.");
  const isPolicy = task.category === "policy";
  if (isPolicy && raw.acknowledge !== true)
    return invalid({
      acknowledge: "Tick the box to confirm you've read and understood it.",
    });
  const now = new Date();
  await tx.onboardingTask.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: task.id } },
    data: {
      status: "done",
      completedAt: now,
      completedBy: actor.userId,
      onBehalf: false,
      updatedAt: now,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    isPolicy ? "onboarding.policy_acknowledged" : "onboarding.task_completed",
    "onboarding_task",
    task.id,
    { caseId: task.caseId, byEmployee: true },
  );
  return { ok: true, data: { id: task.id } };
}
