// Weekly timesheets (M11.2) and the approved-hours export (M11.3).
//
// One timesheet per site per rota week (Monday to Sunday in the site's time
// zone). It shows planned hours (the PUBLISHED rota) against worked hours
// (clocked time minus recorded breaks) per person and day, with the flags from
// M11.1. A manager with attendance.approve at the site approves it once the
// week has ended and nobody is still clocked in; approval LOCKS the week (also
// enforced by a database trigger). Reopening needs a reason (D9). Approvals and
// reopenings are kept in timesheet_event (append-only).
//
// The export (D11) is approved hours only, never money, for owners, admins
// and HR (attendance.export, organisation-wide). Every export is audited.

import { isUuid, type TenantTx } from "@/lib/tenancy";
import { can } from "@/lib/workspace/policy";
import * as rota from "@/modules/rota";

import { breakMinutes, entryFlags, workedMinutes, type Flag } from "./policy";
import { audit, limitsFor, type Actor, type Result } from "./shared";

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  rota.addDays(v, 0) === v;

const notFound = {
  ok: false,
  code: "not_found",
  message: "That timesheet couldn't be found.",
} as const;

/** Instants bounding a rota week at a site. */
export function weekBounds(weekStart: string, tz: string) {
  const at = (day: string) =>
    rota.zonedToUtc(`${day}T00:00`, tz) ?? asDate(day);
  return { from: at(weekStart), to: at(rota.addDays(weekStart, 7)) };
}

/** The rota week (Monday) an instant falls in, at a site. */
export const weekOf = (at: Date, tz: string) =>
  rota.mondayOf(rota.utcToZoned(at, tz).slice(0, 10));

/** Whether the week containing `at` is approved (locked) at a site. */
export async function isLocked(
  tx: TenantTx,
  tenantId: string,
  siteId: string,
  tz: string,
  at: Date,
): Promise<boolean> {
  const t = await tx.timesheet.findUnique({
    where: {
      tenantId_siteId_weekStart: {
        tenantId,
        siteId,
        weekStart: asDate(weekOf(at, tz)),
      },
    },
    select: { status: true },
  });
  return t?.status === "approved";
}

export const LOCKED_MESSAGE =
  "That week's timesheet is approved, so its times are locked. Ask someone who can approve timesheets to reopen it first.";

/** The database trigger's refusal, if a check above was bypassed. */
export const isLockError = (e: unknown) =>
  e instanceof Error && e.message.includes("time_entry_week_locked");

async function siteFor(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  code: "attendance.view" | "attendance.approve",
) {
  if (typeof siteId !== "string" || !isUuid(siteId)) return null;
  if (!can(actor.grants, code, siteId)) return null;
  return tx.site.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: siteId } },
    select: { id: true, name: true, timezone: true },
  });
}

const nameOf = (e: {
  givenName: string;
  familyName: string;
  preferredName: string | null;
}) => `${e.preferredName || e.givenName} ${e.familyName}`;

export type TimesheetFlag = Flag | "no_break";

