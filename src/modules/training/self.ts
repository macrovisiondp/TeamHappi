// "My training" (M8.2): a person's own training, reached through OWNERSHIP
// (the employee record linked to the signed-in member), never through a role.
//
// They see their own requirements, status and history, and can confirm
// in-house READ-AND-CONFIRM courses themselves. They can't record or verify
// external certificates or in-person training (D5), can't change records a
// manager made, and never see anyone else's training. A confirmation records
// the content version read; it isn't an exam, accreditation or qualification.

import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  addMonths,
  personUpToDate,
  requirementsFor,
  statusOf,
  type Actor,
  type CourseStatus,
  type RecordFacts,
  type Rule,
} from "./policy";
import type { Result } from "./service";

const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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
      jobTitle: true,
      status: true,
      startDate: true,
      primarySiteId: true,
    },
  });
  return e && e.status !== "left" ? e : null;
}

export interface MyCourse extends CourseStatus {
  courseId: string;
  name: string;
  description: string | null;
  kind: "internal" | "external";
  completionMethod: "read_and_confirm" | "in_person" | "external_certificate";
  /** Read-and-confirm content, only for courses they can confirm themselves. */
  content: string | null;
  contentVersion: number;
  /** The version of their latest confirmation, if they confirmed it themselves. */
  confirmedVersion: number | null;
  canConfirm: boolean;
}

