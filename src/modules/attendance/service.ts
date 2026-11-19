// Attendance for managers (M11.1). Every function receives a transaction scoped
// to one organisation by withTenant() (so RLS applies) and an Actor from the
// server session. Permissions and site scope are checked here for every read
// and write: attendance.view to see a site, attendance.manage to record,
// correct or remove times there. Anything outside the member's scope, or in
// another organisation, looks "not found".
//
// Every record, correction and removal needs a reason, kept on
// time_entry_change (append-only), never in the audit trail.

import { isUuid, type TenantTx } from "@/lib/tenancy";
import { can } from "@/lib/workspace/policy";
import * as rota from "@/modules/rota";

import {
  MAX_ENTRY_HOURS,
  breakMinutes,
  entryFlags,
  isMissedClockOut,
  matchShift,
  personStatus,
  workedMinutes,
  type Limits,
} from "./policy";
import {
  audit,
  limitsFor,
  uniqueViolation,
  type Actor,
  type Result,
} from "./shared";
import { LOCKED_MESSAGE, isLockError, isLocked } from "./timesheets";

const HOUR = 3_600_000;

const notFound = (what: string) =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
const invalid = (
  fieldErrors: Record<string, string>,
  message = "Check the highlighted fields.",
) => ({ ok: false, code: "invalid", message, fieldErrors }) as const;
const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;

/** Site filter for reads: null = everything, [] = nothing. */
function scopeSites(
  actor: Actor,
  code: "attendance.view" | "attendance.manage",
) {
  const scope = actor.grants.get(code);
  if (!scope) return [];
  return scope === "all" ? null : [...scope];
}

const nameOf = (e: {
  givenName: string;
  familyName: string;
  preferredName: string | null;
}) => `${e.preferredName || e.givenName} ${e.familyName}`;

/** Sites the member can see attendance for. */
export async function attendanceSites(tx: TenantTx, actor: Actor) {
  const scope = scopeSites(actor, "attendance.view");
  if (scope && scope.length === 0) return [];
  return tx.site.findMany({
    where: {
      tenantId: actor.tenantId,
      status: "active",
      ...(scope ? { id: { in: scope } } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, timezone: true },
  });
}

async function siteIn(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  code: "attendance.view" | "attendance.manage",
) {
  if (typeof siteId !== "string" || !isUuid(siteId)) return null;
  if (!can(actor.grants, code, siteId)) return null;
  return tx.site.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: siteId } },
    select: { id: true, name: true, timezone: true },
  });
}

