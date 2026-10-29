// Recruitment rules (M9.1). Pure functions, unit-tested; the service applies
// them on the server for every change.
//
// The pipeline has eight fixed system stages (decision D2). The five working
// stages can be renamed per organisation (labels only). The three end
// stages are reached only by their own actions: Hire (from Offer), Reject
// (with a reason) and Withdraw, from any working stage.

import type { PermissionCode } from "@/lib/permissions/catalogue";
import { can, type Grants } from "@/lib/workspace/policy";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

export const WORKING_STAGES = [
  "applied",
  "screening",
  "shortlisted",
  "interview",
  "offer",
] as const;
export type WorkingStage = (typeof WORKING_STAGES)[number];
export type EndStage = "hired" | "rejected" | "withdrawn";
export type Stage = WorkingStage | EndStage;

export const DEFAULT_STAGE_LABELS: Record<Stage, string> = {
  applied: "Applied",
  screening: "Screening",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const isWorkingStage = (s: string): s is WorkingStage =>
  (WORKING_STAGES as readonly string[]).includes(s);

/** Labels with the organisation's renamed working stages (end stages keep their names). */
export function stageLabels(custom: unknown): Record<Stage, string> {
  const out = { ...DEFAULT_STAGE_LABELS };
  if (custom && typeof custom === "object")
    for (const [k, v] of Object.entries(custom as Record<string, unknown>))
      if (isWorkingStage(k) && typeof v === "string" && v.trim())
        out[k] = v.trim().slice(0, 40);
  return out;
}

export type Decision = { ok: true } | { ok: false; message: string };
const ok: Decision = { ok: true };
const no = (message: string): Decision => ({ ok: false, message });

/** A plain stage move: between working stages only, on an open application. */
export function mayMove(
  outcome: "active" | "hired" | "rejected" | "withdrawn",
  from: Stage,
  to: string,
): Decision {
  if (outcome !== "active") return no("This application is closed.");
  if (!isWorkingStage(to))
    return no("Use Hire, Reject or Withdraw to close an application.");
  if (from === to) return no("It's already at that stage.");
  return ok;
}

/** Hire only from Offer, on an open application. */
export function mayHire(
  outcome: "active" | "hired" | "rejected" | "withdrawn",
  stage: Stage,
): Decision {
  if (outcome === "hired") return no("This candidate has already been hired.");
  if (outcome !== "active") return no("This application is closed.");
  if (stage !== "offer") return no("Move the application to Offer first.");
  return ok;
}

/** Permission at a vacancy's site. */
export const canAt = (actor: Actor, code: PermissionCode, siteId: string) =>
  can(actor.grants, code, siteId);

export const orgWide = (actor: Actor, code: PermissionCode) =>
  actor.grants.get(code) === "all";

/** Site filter for reads: null = everything, [] = nothing. */
export function scopeSites(
  actor: Actor,
  code: PermissionCode,
): string[] | null {
  const scope = actor.grants.get(code);
  if (!scope) return [];
  return scope === "all" ? null : [...scope];
}

/** Calendar arithmetic on YYYY-MM-DD, clamping to the month's last day. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * When a candidate is due for retention review (anonymisation): the given
 * number of months after their LAST application closed. Null while any of
 * their applications is still open (decision D6; nothing automatic in M9.1).
 */
export function reviewDueOn(
  applications: readonly { closedOn: string | null }[],
  retentionMonths: number,
): string | null {
  if (applications.length === 0) return null;
  if (applications.some((a) => a.closedOn === null)) return null;
  const last = applications
    .map((a) => a.closedOn!)
    .reduce((x, y) => (x > y ? x : y));
  return addMonths(last, retentionMonths);
}

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Pay as a decimal string with two places, or null; never a float in storage. */
export function parsePay(raw: unknown): string | null | false {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim().replace(/^£/, "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return false;
  const [whole, frac = ""] = s.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

/**
 * A local date and time ("2026-11-03T14:30", as a datetime-local input sends
 * it) in the organisation's time zone, as an instant. Handles clock changes.
 */
export function zonedToUtc(local: unknown, timeZone: string): Date | null {
  const m =
    typeof local === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
      : null;
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  if (Number.isNaN(wall)) return null;
  let t = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  const second = wall - offsetMinutes(timeZone, new Date(t)) * 60000;
  if (second !== t) t = second;
  const back = new Date(wall).toISOString().slice(0, 16);
  return back === local ? new Date(t) : null;
}

/** An instant as a datetime-local value in the organisation's time zone. */
export function utcToZoned(at: Date, timeZone: string): string {
  return new Date(at.getTime() + offsetMinutes(timeZone, at) * 60000)
    .toISOString()
    .slice(0, 16);
}
