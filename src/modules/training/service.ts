// Training service (M8.1). Every function receives a transaction scoped to one
// organisation by withTenant() (so RLS applies) and an Actor from the server
// session. Permissions and site scope are checked here for every read and
// write, and every change writes an audit event (ids and codes only).

import { z } from "zod";

import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  CATEGORIES,
  addMonths,
  canAt,
  isIsoDate,
  orgWide,
  personUpToDate,
  requirementsFor,
  statusOf,
  type Actor,
  type CourseStatus,
  type Person,
  type RecordFacts,
  type Rule,
  type TrainingStatus,
} from "./policy";
import { SUGGESTED_COURSES } from "./suggested";

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: Record<string, string>;
    };

const forbidden = (message = "Your role doesn't allow this change.") =>
  ({ ok: false, code: "forbidden", message }) as const;
const notFound = (what: string) =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;
const invalid = (
  fieldErrors: Record<string, string>,
  message = "Check the highlighted fields.",
) => ({ ok: false, code: "invalid", message, fieldErrors }) as const;
const zodErrors = (e: z.ZodError) =>
  Object.fromEntries(
    e.issues.map((i) => [String(i.path[0] ?? "form"), i.message]),
  );
const uniqueViolation = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "P2002";

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType: "training_course" | "training_requirement" | "training_record",
  targetId: string,
  detail: Record<string, string | number | boolean | null> = {},
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

// --- Courses ------------------------------------------------------------------------