/** Start and end of a local day at a site, as instants. */
function dayBounds(day: string, tz: string) {
  const from =
    rota.zonedToUtc(`${day}T00:00`, tz) ?? new Date(`${day}T00:00:00Z`);
  const next = rota.addDays(day, 1);
  const to =
    rota.zonedToUtc(`${next}T00:00`, tz) ?? new Date(`${next}T00:00:00Z`);
  return { from, to };
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  rota.addDays(v, 0) === v;

/**
 * Who's in at a site on a day: everyone rostered (published shifts) and everyone
 * who clocked in, with a status and flags. Open entries from earlier days show
 * too, so missed clock-outs aren't lost.
 */
export async function whosIn(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  dayInput: unknown,
  now = new Date(),
) {
  const site = await siteIn(tx, actor, siteId, "attendance.view");
  if (!site) return null;
  const today = rota.todayIn(site.timezone, now);
  const day = isIsoDate(dayInput) ? dayInput : today;
  const { from, to } = dayBounds(day, site.timezone);
  const limits = await limitsFor(tx, actor);

  const [shifts, entries] = await Promise.all([
    rota.publishedShifts(tx, actor.tenantId, { siteId: site.id, from, to }),
    tx.timeEntry.findMany({
      where: {
        tenantId: actor.tenantId,
        siteId: site.id,
        removedAt: null,
        OR: [
          { clockInAt: { gte: from, lt: to } },
          // Still open from an earlier day (shown on today's view only).
          ...(day === today
            ? [{ clockOutAt: null, clockInAt: { lt: from } }]
            : []),
        ],
      },
      orderBy: { clockInAt: "asc" },
      select: {
        id: true,
        employeeId: true,
        shiftId: true,
        clockInAt: true,
        clockOutAt: true,
        source: true,
        breaks: { select: { startsAt: true, endsAt: true } },
        changes: {
          orderBy: { occurredAt: "asc" },
          select: {
            id: true,
            kind: true,
            oldClockIn: true,
            oldClockOut: true,
            newClockIn: true,
            newClockOut: true,
            reason: true,
            occurredAt: true,
          },
        },
      },
    }),
  ]);
  // Shifts that entries were matched to may start on another day.
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const missingShiftIds = entries
    .map((e) => e.shiftId)
    .filter((id): id is string => !!id && !shiftById.has(id));
  if (missingShiftIds.length)
    for (const s of await rota.publishedShifts(tx, actor.tenantId, {
      siteId: site.id,
      from: new Date(from.getTime() - 2 * 24 * HOUR),
      to: new Date(to.getTime() + 24 * HOUR),
      employeeIds: [...new Set(entries.map((e) => e.employeeId))],
    }))
      shiftById.set(s.id, s);

  const employeeIds = [
    ...new Set([
      ...shifts.map((s) => s.employeeId),
      ...entries.map((e) => e.employeeId),
    ]),
  ];
  const [people, staff] = await Promise.all([
    tx.employee.findMany({
      where: { tenantId: actor.tenantId, id: { in: employeeIds } },
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
      },
    }),
    // People a manager can record times for here.
    tx.employee.findMany({
      where: {
        tenantId: actor.tenantId,
        status: { in: ["pending", "active"] },
        OR: [
          { primarySiteId: site.id },
          { id: { in: shifts.map((s) => s.employeeId) } },
        ],
      },
      orderBy: [{ givenName: "asc" }, { familyName: "asc" }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
      },
    }),
  ]);
  const names = new Map(people.map((p) => [p.id, nameOf(p)]));
  const time = (d: Date) => rota.utcToZoned(d, site.timezone);

  const rows = employeeIds.map((employeeId) => {
    const mine = shifts.filter((s) => s.employeeId === employeeId);
    const theirs = entries
      .filter((e) => e.employeeId === employeeId)
      .map((e) => {
        const shift = e.shiftId ? (shiftById.get(e.shiftId) ?? null) : null;
        const times = {
          clockInAt: e.clockInAt,
          clockOutAt: e.clockOutAt,
          corrected: e.source === "manager" || e.changes.length > 0,
        };
        const at = (d: Date | null) => (d ? time(d).replace("T", " ") : null);
        return {
          id: e.id,
          clockInAt: e.clockInAt,
          clockOutAt: e.clockOutAt,
          clockIn: time(e.clockInAt),
          clockOut: e.clockOutAt ? time(e.clockOutAt) : null,
          shift: shift
            ? { start: time(shift.startsAt), end: time(shift.endsAt) }
            : null,
          onBreak: e.breaks.some((b) => !b.endsAt),
          missed: isMissedClockOut(times, shift, limits, now),
          breakMinutes: breakMinutes(e.breaks, e.clockOutAt ?? now),
          workedMinutes: workedMinutes(e, e.breaks, now),
          flags: entryFlags(times, shift, limits, now),
          history: e.changes.map((c) => ({
            id: c.id,
            kind: c.kind,
            from: c.oldClockIn
              ? `${at(c.oldClockIn)}–${at(c.oldClockOut)?.slice(11) ?? "open"}`
              : null,
            to: c.newClockIn
              ? `${at(c.newClockIn)}–${at(c.newClockOut)?.slice(11) ?? "open"}`
              : null,
            reason: c.reason,
            at: at(c.occurredAt),
          })),
        };
      });
    return {
      employeeId,
      name: names.get(employeeId) ?? "Unknown",
      shifts: mine.map((s) => ({
        id: s.id,
        start: time(s.startsAt),
        end: time(s.endsAt),
        breakMinutes: s.breakMinutes,
        roleLabel: s.roleLabel,
      })),
      entries: theirs,
      status: personStatus(mine, theirs, limits, now),
    };
  });
  rows.sort(
    (a, b) =>
      (a.shifts[0]?.start ?? a.entries[0]?.clockIn ?? "").localeCompare(
        b.shifts[0]?.start ?? b.entries[0]?.clockIn ?? "",
      ) || a.name.localeCompare(b.name),
  );

  return {
    site,
    day,
    today,
    previousDay: rota.addDays(day, -1),
    nextDay: rota.addDays(day, 1),
    limits,
    can: {
      manage: can(actor.grants, "attendance.manage", site.id),
      settings: can(actor.grants, "tenant.settings.manage"),
    },
    rows,
    staff: staff.map((p) => ({ id: p.id, name: nameOf(p) })),
  };
}

