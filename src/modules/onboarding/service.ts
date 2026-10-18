// Onboarding service (M7.1). Every function receives a transaction already
// scoped to one organisation by withTenant() (so RLS applies) and an Actor
// resolved from the server session. Permissions and site scope are checked
// here for every read and write; each change writes an audit event in the same
// transaction. Audit detail holds ids and codes only, never names.

import { z } from "zod";

import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  canAt,
  dueDate,
  hasAny,
  isIsoDate,
  isOverdue,
  maySignOff,
  mayWaive,
  orgWide,
  progressOf,
  templateSuits,
  type Actor,
  type Progress,
  type TemplateScope,
} from "./policy";
import { SUGGESTED_TEMPLATES } from "./suggested";

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

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType: "onboarding_template" | "onboarding_case" | "onboarding_task",
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

const uniqueViolation = (e: unknown) =>
  // Prisma's unique-constraint error code (the module can't import the client).
  typeof e === "object" &&
  e !== null &&
  (e as { code?: unknown }).code === "P2002";

// --- Templates ------------------------------------------------------------------

const CATEGORIES = ["task", "document", "induction", "policy"] as const;
const OWNERS = ["manager", "hr", "employee"] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const templateSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name").max(120),
    description: optionalText(1000),
    scope: z.enum(["organisation", "site", "job_title"]),
    siteId: z.string().optional().nullable(),
    jobTitle: optionalText(120),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "site" && !v.siteId)
      ctx.addIssue({
        code: "custom",
        path: ["siteId"],
        message: "Choose a site",
      });
    if (v.scope === "job_title" && !v.jobTitle)
      ctx.addIssue({
        code: "custom",
        path: ["jobTitle"],
        message: "Enter the job title",
      });
  });

const templateTaskSchema = z.object({
  title: z.string().trim().min(1, "Enter a task").max(160),
  guidance: optionalText(2000),
  category: z.enum(CATEGORIES),
  ownerKind: z.enum(OWNERS),
  dueOffsetDays: z.coerce
    .number()
    .int("Use whole days")
    .min(-90, "At most 90 days before the start")
    .max(365, "At most 365 days after the start"),
  required: z.coerce.boolean(),
});

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  scope: TemplateScope;
  siteId: string | null;
  siteName: string | null;
  jobTitle: string | null;
  isSuggested: boolean;
  version: number;
  archived: boolean;
  taskCount: number;
  requiredCount: number;
}

const canEditTemplates = (actor: Actor) =>
  orgWide(actor, "onboarding.template.manage");

/** Templates for the templates page (managers) or for starting a case. */
export async function listTemplates(
  tx: TenantTx,
  actor: Actor,
  opts: { includeArchived?: boolean } = {},
): Promise<TemplateSummary[] | null> {
  if (!canEditTemplates(actor) && !hasAny(actor, "onboarding.manage"))
    return null;
  const rows = await tx.onboardingTemplate.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(opts.includeArchived && canEditTemplates(actor)
        ? {}
        : { archivedAt: null }),
    },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      scope: true,
      siteId: true,
      jobTitle: true,
      isSuggested: true,
      version: true,
      archivedAt: true,
      site: { select: { name: true } },
      tasks: { where: { archivedAt: null }, select: { required: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    scope: t.scope,
    siteId: t.siteId,
    siteName: t.site?.name ?? null,
    jobTitle: t.jobTitle,
    isSuggested: t.isSuggested,
    version: t.version,
    archived: t.archivedAt !== null,
    taskCount: t.tasks.length,
    requiredCount: t.tasks.filter((x) => x.required).length,
  }));
}

export async function getTemplate(tx: TenantTx, actor: Actor, id: string) {
  if (!canEditTemplates(actor) || !isUuid(id)) return null;
  return tx.onboardingTemplate.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      name: true,
      description: true,
      scope: true,
      siteId: true,
      jobTitle: true,
      isSuggested: true,
      version: true,
      archivedAt: true,
      site: { select: { name: true } },
      tasks: {
        where: { archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          guidance: true,
          category: true,
          ownerKind: true,
          dueOffsetDays: true,
          required: true,
          sortOrder: true,
        },
      },
    },
  });
}

