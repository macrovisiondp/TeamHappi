// Onboarding rules (M7.1). Pure functions, unit-tested; the service applies
// them on the server for every change.
//
// Three separate ideas, never merged:
// - task completion: how many tasks are done (progress);
// - operational readiness: every REQUIRED task is done or waived;
// - final sign-off: an owner/admin/HR decision, recorded and audited.
// None of them says anything about right to work (M7.2), which is recorded
// separately and never inferred from onboarding progress.

import type { PermissionCode } from "@/lib/permissions/catalogue";
import { can, type Grants } from "@/lib/workspace/policy";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

export type TaskStatus = "to_do" | "done" | "waived";

export interface TaskFacts {
  required: boolean;
  status: TaskStatus;
  dueOn: string | null; // YYYY-MM-DD
}

export interface Progress {
  total: number;
  finished: number; // done or waived
  percent: number;
  requiredOutstanding: number;
  overdue: number;
  /** Every required task is done or waived (NOT legal clearance). */
  operationallyReady: boolean;
}

export function progressOf(
  tasks: readonly TaskFacts[],
  today: string,
): Progress {
  const finished = tasks.filter((t) => t.status !== "to_do").length;
  const requiredOutstanding = tasks.filter(
    (t) => t.required && t.status === "to_do",
  ).length;
  return {
    total: tasks.length,
    finished,
    percent: tasks.length ? Math.round((finished / tasks.length) * 100) : 0,
    requiredOutstanding,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
    operationallyReady: requiredOutstanding === 0,
  };
}

export function isOverdue(t: TaskFacts, today: string): boolean {
  return t.status === "to_do" && t.dueOn !== null && t.dueOn < today;
}

/** Start date + offset in days, as YYYY-MM-DD (calendar arithmetic, no time zones). */
export function dueDate(startDate: string, offsetDays: number): string {
  const [y, m, d] = startDate.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(y, m - 1, d + offsetDays))
    .toISOString()
    .slice(0, 10);
}

/** Today's date in the organisation's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/**
 * Permission at the case's site. A case without a site (an employee with no
 * primary site) needs the permission organisation-wide.
 */
export function canAt(
  actor: Actor,
  code: PermissionCode,
  siteId: string | null,
): boolean {
  return siteId === null
    ? actor.grants.get(code) === "all"
    : can(actor.grants, code, siteId);
}

export const hasAny = (actor: Actor, code: PermissionCode) =>
  actor.grants.has(code);

export const orgWide = (actor: Actor, code: PermissionCode) =>
  actor.grants.get(code) === "all";

export type Decision = { ok: true } | { ok: false; message: string };
const ok: Decision = { ok: true };
const no = (message: string): Decision => ({ ok: false, message });

/** Waiving a REQUIRED task is a policy exception: sign-off holders only, with a reason. */
export function mayWaive(
  actor: Actor,
  siteId: string | null,
  required: boolean,
  reason: string,
): Decision {
  if (reason.trim().length < 3) return no("Give a reason for the exception.");
  if (required && !canAt(actor, "onboarding.signoff", siteId))
    return no(
      "Only an owner, administrator or HR manager can make an exception to a required task.",
    );
  if (!canAt(actor, "onboarding.manage", siteId))
    return no("Your role doesn't allow this change.");
  return ok;
}

/** Final sign-off: authorised role, every required task finished, not your own onboarding. */
export function maySignOff(
  actor: Actor,
  siteId: string | null,
  progress: Progress,
  isOwnRecord: boolean,
): Decision {
  if (!canAt(actor, "onboarding.signoff", siteId))
    return no("Final sign-off needs an owner, administrator or HR manager.");
  if (isOwnRecord) return no("You can't sign off your own onboarding.");
  if (!progress.operationallyReady)
    return no(
      `${progress.requiredOutstanding} required task${progress.requiredOutstanding === 1 ? " is" : "s are"} still open.`,
    );
  return ok;
}

export type TemplateScope = "organisation" | "site" | "job_title";

/** Whether a template suits an employee (a manual choice is always possible). */
export function templateSuits(
  t: { scope: TemplateScope; siteId: string | null; jobTitle: string | null },
  e: { primarySiteId: string | null; jobTitle: string | null },
): boolean {
  if (t.scope === "organisation") return true;
  if (t.scope === "site")
    return t.siteId !== null && t.siteId === e.primarySiteId;
  return (
    !!t.jobTitle &&
    !!e.jobTitle &&
    t.jobTitle.trim().toLowerCase() === e.jobTitle.trim().toLowerCase()
  );
}
