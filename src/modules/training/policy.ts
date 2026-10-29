// Training rules (M8.1). Pure functions, unit-tested; the service applies them
// on the server. Requirements are worked out from RULES every time they're
// read, so joining, job-title changes, site moves, rule changes, archived
// courses and leaving all apply immediately, with no background job.
//
// Rule resolution (documented in docs/architecture/m8.1-training-foundation.md):
// - A rule applies to a person when its target matches: the whole
//   organisation; their primary site; their job title (ignoring capitals and
//   spaces at the ends); or them by name. People who have left have no
//   requirements (their records are kept).
// - Several rules for the same course make ONE requirement: mandatory if any
//   applicable rule is mandatory, due on the EARLIEST due date among the
//   applicable rules of that strength (mandatory rules only, if any).
// - A rule's due date is `due_days` after the later of the person's start
//   date and the date the rule took effect (so existing staff aren't overdue
//   on the day a rule is added). People without a start date count from the
//   rule's date.
// - Rules for archived courses don't apply.

import type { PermissionCode } from "@/lib/permissions/catalogue";
import { can, type Grants } from "@/lib/workspace/policy";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

export type RuleScope = "organisation" | "site" | "job_title" | "employee";

export interface Rule {
  id: string;
  courseId: string;
  scope: RuleScope;
  siteId: string | null;
  jobTitle: string | null;
  employeeId: string | null;
  mandatory: boolean;
  dueDays: number;
  effectiveFrom: string; // YYYY-MM-DD
}

export interface Person {
  id: string;
  primarySiteId: string | null;
  jobTitle: string | null;
  startDate: string | null;
  status: "pending" | "active" | "left";
}

export interface Requirement {
  courseId: string;
  mandatory: boolean;
  dueOn: string;
  ruleIds: string[];
}

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();

export function ruleApplies(rule: Rule, person: Person): boolean {
  if (person.status === "left") return false;
  switch (rule.scope) {
    case "organisation":
      return true;
    case "site":
      return rule.siteId !== null && rule.siteId === person.primarySiteId;
    case "job_title":
      return (
        !!norm(rule.jobTitle) && norm(rule.jobTitle) === norm(person.jobTitle)
      );
    case "employee":
      return rule.employeeId === person.id;
  }
}

/** Calendar arithmetic on YYYY-MM-DD (no time zones). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Adds calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function ruleDueOn(rule: Rule, person: Person): string {
  const start = person.startDate ?? rule.effectiveFrom;
  const base = start > rule.effectiveFrom ? start : rule.effectiveFrom;
  return addDays(base, rule.dueDays);
}

/** One requirement per course, from every applicable rule (see the header). */
export function requirementsFor(
  person: Person,
  rules: readonly Rule[],
  activeCourseIds: ReadonlySet<string>,
): Requirement[] {
  const byCourse = new Map<string, Rule[]>();
  for (const r of rules)
    if (activeCourseIds.has(r.courseId) && ruleApplies(r, person))
      byCourse.set(r.courseId, [...(byCourse.get(r.courseId) ?? []), r]);
  return [...byCourse.entries()].map(([courseId, rs]) => {
    const mandatory = rs.some((r) => r.mandatory);
    const counted = mandatory ? rs.filter((r) => r.mandatory) : rs;
    const dueOn = counted
      .map((r) => ruleDueOn(r, person))
      .reduce((a, b) => (a < b ? a : b));
    return { courseId, mandatory, dueOn, ruleIds: rs.map((r) => r.id) };
  });
}

export interface RecordFacts {
  id: string;
  courseId: string;
  completedOn: string;
  expiresOn: string | null;
  recordedAt: Date;
  voided: boolean;
}

/** The record that counts: the latest completion that hasn't been voided. */
export function currentRecord(
  records: readonly RecordFacts[],
): RecordFacts | null {
  return (
    records
      .filter((r) => !r.voided)
      .sort(
        (a, b) =>
          b.completedOn.localeCompare(a.completedOn) ||
          b.recordedAt.getTime() - a.recordedAt.getTime(),
      )[0] ?? null
  );
}

export type TrainingStatus =
  "up_to_date" | "expiring" | "due" | "overdue" | "expired" | "not_required";

export interface CourseStatus {
  status: TrainingStatus;
  mandatory: boolean;
  dueOn: string | null;
  completedOn: string | null;
  expiresOn: string | null;
  recordId: string | null;
}

/**
 * Status for one person and course. An expired record never counts as valid,
 * however it was completed. A valid record that isn't required shows as
 * "not required" (it's kept in the history).
 */
export function statusOf(
  requirement: Requirement | null,
  records: readonly RecordFacts[],
  warnDays: number,
  today: string,
): CourseStatus {
  const r = currentRecord(records);
  const valid = !!r && (r.expiresOn === null || r.expiresOn >= today);
  const base = {
    mandatory: requirement?.mandatory ?? false,
    dueOn: requirement?.dueOn ?? null,
    completedOn: r?.completedOn ?? null,
    expiresOn: r?.expiresOn ?? null,
    recordId: r?.id ?? null,
  };
  if (!requirement) return { ...base, status: "not_required" };
  if (valid)
    return {
      ...base,
      status:
        r!.expiresOn !== null && r!.expiresOn <= addDays(today, warnDays)
          ? "expiring"
          : "up_to_date",
    };
  if (r) return { ...base, status: "expired" };
  return {
    ...base,
    status: requirement.dueOn >= today ? "due" : "overdue",
  };
}

/** Up to date: no MANDATORY requirement is overdue or expired. */
export const personUpToDate = (statuses: readonly CourseStatus[]) =>
  !statuses.some(
    (s) => s.mandatory && (s.status === "overdue" || s.status === "expired"),
  );

/** Permission at a person's site; people without a site need it organisation-wide. */
export function canAt(
  actor: Actor,
  code: PermissionCode,
  siteId: string | null,
): boolean {
  return siteId === null
    ? actor.grants.get(code) === "all"
    : can(actor.grants, code, siteId);
}

export const orgWide = (actor: Actor, code: PermissionCode) =>
  actor.grants.get(code) === "all";

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Today's date in the organisation's time zone, as YYYY-MM-DD. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const CATEGORIES = [
  "food_safety",
  "allergens",
  "health_safety",
  "fire_safety",
  "first_aid",
  "manual_handling",
  "licensing",
  "safeguarding",
  "equality",
  "customer_service",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];