async function checkSite(
  tx: TenantTx,
  actor: Actor,
  siteId: string | null | undefined,
) {
  if (!siteId) return null;
  if (!isUuid(siteId)) return false;
  const site = await tx.site.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: siteId } },
    select: { status: true },
  });
  return site?.status === "active" ? siteId : false;
}

export async function saveTemplate(
  tx: TenantTx,
  actor: Actor,
  id: string | null,
  raw: unknown,
): Promise<Result> {
  if (!canEditTemplates(actor)) return forbidden();
  const parsed = templateSchema.safeParse(raw);
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const v = parsed.data;
  const siteId =
    v.scope === "site" ? await checkSite(tx, actor, v.siteId) : null;
  if (siteId === false) return invalid({ siteId: "Choose an active site" });
  const data = {
    name: v.name,
    description: v.description ?? null,
    scope: v.scope,
    siteId: v.scope === "site" ? siteId : null,
    jobTitle: v.scope === "job_title" ? (v.jobTitle ?? null) : null,
  };
  try {
    if (!id) {
      const created = await tx.onboardingTemplate.create({
        data: { tenantId: actor.tenantId, ...data, createdBy: actor.userId },
        select: { id: true },
      });
      await audit(
        tx,
        actor,
        "onboarding.template_created",
        "onboarding_template",
        created.id,
      );
      return { ok: true, data: created };
    }
    const existing = await activeTemplate(tx, actor, id);
    if (!existing) return notFound("template");
    await tx.onboardingTemplate.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id } },
      data: { ...data, version: existing.version + 1, updatedAt: new Date() },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "onboarding.template_updated",
      "onboarding_template",
      id,
      {
        version: existing.version + 1,
      },
    );
    return { ok: true, data: { id } };
  } catch (e) {
    if (uniqueViolation(e))
      return invalid({ name: "There's already a template with this name" });
    throw e;
  }
}

async function activeTemplate(tx: TenantTx, actor: Actor, id: string) {
  if (!isUuid(id)) return null;
  const t = await tx.onboardingTemplate.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: { id: true, version: true, archivedAt: true },
  });
  return t && !t.archivedAt ? t : null;
}

async function bumpVersion(
  tx: TenantTx,
  actor: Actor,
  templateId: string,
  version: number,
) {
  await tx.onboardingTemplate.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: templateId } },
    data: { version: version + 1, updatedAt: new Date() },
    select: { id: true },
  });
}

export async function archiveTemplate(
  tx: TenantTx,
  actor: Actor,
  id: string,
): Promise<Result> {
  if (!canEditTemplates(actor)) return forbidden();
  const t = await activeTemplate(tx, actor, id);
  if (!t) return notFound("template");
  await tx.onboardingTemplate.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    data: { archivedAt: new Date(), updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "onboarding.template_archived",
    "onboarding_template",
    id,
  );
  return { ok: true, data: { id } };
}

