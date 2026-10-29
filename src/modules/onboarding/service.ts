// Onboarding service (M7.1, with the M7.2 document checklist). Every function receives a transaction already
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
import { rtwFactsFor } from "./compliance";
import {
  IDENTIFIER_MESSAGE,
  clearanceOf,
  documentProgressOf,
  looksLikeIdentifier,
  mayCloseDocument,
  type Clearance,
  type DocumentProgress,
  type RtwFacts,
} from "./compliance-policy";
import {
  activeMember,
  asDate,
  assignableMembers,
  audit,
  conflict,
  forbidden,
  invalid,
  isoOf,
  notFound,
  uniqueViolation,
  userNames,
  zodErrors,
  type Result,
} from "./shared";
import { SUGGESTED_TEMPLATES } from "./suggested";

export type { Result } from "./shared";

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
  // M7.2: document checklist (metadata only).
  documents: {
    orderBy: [{ createdAt: "asc" as const }],
    select: {
      id: true,
      title: true,
      required: true,
      status: true,
      expiresOn: true,
      reason: true,
      statusBy: true,
      statusAt: true,
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
  documents: DocumentProgress;
  /** Computed, never ticked by hand. Yes/no only: no right-to-work details. */
  clearance: Clearance;
  nextDue: { title: string; dueOn: string | null } | null;
}

const documentFacts = (c: CaseRow) =>
  c.documents.map((d) => ({
    required: d.required,
    status: d.status,
    expiresOn: isoOf(d.expiresOn),
  }));

function summarise(
  c: CaseRow,
  today: string,
  rtw: ReadonlyMap<string, RtwFacts>,
): CaseSummary {
  const progress = progressOf(taskFacts(c), today);
  const startDate = isoOf(c.startDate)!;
  const clearance = clearanceOf(
    progress,
    documentFacts(c),
    rtw.get(c.employeeId) ?? null,
    startDate,
    today,
  );
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
    startDate,
    ownerMembershipId: c.ownerMembershipId,
    progress,
    documents: documentProgressOf(documentFacts(c), clearance.on),
    clearance,
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
    notCleared: number;
    documentsExpiring: number;
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
  const rtw = await rtwFactsFor(tx, actor.tenantId, [
    ...rows.map((c) => c.employeeId),
    ...activeRows.map((c) => c.employeeId),
  ]);
  const soon = dueDate(today, 7);
  const active = activeRows.map((c) => summarise(c, today, rtw));
  return {
    stats: {
      active: active.length,
      startingSoon: active.filter(
        (c) => c.startDate >= today && c.startDate <= soon,
      ).length,
      overdueTasks: active.reduce((n, c) => n + c.progress.overdue, 0),
      readyForSignOff: active.filter((c) => c.progress.operationallyReady)
        .length,
      notCleared: active.filter((c) => !c.clearance.cleared).length,
      documentsExpiring: active.reduce(
        (n, c) => n + c.documents.expiringSoon + c.documents.expired,
        0,
      ),
    },
    cases: rows.map((c) => summarise(c, today, rtw)),
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
  return summarise(
    c,
    today,
    await rtwFactsFor(tx, actor.tenantId, [c.employeeId]),
  );
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
  // Who completed tasks, changed documents and signed off (user ids).
  const people = await userNames(tx, [
    ...c.tasks.map((t) => t.completedBy),
    ...c.documents.map((d) => d.statusBy),
    c.signedOffBy,
  ]);
  const isOwnRecord = c.employee.membershipId === actor.membershipId;
  const summary = summarise(
    c,
    today,
    await rtwFactsFor(tx, actor.tenantId, [c.employeeId]),
  );
  const progress = summary.progress;
  return {
    ...summary,
    templateVersion: c.templateVersion,
    ownerName: c.ownerMembershipId
      ? (names.get(c.ownerMembershipId) ?? "A former member")
      : null,
    signedOff: c.signedOffAt
      ? {
          at: c.signedOffAt,
          by: people.get(c.signedOffBy!) ?? "A former member",
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
        ? (people.get(t.completedBy) ?? "A former member")
        : null,
      onBehalf: t.onBehalf,
      waivedReason: t.waivedReason,
    })),
    documentList: c.documents.map((d) => ({
      id: d.id,
      title: d.title,
      required: d.required,
      status: d.status,
      expiresOn: isoOf(d.expiresOn),
      expired:
        d.expiresOn !== null &&
        (d.status === "seen" || d.status === "verified") &&
        isoOf(d.expiresOn)! < summary.clearance.on,
      reason: d.reason,
      changedByName: d.statusBy
        ? (people.get(d.statusBy) ?? "A former member")
        : null,
      changedAt: d.statusAt,
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
      // The full right-to-work record (restricted, audited when opened).
      viewRightToWork: canAt(actor, "rtw.view", c.siteId),
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

// --- Document checklist (M7.2, metadata only) --------------------------------------
// Records that a document was seen or verified, by whom and when, and when it
// expires. No file is stored. Right-to-work documents are never listed here:
// they are recorded in the right-to-work check.

async function editableCase(tx: TenantTx, actor: Actor, caseId: string) {
  const c = await loadCase(tx, actor, caseId);
  if (!c) return { error: notFound("onboarding") } as const;
  if (c.status !== "active")
    return { error: conflict("This onboarding is closed.") } as const;
  if (!canAt(actor, "onboarding.manage", c.siteId))
    return { error: forbidden() } as const;
  return { c } as const;
}

export async function addDocument(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  raw: { title?: unknown; required?: unknown },
): Promise<Result> {
  const found = await editableCase(tx, actor, caseId);
  if ("error" in found) return found.error!;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (title.length < 1 || title.length > 120)
    return invalid({ title: "Enter the document (up to 120 characters)" });
  if (looksLikeIdentifier(title)) return invalid({ title: IDENTIFIER_MESSAGE });
  if (RIGHT_TO_WORK_WORDS.test(title))
    return invalid({
      title:
        "Record right-to-work documents in the right-to-work check, not here.",
    });
  const required = raw.required === true;
  const created = await tx.onboardingDocument.create({
    data: {
      tenantId: actor.tenantId,
      caseId: found.c.id,
      title,
      required,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "onboarding.document_added",
    "onboarding_document",
    created.id,
    { caseId: found.c.id, required },
  );
  return { ok: true, data: created };
}

const RIGHT_TO_WORK_WORDS =
  /\b(right[\s-]to[\s-]work|passport|share code|e-?visa|visa|biometric residence|brp|immigration)\b/i;

export type DocumentCommand =
  | { kind: "seen" | "verified"; expiresOn: string | null }
  | { kind: "reject" | "waive"; reason: string }
  | { kind: "reopen" };

export async function updateDocument(
  tx: TenantTx,
  actor: Actor,
  caseId: string,
  documentId: string,
  cmd: DocumentCommand,
): Promise<Result> {
  const found = await editableCase(tx, actor, caseId);
  if ("error" in found) return found.error!;
  const { c } = found;
  const doc = c.documents.find((d) => d.id === documentId);
  if (!doc) return notFound("document");
  const where = { tenantId_id: { tenantId: actor.tenantId, id: doc.id } };
  const now = new Date();
  let action: string;
  if (cmd.kind === "seen" || cmd.kind === "verified") {
    if (doc.status === "waived")
      return conflict("This document was waived. Reopen it first.");
    if (cmd.expiresOn !== null && !isIsoDate(cmd.expiresOn))
      return invalid({ expiresOn: "Enter a date" });
    await tx.onboardingDocument.update({
      where,
      data: {
        status: cmd.kind,
        expiresOn: cmd.expiresOn ? asDate(cmd.expiresOn) : null,
        reason: null,
        statusBy: actor.userId,
        statusAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    action = `onboarding.document_${cmd.kind}`;
  } else if (cmd.kind === "reject" || cmd.kind === "waive") {
    if (doc.status === "waived" || doc.status === "rejected")
      return conflict("Reopen this document first.");
    const reason = (cmd.reason ?? "").trim();
    if (reason.length > 500)
      return invalid({ reason: "Keep it under 500 characters" });
    if (looksLikeIdentifier(reason))
      return invalid({ reason: IDENTIFIER_MESSAGE });
    const may = mayCloseDocument(
      actor,
      c.siteId,
      doc.required,
      cmd.kind,
      reason,
    );
    if (!may.ok)
      return "field" in may
        ? invalid({ reason: may.message })
        : forbidden(may.message);
    await tx.onboardingDocument.update({
      where,
      data: {
        status: cmd.kind === "reject" ? "rejected" : "waived",
        reason,
        statusBy: actor.userId,
        statusAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    // The reason is free text: kept on the record, not copied into the audit trail.
    action =
      cmd.kind === "reject"
        ? "onboarding.document_rejected"
        : "onboarding.document_waived";
  } else {
    if (doc.status === "requested")
      return conflict("This document is already open.");
    if (
      doc.status === "waived" &&
      doc.required &&
      !canAt(actor, "onboarding.signoff", c.siteId)
    )
      return forbidden(
        "Only an owner, administrator or HR manager can reopen a waived required document.",
      );
    await tx.onboardingDocument.update({
      where,
      data: {
        status: "requested",
        expiresOn: null,
        reason: null,
        statusBy: null,
        statusAt: null,
        updatedAt: now,
      },
      select: { id: true },
    });
    action = "onboarding.document_reopened";
  }
  await audit(tx, actor, action, "onboarding_document", doc.id, {
    caseId: c.id,
    required: doc.required,
  });
  return { ok: true, data: { id: doc.id } };
}
