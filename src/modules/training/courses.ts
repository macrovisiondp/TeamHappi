// Interactive courses (M15, docs/architecture/m15-training-courses.md).
//
// - Import (training.manage): course files are validated strictly, then stored
//   as a new course or a new version of the course with the same code.
// - Learning (ownership): a person works through courses that apply to them.
//   Quizzes and finals are graded HERE; the browser never gets the answer key
//   before submitting. Final questions are drawn here and stored with the
//   attempt, so the learner can't choose them.
// - Completion: passing the final makes the training record, unless the course
//   needs a practical sign-off, which a manager with training.record at the
//   person's site gives (T4).
// - A course "cycle" starts after the person's latest valid record for the
//   course, so a refresher starts from scratch.

import { checkJobTitle } from "@/lib/job-titles";
import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  drawFinal,
  forLearner,
  grade,
  parseCourseFile,
  quizModules,
  type CoursePackage,
  type LearnerQuestion,
  type Page,
} from "./course-format";
import {
  addMonths,
  canAt,
  orgWide,
  requirementsFor,
  statusOf,
  type Actor,
  type CourseStatus,
} from "./policy";
import { ownRecord } from "./self";
import type { Result } from "./service";

/** A final must be submitted within this time of starting it. */
export const FINAL_TIME_LIMIT_MS = 3 * 60 * 60 * 1000;

const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

const fail = (
  code: "forbidden" | "not_found" | "invalid" | "conflict",
  message: string,
) => ({ ok: false, code, message }) as const;
const notFound = () => fail("not_found", "That course couldn't be found.");

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, string | number | boolean | null>,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      detail,
    },
    select: { id: true },
  });
}

const nameOf = (e: {
  givenName: string;
  familyName: string;
  preferredName: string | null;
}) => `${e.preferredName || e.givenName} ${e.familyName}`;

async function latestPackage(tx: TenantTx, actor: Actor, courseId: string) {
  return tx.trainingCoursePackage.findFirst({
    where: { tenantId: actor.tenantId, courseId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      code: true,
      content: true,
      finalCount: true,
      passPercent: true,
      modulePassPercent: true,
      practical: true,
      createdAt: true,
    },
  });
}

// --- Import ---------------------------------------------------------------------------

export interface ImportFile {
  name: string;
  text: string;
}

export interface ImportOutcome {
  file: string;
  ok: boolean;
  message: string;
  courseId?: string;
}

/**
 * Imports course files. Each file is checked on its own; files that aren't
 * valid are reported and skipped. A file whose code matches an existing
 * course adds a new version of it (unless nothing changed).
 */
export async function importCourses(
  tx: TenantTx,
  actor: Actor,
  files: ImportFile[],
  addRules: boolean,
): Promise<Result<{ outcomes: ImportOutcome[] }>> {
  if (!orgWide(actor, "training.manage"))
    return fail("forbidden", "Your role doesn't allow this change.");
  if (!files.length || files.length > 40)
    return fail("invalid", "Choose between 1 and 40 course files.");
  const outcomes: ImportOutcome[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const file = f.name.slice(0, 120) || "course file";
    const p = parseCourseFile(f.text);
    if (!p.ok) {
      outcomes.push({ file, ok: false, message: p.message });
      continue;
    }
    const c = p.file;
    if (seen.has(c.code.toLowerCase())) {
      outcomes.push({
        file,
        ok: false,
        message: `Course ${c.code} appears twice in this upload.`,
      });
      continue;
    }
    seen.add(c.code.toLowerCase());
    outcomes.push(await importOne(tx, actor, file, p, addRules));
  }
  return { ok: true, data: { outcomes } };
}