/** Add (taskId null) or edit a template task. Each change makes a new template version. */
export async function saveTemplateTask(
  tx: TenantTx,
  actor: Actor,
  templateId: string,
  taskId: string | null,
  raw: unknown,
): Promise<Result> {
  if (!canEditTemplates(actor)) return forbidden();
  const t = await activeTemplate(tx, actor, templateId);
  if (!t) return notFound("template");
  const parsed = templateTaskSchema.safeParse(raw);
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const v = parsed.data;
  const data = {
    title: v.title,
    guidance: v.guidance ?? null,
    category: v.category,
    ownerKind: v.ownerKind,
    dueOffsetDays: v.dueOffsetDays,
    required: v.required,
  };
  let id = taskId;
  if (!taskId) {
    const count = await tx.onboardingTemplateTask.count({
      where: { tenantId: actor.tenantId, templateId },
    });
    id = (
      await tx.onboardingTemplateTask.create({
        data: {
          tenantId: actor.tenantId,
          templateId,
          ...data,
          sortOrder: count,
        },
        select: { id: true },
      })
    ).id;
  } else {
    const existing = isUuid(taskId)
      ? await tx.onboardingTemplateTask.findUnique({
          where: { tenantId_id: { tenantId: actor.tenantId, id: taskId } },
          select: { templateId: true, archivedAt: true },
        })
      : null;
    if (!existing || existing.templateId !== templateId || existing.archivedAt)
      return notFound("task");
    await tx.onboardingTemplateTask.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: taskId } },
      data: { ...data, updatedAt: new Date() },
      select: { id: true },
    });
  }
  await bumpVersion(tx, actor, templateId, t.version);
  await audit(
    tx,
    actor,
    taskId
      ? "onboarding.template_task_updated"
      : "onboarding.template_task_added",
    "onboarding_template",
    templateId,
    {
      taskId: id,
      version: t.version + 1,
    },
  );
  return { ok: true, data: { id: id! } };
}

export async function archiveTemplateTask(
  tx: TenantTx,
  actor: Actor,
  templateId: string,
  taskId: string,
): Promise<Result> {
  if (!canEditTemplates(actor)) return forbidden();
  const t = await activeTemplate(tx, actor, templateId);
  if (!t || !isUuid(taskId)) return notFound("template");
  const existing = await tx.onboardingTemplateTask.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: taskId } },
    select: { templateId: true, archivedAt: true },
  });
  if (!existing || existing.templateId !== templateId || existing.archivedAt)
    return notFound("task");
  await tx.onboardingTemplateTask.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: taskId } },
    data: { archivedAt: new Date(), updatedAt: new Date() },
    select: { id: true },
  });
  await bumpVersion(tx, actor, templateId, t.version);
  await audit(
    tx,
    actor,
    "onboarding.template_task_removed",
    "onboarding_template",
    templateId,
    {
      taskId,
      version: t.version + 1,
    },
  );
  return { ok: true, data: { id: taskId } };
}

