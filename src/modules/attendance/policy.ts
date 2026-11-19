// Attendance rules (M11.1). Pure functions, unit-tested; the service applies
// them on the server.
//
// Real clock times are stored and never rounded (scope D4). Flags are worked out
// when shown, from the organisation's limits (D5, D7), so changing a limit
// changes the flags but never a recorded time. No pay is calculated here.

export interface Limits {
  /** Early or late by more than this is flagged (D5). */
  toleranceMinutes: number;
  /** Still clocked in this long after the shift ends = missed clock-out (D7). */
  missedClockOutHours: number;
}

export const DEFAULT_LIMITS: Limits = {
  toleranceMinutes: 10,
  missedClockOutHours: 2,
};

/** A clock-in this long before a shift starts still matches it. */
export const MATCH_BEFORE_MINUTES = 120;
/** The longest an entry can be (also a database CHECK). */
export const MAX_ENTRY_HOURS = 24;
/** With no shift, still clocked in after this long = missed clock-out. */
export const NO_SHIFT_MISSED_HOURS = 12;

const MIN = 60_000;

export interface ShiftWindow {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * The shift a clock-in at `at` belongs to: one that starts within
 * MATCH_BEFORE_MINUTES after `at` or is already running. The nearest start wins.
 */
export function matchShift<S extends ShiftWindow>(
  shifts: readonly S[],
  at: Date,
): S | null {
  const t = at.getTime();
  let best: S | null = null;
  for (const s of shifts) {
    const start = s.startsAt.getTime();
    if (t < start - MATCH_BEFORE_MINUTES * MIN || t >= s.endsAt.getTime())
      continue;
    if (!best || Math.abs(start - t) < Math.abs(best.startsAt.getTime() - t))
      best = s;
  }
  return best;
}

export type Flag =
  | "no_shift"
  | "early_in"
  | "late_in"
  | "left_early"
  | "stayed_late"
  | "missed_clock_out"
  | "corrected";

export const FLAG_LABELS: Record<Flag, string> = {
  no_shift: "No shift",
  early_in: "Early in",
  late_in: "Late in",
  left_early: "Left early",
  stayed_late: "Stayed late",
  missed_clock_out: "Missed clock-out",
  corrected: "Corrected",
};

export interface EntryTimes {
  clockInAt: Date;
  clockOutAt: Date | null;
  /** A manager recorded or changed it. */
  corrected: boolean;
}

/** Whether an open entry has run past the missed clock-out limit. */
export function isMissedClockOut(
  e: EntryTimes,
  shift: { endsAt: Date } | null,
  limits: Limits,
  now: Date,
): boolean {
  if (e.clockOutAt) return false;
  const limit = shift
    ? shift.endsAt.getTime() + limits.missedClockOutHours * 60 * MIN
    : e.clockInAt.getTime() + NO_SHIFT_MISSED_HOURS * 60 * MIN;
  return now.getTime() > limit;
}

/** What a manager should look at on an entry. Never changes a time. */
export function entryFlags(
  e: EntryTimes,
  shift: { startsAt: Date; endsAt: Date } | null,
  limits: Limits,
  now: Date,
): Flag[] {
  const flags: Flag[] = [];
  const tol = limits.toleranceMinutes * MIN;
  if (!shift) flags.push("no_shift");
  else {
    const dIn = e.clockInAt.getTime() - shift.startsAt.getTime();
    if (dIn < -tol) flags.push("early_in");
    if (dIn > tol) flags.push("late_in");
    if (e.clockOutAt) {
      const dOut = e.clockOutAt.getTime() - shift.endsAt.getTime();
      if (dOut < -tol) flags.push("left_early");
      if (dOut > tol) flags.push("stayed_late");
    }
  }
  if (isMissedClockOut(e, shift, limits, now)) flags.push("missed_clock_out");
  if (e.corrected) flags.push("corrected");
  return flags;
}

export interface BreakTimes {
  startsAt: Date;
  endsAt: Date | null;
}

/** Minutes between two instants, never negative. */
const minutesBetween = (a: Date, b: Date) =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / MIN));

/** Recorded break minutes (an open break counts up to `until`). */
export function breakMinutes(
  breaks: readonly BreakTimes[],
  until: Date,
): number {
  return breaks.reduce(
    (sum, b) => sum + minutesBetween(b.startsAt, b.endsAt ?? until),
    0,
  );
}

/**
 * Time worked: clock-in to clock-out (or `now` while clocked in) minus recorded
 * breaks. For display; nothing is deducted automatically (D6).
 */
export function workedMinutes(
  e: { clockInAt: Date; clockOutAt: Date | null },
  breaks: readonly BreakTimes[],
  now: Date,
): number {
  const end = e.clockOutAt ?? now;
  return Math.max(
    0,
    minutesBetween(e.clockInAt, end) - breakMinutes(breaks, end),
  );
}

export type Status =
  | "due"
  | "late"
  | "no_clock_in"
  | "in"
  | "on_break"
  | "done"
  | "missed_clock_out";

export const STATUS_LABELS: Record<Status, string> = {
  due: "Not in yet",
  late: "Late",
  no_clock_in: "No clock-in",
  in: "In",
  on_break: "On break",
  done: "Done",
  missed_clock_out: "Missed clock-out",
};

/** One status for a person on Who's in. */
export function personStatus(
  shifts: readonly { startsAt: Date; endsAt: Date }[],
  entries: readonly {
    clockInAt: Date;
    clockOutAt: Date | null;
    onBreak: boolean;
    missed: boolean;
  }[],
  limits: Limits,
  now: Date,
): Status {
  const open = entries.find((e) => !e.clockOutAt);
  if (open)
    return open.missed ? "missed_clock_out" : open.onBreak ? "on_break" : "in";
  // Shifts with no clock-in that overlaps them.
  const uncovered = shifts.filter(
    (s) =>
      !entries.some(
        (e) =>
          e.clockInAt < s.endsAt &&
          (e.clockOutAt ?? now) >
            new Date(s.startsAt.getTime() - MATCH_BEFORE_MINUTES * MIN),
      ),
  );
  const tol = limits.toleranceMinutes * MIN;
  if (uncovered.some((s) => s.endsAt <= now)) return "no_clock_in";
  if (uncovered.some((s) => now.getTime() > s.startsAt.getTime() + tol))
    return "late";
  if (entries.length && !uncovered.length) return "done";
  if (uncovered.length) return "due";
  return "done";
}
