// Recruitment service (M9.1). Every function receives a transaction scoped to
// one organisation by withTenant() (so RLS applies) and an Actor from the
// server session. Permissions and site scope (the vacancy's site) are checked
// here for every read and write; every change writes an audit event with ids
// and codes only: never names, contact details, notes, feedback or pay.

import { z } from "zod";

import { isUuid, type TenantTx } from "@/lib/tenancy";
import { nextEmployeeNumber } from "@/lib/workspace/employee-number";
import * as onboarding from "@/modules/onboarding";

import {
  WORKING_STAGES,
  canAt,
  isIsoDate,
  mayHire,
  mayMove,
  orgWide,
  parsePay,
  reviewDueOn,
  scopeSites,
  stageLabels,
  zonedToUtc,
  type Actor,
  type Stage,
} from "./policy";

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
const isoOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Thrown inside a transaction to roll it back with a friendly result. */
class Rollback extends Error {
  constructor(readonly result: Result<never>) {
    super(result.ok ? "" : result.message);
  }
}

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType:
    | "vacancy"
    | "candidate"
    | "application"
    | "interview"
    | "recruitment_settings",
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

const nameOf = (c: { givenName: string; familyName: string }) =>
  `${c.givenName} ${c.familyName}`;

// --- Settings -------------------------------------------------------------------------

async function settingsRow(tx: TenantTx, actor: Actor) {
  return tx.recruitmentSettings.findUnique({
    where: { tenantId: actor.tenantId },
    select: { stageLabels: true, retentionMonths: true },
  });
}

export async function getSettings(tx: TenantTx, actor: Actor) {
  if (
    !actor.grants.has("recruitment.view") &&
    !orgWide(actor, "recruitment.settings")
  )
    return null;
  const s = await settingsRow(tx, actor);
  return {
    labels: stageLabels(s?.stageLabels),
    retentionMonths: s?.retentionMonths ?? 6,
    canEdit: orgWide(actor, "recruitment.settings"),
  };
}

const settingsSchema = z.object({
  labels: z.record(
    z.string(),
    z.string().trim().max(40, "Keep labels under 40 characters"),
  ),
  retentionMonths: z.coerce
    .number()
    .int()
    .min(3, "At least 3 months")
    .max(12, "At most 12 months"),
});

