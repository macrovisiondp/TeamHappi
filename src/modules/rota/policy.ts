// Rota rules (M10.1). Pure functions, unit-tested; the service applies them on
// the server for every change.
//
// A rota is one week per site, Monday to Sunday (decision D1). Times are entered
// as wall-clock times in the site's time zone and stored as instants, so clocks
// going forward or back are handled. Hours = shift length minus unpaid break;
// there is no pay or cost here (D6).
//
// Working-time checks are warnings for a manager, not legal advice (D5):
//   - the same person on two overlapping shifts is BLOCKED;
//   - under 11 hours' rest between shifts, over 6 hours with under 20 minutes'
//     break, and over 48 hours in the rota week are warnings.
// Under-18 rules aren't checked (no dates of birth are recorded, D9).

import type { PermissionCode } from "@/lib/permissions/catalogue";
import { can, type Grants } from "@/lib/workspace/policy";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

/** Permission at a site. */
export const canAt = (actor: Actor, code: PermissionCode, siteId: string) =>
  can(actor.grants, code, siteId);

/** Site filter for reads: null = everything, [] = nothing. */
export function scopeSites(
  actor: Actor,
  code: PermissionCode,
): string[] | null {
  const scope = actor.grants.get(code);
  if (!scope) return [];
  return scope === "all" ? null : [...scope];
}

// --- Dates ---------------------------------------------------------------------------

export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
}

export const weekDays = (weekStart: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return Math.round((asUtc - at.getTime()) / 60000);
}

/**
 * A wall-clock time ("YYYY-MM-DDTHH:MM") in a time zone as an instant. null if
 * it isn't valid or doesn't exist (the hour skipped when clocks go forward).
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  if (Number.isNaN(wall)) return null;
  let t = wall - offsetMinutes(timeZone, new Date(wall)) * 60000;
  const second = wall - offsetMinutes(timeZone, new Date(t)) * 60000;
  if (second !== t) t = second;
  if (new Date(wall).toISOString().slice(0, 16) !== local) return null;
  // Round-trip: a time inside the skipped hour comes back different.
  return utcToZoned(new Date(t), timeZone) === local ? new Date(t) : null;
}

/** An instant as "YYYY-MM-DDTHH:MM" in a time zone. */
export function utcToZoned(at: Date, timeZone: string): string {
  return new Date(at.getTime() + offsetMinutes(timeZone, at) * 60000)
    .toISOString()
    .slice(0, 16);
}

// --- Shift times ----------------------------------------------------------------------

export const MAX_SHIFT_MINUTES = 16 * 60;
export const MAX_BREAK_MINUTES = 240;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A shift from its day, start and end ("HH:MM") in the site's time zone. An end
 * at or before the start means the next day (overnight shifts).
 */
export function shiftTimes(
  day: unknown,
  start: unknown,
  end: unknown,
  breakMinutes: unknown,
  timeZone: string,
):
  | { ok: true; startsAt: Date; endsAt: Date; breakMinutes: number }
  | { ok: false; fieldErrors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!isIsoDate(day)) errors.day = "Choose a day";
  if (typeof start !== "string" || !HHMM.test(start))
    errors.start = "Enter a start time, like 09:00";
  if (typeof end !== "string" || !HHMM.test(end))
    errors.end = "Enter an end time, like 17:30";
  const br =
    breakMinutes === "" || breakMinutes === undefined || breakMinutes === null
      ? 0
      : Number(breakMinutes);
  if (!Number.isInteger(br) || br < 0 || br > MAX_BREAK_MINUTES)
    errors.breakMinutes = `Enter a break of 0 to ${MAX_BREAK_MINUTES} minutes`;
  if (Object.keys(errors).length) return { ok: false, fieldErrors: errors };
  const d = day as string;
  const endDay = (end as string) <= (start as string) ? addDays(d, 1) : d;
  const startsAt = zonedToUtc(`${d}T${start}`, timeZone);
  const endsAt = zonedToUtc(`${endDay}T${end}`, timeZone);
  if (!startsAt)
    return {
      ok: false,
      fieldErrors: {
        start: "That time doesn't exist on this day (clocks change)",
      },
    };
  if (!endsAt)
    return {
      ok: false,
      fieldErrors: {
        end: "That time doesn't exist on this day (clocks change)",
      },
    };
  const minutes = (endsAt.getTime() - startsAt.getTime()) / 60000;
  if (minutes > MAX_SHIFT_MINUTES)
    return {
      ok: false,
      fieldErrors: { end: "A shift can be at most 16 hours" },
    };
  if (br >= minutes)
    return {
      ok: false,
      fieldErrors: { breakMinutes: "The break must be shorter than the shift" },
    };
  return { ok: true, startsAt, endsAt, breakMinutes: br };
}

/** Paid-time-agnostic hours: length minus unpaid break, in minutes. */
export const workedMinutes = (s: {
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
}) => (s.endsAt.getTime() - s.startsAt.getTime()) / 60000 - s.breakMinutes;

/** "7h 30m" style. */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

// --- Working-time checks (D5) ---------------------------------------------------------

export interface TimedShift {
  id: string;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
}

export type Warning =
  | { code: "no_rtw"; blocking: true; message: string }
  | { code: "overlap"; blocking: true; message: string }
  | { code: "onboarding"; blocking: false; message: string }
  | { code: "training"; blocking: false; message: string }
  | { code: "short_rest"; blocking: false; message: string }
  | { code: "no_break"; blocking: false; message: string }
  | { code: "over_48"; blocking: false; message: string };

export const REST_MINUTES = 11 * 60;
export const BREAK_AFTER_MINUTES = 6 * 60;
export const MIN_BREAK_MINUTES = 20;
export const WEEK_LIMIT_MINUTES = 48 * 60;

/**
 * Checks one shift against the same person's other shifts. `others` are their
 * other active shifts around it (any week); `weekOthers` those in the same rota
 * week, for the 48-hour total.
 */
export function workingTimeWarnings(
  shift: TimedShift,
  others: readonly TimedShift[],
  weekOthers: readonly TimedShift[],
): Warning[] {
  const out: Warning[] = [];
  const s = shift.startsAt.getTime();
  const e = shift.endsAt.getTime();
  const rest = REST_MINUTES * 60000;
  for (const o of others) {
    if (o.id === shift.id) continue;
    const os = o.startsAt.getTime();
    const oe = o.endsAt.getTime();
    if (os < e && s < oe) {
      out.push({
        code: "overlap",
        blocking: true,
        message: "They're already on a shift at this time.",
      });
      break;
    }
  }
  if (!out.length)
    for (const o of others) {
      if (o.id === shift.id) continue;
      const os = o.startsAt.getTime();
      const oe = o.endsAt.getTime();
      const gap = os >= e ? os - e : s >= oe ? s - oe : Infinity;
      if (gap < rest) {
        out.push({
          code: "short_rest",
          blocking: false,
          message: "Less than 11 hours' rest between this and another shift.",
        });
        break;
      }
    }
  const length = (e - s) / 60000;
  if (length > BREAK_AFTER_MINUTES && shift.breakMinutes < MIN_BREAK_MINUTES)
    out.push({
      code: "no_break",
      blocking: false,
      message: "Over 6 hours with less than a 20-minute break.",
    });
  const week =
    workedMinutes(shift) +
    weekOthers
      .filter((o) => o.id !== shift.id)
      .reduce((sum, o) => sum + workedMinutes(o), 0);
  if (week > WEEK_LIMIT_MINUTES)
    out.push({
      code: "over_48",
      blocking: false,
      message: `Over 48 hours this week (${formatMinutes(week)}).`,
    });
  return out;
}