/** Adds the suggested UK hospitality templates that aren't already present. */
export async function addSuggestedTemplates(
  tx: TenantTx,
  actor: Actor,
): Promise<Result<{ added: number }>> {
  if (!canEditTemplates(actor)) return forbidden();
  const existing = new Set(
    (
      await tx.onboardingTemplate.findMany({
        where: { tenantId: actor.tenantId, archivedAt: null },
        select: { name: true },
      })
    ).map((t) => t.name.toLowerCase()),
  );
  let added = 0;
  for (const s of SUGGESTED_TEMPLATES) {
    if (existing.has(s.name.toLowerCase())) continue;
    const t = await tx.onboardingTemplate.create({
      data: {
        tenantId: actor.tenantId,
        name: s.name,
        description: s.description,
        isSuggested: true,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await tx.onboardingTemplateTask.createMany({
      data: s.tasks.map((task, i) => ({
        tenantId: actor.tenantId,
        templateId: t.id,
        title: task.title,
        guidance: task.guidance ?? null,
        category: task.category,
        ownerKind: task.owner,
        dueOffsetDays: task.due,
        required: task.required,
        sortOrder: i,
      })),
    });
    await audit(
      tx,
      actor,
      "onboarding.template_created",
      "onboarding_template",
      t.id,
      { suggested: true },
    );
    added++;
  }
  return { ok: true, data: { added } };
}

// --- Cases -----------------------------------------------------------------------

/** Employees the actor may start onboarding for (no open case yet). */
export async function startOptions(tx: TenantTx, actor: Actor) {
  if (!hasAny(actor, "onboarding.manage")) return null;
  const scope = actor.grants.get("onboarding.manage")!;
  const [employees, templates, members] = await Promise.all([
    tx.employee.findMany({
      where: {
        tenantId: actor.tenantId,
        status: { in: ["pending", "active"] },
        onboardingCases: { none: { status: "active" } },
        ...(scope === "all" ? {} : { primarySiteId: { in: [...scope] } }),
      },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        jobTitle: true,
        startDate: true,
        primarySiteId: true,
        primarySite: { select: { name: true } },
      },
    }),
    tx.onboardingTemplate.findMany({
      where: { tenantId: actor.tenantId, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        scope: true,
        siteId: true,
        jobTitle: true,
        isSuggested: true,
      },
    }),
    assignableMembers(tx, actor),
  ]);
  return {
    employees: employees.map((e) => ({
      id: e.id,
      name: `${e.preferredName || e.givenName} ${e.familyName}`,
      jobTitle: e.jobTitle,
      siteName: e.primarySite?.name ?? null,
      startDate: isoOf(e.startDate),
      suggestedTemplateIds: templates
        .filter((t) => templateSuits(t, e))
        .map((t) => t.id),
    })),
    templates,
    members,
  };
}

/** Active members (who can own a case or a task). */
export async function assignableMembers(tx: TenantTx, actor: Actor) {
  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId: actor.tenantId, status: "active" },
    select: { id: true, userId: true },
  });
  const users = await tx.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return memberships
    .map((m) => ({ id: m.id, name: names.get(m.userId) ?? "Member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function activeMember(tx: TenantTx, actor: Actor, membershipId: unknown) {
  if (
    membershipId === null ||
    membershipId === undefined ||
    membershipId === ""
  )
    return null;
  if (typeof membershipId !== "string" || !isUuid(membershipId)) return false;
  const m = await tx.tenantMembership.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: membershipId } },
    select: { status: true },
  });
  return m?.status === "active" ? membershipId : false;
}

export async function startCase(
  tx: TenantTx,
  actor: Actor,
  raw: {
    employeeId?: unknown;
    templateId?: unknown;
    startDate?: unknown;
    ownerMembershipId?: unknown;
  },
): Promise<Result> {
  if (!hasAny(actor, "onboarding.manage")) return forbidden();
  const errors: Record<string, string> = {};
  if (typeof raw.employeeId !== "string" || !isUuid(raw.employeeId))
    errors.employeeId = "Choose a person";
  if (typeof raw.templateId !== "string" || !isUuid(raw.templateId))
    errors.templateId = "Choose a template";
  if (!isIsoDate(raw.startDate)) errors.startDate = "Enter the start date";
  if (Object.keys(errors).length) return invalid(errors);
  const employee = await tx.employee.findUnique({
    where: {
      tenantId_id: { tenantId: actor.tenantId, id: raw.employeeId as string },
    },
    select: { id: true, status: true, primarySiteId: true },
  });
  // Other organisations' people and people outside your sites look the same: not found.
  if (!employee || !canAt(actor, "onboarding.manage", employee.primarySiteId))
    return notFound("person");
  if (employee.status === "left")
    return conflict("This person has left the organisation.");
  const template = await tx.onboardingTemplate.findUnique({
    where: {
      tenantId_id: { tenantId: actor.tenantId, id: raw.templateId as string },
    },
    select: {
      id: true,
      name: true,
      version: true,
      archivedAt: true,
      tasks: {
        where: { archivedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          guidance: true,
          category: true,
          ownerKind: true,
          dueOffsetDays: true,
          required: true,
        },
      },
    },
  });
  if (!template || template.archivedAt)
    return invalid({ templateId: "Choose an active template" });
  if (template.tasks.length === 0)
    return invalid({ templateId: "This template has no tasks yet" });
  const owner = await activeMember(tx, actor, raw.ownerMembershipId);
  if (owner === false)
    return invalid({ ownerMembershipId: "Choose an active member" });
  const ownerId = owner ?? actor.membershipId;
  const startDate = raw.startDate as string;
  try {
    const created = await tx.onboardingCase.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: employee.id,
        templateId: template.id,
        templateVersion: template.version,
        templateName: template.name,
        siteId: employee.primarySiteId,
        startDate: asDate(startDate),
        ownerMembershipId: ownerId,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    // The snapshot: tasks are copied, so later template edits never change this case.
    await tx.onboardingTask.createMany({
      data: template.tasks.map((t, i) => ({
        tenantId: actor.tenantId,
        caseId: created.id,
        templateTaskId: t.id,
        title: t.title,
        guidance: t.guidance,
        category: t.category,
        ownerKind: t.ownerKind,
        required: t.required,
        sortOrder: i,
        dueOn: asDate(dueDate(startDate, t.dueOffsetDays)),
        assigneeMembershipId: t.ownerKind === "manager" ? ownerId : null,
      })),
    });
    await audit(
      tx,
      actor,
      "onboarding.case_started",
      "onboarding_case",
      created.id,
      {
        employeeId: employee.id,
        templateId: template.id,
        templateVersion: template.version,
        tasks: template.tasks.length,
      },
    );
    return { ok: true, data: created };
  } catch (e) {
    if (uniqueViolation(e))
      return conflict("This person already has onboarding in progress.");
    throw e;
  }
}