// --- Recording and correcting --------------------------------------------------------

export interface TimesInput {
  /** "YYYY-MM-DDTHH:MM" at the site. */
  clockIn?: unknown;
  /** "YYYY-MM-DDTHH:MM" at the site, or empty = still clocked in. */
  clockOut?: unknown;
  reason?: unknown;
}

function parseTimes(raw: TimesInput, tz: string, now: Date) {
  const errors: Record<string, string> = {};
  const inAt =
    typeof raw.clockIn === "string" ? rota.zonedToUtc(raw.clockIn, tz) : null;
  if (!inAt) errors.clockIn = "Enter the clock-in date and time";
  else if (inAt.getTime() > now.getTime() + 60_000)
    errors.clockIn = "The clock-in can't be in the future";
  let outAt: Date | null = null;
  if (typeof raw.clockOut === "string" && raw.clockOut !== "") {
    outAt = rota.zonedToUtc(raw.clockOut, tz);
    if (!outAt) errors.clockOut = "Enter a valid clock-out date and time";
    else if (outAt.getTime() > now.getTime() + 60_000)
      errors.clockOut = "The clock-out can't be in the future";
    else if (inAt && outAt <= inAt)
      errors.clockOut = "The clock-out must be after the clock-in";
    else if (inAt && outAt.getTime() - inAt.getTime() > MAX_ENTRY_HOURS * HOUR)
      errors.clockOut = "An entry can't be longer than 24 hours";
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (!reason) errors.reason = "Give a reason";
  else if (reason.length > 300)
    errors.reason = "Keep the reason to 300 characters";
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, inAt: inAt!, outAt, reason };
}

/** Another entry for the person that overlaps these times, if any. */
async function overlapping(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  inAt: Date,
  outAt: Date | null,
  exceptId?: string,
) {
  return tx.timeEntry.findFirst({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      removedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      ...(outAt ? { clockInAt: { lt: outAt } } : {}),
      OR: [{ clockOutAt: null }, { clockOutAt: { gt: inAt } }],
    },
    select: { id: true },
  });
}

async function shiftFor(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  siteId: string,
  at: Date,
) {
  const shifts = await rota.publishedShifts(tx, actor.tenantId, {
    employeeIds: [employeeId],
    siteId,
    from: new Date(at.getTime() - 24 * HOUR),
    to: new Date(at.getTime() + 24 * HOUR),
  });
  return matchShift(shifts, at);
}

const OVERLAP =
  "These times overlap another entry for this person. Correct or remove that one first.";