export async function myTraining(tx: TenantTx, actor: Actor, today: string) {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const [courses, ruleRows, recordRows] = await Promise.all([
    tx.trainingCourse.findMany({
      where: { tenantId: actor.tenantId, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        kind: true,
        completionMethod: true,
        content: true,
        contentVersion: true,
        warnDays: true,
      },
    }),
    tx.trainingRequirement.findMany({
      where: { tenantId: actor.tenantId, archivedAt: null },
      select: {
        id: true,
        courseId: true,
        scope: true,
        siteId: true,
        jobTitle: true,
        employeeId: true,
        mandatory: true,
        dueDays: true,
        effectiveFrom: true,
      },
    }),
    tx.trainingRecord.findMany({
      where: { tenantId: actor.tenantId, employeeId: me.id },
      orderBy: [{ completedOn: "desc" }, { recordedAt: "desc" }],
      select: {
        id: true,
        courseId: true,
        courseVersion: true,
        method: true,
        completedOn: true,
        expiresOn: true,
        provider: true,
        selfCompleted: true,
        recordedAt: true,
        voidedAt: true,
      },
    }),
  ]);
  const rules: Rule[] = ruleRows.map((r) => ({
    ...r,
    effectiveFrom: isoOf(r.effectiveFrom)!,
  }));
  const reqs = new Map(
    requirementsFor(
      {
        id: me.id,
        primarySiteId: me.primarySiteId,
        jobTitle: me.jobTitle,
        startDate: isoOf(me.startDate),
        status: me.status,
      },
      rules,
      new Set(courses.map((c) => c.id)),
    ).map((r) => [r.courseId, r]),
  );
  const factsFor = (courseId: string): RecordFacts[] =>
    recordRows
      .filter((r) => r.courseId === courseId)
      .map((r) => ({
        id: r.id,
        courseId: r.courseId,
        completedOn: isoOf(r.completedOn)!,
        expiresOn: isoOf(r.expiresOn),
        recordedAt: r.recordedAt,
        voided: r.voidedAt !== null,
      }));
  // Only what's required or recommended for them appears as "to do".
  const required: MyCourse[] = courses
    .filter((c) => reqs.has(c.id))
    .map((c) => {
      const s = statusOf(reqs.get(c.id)!, factsFor(c.id), c.warnDays, today);
      const own = recordRows.find(
        (r) => r.courseId === c.id && !r.voidedAt && r.selfCompleted,
      );
      const canConfirm = c.completionMethod === "read_and_confirm";
      return {
        ...s,
        courseId: c.id,
        name: c.name,
        description: c.description,
        kind: c.kind,
        completionMethod: c.completionMethod,
        content: canConfirm ? c.content : null,
        contentVersion: c.contentVersion,
        confirmedVersion: own?.courseVersion ?? null,
        canConfirm,
      };
    })
    .sort(
      (a, b) =>
        Number(b.mandatory) - Number(a.mandatory) ||
        (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  const names = new Map(courses.map((c) => [c.id, c.name]));
  return {
    firstName: me.preferredName || me.givenName,
    upToDate: personUpToDate(required),
    required,
    // Their own history: valid records only (voided mistakes stay with managers).
    history: recordRows
      .filter((r) => !r.voidedAt)
      .map((r) => ({
        id: r.id,
        courseName: names.get(r.courseId) ?? "A course no longer offered",
        completedOn: isoOf(r.completedOn)!,
        expiresOn: isoOf(r.expiresOn),
        method: r.method,
        provider: r.provider,
        selfCompleted: r.selfCompleted,
      })),
  };
}

/**
 * The person confirms they've read an in-house course. Only read-and-confirm
 * courses that apply to them; the content version they read must still be
 * the current one (it may have changed while they were reading).
 */
export async function confirmMyCourse(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  today: string,
  raw: { acknowledge?: unknown; version?: unknown },
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me || !isUuid(courseId)) return notFound();
  const course = await tx.trainingCourse.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: courseId } },
    select: {
      id: true,
      completionMethod: true,
      contentVersion: true,
      validityMonths: true,
      archivedAt: true,
    },
  });
  if (!course || course.archivedAt) return notFound();
  const rules = await tx.trainingRequirement.findMany({
    where: { tenantId: actor.tenantId, courseId: course.id, archivedAt: null },
    select: {
      id: true,
      courseId: true,
      scope: true,
      siteId: true,
      jobTitle: true,
      employeeId: true,
      mandatory: true,
      dueDays: true,
      effectiveFrom: true,
    },
  });
  const applies =
    requirementsFor(
      {
        id: me.id,
        primarySiteId: me.primarySiteId,
        jobTitle: me.jobTitle,
        startDate: isoOf(me.startDate),
        status: me.status,
      },
      rules.map((r) => ({ ...r, effectiveFrom: isoOf(r.effectiveFrom)! })),
      new Set([course.id]),
    ).length > 0;
  // Courses that don't apply to them, or aren't read-and-confirm: not theirs to complete.
  if (!applies) return notFound();
  if (course.completionMethod !== "read_and_confirm")
    return {
      ok: false,
      code: "forbidden",
      message:
        "This course is recorded by your manager. Show them your certificate or tell them when it's done.",
    };
  if (raw.acknowledge !== true)
    return {
      ok: false,
      code: "invalid",
      message: "Tick the box to confirm you've read and understood it.",
      fieldErrors: {
        acknowledge: "Tick the box to confirm you've read and understood it.",
      },
    };
  if (Number(raw.version) !== course.contentVersion)
    return {
      ok: false,
      code: "conflict",
      message:
        "The content was updated while you were reading. Please read the new version.",
    };
  const expiresOn = course.validityMonths
    ? addMonths(today, course.validityMonths)
    : null;
  const created = await tx.trainingRecord.create({
    data: {
      tenantId: actor.tenantId,
      employeeId: me.id,
      courseId: course.id,
      courseVersion: course.contentVersion,
      method: "read_and_confirm",
      completedOn: new Date(`${today}T00:00:00Z`),
      expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00Z`) : null,
      selfCompleted: true,
      recordedBy: actor.userId,
    },
    select: { id: true },
  });
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action: "training.self_confirmed",
      targetType: "training_record",
      targetId: created.id,
      detail: {
        employeeId: me.id,
        courseId: course.id,
        courseVersion: course.contentVersion,
      },
    },
    select: { id: true },
  });
  return { ok: true, data: created };
}

function notFound(): Result {
  return {
    ok: false,
    code: "not_found",
    message: "That course couldn't be found.",
  };
}