type CaseSelect = NonNullable<
  NonNullable<Parameters<TenantTx["onboardingCase"]["findUnique"]>[0]>["select"]
>;

const caseSelect = {
  id: true,
  employeeId: true,
  templateName: true,
  templateVersion: true,
  siteId: true,
  status: true,
  startDate: true,
  ownerMembershipId: true,
  signedOffBy: true,
  signedOffAt: true,
  signOffNote: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  employee: {
    select: {
      givenName: true,
      familyName: true,
      preferredName: true,
      jobTitle: true,
      membershipId: true,
      status: true,
    },
  },
  site: { select: { name: true } },
  tasks: {
    orderBy: [{ sortOrder: "asc" as const }],
    select: {
      id: true,
      title: true,
      guidance: true,
      category: true,
      ownerKind: true,
      required: true,
      dueOn: true,
      assigneeMembershipId: true,
      status: true,
      completedAt: true,
      completedBy: true,
      onBehalf: true,
      waivedReason: true,
    },
  },
} satisfies CaseSelect;

const findCase = (tx: TenantTx, tenantId: string, id: string) =>
  tx.onboardingCase.findUnique({
    where: { tenantId_id: { tenantId, id } },
    select: caseSelect,
  });
type CaseRow = NonNullable<Awaited<ReturnType<typeof findCase>>>;
type CaseWhere = NonNullable<
  Parameters<TenantTx["onboardingCase"]["findMany"]>[0]
>["where"];

const taskFacts = (c: CaseRow) =>
  c.tasks.map((t) => ({
    required: t.required,
    status: t.status,
    dueOn: isoOf(t.dueOn),
  }));

export interface CaseSummary {
  id: string;
  employeeId: string;
  name: string;
  jobTitle: string | null;
  siteName: string | null;
  templateName: string;
  status: "active" | "completed" | "cancelled";
  startDate: string;
  ownerMembershipId: string | null;
  progress: Progress;
  nextDue: { title: string; dueOn: string | null } | null;
}

function summarise(c: CaseRow, today: string): CaseSummary {
  const next = c.tasks
    .filter((t) => t.status === "to_do")
    .sort((a, b) =>
      (isoOf(a.dueOn) ?? "9999").localeCompare(isoOf(b.dueOn) ?? "9999"),
    )[0];
  return {
    id: c.id,
    employeeId: c.employeeId,
    name: `${c.employee.preferredName || c.employee.givenName} ${c.employee.familyName}`,
    jobTitle: c.employee.jobTitle,
    siteName: c.site?.name ?? null,
    templateName: c.templateName,
    status: c.status,
    startDate: isoOf(c.startDate)!,
    ownerMembershipId: c.ownerMembershipId,
    progress: progressOf(taskFacts(c), today),
    nextDue: next ? { title: next.title, dueOn: isoOf(next.dueOn) } : null,
  };
}