/** A site's week: planned versus worked per person and day, with flags. */
export async function timesheet(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  weekInput: unknown,
  now = new Date(),
) {
  const site = await siteFor(tx, actor, siteId, "attendance.view");
  if (!site) return null;
  const today = rota.todayIn(site.timezone, now);
  const thisWeek = rota.mondayOf(today);
  const weekStart = isIsoDate(weekInput)
    ? rota.mondayOf(weekInput)
    : rota.addDays(thisWeek, -7);
  const { from, to } = weekBounds(weekStart, site.timezone);
  const days = rota.weekDays(weekStart);
  const limits = await limitsFor(tx, actor);

  const [sheet, shifts, entries] = await Promise.all([
    tx.timesheet.findUnique({
      where: {
        tenantId_siteId_weekStart: {
          tenantId: actor.tenantId,
          siteId: site.id,
          weekStart: asDate(weekStart),
        },
      },
      select: {
        id: true,
        status: true,
        approvedAt: true,
        events: {
          orderBy: { occurredAt: "asc" },
          select: { id: true, kind: true, reason: true, occurredAt: true },
        },
      },
    }),
    rota.publishedShifts(tx, actor.tenantId, { siteId: site.id, from, to }),
    tx.timeEntry.findMany({
      where: {
        tenantId: actor.tenantId,
        siteId: site.id,
        removedAt: null,
        clockInAt: { gte: from, lt: to },
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
        _count: { select: { changes: true } },
      },
    }),
  ]);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const employeeIds = [
    ...new Set([
      ...shifts.map((s) => s.employeeId),
      ...entries.map((e) => e.employeeId),
    ]),
  ];
  const people = await tx.employee.findMany({
    where: { tenantId: actor.tenantId, id: { in: employeeIds } },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      preferredName: true,
    },
  });
  const names = new Map(people.map((p) => [p.id, nameOf(p)]));
  const local = (d: Date) => rota.utcToZoned(d, site.timezone);
  const dayOf = (d: Date) => local(d).slice(0, 10);

  const rows = employeeIds
    .map((employeeId) => {
      const planned = shifts.filter((s) => s.employeeId === employeeId);
      const worked = entries
        .filter((e) => e.employeeId === employeeId)
        .map((e) => {
          const shift = e.shiftId ? (shiftById.get(e.shiftId) ?? null) : null;
          const flags: TimesheetFlag[] = entryFlags(
            {
              clockInAt: e.clockInAt,
              clockOutAt: e.clockOutAt,
              corrected: e.source === "manager" || e._count.changes > 0,
            },
            shift,
            limits,
            now,
          );
          // A planned break with none recorded: shown, never deducted (D6).
          if (shift && shift.breakMinutes > 0 && e.breaks.length === 0)
            flags.push("no_break");
          return {
            id: e.id,
            day: dayOf(e.clockInAt),
            clockIn: local(e.clockInAt),
            clockOut: e.clockOutAt ? local(e.clockOutAt) : null,
            breakMinutes: breakMinutes(e.breaks, e.clockOutAt ?? now),
            plannedBreakMinutes: shift?.breakMinutes ?? null,
            workedMinutes: workedMinutes(e, e.breaks, now),
            open: !e.clockOutAt,
            flags,
          };
        });
      const perDay = days.map((d) => ({
        day: d,
        planned: planned
          .filter((s) => dayOf(s.startsAt) === d)
          .reduce((sum, s) => sum + rota.workedMinutes(s), 0),
        worked: worked
          .filter((w) => w.day === d)
          .reduce((sum, w) => sum + w.workedMinutes, 0),
      }));
      return {
        employeeId,
        name: names.get(employeeId) ?? "Unknown",
        days: perDay,
        planned: perDay.reduce((s, d) => s + d.planned, 0),
        worked: perDay.reduce((s, d) => s + d.worked, 0),
        flagged: worked.filter((w) => w.flags.length).length,
        entries: worked,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const status = sheet?.status === "approved" ? "approved" : "open";
  const ended = now >= to;
  const openEntries = entries.filter((e) => !e.clockOutAt).length;
  const t = (d: Date) => local(d).replace("T", " ");
  return {
    site,
    weekStart,
    days,
    previousWeek: rota.addDays(weekStart, -7),
    nextWeek: rota.addDays(weekStart, 7),
    thisWeek,
    status,
    approvedAt: sheet?.approvedAt ? t(sheet.approvedAt) : null,
    events: (sheet?.events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      reason: e.reason,
      at: t(e.occurredAt),
    })),
    can: {
      approve: can(actor.grants, "attendance.approve", site.id),
      manage: can(actor.grants, "attendance.manage", site.id),
      export: can(actor.grants, "attendance.export"),
    },
    // Why it can't be approved yet, if it can't.
    blocker:
      status === "approved"
        ? null
        : !ended
          ? "This week hasn't finished yet."
          : openEntries
            ? `${openEntries} ${openEntries === 1 ? "person is" : "people are"} still clocked in this week. Enter their clock-out times first.`
            : null,
    totals: {
      planned: rows.reduce((s, r) => s + r.planned, 0),
      worked: rows.reduce((s, r) => s + r.worked, 0),
    },
    rows,
  };
}