async function importOne(
  tx: TenantTx,
  actor: Actor,
  file: string,
  p: Extract<ReturnType<typeof parseCourseFile>, { ok: true }>,
  addRules: boolean,
): Promise<ImportOutcome> {
  const c = p.file;
  const sameName = await tx.trainingCourse.findFirst({
    where: {
      tenantId: actor.tenantId,
      archivedAt: null,
      name: { equals: c.name, mode: "insensitive" },
    },
    select: { id: true, kind: true, completionMethod: true },
  });

  if (c.kind === "external") {
    if (sameName)
      return {
        file,
        ok: true,
        message: `${c.name} is already a course. Nothing changed.`,
        courseId: sameName.id,
      };
    const created = await tx.trainingCourse.create({
      data: {
        tenantId: actor.tenantId,
        name: c.name,
        description: c.who?.slice(0, 1000) || null,
        category: c.category ?? "other",
        kind: "external",
        completionMethod: "external_certificate",
        certificateExpected: true,
        validityMonths: c.validityMonths,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    const rules = await addFileRules(
      tx,
      actor,
      created.id,
      c.requirements,
      addRules,
    );
    await audit(
      tx,
      actor,
      "training.course_imported",
      "training_course",
      created.id,
      {
        kind: "external",
        version: 1,
      },
    );
    return {
      file,
      ok: true,
      message: `Added ${c.name} (external)${rulesNote(rules)}.`,
      courseId: created.id,
    };
  }

  const pkg = p.pkg!;
  // Stored as validated JSON (plain data only).
  const content = JSON.parse(JSON.stringify(pkg)) as { [key: string]: never };
  // An earlier version of the same course (same code, still active)?
  const previous = await tx.trainingCoursePackage.findFirst({
    where: {
      tenantId: actor.tenantId,
      code: c.code,
      course: { archivedAt: null },
    },
    orderBy: { version: "desc" },
    select: {
      courseId: true,
      version: true,
      content: true,
      finalCount: true,
      passPercent: true,
      modulePassPercent: true,
      practical: true,
    },
  });

  if (previous) {
    const unchanged =
      canonical(previous.content) === canonical(pkg) &&
      previous.finalCount === p.finalCount &&
      previous.passPercent === p.passPercent &&
      previous.modulePassPercent === p.modulePassPercent &&
      previous.practical === p.practical;
    if (unchanged)
      return {
        file,
        ok: true,
        message: `${c.name} is already up to date. Nothing changed.`,
        courseId: previous.courseId,
      };
    if (sameName && sameName.id !== previous.courseId)
      return {
        file,
        ok: false,
        message: `Another course is already called ${c.name}. Rename one of them first.`,
      };
    const course = await tx.trainingCourse.findUniqueOrThrow({
      where: {
        tenantId_id: { tenantId: actor.tenantId, id: previous.courseId },
      },
      select: { contentVersion: true },
    });
    const version = Math.max(course.contentVersion, previous.version) + 1;
    await tx.trainingCourse.update({
      where: {
        tenantId_id: { tenantId: actor.tenantId, id: previous.courseId },
      },
      data: {
        name: c.name,
        validityMonths: c.validityMonths,
        contentVersion: version,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await tx.trainingCoursePackage.create({
      data: {
        tenantId: actor.tenantId,
        courseId: previous.courseId,
        version,
        code: c.code,
        format: c.format,
        content,
        finalCount: p.finalCount,
        passPercent: p.passPercent,
        modulePassPercent: p.modulePassPercent,
        practical: p.practical,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.course_imported",
      "training_course",
      previous.courseId,
      {
        kind: "internal",
        version,
      },
    );
    return {
      file,
      ok: true,
      message: `Updated ${c.name} to version ${version}. People's existing records stay valid.`,
      courseId: previous.courseId,
    };
  }

  if (sameName)
    return {
      file,
      ok: false,
      message: `A course called ${c.name} already exists. Rename or archive it first.`,
    };
  const created = await tx.trainingCourse.create({
    data: {
      tenantId: actor.tenantId,
      name: c.name,
      description: (c.who || c.intro || "").slice(0, 1000) || null,
      category: c.category ?? "other",
      kind: "internal",
      completionMethod: "interactive",
      certificateExpected: false,
      validityMonths: c.validityMonths,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await tx.trainingCoursePackage.create({
    data: {
      tenantId: actor.tenantId,
      courseId: created.id,
      version: 1,
      code: c.code,
      format: c.format,
      content,
      finalCount: p.finalCount,
      passPercent: p.passPercent,
      modulePassPercent: p.modulePassPercent,
      practical: p.practical,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  const rules = await addFileRules(
    tx,
    actor,
    created.id,
    c.requirements,
    addRules,
  );
  await audit(
    tx,
    actor,
    "training.course_imported",
    "training_course",
    created.id,
    {
      kind: "internal",
      version: 1,
    },
  );
  return {
    file,
    ok: true,
    message: `Added ${c.name}${rulesNote(rules)}.`,
    courseId: created.id,
  };
}

/** JSON with object keys sorted (the database doesn't keep key order). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

async function addFileRules(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  rules:
    { jobTitle: string; mandatory: boolean; dueDays: number }[] | undefined,
  addRules: boolean,
) {
  const skipped: string[] = [];
  if (!addRules || !rules?.length) return { added: 0, skipped };
  const seen = new Set<string>();
  let n = 0;
  for (const r of rules) {
    // M16: titles must be on the organisation's list, if it keeps one.
    const title = await checkJobTitle(tx, r.jobTitle);
    if (!title.ok || !title.value) {
      skipped.push(r.jobTitle.trim());
      continue;
    }
    const key = title.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    await tx.trainingRequirement.create({
      data: {
        tenantId: actor.tenantId,
        courseId,
        scope: "job_title",
        jobTitle: title.value,
        mandatory: r.mandatory,
        dueDays: r.dueDays,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    n++;
  }
  return { added: n, skipped };
}

const rulesNote = (r: { added: number; skipped: string[] }) =>
  (r.added
    ? ` with ${r.added} job-title rule${r.added === 1 ? "" : "s"}`
    : "") +
  (r.skipped.length
    ? `. Rules not added because the job title isn't on your list: ${r.skipped.join(", ")}`
    : "");

// --- Managers: what's in a course --------------------------------------------------------

export async function coursePackageSummary(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
) {
  if (!orgWide(actor, "training.manage") || !isUuid(courseId)) return null;
  const pkg = await latestPackage(tx, actor, courseId);
  if (!pkg) return null;
  const c = pkg.content as unknown as CoursePackage;
  return {
    code: pkg.code,
    version: pkg.version,
    importedAt: pkg.createdAt,
    minutes: c.minutes,
    modules: c.modules.map((m) => ({
      title: m.title,
      questions: m.quiz.length,
    })),
    poolSize: c.pool.length,
    safetyQuestions: c.pool.filter((q) => q.critical).length,
    finalCount: pkg.finalCount,
    passPercent: pkg.passPercent,
    modulePassPercent: pkg.modulePassPercent,
    practical: pkg.practical,
  };
}

// --- Learners --------------------------------------------------------------------------

type Me = NonNullable<Awaited<ReturnType<typeof ownRecord>>>;

/** The course, if it's an active interactive course that applies to the person. */
async function theirCourse(
  tx: TenantTx,
  actor: Actor,
  me: Me,
  courseId: string,
) {
  if (!isUuid(courseId)) return null;
  const course = await tx.trainingCourse.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: courseId } },
    select: {
      id: true,
      name: true,
      completionMethod: true,
      validityMonths: true,
      warnDays: true,
      archivedAt: true,
    },
  });
  if (!course || course.archivedAt || course.completionMethod !== "interactive")
    return null;
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
  const [requirement] = requirementsFor(
    {
      id: me.id,
      primarySiteId: me.primarySiteId,
      jobTitle: me.jobTitle,
      startDate: isoOf(me.startDate),
      status: me.status,
    },
    rules.map((r) => ({ ...r, effectiveFrom: isoOf(r.effectiveFrom)! })),
    new Set([course.id]),
  );
  return requirement ? { course, requirement } : null;
}

async function cycleOf(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  courseId: string,
  packageId: string,
) {
  const records = await tx.trainingRecord.findMany({
    where: { tenantId: actor.tenantId, employeeId, courseId },
    orderBy: [{ completedOn: "desc" }, { recordedAt: "desc" }],
    select: {
      id: true,
      courseId: true,
      method: true,
      completedOn: true,
      expiresOn: true,
      recordedAt: true,
      voidedAt: true,
    },
  });
  const valid = records.filter((r) => !r.voidedAt);
  const since = valid.reduce<Date | null>(
    (m, r) => (!m || r.recordedAt > m ? r.recordedAt : m),
    null,
  );
  const attempts = await tx.trainingAttempt.findMany({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      courseId,
      packageId,
      submittedAt: since ? { gt: since } : { not: null },
    },
    orderBy: { submittedAt: "asc" },
    select: {
      part: true,
      moduleIndex: true,
      scorePercent: true,
      passed: true,
      submittedAt: true,
    },
  });
  return { records, valid, attempts };
}

export type LearnerPage = Page;

export interface LearnerCourse {
  courseId: string;
  name: string;
  version: number;
  minutes: number | null;
  who: string | null;
  intro: string | null;
  law: string | null;
  outcomes: string[];
  modules: {
    title: string;
    icon: string | null;
    blurb: string | null;
    pages: LearnerPage[];
    quiz: LearnerQuestion[];
    passed: boolean;
    bestPercent: number | null;
  }[];
  final: {
    count: number;
    passPercent: number;
    modulePassPercent: number;
    unlocked: boolean;
    passed: boolean;
    bestPercent: number | null;
    attempts: number;
  };
  practical: string | null;
  state: "learning" | "awaiting_signoff" | "complete";
  status: CourseStatus;
  /** Their latest valid record, if it was earned by passing this course. */
  certificateRecordId: string | null;
}

export async function learnerCourse(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  today: string,
): Promise<LearnerCourse | null> {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const found = await theirCourse(tx, actor, me, courseId);
  if (!found) return null;
  const pkg = await latestPackage(tx, actor, found.course.id);
  if (!pkg) return null;
  const c = pkg.content as unknown as CoursePackage;
  const { valid, attempts } = await cycleOf(
    tx,
    actor,
    me.id,
    found.course.id,
    pkg.id,
  );
  const status = statusOf(
    found.requirement,
    valid.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      completedOn: isoOf(r.completedOn)!,
      expiresOn: isoOf(r.expiresOn),
      recordedAt: r.recordedAt,
      voided: false,
    })),
    found.course.warnDays,
    today,
  );
  const best = (part: string, i: number | null) => {
    const xs = attempts.filter((a) => a.part === part && a.moduleIndex === i);
    return xs.length ? Math.max(...xs.map((a) => a.scorePercent ?? 0)) : null;
  };
  const passedModule = (i: number) =>
    attempts.some(
      (a) => a.part === "module" && a.moduleIndex === i && a.passed,
    );
  const finals = attempts.filter((a) => a.part === "final");
  const finalPassed = finals.some((a) => a.passed);
  const unlocked = quizModules(c).every(passedModule);
  const latest = valid[0] ?? null;
  const state: LearnerCourse["state"] =
    finalPassed && pkg.practical
      ? "awaiting_signoff"
      : latest &&
          attempts.length === 0 &&
          (status.status === "up_to_date" || status.status === "expiring")
        ? "complete"
        : "learning";
  return {
    courseId: found.course.id,
    name: found.course.name,
    version: pkg.version,
    minutes: c.minutes,
    who: c.who,
    intro: c.intro,
    law: c.law,
    outcomes: c.outcomes,
    modules: c.modules.map((m, i) => ({
      title: m.title,
      icon: m.icon || null,
      blurb: m.blurb || null,
      pages: m.pages,
      quiz: m.quiz.map(forLearner),
      passed: m.quiz.length ? passedModule(i) : true,
      bestPercent: best("module", i),
    })),
    final: {
      count: pkg.finalCount,
      passPercent: pkg.passPercent,
      modulePassPercent: pkg.modulePassPercent,
      unlocked,
      passed: finalPassed,
      bestPercent: best("final", null),
      attempts: finals.length,
    },
    practical: pkg.practical,
    state,
    status,
    certificateRecordId:
      latest && latest.method === "assessment" ? latest.id : null,
  };
}

export interface QuizResult {
  scorePercent: number;
  correct: number;
  total: number;
  passed: boolean;
  safetyMissed: number;
  feedback: { correct: boolean; why: string }[];
  /** Set when passing the final completed the course. */
  completed: boolean;
  awaitingSignOff: boolean;
}

export async function submitModuleQuiz(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  moduleIndex: unknown,
  answers: unknown,
): Promise<Result<QuizResult>> {
  const me = await ownRecord(tx, actor);
  if (!me) return notFound();
  const found = await theirCourse(tx, actor, me, courseId);
  if (!found) return notFound();
  const pkg = await latestPackage(tx, actor, found.course.id);
  if (!pkg) return notFound();
  const c = pkg.content as unknown as CoursePackage;
  const i = Number(moduleIndex);
  const m = Number.isInteger(i) ? c.modules[i] : undefined;
  if (!m || !m.quiz.length) return notFound();
  const g = grade(m.quiz, answers, pkg.modulePassPercent, false);
  const now = new Date();
  const attempt = await tx.trainingAttempt.create({
    data: {
      tenantId: actor.tenantId,
      employeeId: me.id,
      courseId: found.course.id,
      packageId: pkg.id,
      part: "module",
      moduleIndex: i,
      questionIds: m.quiz.map((_, k) => k),
      startedAt: now,
      submittedAt: now,
      correct: g.correct,
      scorePercent: g.scorePercent,
      passed: g.passed,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "training.attempt_submitted",
    "training_attempt",
    attempt.id,
    {
      employeeId: me.id,
      courseId: found.course.id,
      part: "module",
      scorePercent: g.scorePercent,
      passed: g.passed,
    },
  );
  return {
    ok: true,
    data: { ...g, completed: false, awaitingSignOff: false },
  };
}

export async function startFinal(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  today: string,
): Promise<Result<{ attemptId: string; questions: LearnerQuestion[] }>> {
  const view = await learnerCourse(tx, actor, courseId, today);
  if (!view) return notFound();
  if (!view.final.unlocked)
    return fail("conflict", "Pass every module quiz first.");
  if (view.state === "awaiting_signoff")
    return fail("conflict", "You've passed. Your practical sign-off is next.");
  const me = (await ownRecord(tx, actor))!;
  const pkg = (await latestPackage(tx, actor, view.courseId))!;
  const c = pkg.content as unknown as CoursePackage;
  const ids = drawFinal(c.pool, pkg.finalCount);
  const attempt = await tx.trainingAttempt.create({
    data: {
      tenantId: actor.tenantId,
      employeeId: me.id,
      courseId: view.courseId,
      packageId: pkg.id,
      part: "final",
      questionIds: ids,
    },
    select: { id: true },
  });
  return {
    ok: true,
    data: {
      attemptId: attempt.id,
      questions: ids.map((k) => forLearner(c.pool[k]!)),
    },
  };
}

export async function submitFinal(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  attemptId: unknown,
  answers: unknown,
  today: string,
): Promise<Result<QuizResult>> {
  const me = await ownRecord(tx, actor);
  if (!me || typeof attemptId !== "string" || !isUuid(attemptId))
    return notFound();
  const found = await theirCourse(tx, actor, me, courseId);
  if (!found) return notFound();
  const attempt = await tx.trainingAttempt.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: attemptId } },
    select: {
      id: true,
      employeeId: true,
      courseId: true,
      part: true,
      questionIds: true,
      startedAt: true,
      submittedAt: true,
      package: {
        select: {
          id: true,
          version: true,
          content: true,
          passPercent: true,
          practical: true,
        },
      },
    },
  });
  if (
    !attempt ||
    attempt.employeeId !== me.id ||
    attempt.courseId !== found.course.id ||
    attempt.part !== "final"
  )
    return notFound();
  if (attempt.submittedAt)
    return fail("conflict", "This attempt has already been marked.");
  if (Date.now() - attempt.startedAt.getTime() > FINAL_TIME_LIMIT_MS)
    return fail("conflict", "This attempt has timed out. Start a new one.");
  const c = attempt.package.content as unknown as CoursePackage;
  const questions = attempt.questionIds.map((k) => c.pool[k]!);
  const g = grade(questions, answers, attempt.package.passPercent, true);
  const now = new Date();
  await tx.trainingAttempt.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: attempt.id } },
    data: {
      submittedAt: now,
      correct: g.correct,
      scorePercent: g.scorePercent,
      passed: g.passed,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "training.attempt_submitted",
    "training_attempt",
    attempt.id,
    {
      employeeId: me.id,
      courseId: found.course.id,
      part: "final",
      scorePercent: g.scorePercent,
      passed: g.passed,
    },
  );
  let completed = false;
  const awaitingSignOff = g.passed && !!attempt.package.practical;
  if (g.passed && !attempt.package.practical) {
    const expiresOn = found.course.validityMonths
      ? addMonths(today, found.course.validityMonths)
      : null;
    const record = await tx.trainingRecord.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: me.id,
        courseId: found.course.id,
        courseVersion: attempt.package.version,
        method: "assessment",
        completedOn: asDate(today),
        expiresOn: expiresOn ? asDate(expiresOn) : null,
        selfCompleted: true,
        recordedBy: actor.userId,
        // The same moment as the attempt, so the next cycle starts after it.
        recordedAt: now,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.course_passed",
      "training_record",
      record.id,
      {
        employeeId: me.id,
        courseId: found.course.id,
        scorePercent: g.scorePercent,
      },
    );
    completed = true;
  }
  return { ok: true, data: { ...g, completed, awaitingSignOff } };
}

// --- Practical sign-off (T4) --------------------------------------------------------------

async function passedFinals(tx: TenantTx, actor: Actor, courseId: string) {
  const finals = await tx.trainingAttempt.findMany({
    where: {
      tenantId: actor.tenantId,
      courseId,
      part: "final",
      passed: true,
      package: { practical: { not: null } },
    },
    orderBy: { submittedAt: "desc" },
    select: {
      employeeId: true,
      scorePercent: true,
      submittedAt: true,
      package: { select: { version: true, practical: true } },
    },
  });
  const ids = [...new Set(finals.map((f) => f.employeeId))];
  const records = ids.length
    ? await tx.trainingRecord.findMany({
        where: {
          tenantId: actor.tenantId,
          courseId,
          employeeId: { in: ids },
          voidedAt: null,
        },
        select: { employeeId: true, recordedAt: true },
      })
    : [];
  // Per person: their latest pass, if no record has been made since it.
  const out = new Map<string, (typeof finals)[number]>();
  for (const f of finals) {
    if (out.has(f.employeeId)) continue;
    const since = records.some(
      (r) => r.employeeId === f.employeeId && r.recordedAt >= f.submittedAt!,
    );
    if (!since) out.set(f.employeeId, f);
  }
  return out;
}

export async function awaitingSignOff(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
) {
  if (!actor.grants.has("training.record") || !isUuid(courseId)) return [];
  const pending = await passedFinals(tx, actor, courseId);
  if (!pending.size) return [];
  const people = await tx.employee.findMany({
    where: { tenantId: actor.tenantId, id: { in: [...pending.keys()] } },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      preferredName: true,
      primarySiteId: true,
      status: true,
    },
  });
  return people
    .filter(
      (p) =>
        p.status !== "left" && canAt(actor, "training.record", p.primarySiteId),
    )
    .map((p) => {
      const f = pending.get(p.id)!;
      return {
        employeeId: p.id,
        name: nameOf(p),
        passedAt: f.submittedAt!,
        scorePercent: f.scorePercent ?? 0,
        practical: f.package.practical!,
      };
    })
    .sort((a, b) => a.passedAt.getTime() - b.passedAt.getTime());
}