/** Records times for someone at the site (including staff without a login). */
export async function recordEntry(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  employeeId: unknown,
  raw: TimesInput,
  now = new Date(),
): Promise<Result> {
  const site = await siteIn(tx, actor, siteId, "attendance.manage");
  if (!site) return notFound("site");
  if (typeof employeeId !== "string" || !isUuid(employeeId))
    return invalid({ employeeId: "Choose a person" });
  const person = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: { id: true, primarySiteId: true },
  });
  const t = parseTimes(raw, site.timezone, now);
  if (!t.ok) return invalid(t.errors);
  // Only people based here or rostered here around that time.
  const shift = person
    ? await shiftFor(tx, actor, person.id, site.id, t.inAt)
    : null;
  if (!person || (person.primarySiteId !== site.id && !shift))
    return invalid({
      employeeId: "Choose someone based at this site or on its rota then",
    });
  if (await isLocked(tx, actor.tenantId, site.id, site.timezone, t.inAt))
    return conflict(LOCKED_MESSAGE);
  if (await overlapping(tx, actor, person.id, t.inAt, t.outAt))
    return conflict(OVERLAP);
  try {
    const entry = await tx.timeEntry.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: person.id,
        siteId: site.id,
        shiftId: shift?.id ?? null,
        clockInAt: t.inAt,
        clockOutAt: t.outAt,
        source: "manager",
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await tx.timeEntryChange.create({
      data: {
        tenantId: actor.tenantId,
        timeEntryId: entry.id,
        kind: "recorded",
        newClockIn: t.inAt,
        newClockOut: t.outAt,
        reason: t.reason,
        actorUserId: actor.userId,
      },
      select: { id: true },
    });
    await audit(tx, actor, "attendance.entry_recorded", entry.id, {
      employeeId: person.id,
      siteId: site.id,
      shiftId: shift?.id ?? null,
    });
    return { ok: true, data: entry };
  } catch (e) {
    if (uniqueViolation(e))
      return conflict("This person is already clocked in.");
    if (isLockError(e)) return conflict(LOCKED_MESSAGE);
    throw e;
  }
}

async function entryIn(tx: TenantTx, actor: Actor, entryId: unknown) {
  if (typeof entryId !== "string" || !isUuid(entryId)) return null;
  const e = await tx.timeEntry.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: entryId } },
    select: {
      id: true,
      employeeId: true,
      siteId: true,
      clockInAt: true,
      clockOutAt: true,
      removedAt: true,
      site: { select: { timezone: true } },
      breaks: { where: { endsAt: null }, select: { id: true, startsAt: true } },
    },
  });
  if (!e || e.removedAt || !can(actor.grants, "attendance.manage", e.siteId))
    return null;
  return e;
}