const canManage = (actor: Actor) => orgWide(actor, "training.manage");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters`)
    .transform((v) => v || null)
    .nullable()
    .optional();

const courseSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120),
    description: optionalText(1000),
    category: z.enum(CATEGORIES),
    kind: z.enum(["internal", "external"]),
    completionMethod: z.enum([
      "read_and_confirm",
      "in_person",
      "external_certificate",
    ]),
    certificateExpected: z.coerce.boolean(),
    validityMonths: z
      .union([z.literal(""), z.null(), z.coerce.number()])
      .transform((v) => (v === "" || v === null ? null : v))
      .pipe(
        z
          .number()
          .int("Use whole months")
          .min(1, "At least 1 month")
          .max(120, "At most 120 months")
          .nullable(),
      ),
    warnDays: z.coerce
      .number()
      .int("Use whole days")
      .min(0, "0 or more")
      .max(365, "At most 365 days"),
    content: optionalText(20000),
  })
  .superRefine((v, ctx) => {
    const ok =
      v.kind === "internal"
        ? v.completionMethod !== "external_certificate"
        : v.completionMethod === "external_certificate";
    if (!ok)
      ctx.addIssue({
        code: "custom",
        path: ["completionMethod"],
        message:
          v.kind === "internal"
            ? "Internal courses are read and confirmed, or given in person"
            : "External courses end with a certificate",
      });
    if (v.completionMethod === "read_and_confirm" && !v.content)
      ctx.addIssue({
        code: "custom",
        path: ["content"],
        message: "Add the content people will read and confirm",
      });
  });

export interface CourseSummary {
  id: string;
  name: string;
  description: string | null;
  category: string;
  kind: "internal" | "external";
  completionMethod: "read_and_confirm" | "in_person" | "external_certificate";
  certificateExpected: boolean;
  validityMonths: number | null;
  warnDays: number;
  contentVersion: number;
  isSuggested: boolean;
  archived: boolean;
  rules: number;
}

/** The course catalogue (anyone with training.view or training.manage). */
export async function listCourses(
  tx: TenantTx,
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
): Promise<CourseSummary[] | null> {
  if (!actor.grants.has("training.view") && !canManage(actor)) return null;
  const rows = await tx.trainingCourse.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(opts.includeArchived && canManage(actor) ? {} : { archivedAt: null }),
    },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      kind: true,
      completionMethod: true,
      certificateExpected: true,
      validityMonths: true,
      warnDays: true,
      contentVersion: true,
      isSuggested: true,
      archivedAt: true,
      requirements: { where: { archivedAt: null }, select: { id: true } },
    },
  });
  return rows.map(({ archivedAt, requirements, ...c }) => ({
    ...c,
    archived: archivedAt !== null,
    rules: requirements.length,
  }));
}

export async function getCourse(tx: TenantTx, actor: Actor, id: string) {
  if (!canManage(actor) || !isUuid(id)) return null;
  const c = await tx.trainingCourse.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      kind: true,
      completionMethod: true,
      certificateExpected: true,
      validityMonths: true,
      warnDays: true,
      content: true,
      contentVersion: true,
      isSuggested: true,
      archivedAt: true,
      requirements: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          scope: true,
          siteId: true,
          jobTitle: true,
          employeeId: true,
          mandatory: true,
          dueDays: true,
          effectiveFrom: true,
        },
      },
    },
  });
  if (!c) return null;
  // Names for the rule targets.
  const [sites, people] = await Promise.all([
    tx.site.findMany({
      where: {
        tenantId: actor.tenantId,
        id: {
          in: c.requirements
            .map((r) => r.siteId)
            .filter((v): v is string => !!v),
        },
      },
      select: { id: true, name: true },
    }),
    tx.employee.findMany({
      where: {
        tenantId: actor.tenantId,
        id: {
          in: c.requirements
            .map((r) => r.employeeId)
            .filter((v): v is string => !!v),
        },
      },
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
      },
    }),
  ]);
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const personName = new Map(people.map((p) => [p.id, nameOf(p)]));
  // Choices for new rules: active sites, and people still employed or about to start.
  const [siteOptions, peopleOptions] = await Promise.all([
    tx.site.findMany({
      where: { tenantId: actor.tenantId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    tx.employee.findMany({
      where: {
        tenantId: actor.tenantId,
        status: { in: ["pending", "active"] },
      },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
      },
    }),
  ]);
  return {
    ...c,
    options: {
      sites: siteOptions,
      people: peopleOptions.map((p) => ({ id: p.id, name: nameOf(p) })),
    },
    archived: c.archivedAt !== null,
    rules: c.requirements.map((r) => ({
      id: r.id,
      scope: r.scope,
      target:
        r.scope === "organisation"
          ? "Everyone"
          : r.scope === "site"
            ? `Site: ${siteName.get(r.siteId!) ?? "unknown"}`
            : r.scope === "job_title"
              ? `Job title: ${r.jobTitle}`
              : `Person: ${personName.get(r.employeeId!) ?? "unknown"}`,
      mandatory: r.mandatory,
      dueDays: r.dueDays,
      effectiveFrom: isoOf(r.effectiveFrom)!,
    })),
  };
}

async function activeCourse(tx: TenantTx, actor: Actor, id: unknown) {
  if (typeof id !== "string" || !isUuid(id)) return null;
  const c = await tx.trainingCourse.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      kind: true,
      completionMethod: true,
      validityMonths: true,
      content: true,
      contentVersion: true,
      archivedAt: true,
    },
  });
  return c && !c.archivedAt ? c : null;
}

export async function saveCourse(
  tx: TenantTx,
  actor: Actor,
  id: string | null,
  raw: unknown,
): Promise<Result> {
  if (!canManage(actor)) return forbidden();
  const existing = id ? await activeCourse(tx, actor, id) : null;
  if (id && !existing) return notFound("course");
  // A course's type and completion method are fixed once created (records depend on them).
  const parsed = courseSchema.safeParse(
    existing
      ? {
          ...(raw as object),
          kind: existing.kind,
          completionMethod: existing.completionMethod,
        }
      : raw,
  );
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const v = parsed.data;
  const data = {
    name: v.name,
    description: v.description ?? null,
    category: v.category,
    certificateExpected: v.certificateExpected,
    validityMonths: v.validityMonths,
    warnDays: v.warnDays,
    content:
      v.completionMethod === "read_and_confirm" ? (v.content ?? null) : null,
  };
  try {
    if (!existing) {
      const created = await tx.trainingCourse.create({
        data: {
          tenantId: actor.tenantId,
          ...data,
          kind: v.kind,
          completionMethod: v.completionMethod,
          createdBy: actor.userId,
        },
        select: { id: true },
      });
      await audit(
        tx,
        actor,
        "training.course_created",
        "training_course",
        created.id,
        {
          kind: v.kind,
        },
      );
      return { ok: true, data: created };
    }
    // New content means a new version: earlier confirmations keep the version they confirmed.
    const contentChanged = (existing.content ?? null) !== data.content;
    const version = existing.contentVersion + (contentChanged ? 1 : 0);
    await tx.trainingCourse.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: existing.id } },
      data: { ...data, contentVersion: version, updatedAt: new Date() },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.course_updated",
      "training_course",
      existing.id,
      {
        contentVersion: version,
      },
    );
    return { ok: true, data: { id: existing.id } };
  } catch (e) {
    if (uniqueViolation(e))
      return invalid({ name: "There's already a course with this name" });
    throw e;
  }
}

export async function archiveCourse(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<Result> {
  if (!canManage(actor)) return forbidden();
  const c = await activeCourse(tx, actor, id);
  if (!c) return notFound("course");
  await tx.trainingCourse.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: c.id } },
    data: { archivedAt: new Date(), updatedAt: new Date() },
    select: { id: true },
  });
  await audit(tx, actor, "training.course_archived", "training_course", c.id);
  return { ok: true, data: { id: c.id } };
}

/** Adds the suggested courses that aren't already in the catalogue (no rules). */
export async function addSuggestedCourses(
  tx: TenantTx,
  actor: Actor,
): Promise<Result<{ added: number }>> {
  if (!canManage(actor)) return forbidden();
  const existing = new Set(
    (
      await tx.trainingCourse.findMany({
        where: { tenantId: actor.tenantId, archivedAt: null },
        select: { name: true },
      })
    ).map((c) => c.name.toLowerCase()),
  );
  let added = 0;
  for (const s of SUGGESTED_COURSES) {
    if (existing.has(s.name.toLowerCase())) continue;
    const c = await tx.trainingCourse.create({
      data: {
        tenantId: actor.tenantId,
        name: s.name,
        description: s.description,
        category: s.category,
        kind: s.kind,
        completionMethod: s.completionMethod,
        certificateExpected: s.certificateExpected,
        validityMonths: s.validityMonths,
        content: s.content ?? null,
        isSuggested: true,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await audit(tx, actor, "training.course_created", "training_course", c.id, {
      suggested: true,
    });
    added++;
  }
  return { ok: true, data: { added } };
}

// --- Requirement rules ---------------------------------------------------------------

const ruleSchema = z.object({
  scope: z.enum(["organisation", "site", "job_title", "employee"]),
  siteId: z.string().optional().nullable(),
  jobTitle: optionalText(120),
  employeeId: z.string().optional().nullable(),
  mandatory: z.coerce.boolean(),
  dueDays: z.coerce
    .number()
    .int("Use whole days")
    .min(0, "0 or more")
    .max(365, "At most 365 days"),
});

/** Add a rule (ruleId null) or change an existing rule's strength and due days. */
export async function saveRule(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  ruleId: string | null,
  raw: unknown,
): Promise<Result> {
  if (!canManage(actor)) return forbidden();
  const course = await activeCourse(tx, actor, courseId);
  if (!course) return notFound("course");
  if (ruleId) {
    const parsed = ruleSchema
      .pick({ mandatory: true, dueDays: true })
      .safeParse(raw);
    if (!parsed.success) return invalid(zodErrors(parsed.error));
    const rule = isUuid(ruleId)
      ? await tx.trainingRequirement.findUnique({
          where: { tenantId_id: { tenantId: actor.tenantId, id: ruleId } },
          select: { id: true, courseId: true, archivedAt: true },
        })
      : null;
    if (!rule || rule.courseId !== course.id || rule.archivedAt)
      return notFound("rule");
    await tx.trainingRequirement.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: rule.id } },
      data: { ...parsed.data, updatedAt: new Date() },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.rule_updated",
      "training_requirement",
      rule.id,
      {
        courseId: course.id,
        mandatory: parsed.data.mandatory,
        dueDays: parsed.data.dueDays,
      },
    );
    return { ok: true, data: { id: rule.id } };
  }
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const v = parsed.data;
  let siteId: string | null = null;
  let employeeId: string | null = null;
  let jobTitle: string | null = null;
  if (v.scope === "site") {
    const site =
      v.siteId && isUuid(v.siteId)
        ? await tx.site.findUnique({
            where: { tenantId_id: { tenantId: actor.tenantId, id: v.siteId } },
            select: { id: true, status: true },
          })
        : null;
    if (site?.status !== "active")
      return invalid({ siteId: "Choose an active site" });
    siteId = site.id;
  } else if (v.scope === "employee") {
    const e =
      v.employeeId && isUuid(v.employeeId)
        ? await tx.employee.findUnique({
            where: {
              tenantId_id: { tenantId: actor.tenantId, id: v.employeeId },
            },
            select: { id: true, status: true },
          })
        : null;
    if (!e || e.status === "left")
      return invalid({ employeeId: "Choose a current person" });
    employeeId = e.id;
  } else if (v.scope === "job_title") {
    if (!v.jobTitle) return invalid({ jobTitle: "Enter the job title" });
    jobTitle = v.jobTitle;
  }
  try {
    const created = await tx.trainingRequirement.create({
      data: {
        tenantId: actor.tenantId,
        courseId: course.id,
        scope: v.scope,
        siteId,
        jobTitle,
        employeeId,
        mandatory: v.mandatory,
        dueDays: v.dueDays,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.rule_added",
      "training_requirement",
      created.id,
      {
        courseId: course.id,
        scope: v.scope,
        mandatory: v.mandatory,
      },
    );
    return { ok: true, data: created };
  } catch (e) {
    if (uniqueViolation(e))
      return conflict("This course already has a rule for that target.");
    throw e;
  }
}

export async function archiveRule(
  tx: TenantTx,
  actor: Actor,
  courseId: string,
  ruleId: string,
): Promise<Result> {
  if (!canManage(actor)) return forbidden();
  if (!isUuid(courseId) || !isUuid(ruleId)) return notFound("rule");
  const rule = await tx.trainingRequirement.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: ruleId } },
    select: { id: true, courseId: true, archivedAt: true },
  });
  if (!rule || rule.courseId !== courseId || rule.archivedAt)
    return notFound("rule");
  await tx.trainingRequirement.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: rule.id } },
    data: { archivedAt: new Date(), updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "training.rule_removed",
    "training_requirement",
    rule.id,
    {
      courseId,
    },
  );
  return { ok: true, data: { id: rule.id } };
}

// --- Working out status ---------------------------------------------------------------

/** Site filter for reads: null = everything, [] = nothing. */
function viewSites(actor: Actor): string[] | null {
  const scope = actor.grants.get("training.view");
  if (!scope) return [];
  return scope === "all" ? null : [...scope];
}

const personSelect = {
  id: true,
  givenName: true,
  familyName: true,
  preferredName: true,
  jobTitle: true,
  status: true,
  startDate: true,
  primarySiteId: true,
  primarySite: { select: { name: true } },
  teams: { select: { teamId: true } },
} as const;

type PersonRow = {
  id: string;
  givenName: string;
  familyName: string;
  preferredName: string | null;
  jobTitle: string | null;
  status: "pending" | "active" | "left";
  startDate: Date | null;
  primarySiteId: string | null;
  primarySite: { name: string } | null;
  teams: { teamId: string }[];
};

const toPerson = (e: PersonRow): Person => ({
  id: e.id,
  primarySiteId: e.primarySiteId,
  jobTitle: e.jobTitle,
  startDate: isoOf(e.startDate),
  status: e.status,
});

/** Everything needed to work out status for a set of people. */
async function loadBasis(tx: TenantTx, actor: Actor, employeeIds: string[]) {
  const [courses, ruleRows, recordRows] = await Promise.all([
    tx.trainingCourse.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        kind: true,
        category: true,
        warnDays: true,
        archivedAt: true,
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
    employeeIds.length
      ? tx.trainingRecord.findMany({
          where: { tenantId: actor.tenantId, employeeId: { in: employeeIds } },
          select: {
            id: true,
            employeeId: true,
            courseId: true,
            completedOn: true,
            expiresOn: true,
            recordedAt: true,
            voidedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const rules: Rule[] = ruleRows.map((r) => ({
    ...r,
    effectiveFrom: isoOf(r.effectiveFrom)!,
  }));
  const active = courses.filter((c) => !c.archivedAt);
  const activeIds = new Set(active.map((c) => c.id));
  const records = new Map<string, RecordFacts[]>();
  for (const r of recordRows) {
    const key = `${r.employeeId}:${r.courseId}`;
    records.set(key, [
      ...(records.get(key) ?? []),
      {
        id: r.id,
        courseId: r.courseId,
        completedOn: isoOf(r.completedOn)!,
        expiresOn: isoOf(r.expiresOn),
        recordedAt: r.recordedAt,
        voided: r.voidedAt !== null,
      },
    ]);
  }
  return { courses, active, activeIds, rules, records };
}

type Basis = Awaited<ReturnType<typeof loadBasis>>;

function statusesFor(person: Person, basis: Basis, today: string) {
  const reqs = new Map(
    requirementsFor(person, basis.rules, basis.activeIds).map((r) => [
      r.courseId,
      r,
    ]),
  );
  const out = new Map<string, CourseStatus>();
  for (const c of basis.active) {
    const recs = basis.records.get(`${person.id}:${c.id}`) ?? [];
    const req = reqs.get(c.id) ?? null;
    if (!req && recs.length === 0) continue;
    out.set(c.id, statusOf(req, recs, c.warnDays, today));
  }
  return out;
}

// --- Matrix ---------------------------------------------------------------------------

export type MatrixStatusFilter = Exclude<TrainingStatus, "not_required">;

export interface Matrix {
  courses: { id: string; name: string; kind: "internal" | "external" }[];
  rows: {
    id: string;
    name: string;
    jobTitle: string | null;
    siteName: string | null;
    upToDate: boolean;
    cells: Record<string, CourseStatus>;
  }[];
  stats: {
    people: number;
    upToDate: number;
    overdue: number;
    expired: number;
    expiring: number;
  };
  filters: {
    sites: { id: string; name: string }[];
    teams: { id: string; name: string }[];
    jobTitles: string[];
  };
}

const STATUS_FILTERS: readonly MatrixStatusFilter[] = [
  "up_to_date",
  "expiring",
  "due",
  "overdue",
  "expired",
];

export async function matrix(
  tx: TenantTx,
  actor: Actor,
  today: string,
  filter: {
    siteId?: string;
    teamId?: string;
    jobTitle?: string;
    status?: string;
  } = {},
): Promise<Matrix | null> {
  const sites = viewSites(actor);
  if (sites && sites.length === 0) return null;
  const employees = (await tx.employee.findMany({
    where: {
      tenantId: actor.tenantId,
      status: { in: ["pending", "active"] },
      ...(sites ? { primarySiteId: { in: sites } } : {}),
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    select: personSelect,
  })) as PersonRow[];
  const [siteRows, teamRows, basis] = await Promise.all([
    tx.site.findMany({
      where: {
        tenantId: actor.tenantId,
        status: "active",
        ...(sites ? { id: { in: sites } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    tx.team.findMany({
      where: {
        tenantId: actor.tenantId,
        archived: false,
        ...(sites ? { siteId: { in: sites } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, site: { select: { name: true } } },
    }),
    loadBasis(
      tx,
      actor,
      employees.map((e) => e.id),
    ),
  ]);
  const jobTitles = [
    ...new Set(
      employees.map((e) => e.jobTitle?.trim()).filter((v): v is string => !!v),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const all = employees.map((e) => {
    const cells = statusesFor(toPerson(e), basis, today);
    return { e, cells };
  });
  // Columns: active courses anyone in view is required to do (or has records for).
  const used = new Set(all.flatMap((r) => [...r.cells.keys()]));
  const courses = basis.active
    .filter((c) => used.has(c.id))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const status = STATUS_FILTERS.find((s) => s === filter.status);
  const rows = all
    .filter(({ e }) => !filter.siteId || e.primarySiteId === filter.siteId)
    .filter(
      ({ e }) =>
        !filter.teamId || e.teams.some((t) => t.teamId === filter.teamId),
    )
    .filter(
      ({ e }) =>
        !filter.jobTitle ||
        (e.jobTitle ?? "").trim().toLowerCase() ===
          filter.jobTitle.trim().toLowerCase(),
    )
    .filter(
      ({ cells }) =>
        !status || [...cells.values()].some((c) => c.status === status),
    )
    .map(({ e, cells }) => ({
      id: e.id,
      name: nameOf(e),
      jobTitle: e.jobTitle,
      siteName: e.primarySite?.name ?? null,
      upToDate: personUpToDate([...cells.values()]),
      cells: Object.fromEntries(cells),
    }));

  const everything = all.flatMap((r) => [...r.cells.values()]);
  return {
    courses,
    rows,
    stats: {
      people: all.length,
      upToDate: all.filter((r) => personUpToDate([...r.cells.values()])).length,
      overdue: everything.filter((c) => c.status === "overdue").length,
      expired: everything.filter((c) => c.status === "expired").length,
      expiring: everything.filter((c) => c.status === "expiring").length,
    },
    filters: {
      sites: siteRows,
      teams: teamRows.map((t) => ({
        id: t.id,
        name: `${t.name} (${t.site.name})`,
      })),
      jobTitles,
    },
  };
}

// --- One person ------------------------------------------------------------------------

async function visiblePerson(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  code: "training.view" | "training.record",
) {
  if (!isUuid(employeeId)) return null;
  const e = (await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: personSelect,
  })) as PersonRow | null;
  // Other organisations' people and people outside your sites look the same: not found.
  return e && canAt(actor, code, e.primarySiteId) ? e : null;
}

export async function personTraining(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  today: string,
) {
  const e = await visiblePerson(tx, actor, employeeId, "training.view");
  if (!e) return null;
  const basis = await loadBasis(tx, actor, [e.id]);
  const statuses = statusesFor(toPerson(e), basis, today);
  const courseName = new Map(basis.courses.map((c) => [c.id, c.name]));
  const history = await tx.trainingRecord.findMany({
    where: { tenantId: actor.tenantId, employeeId: e.id },
    orderBy: [{ completedOn: "desc" }, { recordedAt: "desc" }],
    select: {
      id: true,
      courseId: true,
      courseVersion: true,
      method: true,
      completedOn: true,
      expiresOn: true,
      provider: true,
      reference: true,
      selfCompleted: true,
      replacesId: true,
      recordedBy: true,
      recordedAt: true,
      voidedAt: true,
      voidedBy: true,
      voidReason: true,
    },
  });
  const userIds = [
    ...new Set(
      history
        .flatMap((h) => [h.recordedBy, h.voidedBy])
        .filter((v): v is string => !!v),
    ),
  ];
  const users = userIds.length
    ? await tx.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const required = [...statuses.entries()]
    .filter(([, s]) => s.status !== "not_required")
    .map(([courseId, s]) => ({
      courseId,
      courseName: courseName.get(courseId) ?? "Course",
      ...s,
    }))
    .sort(
      (a, b) =>
        Number(b.mandatory) - Number(a.mandatory) ||
        a.courseName.localeCompare(b.courseName),
    );
  return {
    person: {
      id: e.id,
      name: nameOf(e),
      jobTitle: e.jobTitle,
      siteName: e.primarySite?.name ?? null,
      status: e.status,
    },
    upToDate: personUpToDate([...statuses.values()]),
    required,
    history: history.map((h) => ({
      id: h.id,
      courseId: h.courseId,
      courseName: courseName.get(h.courseId) ?? "Course",
      courseVersion: h.courseVersion,
      method: h.method,
      completedOn: isoOf(h.completedOn)!,
      expiresOn: isoOf(h.expiresOn),
      provider: h.provider,
      reference: h.reference,
      selfCompleted: h.selfCompleted,
      replacesId: h.replacesId,
      recordedByName: userName.get(h.recordedBy) ?? "A former member",
      recordedAt: h.recordedAt,
      voided: h.voidedAt
        ? {
            at: h.voidedAt,
            by: userName.get(h.voidedBy!) ?? "A former member",
            reason: h.voidReason,
          }
        : null,
    })),
    courses: basis.active.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
    })),
    can: {
      record:
        e.status !== "left" && canAt(actor, "training.record", e.primarySiteId),
    },
  };
}

// --- Recording and correcting -----------------------------------------------------------

export interface RecordCommand {
  courseId?: unknown;
  completedOn?: unknown;
  expiresOn?: unknown;
  provider?: unknown;
  reference?: unknown;
  /** Correcting: the record this one replaces (voided in the same transaction). */
  replacesId?: unknown;
  voidReason?: unknown;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * A manager records a completion. External courses are recorded as a
 * certificate; internal ones as given in person. Read-and-confirm is only ever
 * the person's own confirmation (M8.2), never recorded on their behalf.
 */
export async function recordTraining(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  today: string,
  raw: RecordCommand,
): Promise<Result> {
  if (!actor.grants.has("training.record")) return forbidden();
  const e = await visiblePerson(tx, actor, employeeId, "training.record");
  if (!e) return notFound("person");
  if (e.status === "left")
    return conflict("This person has left. Their history is kept as it is.");
  const course = await activeCourse(tx, actor, raw.courseId);
  const errors: Record<string, string> = {};
  if (!course) errors.courseId = "Choose an active course";
  const completedOn = s(raw.completedOn);
  if (!isIsoDate(completedOn)) errors.completedOn = "Enter the completion date";
  else if (completedOn > today)
    errors.completedOn = "The completion date can't be in the future";
  else if (completedOn < "1990-01-01")
    errors.completedOn = "Check the completion date";
  const expiresRaw = s(raw.expiresOn);
  if (expiresRaw && !isIsoDate(expiresRaw)) errors.expiresOn = "Enter a date";
  const provider = s(raw.provider) || null;
  const reference = s(raw.reference) || null;
  if (provider && provider.length > 120)
    errors.provider = "Keep it under 120 characters";
  if (reference && reference.length > 80)
    errors.reference = "Keep it under 80 characters";
  if (Object.keys(errors).length || !course) return invalid(errors);
  // Expiry: from the certificate if given, otherwise worked out from the course.
  const expiresOn =
    expiresRaw ||
    (course.validityMonths
      ? addMonths(completedOn, course.validityMonths)
      : null);
  if (expiresOn && expiresOn < completedOn)
    return invalid({ expiresOn: "The expiry can't be before completion" });

  let replaces: { id: string } | null = null;
  if (raw.replacesId) {
    const reason = s(raw.voidReason);
    if (reason.length < 3 || reason.length > 500)
      return invalid({
        voidReason: "Say briefly what was wrong (3 to 500 characters)",
      });
    const old =
      typeof raw.replacesId === "string" && isUuid(raw.replacesId)
        ? await tx.trainingRecord.findUnique({
            where: {
              tenantId_id: { tenantId: actor.tenantId, id: raw.replacesId },
            },
            select: {
              id: true,
              employeeId: true,
              courseId: true,
              voidedAt: true,
            },
          })
        : null;
    if (!old || old.employeeId !== e.id) return notFound("record");
    if (old.voidedAt)
      return conflict("That record has already been corrected.");
    if (old.courseId !== course.id)
      return invalid({ courseId: "A correction is for the same course" });
    await tx.trainingRecord.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: old.id } },
      data: {
        voidedAt: new Date(),
        voidedBy: actor.userId,
        voidReason: reason,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "training.record_voided",
      "training_record",
      old.id,
      {
        employeeId: e.id,
        corrected: true,
      },
    );
    replaces = old;
  }

  const created = await tx.trainingRecord.create({
    data: {
      tenantId: actor.tenantId,
      employeeId: e.id,
      courseId: course.id,
      courseVersion: course.contentVersion,
      method: course.kind === "external" ? "external_certificate" : "in_person",
      completedOn: asDate(completedOn),
      expiresOn: expiresOn ? asDate(expiresOn) : null,
      provider,
      reference,
      replacesId: replaces?.id ?? null,
      recordedBy: actor.userId,
    },
    select: { id: true },
  });
  // Ids and codes only: no provider, reference or reason in the audit trail.
  await audit(
    tx,
    actor,
    "training.record_added",
    "training_record",
    created.id,
    {
      employeeId: e.id,
      courseId: course.id,
      replacesId: replaces?.id ?? null,
    },
  );
  return { ok: true, data: created };
}

export async function voidRecord(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  recordId: string,
  rawReason: unknown,
): Promise<Result> {
  if (!actor.grants.has("training.record")) return forbidden();
  const e = await visiblePerson(tx, actor, employeeId, "training.record");
  if (!e || !isUuid(recordId)) return notFound("record");
  const r = await tx.trainingRecord.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: recordId } },
    select: { id: true, employeeId: true, voidedAt: true },
  });
  if (!r || r.employeeId !== e.id) return notFound("record");
  if (r.voidedAt) return conflict("This record is already void.");
  const reason = s(rawReason);
  if (reason.length < 3 || reason.length > 500)
    return invalid({ reason: "Say briefly why (3 to 500 characters)" });
  await tx.trainingRecord.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: r.id } },
    data: { voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason },
    select: { id: true },
  });
  await audit(tx, actor, "training.record_voided", "training_record", r.id, {
    employeeId: e.id,
    corrected: false,
  });
  return { ok: true, data: { id: r.id } };
}