export async function saveSettings(
  tx: TenantTx,
  actor: Actor,
  raw: unknown,
): Promise<Result> {
  if (!orgWide(actor, "recruitment.settings")) return forbidden();
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const labels = Object.fromEntries(
    Object.entries(parsed.data.labels).filter(
      ([k, v]) => (WORKING_STAGES as readonly string[]).includes(k) && v,
    ),
  );
  const row = await tx.recruitmentSettings.upsert({
    where: { tenantId: actor.tenantId },
    create: {
      tenantId: actor.tenantId,
      stageLabels: labels,
      retentionMonths: parsed.data.retentionMonths,
      updatedBy: actor.userId,
    },
    update: {
      stageLabels: labels,
      retentionMonths: parsed.data.retentionMonths,
      updatedBy: actor.userId,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "recruitment.settings_updated",
    "recruitment_settings",
    row.id,
    {
      retentionMonths: parsed.data.retentionMonths,
    },
  );
  return { ok: true, data: row };
}

// --- Vacancies ------------------------------------------------------------------------

const vacancySchema = z.object({
  title: z.string().trim().min(1, "Enter a title").max(120),
  jobTitle: z.string().trim().min(1, "Enter the job title").max(120),
  siteId: z.string(),
  teamId: z.string().optional().nullable(),
  employmentType: z.enum([
    "full_time",
    "part_time",
    "casual",
    "fixed_term",
    "seasonal",
  ]),
  description: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v || null)
    .nullable()
    .optional(),
  openings: z.coerce
    .number()
    .int()
    .min(1, "At least 1")
    .max(100, "At most 100"),
  closesOn: z.string().optional().nullable(),
  hiringManagerMembershipId: z.string().optional().nullable(),
  payMin: z.unknown().optional(),
  payMax: z.unknown().optional(),
  payPeriod: z.enum(["hour", "year"]).optional().nullable().or(z.literal("")),
});

const VACANCY_STATUSES = [
  "draft",
  "open",
  "paused",
  "filled",
  "closed",
] as const;

export async function vacancyOptions(tx: TenantTx, actor: Actor) {
  const scope = scopeSites(actor, "recruitment.manage");
  if (scope && scope.length === 0) return null;
  const [sites, teams, memberships] = await Promise.all([
    tx.site.findMany({
      where: {
        tenantId: actor.tenantId,
        status: "active",
        ...(scope ? { id: { in: scope } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    tx.team.findMany({
      where: {
        tenantId: actor.tenantId,
        archived: false,
        ...(scope ? { siteId: { in: scope } } : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, siteId: true },
    }),
    tx.tenantMembership.findMany({
      where: { tenantId: actor.tenantId, status: "active" },
      select: { id: true, userId: true },
    }),
  ]);
  const users = await tx.user.findMany({
    where: { id: { in: memberships.map((m) => m.userId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    sites,
    teams,
    members: memberships
      .map((m) => ({ id: m.id, name: names.get(m.userId) ?? "Member" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function loadVacancy(tx: TenantTx, actor: Actor, id: string) {
  if (!isUuid(id)) return null;
  return tx.vacancy.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      title: true,
      jobTitle: true,
      siteId: true,
      teamId: true,
      employmentType: true,
      description: true,
      openings: true,
      status: true,
      closesOn: true,
      hiringManagerMembershipId: true,
      payMin: true,
      payMax: true,
      payPeriod: true,
      createdAt: true,
      site: { select: { name: true } },
    },
  });
}

export async function saveVacancy(
  tx: TenantTx,
  actor: Actor,
  id: string | null,
  raw: unknown,
): Promise<Result> {
  if (!actor.grants.has("recruitment.manage")) return forbidden();
  const existing = id ? await loadVacancy(tx, actor, id) : null;
  if (id && (!existing || !canAt(actor, "recruitment.manage", existing.siteId)))
    return notFound("vacancy");
  const parsed = vacancySchema.safeParse(raw);
  if (!parsed.success) return invalid(zodErrors(parsed.error));
  const v = parsed.data;
  const errors: Record<string, string> = {};
  // The vacancy's site decides who sees it: it must be an active site you manage.
  const site = isUuid(v.siteId)
    ? await tx.site.findUnique({
        where: { tenantId_id: { tenantId: actor.tenantId, id: v.siteId } },
        select: { id: true, status: true },
      })
    : null;
  if (
    !site ||
    site.status !== "active" ||
    !canAt(actor, "recruitment.manage", site.id)
  )
    errors.siteId = "Choose an active site you recruit for";
  let teamId: string | null = null;
  if (v.teamId) {
    const team = isUuid(v.teamId)
      ? await tx.team.findUnique({
          where: { tenantId_id: { tenantId: actor.tenantId, id: v.teamId } },
          select: { id: true, siteId: true, archived: true },
        })
      : null;
    if (!team || team.archived || team.siteId !== site?.id)
      errors.teamId = "Choose a team at the vacancy's site";
    else teamId = team.id;
  }
  let hiringManager: string | null = null;
  if (v.hiringManagerMembershipId) {
    const m = isUuid(v.hiringManagerMembershipId)
      ? await tx.tenantMembership.findUnique({
          where: {
            tenantId_id: {
              tenantId: actor.tenantId,
              id: v.hiringManagerMembershipId,
            },
          },
          select: { id: true, status: true },
        })
      : null;
    if (m?.status !== "active")
      errors.hiringManagerMembershipId = "Choose an active member";
    else hiringManager = m.id;
  }
  if (v.closesOn && !isIsoDate(v.closesOn)) errors.closesOn = "Enter a date";
  // Pay: optional decimal strings, never floats.
  const payMin = parsePay(v.payMin);
  const payMax = parsePay(v.payMax);
  const payPeriod = v.payPeriod || null;
  if (payMin === false) errors.payMin = "Enter an amount like 12.50";
  if (payMax === false) errors.payMax = "Enter an amount like 12.50";
  if (payMin && !payPeriod) errors.payPeriod = "Choose per hour or per year";
  if (!payMin && (payMax || payPeriod))
    errors.payMin = "Enter the minimum pay, or leave all pay fields blank";
  if (payMin && payMax && Number(payMax) < Number(payMin))
    errors.payMax = "The maximum can't be below the minimum";
  if (Object.keys(errors).length) return invalid(errors);
  const data = {
    title: v.title,
    jobTitle: v.jobTitle,
    siteId: site!.id,
    teamId,
    employmentType: v.employmentType,
    description: v.description ?? null,
    openings: v.openings,
    closesOn: v.closesOn ? asDate(v.closesOn) : null,
    hiringManagerMembershipId: hiringManager,
    payMin: payMin || null,
    payMax: payMax || null,
    payPeriod: payMin ? payPeriod : null,
  };
  if (!existing) {
    const created = await tx.vacancy.create({
      data: { tenantId: actor.tenantId, ...data, createdBy: actor.userId },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "recruitment.vacancy_created",
      "vacancy",
      created.id,
      {
        siteId: data.siteId,
      },
    );
    return { ok: true, data: created };
  }
  await tx.vacancy.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: existing.id } },
    data: { ...data, updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "recruitment.vacancy_updated",
    "vacancy",
    existing.id,
    {
      siteId: data.siteId,
    },
  );
  return { ok: true, data: { id: existing.id } };
}

export async function setVacancyStatus(
  tx: TenantTx,
  actor: Actor,
  id: string,
  status: unknown,
): Promise<Result> {
  const v = await loadVacancy(tx, actor, id);
  if (!v || !canAt(actor, "recruitment.view", v.siteId))
    return notFound("vacancy");
  if (!canAt(actor, "recruitment.manage", v.siteId)) return forbidden();
  const next = VACANCY_STATUSES.find((s) => s === status);
  if (!next) return invalid({ status: "Choose a status" });
  if (next === v.status) return conflict("It already has that status.");
  await tx.vacancy.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: v.id } },
    data: { status: next, updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "recruitment.vacancy_status_changed",
    "vacancy",
    v.id,
    {
      from: v.status,
      to: next,
    },
  );
  return { ok: true, data: { id: v.id } };
}

export async function listVacancies(
  tx: TenantTx,
  actor: Actor,
  filter: { status?: string; siteId?: string } = {},
) {
  const scope = scopeSites(actor, "recruitment.view");
  if (scope && scope.length === 0) return null;
  const status = VACANCY_STATUSES.find((s) => s === filter.status);
  const rows = await tx.vacancy.findMany({
    where: {
      tenantId: actor.tenantId,
      ...(scope ? { siteId: { in: scope } } : {}),
      ...(filter.siteId && isUuid(filter.siteId)
        ? { siteId: filter.siteId }
        : {}),
      ...(status
        ? { status }
        : { status: { in: ["draft", "open", "paused"] as const } }),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
    select: {
      id: true,
      title: true,
      jobTitle: true,
      status: true,
      openings: true,
      closesOn: true,
      employmentType: true,
      site: { select: { name: true } },
      applications: { select: { stage: true, outcome: true } },
    },
  });
  const sites = await tx.site.findMany({
    where: {
      tenantId: actor.tenantId,
      status: "active",
      ...(scope ? { id: { in: scope } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const s = await settingsRow(tx, actor);
  return {
    labels: stageLabels(s?.stageLabels),
    sites,
    canCreate: actor.grants.has("recruitment.manage"),
    vacancies: rows.map((v) => {
      const counts = Object.fromEntries(
        WORKING_STAGES.map((st) => [st, 0]),
      ) as Record<string, number>;
      for (const a of v.applications)
        if (a.outcome === "active") counts[a.stage]!++;
      return {
        id: v.id,
        title: v.title,
        jobTitle: v.jobTitle,
        status: v.status,
        employmentType: v.employmentType,
        siteName: v.site.name,
        openings: v.openings,
        closesOn: isoOf(v.closesOn),
        active: v.applications.filter((a) => a.outcome === "active").length,
        hired: v.applications.filter((a) => a.outcome === "hired").length,
        counts,
      };
    }),
  };
}

export async function getVacancy(tx: TenantTx, actor: Actor, id: string) {
  const v = await loadVacancy(tx, actor, id);
  if (!v || !canAt(actor, "recruitment.view", v.siteId)) return null;
  const apps = await tx.application.findMany({
    where: { tenantId: actor.tenantId, vacancyId: v.id },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      stage: true,
      outcome: true,
      appliedOn: true,
      candidate: {
        select: { givenName: true, familyName: true, anonymisedAt: true },
      },
    },
  });
  const s = await settingsRow(tx, actor);
  const canManage = canAt(actor, "recruitment.manage", v.siteId);
  return {
    vacancy: {
      ...v,
      siteName: v.site.name,
      closesOn: isoOf(v.closesOn),
      payMin: v.payMin?.toFixed(2) ?? null,
      payMax: v.payMax?.toFixed(2) ?? null,
    },
    labels: stageLabels(s?.stageLabels),
    applications: apps.map((a) => ({
      id: a.id,
      name: nameOf(a.candidate),
      anonymised: a.candidate.anonymisedAt !== null,
      stage: a.stage as Stage,
      outcome: a.outcome,
      appliedOn: isoOf(a.appliedOn)!,
    })),
    hired: apps.filter((a) => a.outcome === "hired").length,
    options: canManage ? await vacancyOptions(tx, actor) : null,
    can: { manage: canManage },
  };
}

// --- Candidates and applications ----------------------------------------------------------

const normEmail = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;

/**
 * Possible matches for an email (decision D1: suggestions only, never merged).
 * Shows only what the actor may see: name, and their applications at sites in scope.
 */
export async function possibleMatches(
  tx: TenantTx,
  actor: Actor,
  emailRaw: unknown,
) {
  const scope = scopeSites(actor, "recruitment.view");
  const email = normEmail(emailRaw);
  if (!email || (scope && scope.length === 0)) return [];
  const rows = await tx.candidate.findMany({
    where: { tenantId: actor.tenantId, email, anonymisedAt: null },
    take: 10,
    select: {
      id: true,
      givenName: true,
      familyName: true,
      applications: {
        where: scope ? { vacancy: { siteId: { in: scope } } } : {},
        select: { vacancy: { select: { title: true } } },
      },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    name: nameOf(c),
    vacancies: c.applications.map((a) => a.vacancy.title),
  }));
}

const candidateSchema = z.object({
  givenName: z.string().trim().min(1, "Enter a first name").max(100),
  familyName: z.string().trim().min(1, "Enter a last name").max(100),
  email: z
    .union([z.literal(""), z.email("Enter a valid email address").max(254)])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null)
    .refine(
      (v) => v === null || (v.length >= 5 && /^[+\d][\d\s()-]*$/.test(v)),
      {
        message: "Enter a valid phone number",
      },
    ),
  source: z.enum(["manual", "referral", "agency"]).default("manual"),
});

async function event(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
  from: Stage | null,
  to: Stage,
) {
  await tx.applicationEvent.create({
    data: {
      tenantId: actor.tenantId,
      applicationId,
      fromStage: from,
      toStage: to,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
}

export async function addApplication(
  tx: TenantTx,
  actor: Actor,
  vacancyId: string,
  raw: {
    candidateId?: unknown;
    givenName?: unknown;
    familyName?: unknown;
    email?: unknown;
    phone?: unknown;
    source?: unknown;
    confirmNew?: unknown;
  },
): Promise<Result> {
  const v = await loadVacancy(tx, actor, vacancyId);
  if (!v || !canAt(actor, "recruitment.view", v.siteId))
    return notFound("vacancy");
  if (!canAt(actor, "recruitment.manage", v.siteId)) return forbidden();
  if (v.status === "closed" || v.status === "filled")
    return conflict("This vacancy is closed. Reopen it to add applicants.");
  let candidateId: string;
  if (typeof raw.candidateId === "string" && raw.candidateId) {
    // Reusing an existing candidate is always an explicit choice.
    const c = isUuid(raw.candidateId)
      ? await tx.candidate.findUnique({
          where: {
            tenantId_id: { tenantId: actor.tenantId, id: raw.candidateId },
          },
          select: { id: true, anonymisedAt: true },
        })
      : null;
    if (!c || c.anonymisedAt)
      return invalid({ candidateId: "Choose a current candidate" });
    candidateId = c.id;
  } else {
    const parsed = candidateSchema.safeParse({
      ...raw,
      source: raw.source || undefined,
    });
    if (!parsed.success) return invalid(zodErrors(parsed.error));
    const c = parsed.data;
    if (c.email && raw.confirmNew !== true) {
      const matches = await possibleMatches(tx, actor, c.email);
      if (matches.length)
        return invalid(
          {
            email: `${matches.length === 1 ? "A candidate" : `${matches.length} candidates`} already use this email. Choose them under "Existing candidate", or tick "This is a different person".`,
          },
          "Possible existing candidate",
        );
    }
    candidateId = (
      await tx.candidate.create({
        data: {
          tenantId: actor.tenantId,
          givenName: c.givenName,
          familyName: c.familyName,
          email: c.email,
          phone: c.phone,
          source: c.source,
          createdBy: actor.userId,
        },
        select: { id: true },
      })
    ).id;
    await audit(
      tx,
      actor,
      "recruitment.candidate_created",
      "candidate",
      candidateId,
    );
  }
  try {
    const app = await tx.application.create({
      data: {
        tenantId: actor.tenantId,
        candidateId,
        vacancyId: v.id,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await event(tx, actor, app.id, null, "applied");
    await audit(
      tx,
      actor,
      "recruitment.application_added",
      "application",
      app.id,
      {
        vacancyId: v.id,
        candidateId,
      },
    );
    return { ok: true, data: app };
  } catch (e) {
    if (uniqueViolation(e))
      throw new Rollback(
        conflict("This candidate has already applied for this vacancy."),
      );
    throw e;
  }
}

async function loadApplication(tx: TenantTx, actor: Actor, id: string) {
  if (!isUuid(id)) return null;
  return tx.application.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      stage: true,
      outcome: true,
      appliedOn: true,
      rejectionReason: true,
      closedAt: true,
      hiredEmployeeId: true,
      hiredAt: true,
      candidateId: true,
      candidate: {
        select: {
          givenName: true,
          familyName: true,
          email: true,
          phone: true,
          source: true,
          anonymisedAt: true,
        },
      },
      vacancy: {
        select: {
          id: true,
          title: true,
          jobTitle: true,
          siteId: true,
          teamId: true,
          status: true,
          site: { select: { name: true } },
        },
      },
    },
  });
}

/** Membership ids interviewing for this application (not removed). */
async function interviewerOf(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
) {
  const n = await tx.interviewInterviewer.count({
    where: {
      tenantId: actor.tenantId,
      membershipId: actor.membershipId,
      removedAt: null,
      interview: { applicationId },
    },
  });
  return n > 0;
}

export async function getApplication(
  tx: TenantTx,
  actor: Actor,
  id: string,
  timeZone: string,
) {
  const a = await loadApplication(tx, actor, id);
  if (!a) return null;
  const full = canAt(actor, "recruitment.view", a.vacancy.siteId);
  // Interviewers without recruitment access see only what they need for their interviews.
  if (!full && !(await interviewerOf(tx, actor, a.id))) return null;
  const [events, notes, interviews, settings] = await Promise.all([
    full
      ? tx.applicationEvent.findMany({
          where: { tenantId: actor.tenantId, applicationId: a.id },
          orderBy: { occurredAt: "asc" },
          select: {
            id: true,
            fromStage: true,
            toStage: true,
            actorUserId: true,
            occurredAt: true,
          },
        })
      : Promise.resolve([]),
    full
      ? tx.applicationNote.findMany({
          where: { tenantId: actor.tenantId, applicationId: a.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            body: true,
            authorUserId: true,
            createdAt: true,
            redactedAt: true,
          },
        })
      : Promise.resolve([]),
    tx.interview.findMany({
      where: {
        tenantId: actor.tenantId,
        applicationId: a.id,
        ...(full
          ? {}
          : {
              interviewers: {
                some: { membershipId: actor.membershipId, removedAt: null },
              },
            }),
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        scheduledAt: true,
        durationMinutes: true,
        format: true,
        location: true,
        status: true,
        outcome: true,
        feedback: true,
        feedbackBy: true,
        feedbackAt: true,
        interviewers: {
          where: { removedAt: null },
          select: { membershipId: true },
        },
      },
    }),
    settingsRow(tx, actor),
  ]);
  const memberships = await tx.tenantMembership.findMany({
    where: { tenantId: actor.tenantId },
    select: { id: true, userId: true, status: true },
  });
  const userIds = [
    ...memberships.map((m) => m.userId),
    ...events.map((e) => e.actorUserId),
    ...notes.map((n) => n.authorUserId),
    ...interviews.map((i) => i.feedbackBy),
  ].filter((v): v is string => !!v);
  const users = await tx.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const memberName = new Map(
    memberships.map((m) => [m.id, userName.get(m.userId) ?? "A former member"]),
  );
  const canManage =
    full && canAt(actor, "recruitment.manage", a.vacancy.siteId);
  const canHire =
    full &&
    a.outcome === "active" &&
    canAt(actor, "recruitment.hire", a.vacancy.siteId) &&
    canAt(actor, "employee.manage", a.vacancy.siteId);
  const templates =
    canHire && canAt(actor, "onboarding.manage", a.vacancy.siteId)
      ? ((await onboarding.listTemplates(tx, actor)) ?? [])
      : [];
  return {
    id: a.id,
    full,
    labels: stageLabels(settings?.stageLabels),
    stage: a.stage as Stage,
    outcome: a.outcome,
    appliedOn: isoOf(a.appliedOn)!,
    rejectionReason: a.rejectionReason,
    closedAt: a.closedAt,
    hiredEmployeeId: a.hiredEmployeeId,
    candidate: {
      id: a.candidateId,
      name: nameOf(a.candidate),
      anonymised: a.candidate.anonymisedAt !== null,
      // Contact details only for people with recruitment access.
      email: full ? a.candidate.email : null,
      phone: full ? a.candidate.phone : null,
      source: a.candidate.source,
    },
    vacancy: {
      id: a.vacancy.id,
      title: a.vacancy.title,
      jobTitle: a.vacancy.jobTitle,
      siteName: a.vacancy.site.name,
    },
    history: events.map((e) => ({
      id: e.id,
      from: e.fromStage as Stage | null,
      to: e.toStage as Stage,
      by: e.actorUserId
        ? (userName.get(e.actorUserId) ?? "A former member")
        : "System",
      at: e.occurredAt,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      redacted: n.redactedAt !== null,
      by: userName.get(n.authorUserId) ?? "A former member",
      at: n.createdAt,
    })),
    interviews: interviews.map((i) => ({
      id: i.id,
      scheduledAt: i.scheduledAt,
      durationMinutes: i.durationMinutes,
      format: i.format,
      location: i.location,
      status: i.status,
      outcome: i.outcome,
      feedback: i.feedback,
      feedbackBy: i.feedbackBy
        ? (userName.get(i.feedbackBy) ?? "A former member")
        : null,
      feedbackAt: i.feedbackAt,
      interviewers: i.interviewers.map((x) => ({
        id: x.membershipId,
        name: memberName.get(x.membershipId) ?? "A former member",
      })),
      mine: i.interviewers.some((x) => x.membershipId === actor.membershipId),
    })),
    members: canManage
      ? memberships
          .filter((m) => m.status === "active")
          .map((m) => ({ id: m.id, name: memberName.get(m.id)! }))
          .sort((x, y) => x.name.localeCompare(y.name))
      : [],
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    timeZone,
    can: {
      manage: canManage && a.outcome === "active",
      note: canManage,
      hire: canHire && mayHire(a.outcome, a.stage as Stage).ok,
      hireAuthorised: canHire,
      startOnboarding: templates.length > 0,
    },
  };
}

async function editableApplication(tx: TenantTx, actor: Actor, id: string) {
  const a = await loadApplication(tx, actor, id);
  if (!a || !canAt(actor, "recruitment.view", a.vacancy.siteId))
    return { error: notFound("application") } as const;
  if (!canAt(actor, "recruitment.manage", a.vacancy.siteId))
    return { error: forbidden() } as const;
  return { a } as const;
}

export async function moveStage(
  tx: TenantTx,
  actor: Actor,
  id: string,
  to: unknown,
): Promise<Result> {
  const found = await editableApplication(tx, actor, id);
  if ("error" in found) return found.error!;
  const { a } = found;
  const decision = mayMove(a.outcome, a.stage as Stage, String(to));
  if (!decision.ok) return conflict(decision.message);
  const next = to as Stage;
  await tx.application.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: a.id } },
    data: { stage: next, updatedAt: new Date() },
    select: { id: true },
  });
  await event(tx, actor, a.id, a.stage as Stage, next);
  await audit(tx, actor, "recruitment.stage_changed", "application", a.id, {
    from: a.stage,
    to: next,
  });
  return { ok: true, data: { id: a.id } };
}

const REJECTION_REASONS = [
  "not_suitable",
  "role_filled",
  "no_response",
  "other",
] as const;

export async function closeApplication(
  tx: TenantTx,
  actor: Actor,
  id: string,
  cmd: { kind: "reject"; reason: unknown } | { kind: "withdraw" },
): Promise<Result> {
  const found = await editableApplication(tx, actor, id);
  if ("error" in found) return found.error!;
  const { a } = found;
  if (a.outcome !== "active") return conflict("This application is closed.");
  const reason =
    cmd.kind === "reject"
      ? REJECTION_REASONS.find((r) => r === cmd.reason)
      : undefined;
  if (cmd.kind === "reject" && !reason)
    return invalid({ reason: "Choose a reason" });
  const stage = cmd.kind === "reject" ? "rejected" : "withdrawn";
  await tx.application.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: a.id } },
    data: {
      stage,
      outcome: stage,
      rejectionReason: reason ?? null,
      closedAt: new Date(),
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  await event(tx, actor, a.id, a.stage as Stage, stage);
  await audit(
    tx,
    actor,
    `recruitment.application_${stage}`,
    "application",
    a.id,
    {
      reason: reason ?? null,
    },
  );
  return { ok: true, data: { id: a.id } };
}

export async function addNote(
  tx: TenantTx,
  actor: Actor,
  id: string,
  rawBody: unknown,
): Promise<Result> {
  const found = await editableApplication(tx, actor, id);
  if ("error" in found) return found.error!;
  if (found.a.candidate.anonymisedAt)
    return conflict("This candidate has been anonymised.");
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (body.length < 1 || body.length > 2000)
    return invalid({ body: "Write a note (up to 2000 characters)" });
  const note = await tx.applicationNote.create({
    data: {
      tenantId: actor.tenantId,
      applicationId: found.a.id,
      authorUserId: actor.userId,
      body,
    },
    select: { id: true },
  });
  // The note itself is never copied into the audit trail.
  await audit(tx, actor, "recruitment.note_added", "application", found.a.id, {
    noteId: note.id,
  });
  return { ok: true, data: note };
}

// --- Interviews ---------------------------------------------------------------------------

const interviewSchema = z.object({
  durationMinutes: z.coerce
    .number()
    .int()
    .min(5, "At least 5 minutes")
    .max(480, "At most 8 hours"),
  format: z.enum(["in_person", "phone", "video"]),
  location: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),
});

async function activeMemberIds(tx: TenantTx, actor: Actor, raw: unknown) {
  const ids = [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw]).filter(
        (v) => typeof v === "string" && v,
      ),
    ),
  ] as string[];
  if (ids.some((v) => !isUuid(v))) return null;
  const found = await tx.tenantMembership.findMany({
    where: { tenantId: actor.tenantId, id: { in: ids }, status: "active" },
    select: { id: true },
  });
  return found.length === ids.length ? ids : null;
}

export async function scheduleInterview(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
  timeZone: string,
  raw: {
    scheduledAt?: unknown;
    durationMinutes?: unknown;
    format?: unknown;
    location?: unknown;
    interviewerIds?: unknown;
  },
): Promise<Result> {
  const found = await editableApplication(tx, actor, applicationId);
  if ("error" in found) return found.error!;
  if (found.a.outcome !== "active")
    return conflict("This application is closed.");
  const parsed = interviewSchema.safeParse(raw);
  const errors: Record<string, string> = parsed.success
    ? {}
    : zodErrors(parsed.error);
  const at = zonedToUtc(raw.scheduledAt, timeZone);
  if (!at) errors.scheduledAt = "Enter the date and time";
  const interviewers = await activeMemberIds(tx, actor, raw.interviewerIds);
  if (!interviewers || interviewers.length === 0)
    errors.interviewerIds = "Choose at least one interviewer";
  if (Object.keys(errors).length || !parsed.success) return invalid(errors);
  const created = await tx.interview.create({
    data: {
      tenantId: actor.tenantId,
      applicationId: found.a.id,
      scheduledAt: at!,
      durationMinutes: parsed.data.durationMinutes,
      format: parsed.data.format,
      location: parsed.data.location,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await tx.interviewInterviewer.createMany({
    data: interviewers!.map((membershipId) => ({
      tenantId: actor.tenantId,
      interviewId: created.id,
      membershipId,
    })),
  });
  await audit(
    tx,
    actor,
    "recruitment.interview_scheduled",
    "interview",
    created.id,
    {
      applicationId: found.a.id,
      interviewers: interviewers!.length,
    },
  );
  return { ok: true, data: created };
}

export type InterviewCommand =
  | {
      kind: "reschedule";
      scheduledAt: unknown;
      durationMinutes: unknown;
      format: unknown;
      location: unknown;
    }
  | { kind: "cancel" }
  | { kind: "no_show" }
  | { kind: "feedback"; outcome: unknown; feedback: unknown };

const OUTCOMES = ["progress", "hold", "do_not_progress"] as const;

export async function updateInterview(
  tx: TenantTx,
  actor: Actor,
  interviewId: string,
  timeZone: string,
  cmd: InterviewCommand,
): Promise<Result> {
  if (!isUuid(interviewId)) return notFound("interview");
  const i = await tx.interview.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: interviewId } },
    select: {
      id: true,
      status: true,
      applicationId: true,
      interviewers: {
        where: { removedAt: null },
        select: { membershipId: true },
      },
      application: {
        select: {
          outcome: true,
          vacancy: { select: { siteId: true } },
          candidate: { select: { anonymisedAt: true } },
        },
      },
    },
  });
  if (!i) return notFound("interview");
  const siteId = i.application.vacancy.siteId;
  const isInterviewer = i.interviewers.some(
    (x) => x.membershipId === actor.membershipId,
  );
  const canView = canAt(actor, "recruitment.view", siteId);
  if (!canView && !isInterviewer) return notFound("interview");
  const canManage = canAt(actor, "recruitment.manage", siteId);
  // Interviewers record feedback for their own interviews; everything else needs manage.
  if (!(canManage || (cmd.kind === "feedback" && isInterviewer)))
    return forbidden();
  if (i.application.candidate.anonymisedAt)
    return conflict("This candidate has been anonymised.");
  const where = { tenantId_id: { tenantId: actor.tenantId, id: i.id } };
  const now = new Date();
  if (cmd.kind === "feedback") {
    if (i.status === "cancelled")
      return conflict("This interview was cancelled.");
    const outcome = OUTCOMES.find((o) => o === cmd.outcome);
    if (!outcome) return invalid({ outcome: "Choose an outcome" });
    const feedback =
      typeof cmd.feedback === "string" ? cmd.feedback.trim() : "";
    if (feedback.length > 4000)
      return invalid({ feedback: "Keep it under 4000 characters" });
    await tx.interview.update({
      where,
      data: {
        status: "completed",
        outcome,
        feedback: feedback || null,
        feedbackBy: actor.userId,
        feedbackAt: now,
        updatedAt: now,
      },
      select: { id: true },
    });
    // The feedback text is never copied into the audit trail.
    await audit(
      tx,
      actor,
      "recruitment.interview_feedback",
      "interview",
      i.id,
      { outcome },
    );
    return { ok: true, data: { id: i.id } };
  }
  if (i.status !== "scheduled")
    return conflict("Only scheduled interviews can be changed.");
  if (i.application.outcome !== "active")
    return conflict("This application is closed.");
  if (cmd.kind === "reschedule") {
    const parsed = interviewSchema.safeParse(cmd);
    const errors: Record<string, string> = parsed.success
      ? {}
      : zodErrors(parsed.error);
    const at = zonedToUtc(cmd.scheduledAt, timeZone);
    if (!at) errors.scheduledAt = "Enter the date and time";
    if (Object.keys(errors).length || !parsed.success) return invalid(errors);
    await tx.interview.update({
      where,
      data: { scheduledAt: at!, ...parsed.data, updatedAt: now },
      select: { id: true },
    });
    await audit(
      tx,
      actor,
      "recruitment.interview_rescheduled",
      "interview",
      i.id,
    );
    return { ok: true, data: { id: i.id } };
  }
  const status = cmd.kind === "cancel" ? "cancelled" : "no_show";
  await tx.interview.update({
    where,
    data: { status, updatedAt: now },
    select: { id: true },
  });
  await audit(tx, actor, `recruitment.interview_${status}`, "interview", i.id);
  return { ok: true, data: { id: i.id } };
}

/** The internal interview schedule: everything in view scope, plus your own (the last week and the next eight by default). */
export async function interviewSchedule(
  tx: TenantTx,
  actor: Actor,
  window: { from: Date; to: Date } = {
    from: new Date(Date.now() - 7 * 86_400_000),
    to: new Date(Date.now() + 56 * 86_400_000),
  },
) {
  const scope = scopeSites(actor, "recruitment.view");
  const mine = {
    interviewers: {
      some: { membershipId: actor.membershipId, removedAt: null },
    },
  };
  const rows = await tx.interview.findMany({
    where: {
      tenantId: actor.tenantId,
      scheduledAt: { gte: window.from, lt: window.to },
      status: { in: ["scheduled", "completed", "no_show"] },
      OR: [
        mine,
        ...(scope === null
          ? [{}]
          : scope.length
            ? [{ application: { vacancy: { siteId: { in: scope } } } }]
            : []),
      ],
    },
    orderBy: { scheduledAt: "asc" },
    take: 300,
    select: {
      id: true,
      scheduledAt: true,
      durationMinutes: true,
      format: true,
      location: true,
      status: true,
      applicationId: true,
      interviewers: {
        where: { removedAt: null },
        select: { membershipId: true },
      },
      application: {
        select: {
          candidate: { select: { givenName: true, familyName: true } },
          vacancy: {
            select: { title: true, site: { select: { name: true } } },
          },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    scheduledAt: r.scheduledAt,
    durationMinutes: r.durationMinutes,
    format: r.format,
    location: r.location,
    status: r.status,
    candidateName: nameOf(r.application.candidate),
    vacancyTitle: r.application.vacancy.title,
    siteName: r.application.vacancy.site.name,
    mine: r.interviewers.some((x) => x.membershipId === actor.membershipId),
  }));
}

// --- Hire -----------------------------------------------------------------------------------

/**
 * Hire (decisions D3, D4): from Offer, by someone with recruitment.hire and
 * employee.manage at the vacancy's site. Creates exactly one employee record
 * per application (a retry or double click returns the same one), marks the
 * application hired, and optionally starts onboarding. Never creates a login.
 */
export async function hire(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
  raw: { startDate?: unknown; startOnboarding?: unknown; templateId?: unknown },
): Promise<
  Result<{ employeeId: string; caseId: string | null; alreadyHired: boolean }>
> {
  const a = await loadApplication(tx, actor, applicationId);
  if (!a || !canAt(actor, "recruitment.view", a.vacancy.siteId))
    return notFound("application");
  if (a.outcome === "hired" && a.hiredEmployeeId)
    return {
      ok: true,
      data: { employeeId: a.hiredEmployeeId, caseId: null, alreadyHired: true },
    };
  if (
    !canAt(actor, "recruitment.hire", a.vacancy.siteId) ||
    !canAt(actor, "employee.manage", a.vacancy.siteId)
  )
    return forbidden(
      "Hiring needs an owner, administrator or HR manager (it creates an employee record).",
    );
  const decision = mayHire(a.outcome, a.stage as Stage);
  if (!decision.ok) return conflict(decision.message);
  if (a.candidate.anonymisedAt)
    return conflict("This candidate has been anonymised.");
  if (!isIsoDate(raw.startDate))
    return invalid({ startDate: "Enter the start date" });
  const startOnboarding = raw.startOnboarding === true;
  if (startOnboarding) {
    if (!canAt(actor, "onboarding.manage", a.vacancy.siteId))
      return forbidden(
        "Starting onboarding needs onboarding access at this site.",
      );
    if (typeof raw.templateId !== "string" || !isUuid(raw.templateId))
      return invalid({ templateId: "Choose an onboarding template" });
  }

  let employeeId: string;
  try {
    const employee = await tx.employee.create({
      data: {
        tenantId: actor.tenantId,
        employeeNumber: await nextEmployeeNumber(tx),
        givenName: a.candidate.givenName,
        familyName: a.candidate.familyName,
        email: a.candidate.email,
        phoneNumber: a.candidate.phone,
        jobTitle: a.vacancy.jobTitle,
        primarySiteId: a.vacancy.siteId,
        status: "pending",
        startDate: asDate(raw.startDate),
      },
      select: { id: true },
    });
    employeeId = employee.id;
  } catch (e) {
    if (uniqueViolation(e))
      throw new Rollback(
        conflict("Someone else just added a person. Please try again."),
      );
    throw e;
  }
  if (a.vacancy.teamId)
    await tx.teamMember.create({
      data: { tenantId: actor.tenantId, teamId: a.vacancy.teamId, employeeId },
      select: { teamId: true },
    });
  // Claim the application. If someone else hired it meanwhile, nothing is
  // updated: roll back this employee and return theirs (no duplicates).
  const claimed = await tx.application.updateMany({
    where: {
      tenantId: actor.tenantId,
      id: a.id,
      outcome: "active",
      stage: "offer",
      hiredEmployeeId: null,
    },
    data: {
      stage: "hired",
      outcome: "hired",
      hiredEmployeeId: employeeId,
      hiredAt: new Date(),
      hiredBy: actor.userId,
      closedAt: new Date(),
      updatedAt: new Date(),
    },
  });
  if (claimed.count !== 1) throw new Rollback(conflict("ALREADY_HIRED"));
  await event(tx, actor, a.id, "offer", "hired");
  await audit(tx, actor, "recruitment.hired", "application", a.id, {
    employeeId,
    vacancyId: a.vacancy.id,
    onboarding: startOnboarding,
  });

  let caseId: string | null = null;
  if (startOnboarding) {
    const started = await onboarding.startCase(tx, actor, {
      employeeId,
      templateId: raw.templateId,
      startDate: raw.startDate,
    });
    // Hire and onboarding succeed or fail together.
    if (!started.ok) throw new Rollback(started as Result<never>);
    caseId = started.data.id;
  }
  return { ok: true, data: { employeeId, caseId, alreadyHired: false } };
}

export { Rollback };

/** The application an employee was hired from (for their person page). */
export async function hiredFrom(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
) {
  if (!isUuid(employeeId)) return null;
  const a = await tx.application.findFirst({
    where: { tenantId: actor.tenantId, hiredEmployeeId: employeeId },
    select: {
      id: true,
      hiredAt: true,
      vacancy: { select: { title: true, siteId: true } },
    },
  });
  if (!a || !canAt(actor, "recruitment.view", a.vacancy.siteId)) return null;
  return {
    applicationId: a.id,
    vacancyTitle: a.vacancy.title,
    hiredAt: a.hiredAt,
  };
}

// --- Retention (decision D6: manual review, nothing automatic) ---------------------------------

export async function retentionReview(
  tx: TenantTx,
  actor: Actor,
  today: string,
) {
  if (!orgWide(actor, "recruitment.settings")) return null;
  const s = await settingsRow(tx, actor);
  const months = s?.retentionMonths ?? 6;
  const candidates = await tx.candidate.findMany({
    where: { tenantId: actor.tenantId, anonymisedAt: null },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      applications: {
        select: {
          outcome: true,
          closedAt: true,
          vacancy: { select: { title: true } },
        },
      },
    },
  });
  const due = candidates
    .map((c) => ({
      id: c.id,
      name: nameOf(c),
      vacancies: c.applications.map((x) => x.vacancy.title),
      dueOn: reviewDueOn(
        c.applications.map((x) => ({ closedOn: isoOf(x.closedAt) })),
        months,
      ),
    }))
    .filter(
      (c): c is typeof c & { dueOn: string } =>
        c.dueOn !== null && c.dueOn <= today,
    )
    .sort((x, y) => x.dueOn.localeCompare(y.dueOn));
  return { retentionMonths: months, due };
}

/**
 * Anonymise a candidate whose review date has passed: contact details and
 * name removed, notes redacted, interview feedback cleared. Stage history and
 * counts stay for reporting. Audited; not reversible.
 */
export async function anonymiseCandidate(
  tx: TenantTx,
  actor: Actor,
  candidateId: string,
  today: string,
): Promise<Result> {
  if (!orgWide(actor, "recruitment.settings")) return forbidden();
  const review = await retentionReview(tx, actor, today);
  if (!review?.due.some((c) => c.id === candidateId))
    return conflict("This candidate isn't due for review yet.");
  const now = new Date();
  await tx.candidate.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: candidateId } },
    data: {
      givenName: "Anonymised",
      familyName: "candidate",
      email: null,
      phone: null,
      anonymisedAt: now,
      updatedAt: now,
    },
    select: { id: true },
  });
  const apps = await tx.application.findMany({
    where: { tenantId: actor.tenantId, candidateId },
    select: { id: true },
  });
  const appIds = apps.map((x) => x.id);
  await tx.applicationNote.updateMany({
    where: {
      tenantId: actor.tenantId,
      applicationId: { in: appIds },
      redactedAt: null,
    },
    data: { body: null, redactedAt: now },
  });
  await tx.interview.updateMany({
    where: { tenantId: actor.tenantId, applicationId: { in: appIds } },
    data: { feedback: null, location: null, updatedAt: now },
  });
  await audit(
    tx,
    actor,
    "recruitment.candidate_anonymised",
    "candidate",
    candidateId,
    {
      applications: appIds.length,
    },
  );
  return { ok: true, data: { id: candidateId } };
}