/** Site filter for reads: null = everything, [] = nothing. */
function viewSites(actor: Actor): string[] | null {
  const scope = actor.grants.get("onboarding.view");
  if (!scope) return [];
  return scope === "all" ? null : [...scope];
}

export interface Dashboard {
  stats: {
    active: number;
    startingSoon: number;
    overdueTasks: number;
    readyForSignOff: number;
  };
  cases: CaseSummary[];
  sites: { id: string; name: string }[];
}

export async function dashboard(
  tx: TenantTx,
  actor: Actor,
  today: string,
  filter: { status?: string; siteId?: string } = {},
): Promise<Dashboard | null> {
  const sites = viewSites(actor);
  if (sites && sites.length === 0) return null;
  const status =
    (["active", "completed", "cancelled"] as const).find(
      (s) => s === filter.status,
    ) ?? "active";
  const siteFilter =
    filter.siteId && isUuid(filter.siteId) ? filter.siteId : undefined;
  const where: CaseWhere = {
    tenantId: actor.tenantId,
    ...(sites ? { siteId: { in: sites } } : {}),
  };
  const [rows, activeRows, siteRows] = await Promise.all([
    tx.onboardingCase.findMany({
      where: {
        ...where,
        status,
        ...(siteFilter ? { siteId: siteFilter } : {}),
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: caseSelect,
    }),
    tx.onboardingCase.findMany({
      where: { ...where, status: "active" },
      select: caseSelect,
    }),
    tx.site.findMany({
      where: {
        tenantId: actor.tenantId,
        status: "active",
        ...(sites ? { id: { in: sites } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const soon = dueDate(today, 7);
  const active = activeRows.map((c) => summarise(c, today));
  return {
    stats: {
      active: active.length,
      startingSoon: active.filter(
        (c) => c.startDate >= today && c.startDate <= soon,
      ).length,
      overdueTasks: active.reduce((n, c) => n + c.progress.overdue, 0),
      readyForSignOff: active.filter((c) => c.progress.operationallyReady)
        .length,
    },
    cases: rows.map((c) => summarise(c, today)),
    sites: siteRows,
  };
}

/** Onboarding for one employee (for the person page), or null if not visible. */
export async function caseForEmployee(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  today: string,
) {
  if (!isUuid(employeeId)) return null;
  const c = await tx.onboardingCase.findFirst({
    where: { tenantId: actor.tenantId, employeeId },
    orderBy: [{ createdAt: "desc" }],
    select: caseSelect,
  });
  if (!c || !canAt(actor, "onboarding.view", c.siteId)) return null;
  return summarise(c, today);
}

async function loadCase(tx: TenantTx, actor: Actor, caseId: string) {
  if (!isUuid(caseId)) return null;
  const c = await findCase(tx, actor.tenantId, caseId);
  return c && canAt(actor, "onboarding.view", c.siteId) ? c : null;
}

export async function getCase(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  today: string,
) {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return null;
  const members = await assignableMembers(tx, actor);
  const names = new Map(members.map((m) => [m.id, m.name]));
  // Who completed tasks (user ids) and who signed off.
  const userIds = [
    ...new Set(
      [...c.tasks.map((t) => t.completedBy), c.signedOffBy].filter(
        (v): v is string => !!v,
      ),
    ),
  ];
  const users = await tx.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userNames = new Map(users.map((u) => [u.id, u.name]));
  const isOwnRecord = c.employee.membershipId === actor.membershipId;
  const progress = progressOf(taskFacts(c), today);
  return {
    ...summarise(c, today),
    templateVersion: c.templateVersion,
    ownerName: c.ownerMembershipId
      ? (names.get(c.ownerMembershipId) ?? "A former member")
      : null,
    signedOff: c.signedOffAt
      ? {
          at: c.signedOffAt,
          by: userNames.get(c.signedOffBy!) ?? "A former member",
          note: c.signOffNote,
        }
      : null,
    cancelled: c.cancelledAt
      ? { at: c.cancelledAt, reason: c.cancelReason }
      : null,
    tasks: c.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      guidance: t.guidance,
      category: t.category,
      ownerKind: t.ownerKind,
      required: t.required,
      dueOn: isoOf(t.dueOn),
      overdue: isOverdue(
        { required: t.required, status: t.status, dueOn: isoOf(t.dueOn) },
        today,
      ),
      assigneeMembershipId: t.assigneeMembershipId,
      assigneeName: t.assigneeMembershipId
        ? (names.get(t.assigneeMembershipId) ?? "A former member")
        : null,
      status: t.status,
      completedAt: t.completedAt,
      completedByName: t.completedBy
        ? (userNames.get(t.completedBy) ?? "A former member")
        : null,
      onBehalf: t.onBehalf,
      waivedReason: t.waivedReason,
    })),
    members,
    can: {
      manage:
        c.status === "active" && canAt(actor, "onboarding.manage", c.siteId),
      waiveRequired:
        c.status === "active" && canAt(actor, "onboarding.signoff", c.siteId),
      signOff:
        c.status === "active" &&
        maySignOff(actor, c.siteId, progress, isOwnRecord).ok,
      signOffAuthorised: canAt(actor, "onboarding.signoff", c.siteId),
    },
    isOwnRecord,
  };
}

async function editableTask(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  taskId: string,
) {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return { error: notFound("onboarding") } as const;
  if (c.status !== "active")
    return { error: conflict("This onboarding is closed.") } as const;
  if (!canAt(actor, "onboarding.manage", c.siteId))
    return { error: forbidden() } as const;
  const task = c.tasks.find((t) => t.id === taskId);
  if (!task) return { error: notFound("task") } as const;
  return { c, task } as const;
}

export type TaskCommand =
  | { kind: "complete" }
  | { kind: "reopen" }
  | { kind: "waive"; reason: string }
  | {
      kind: "assign";
      assigneeMembershipId: string | null;
      dueOn: string | null;
    };

export async function updateTask(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  taskId: string,
  cmd: TaskCommand,
): Promise<Result> {
  const found = await editableTask(tx, actor, caseId, taskId);
  if ("error" in found) return found.error!;
  const { c, task } = found;
  const where = { tenantId_id: { tenantId: actor.tenantId, id: task.id } };
  const now = new Date();
  if (cmd.kind === "complete") {
    if (task.status !== "to_do")
      return conflict("This task is already finished.");
    // Tasks for the employee are done on their behalf until the employee view exists (M7.3).
    const onBehalf = task.ownerKind === "employee";
    await tx.onboardingTask.update({
      where,
      data: {
        status: "done",
        completedAt: now,
        completedBy: actor.userId,
        onBehalf,
        updatedAt: now,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "onboarding.task_completed",
      "onboarding_task",
      task.id,
      { caseId: c.id, onBehalf },
    );
  } else if (cmd.kind === "reopen") {
    if (task.status === "to_do") return conflict("This task is already open.");
    if (
      task.status === "waived" &&
      task.required &&
      !canAt(actor, "onboarding.signoff", c.siteId)
    )
      return forbidden(
        "Only an owner, administrator or HR manager can reopen an exception to a required task.",
      );
    await tx.onboardingTask.update({
      where,
      data: {
        status: "to_do",
        completedAt: null,
        completedBy: null,
        onBehalf: false,
        waivedReason: null,
        updatedAt: now,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "onboarding.task_reopened",
      "onboarding_task",
      task.id,
      { caseId: c.id },
    );
  } else if (cmd.kind === "waive") {
    if (task.status !== "to_do")
      return conflict("This task is already finished.");
    const reason = (cmd.reason ?? "").trim();
    if (reason.length > 500)
      return invalid({ reason: "Keep it under 500 characters" });
    const may = mayWaive(actor, c.siteId, task.required, reason);
    if (!may.ok)
      return reason.length < 3
        ? invalid({ reason: may.message })
        : forbidden(may.message);
    await tx.onboardingTask.update({
      where,
      data: {
        status: "waived",
        completedAt: now,
        completedBy: actor.userId,
        waivedReason: reason,
        updatedAt: now,
      },
      select: { id: true },
    });
    // The reason is free text: kept on the task, not copied into the audit trail.
    await audit(
      tx,
      actor,
      "onboarding.task_waived",
      "onboarding_task",
      task.id,
      { caseId: c.id, required: task.required },
    );
  } else {
    const assignee = await activeMember(tx, actor, cmd.assigneeMembershipId);
    if (assignee === false)
      return invalid({ assigneeMembershipId: "Choose an active member" });
    if (cmd.dueOn !== null && !isIsoDate(cmd.dueOn))
      return invalid({ dueOn: "Enter a date" });
    await tx.onboardingTask.update({
      where,
      data: {
        assigneeMembershipId: assignee,
        dueOn: cmd.dueOn ? asDate(cmd.dueOn) : null,
        updatedAt: now,
      },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "onboarding.task_reassigned",
      "onboarding_task",
      task.id,
      { caseId: c.id, assigneeMembershipId: assignee },
    );
  }
  return { ok: true, data: { id: task.id } };
}

export async function signOffCase(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  today: string,
  rawNote: unknown,
): Promise<Result> {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return notFound("onboarding");
  if (c.status !== "active") return conflict("This onboarding is closed.");
  const note = typeof rawNote === "string" ? rawNote.trim() : "";
  if (note.length > 500)
    return invalid({ note: "Keep it under 500 characters" });
  const decision = maySignOff(
    actor,
    c.siteId,
    progressOf(taskFacts(c), today),
    c.employee.membershipId === actor.membershipId,
  );
  if (!decision.ok)
    return canAt(actor, "onboarding.signoff", c.siteId)
      ? conflict(decision.message)
      : forbidden(decision.message);
  const now = new Date();
  await tx.onboardingCase.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: c.id } },
    data: {
      status: "completed",
      signedOffAt: now,
      signedOffBy: actor.userId,
      signOffNote: note || null,
      updatedAt: now,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "onboarding.case_signed_off",
    "onboarding_case",
    c.id,
    { employeeId: c.employeeId },
  );
  return { ok: true, data: { id: c.id } };
}

export async function cancelCase(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  rawReason: unknown,
): Promise<Result> {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return notFound("onboarding");
  if (c.status !== "active") return conflict("This onboarding is closed.");
  if (!canAt(actor, "onboarding.manage", c.siteId)) return forbidden();
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";
  if (reason.length < 3 || reason.length > 500)
    return invalid({ reason: "Give a short reason" });
  const now = new Date();
  await tx.onboardingCase.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: c.id } },
    data: {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: actor.userId,
      cancelReason: reason,
      updatedAt: now,
    },
    select: { id: true },
  });
  await audit(tx, actor, "onboarding.case_cancelled", "onboarding_case", c.id, {
    employeeId: c.employeeId,
  });
  return { ok: true, data: { id: c.id } };
}

export async function changeCaseOwner(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  membershipId: unknown,
): Promise<Result> {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return notFound("onboarding");
  if (c.status !== "active") return conflict("This onboarding is closed.");
  if (!canAt(actor, "onboarding.manage", c.siteId)) return forbidden();
  const owner = await activeMember(tx, actor, membershipId);
  if (!owner) return invalid({ ownerMembershipId: "Choose an active member" });
  await tx.onboardingCase.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: c.id } },
    data: { ownerMembershipId: owner, updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "onboarding.case_owner_changed",
    "onboarding_case",
    c.id,
    { ownerMembershipId: owner },
  );
  return { ok: true, data: { id: c.id } };
}