/** Corrects a clock-in or clock-out (including a missed clock-out). */
export async function correctEntry(
  tx: TenantTx,
  actor: Actor,
  entryId: unknown,
  raw: TimesInput,
  now = new Date(),
): Promise<Result> {
  const e = await entryIn(tx, actor, entryId);
  if (!e) return notFound("entry");
  const t = parseTimes(raw, e.site.timezone, now);
  if (!t.ok) return invalid(t.errors);
  if (
    t.inAt.getTime() === e.clockInAt.getTime() &&
    (t.outAt?.getTime() ?? null) === (e.clockOutAt?.getTime() ?? null)
  )
    return invalid({ clockIn: "Change a time, or cancel" }, "Nothing changed.");
  if (
    (await isLocked(
      tx,
      actor.tenantId,
      e.siteId,
      e.site.timezone,
      e.clockInAt,
    )) ||
    (await isLocked(tx, actor.tenantId, e.siteId, e.site.timezone, t.inAt))
  )
    return conflict(LOCKED_MESSAGE);
  if (await overlapping(tx, actor, e.employeeId, t.inAt, t.outAt, e.id))
    return conflict(OVERLAP);
  const shift = await shiftFor(tx, actor, e.employeeId, e.siteId, t.inAt);
  try {
    // Clocking someone out ends a break they left open.
    if (t.outAt)
      for (const b of e.breaks)
        await tx.timeBreak.update({
          where: { tenantId_id: { tenantId: actor.tenantId, id: b.id } },
          data: { endsAt: b.startsAt > t.outAt ? b.startsAt : t.outAt },
          select: { id: true },
        });
    await tx.timeEntry.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: e.id } },
      data: {
        clockInAt: t.inAt,
        clockOutAt: t.outAt,
        shiftId: shift?.id ?? null,
        updatedBy: actor.userId,
        updatedAt: now,
      },
      select: { id: true },
    });
  } catch (err) {
    if (uniqueViolation(err))
      return conflict("This person is already clocked in.");
    if (isLockError(err)) return conflict(LOCKED_MESSAGE);
    throw err;
  }
  await tx.timeEntryChange.create({
    data: {
      tenantId: actor.tenantId,
      timeEntryId: e.id,
      kind: "corrected",
      oldClockIn: e.clockInAt,
      oldClockOut: e.clockOutAt,
      newClockIn: t.inAt,
      newClockOut: t.outAt,
      reason: t.reason,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "attendance.entry_corrected", e.id, {
    employeeId: e.employeeId,
    shiftId: shift?.id ?? null,
  });
  return { ok: true, data: { id: e.id } };
}

/** Removes an entry made in error. It's kept, marked removed, never deleted. */
export async function removeEntry(
  tx: TenantTx,
  actor: Actor,
  entryId: unknown,
  reasonRaw: unknown,
  now = new Date(),
): Promise<Result> {
  const e = await entryIn(tx, actor, entryId);
  if (!e) return notFound("entry");
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!reason || reason.length > 300)
    return invalid({ reason: "Give a reason (up to 300 characters)" });
  if (
    await isLocked(tx, actor.tenantId, e.siteId, e.site.timezone, e.clockInAt)
  )
    return conflict(LOCKED_MESSAGE);
  for (const b of e.breaks)
    await tx.timeBreak.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: b.id } },
      data: { endsAt: now > b.startsAt ? now : b.startsAt },
      select: { id: true },
    });
  await tx.timeEntry.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: e.id } },
    data: {
      removedAt: now,
      removedBy: actor.userId,
      updatedBy: actor.userId,
      updatedAt: now,
    },
    select: { id: true },
  });
  await tx.timeEntryChange.create({
    data: {
      tenantId: actor.tenantId,
      timeEntryId: e.id,
      kind: "removed",
      oldClockIn: e.clockInAt,
      oldClockOut: e.clockOutAt,
      reason,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "attendance.entry_removed", e.id, {
    employeeId: e.employeeId,
  });
  return { ok: true, data: { id: e.id } };
}

// --- Settings (D5, D7) ---------------------------------------------------------------

export async function saveSettings(
  tx: TenantTx,
  actor: Actor,
  raw: { toleranceMinutes?: unknown; missedClockOutHours?: unknown },
): Promise<Result> {
  if (!can(actor.grants, "tenant.settings.manage"))
    return {
      ok: false,
      code: "forbidden",
      message: "Your role doesn't allow this change.",
    };
  const tol = Number(raw.toleranceMinutes);
  const missed = Number(raw.missedClockOutHours);
  const errors: Record<string, string> = {};
  if (!Number.isInteger(tol) || tol < 0 || tol > 60)
    errors.toleranceMinutes = "Enter whole minutes from 0 to 60";
  if (!Number.isInteger(missed) || missed < 1 || missed > 12)
    errors.missedClockOutHours = "Enter whole hours from 1 to 12";
  if (Object.keys(errors).length) return invalid(errors);
  const limits: Limits = { toleranceMinutes: tol, missedClockOutHours: missed };
  const row = await tx.attendanceSettings.upsert({
    where: { tenantId: actor.tenantId },
    create: { tenantId: actor.tenantId, ...limits, updatedBy: actor.userId },
    update: { ...limits, updatedBy: actor.userId, updatedAt: new Date() },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "attendance.settings_updated",
    row.id,
    { ...limits },
    "attendance_settings",
  );
  return { ok: true, data: row };
}