export async function signOffPractical(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  employeeId: unknown,
  today: string,
): Promise<Result> {
  if (!actor.grants.has("training.record"))
    return fail("forbidden", "Your role doesn't allow this change.");
  if (
    !isUuid(courseId) ||
    typeof employeeId !== "string" ||
    !isUuid(employeeId)
  )
    return notFound();
  const person = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: { id: true, primarySiteId: true, status: true },
  });
  if (!person || !canAt(actor, "training.record", person.primarySiteId))
    return notFound();
  if (person.status === "left")
    return fail(
      "conflict",
      "This person has left. Their history is kept as it is.",
    );
  const course = await tx.trainingCourse.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: courseId } },
    select: { id: true, validityMonths: true, archivedAt: true },
  });
  if (!course || course.archivedAt) return notFound();
  const pass = (await passedFinals(tx, actor, course.id)).get(person.id);
  if (!pass)
    return fail(
      "conflict",
      "There's no passed final waiting for a sign-off for this person.",
    );
  const expiresOn = course.validityMonths
    ? addMonths(today, course.validityMonths)
    : null;
  const record = await tx.trainingRecord.create({
    data: {
      tenantId: actor.tenantId,
      employeeId: person.id,
      courseId: course.id,
      courseVersion: pass.package.version,
      method: "assessment",
      completedOn: asDate(today),
      expiresOn: expiresOn ? asDate(expiresOn) : null,
      selfCompleted: false,
      recordedBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "training.practical_signed_off",
    "training_record",
    record.id,
    {
      employeeId: person.id,
      courseId: course.id,
    },
  );
  return { ok: true, data: record };
}

// --- Certificates (T5) --------------------------------------------------------------------

export interface CertificateFacts {
  recordId: string;
  personName: string;
  courseName: string;
  code: string | null;
  completedOn: string;
  expiresOn: string | null;
  scorePercent: number | null;
  signedOffBy: string | null;
  practical: string | null;
  certificateNo: string;
}

/**
 * For a certificate download: the person themselves, or anyone who can see
 * their training. Every download is audited.
 */
export async function certificateFacts(
  tx: TenantTx,
  actor: Actor,
  recordId: string,
): Promise<CertificateFacts | null> {
  if (!isUuid(recordId)) return null;
  const r = await tx.trainingRecord.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: recordId } },
    select: {
      id: true,
      employeeId: true,
      courseId: true,
      courseVersion: true,
      method: true,
      completedOn: true,
      expiresOn: true,
      selfCompleted: true,
      recordedBy: true,
      recordedAt: true,
      voidedAt: true,
      course: { select: { name: true } },
    },
  });
  if (!r || r.method !== "assessment" || r.voidedAt) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: r.employeeId } },
    select: {
      id: true,
      membershipId: true,
      givenName: true,
      familyName: true,
      preferredName: true,
      primarySiteId: true,
    },
  });
  if (!e) return null;
  const own = e.membershipId === actor.membershipId;
  if (!own && !canAt(actor, "training.view", e.primarySiteId)) return null;
  const [pass, pkg, signer] = await Promise.all([
    tx.trainingAttempt.findFirst({
      where: {
        tenantId: actor.tenantId,
        employeeId: e.id,
        courseId: r.courseId,
        part: "final",
        passed: true,
        submittedAt: { lte: r.recordedAt },
      },
      orderBy: { submittedAt: "desc" },
      select: { scorePercent: true },
    }),
    tx.trainingCoursePackage.findFirst({
      where: {
        tenantId: actor.tenantId,
        courseId: r.courseId,
        version: r.courseVersion,
      },
      select: { code: true, practical: true },
    }),
    r.selfCompleted
      ? null
      : tx.user.findUnique({
          where: { id: r.recordedBy },
          select: { name: true },
        }),
  ]);
  await audit(
    tx,
    actor,
    "training.certificate_downloaded",
    "training_record",
    r.id,
    {
      employeeId: e.id,
      own,
    },
  );
  const year = r.completedOn.getUTCFullYear();
  return {
    recordId: r.id,
    personName: nameOf(e),
    courseName: r.course.name,
    code: pkg?.code ?? null,
    completedOn: isoOf(r.completedOn)!,
    expiresOn: isoOf(r.expiresOn),
    scorePercent: pass?.scorePercent ?? null,
    signedOffBy: r.selfCompleted ? null : (signer?.name ?? "A former member"),
    practical: r.selfCompleted ? null : (pkg?.practical ?? null),
    certificateNo: `TH-${pkg?.code ?? "C"}-${year}-${r.id.replace(/-/g, "").slice(-8).toUpperCase()}`,
  };
}