/** Approves a finished week with nobody still clocked in; locks it. */
export async function approveTimesheet(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  weekInput: unknown,
  now = new Date(),
): Promise<Result> {
  const site = await siteFor(tx, actor, siteId, "attendance.approve");
  if (!site || !isIsoDate(weekInput) || rota.mondayOf(weekInput) !== weekInput)
    return notFound;
  const { from, to } = weekBounds(weekInput, site.timezone);
  if (now < to)
    return {
      ok: false,
      code: "conflict",
      message: "This week hasn't finished yet.",
    };
  const open = await tx.timeEntry.count({
    where: {
      tenantId: actor.tenantId,
      siteId: site.id,
      removedAt: null,
      clockOutAt: null,
      clockInAt: { gte: from, lt: to },
    },
  });
  if (open)
    return {
      ok: false,
      code: "conflict",
      message:
        "Someone is still clocked in this week. Enter their clock-out times first.",
    };
  const key = {
    tenantId_siteId_weekStart: {
      tenantId: actor.tenantId,
      siteId: site.id,
      weekStart: asDate(weekInput),
    },
  };
  const existing = await tx.timesheet.findUnique({
    where: key,
    select: { id: true, status: true },
  });
  if (existing?.status === "approved")
    return {
      ok: false,
      code: "conflict",
      message: "This week is already approved.",
    };
  const row = existing
    ? await tx.timesheet.update({
        where: key,
        data: {
          status: "approved",
          approvedBy: actor.userId,
          approvedAt: now,
          updatedAt: now,
        },
        select: { id: true },
      })
    : await tx.timesheet.create({
        data: {
          tenantId: actor.tenantId,
          siteId: site.id,
          weekStart: asDate(weekInput),
          status: "approved",
          approvedBy: actor.userId,
          approvedAt: now,
        },
        select: { id: true },
      });
  await tx.timesheetEvent.create({
    data: {
      tenantId: actor.tenantId,
      timesheetId: row.id,
      kind: "approved",
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "attendance.timesheet_approved",
    row.id,
    { siteId: site.id, weekStart: weekInput },
    "timesheet",
  );
  return { ok: true, data: row };
}

/** Reopens an approved week, with a reason (D9). */
export async function reopenTimesheet(
  tx: TenantTx,
  actor: Actor,
  siteId: unknown,
  weekInput: unknown,
  reasonRaw: unknown,
  now = new Date(),
): Promise<Result> {
  const site = await siteFor(tx, actor, siteId, "attendance.approve");
  if (!site || !isIsoDate(weekInput)) return notFound;
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!reason || reason.length > 300)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: { reason: "Give a reason (up to 300 characters)" },
    };
  const key = {
    tenantId_siteId_weekStart: {
      tenantId: actor.tenantId,
      siteId: site.id,
      weekStart: asDate(weekInput),
    },
  };
  const sheet = await tx.timesheet.findUnique({
    where: key,
    select: { id: true, status: true },
  });
  if (sheet?.status !== "approved")
    return {
      ok: false,
      code: "conflict",
      message: "This week isn't approved.",
    };
  await tx.timesheet.update({
    where: key,
    data: {
      status: "open",
      approvedBy: null,
      approvedAt: null,
      updatedAt: now,
    },
    select: { id: true },
  });
  await tx.timesheetEvent.create({
    data: {
      tenantId: actor.tenantId,
      timesheetId: sheet.id,
      kind: "reopened",
      reason,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
  await audit(
    tx,
    actor,
    "attendance.timesheet_reopened",
    sheet.id,
    { siteId: site.id, weekStart: weekInput },
    "timesheet",
  );
  return { ok: true, data: { id: sheet.id } };
}

/** A person's approved hours per week (most recent first), for My shifts. */
export async function myApprovedWeeks(
  tx: TenantTx,
  tenantId: string,
  employeeId: string,
  since: Date,
  now: Date,
) {
  const entries = await tx.timeEntry.findMany({
    where: { tenantId, employeeId, removedAt: null, clockInAt: { gte: since } },
    select: {
      siteId: true,
      clockInAt: true,
      clockOutAt: true,
      site: { select: { timezone: true } },
      breaks: { select: { startsAt: true, endsAt: true } },
    },
  });
  const keys = [
    ...new Map(
      entries.map((e) => {
        const w = weekOf(e.clockInAt, e.site.timezone);
        return [`${e.siteId}|${w}`, { siteId: e.siteId, weekStart: w }];
      }),
    ).values(),
  ];
  if (!keys.length) return [];
  const approved = await tx.timesheet.findMany({
    where: {
      tenantId,
      status: "approved",
      OR: keys.map((k) => ({
        siteId: k.siteId,
        weekStart: asDate(k.weekStart),
      })),
    },
    select: { siteId: true, weekStart: true },
  });
  const ok = new Set(approved.map((a) => `${a.siteId}|${isoOf(a.weekStart)}`));
  const byWeek = new Map<string, number>();
  for (const e of entries) {
    const w = weekOf(e.clockInAt, e.site.timezone);
    if (!ok.has(`${e.siteId}|${w}`)) continue;
    byWeek.set(w, (byWeek.get(w) ?? 0) + workedMinutes(e, e.breaks, now));
  }
  return [...byWeek.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([weekStart, minutes]) => ({ weekStart, minutes }));
}

// --- Export (M11.3) -------------------------------------------------------------------

/** Exact decimal hours from whole minutes ("7.50"), without floating point. */
export function hoursDecimal(minutes: number): string {
  const hundredths = Math.round((minutes * 100) / 60);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/** A CSV cell, quoted, with spreadsheet formulas neutralised. */
export function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const EXPORT_MAX_DAYS = 93;

/**
 * Approved hours between two dates (inclusive), one row per entry, for
 * organisation-wide exporters only. Only weeks whose timesheet is approved.
 */
export async function exportApprovedHours(
  tx: TenantTx,
  actor: Actor,
  fromRaw: unknown,
  toRaw: unknown,
  now = new Date(),
): Promise<Result<{ csv: string; rows: number; fileName: string }>> {
  if (!can(actor.grants, "attendance.export"))
    return {
      ok: false,
      code: "forbidden",
      message: "Your role doesn't allow exports.",
    };
  const errors: Record<string, string> = {};
  if (!isIsoDate(fromRaw)) errors.from = "Choose the first date";
  if (!isIsoDate(toRaw)) errors.to = "Choose the last date";
  else if (
    isIsoDate(fromRaw) &&
    (toRaw < fromRaw || toRaw > rota.addDays(fromRaw, EXPORT_MAX_DAYS))
  )
    errors.to = `Choose a last date on or after the first, within ${EXPORT_MAX_DAYS} days`;
  if (Object.keys(errors).length)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: errors,
    };
  const from = fromRaw as string;
  const to = toRaw as string;

  // Widen by a day each side for time zones; filter by local date below.
  const entries = await tx.timeEntry.findMany({
    where: {
      tenantId: actor.tenantId,
      removedAt: null,
      clockOutAt: { not: null },
      clockInAt: {
        gte: asDate(rota.addDays(from, -1)),
        lt: asDate(rota.addDays(to, 2)),
      },
    },
    orderBy: [{ clockInAt: "asc" }],
    select: {
      siteId: true,
      shiftId: true,
      clockInAt: true,
      clockOutAt: true,
      site: { select: { name: true, timezone: true } },
      employee: {
        select: { employeeNumber: true, givenName: true, familyName: true },
      },
      breaks: { select: { startsAt: true, endsAt: true } },
    },
  });
  const sheets = await tx.timesheet.findMany({
    where: {
      tenantId: actor.tenantId,
      status: "approved",
      weekStart: { gte: asDate(rota.mondayOf(from)), lte: asDate(to) },
    },
    select: { siteId: true, weekStart: true },
  });
  const approved = new Set(
    sheets.map((s) => `${s.siteId}|${isoOf(s.weekStart)}`),
  );
  const header = [
    "employee_number",
    "given_name",
    "family_name",
    "site",
    "date",
    "clock_in",
    "clock_out",
    "break_minutes",
    "worked_minutes",
    "worked_hours",
    "on_rota",
  ];
  const lines = [header.map(csvCell).join(",")];
  let rows = 0;
  for (const e of entries) {
    const tz = e.site.timezone;
    const start = rota.utcToZoned(e.clockInAt, tz);
    const day = start.slice(0, 10);
    if (day < from || day > to) continue;
    if (!approved.has(`${e.siteId}|${rota.mondayOf(day)}`)) continue;
    const out = e.clockOutAt!;
    const worked = workedMinutes(e, e.breaks, now);
    lines.push(
      [
        e.employee.employeeNumber ?? "",
        e.employee.givenName,
        e.employee.familyName,
        e.site.name,
        day,
        start.slice(11, 16),
        rota.utcToZoned(out, tz).replace("T", " "),
        breakMinutes(e.breaks, out),
        worked,
        hoursDecimal(worked),
        e.shiftId ? "yes" : "no",
      ]
        .map(csvCell)
        .join(","),
    );
    rows += 1;
  }
  await audit(
    tx,
    actor,
    "attendance.hours_exported",
    actor.tenantId,
    { from, to, rows },
    "timesheet",
  );
  return {
    ok: true,
    data: {
      csv: `${lines.join("\r\n")}\r\n`,
      rows,
      fileName: `approved-hours-${from}-to-${to}.csv`,
    },
  };
}
