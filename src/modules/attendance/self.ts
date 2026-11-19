// Clocking for staff (M11.1). Reached through OWNERSHIP (the employee record
// linked to the signed-in member), never through a role (scope D1). Staff can't
// name a person, site, shift or time: the server decides all of them, and every
// time comes from the server clock.

import type { TenantTx } from "@/lib/tenancy";
import * as rota from "@/modules/rota";

import {
  MATCH_BEFORE_MINUTES,
  MAX_ENTRY_HOURS,
  breakMinutes,
  entryFlags,
  matchShift,
  workedMinutes,
  type Flag,
} from "./policy";
import {
  audit,
  limitsFor,
  uniqueViolation,
  type Actor,
  type Result,
} from "./shared";
import { myApprovedWeeks } from "./timesheets";

const HOUR = 3_600_000;
const RECENT_DAYS = 14;

async function ownRecord(tx: TenantTx, actor: Actor) {
  const e = await tx.employee.findUnique({
    where: {
      tenantId_membershipId: {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
      },
    },
    select: {
      id: true,
      givenName: true,
      preferredName: true,
      status: true,
      primarySiteId: true,
      primarySite: { select: { timezone: true, status: true } },
    },
  });
  return e && e.status !== "left" ? e : null;
}

const NOT_LINKED = {
  ok: false,
  code: "not_found",
  message: "Your login isn't linked to a staff record.",
} as const;

async function openEntry(tx: TenantTx, actor: Actor, employeeId: string) {
  return tx.timeEntry.findFirst({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      clockOutAt: null,
      removedAt: null,
    },
    select: {
      id: true,
      siteId: true,
      shiftId: true,
      clockInAt: true,
      breaks: {
        where: { endsAt: null },
        select: { id: true, startsAt: true },
      },
    },
  });
}

/** Their clock state and their times for the last two weeks. */
export async function myClock(tx: TenantTx, actor: Actor, now = new Date()) {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const homeTz = me.primarySite?.timezone ?? "Europe/London";
  const limits = await limitsFor(tx, actor);
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * HOUR);
  const [entries, shifts] = await Promise.all([
    tx.timeEntry.findMany({
      where: {
        tenantId: actor.tenantId,
        employeeId: me.id,
        removedAt: null,
        OR: [{ clockInAt: { gte: since } }, { clockOutAt: null }],
      },
      orderBy: { clockInAt: "desc" },
      select: {
        id: true,
        clockInAt: true,
        clockOutAt: true,
        shiftId: true,
        source: true,
        site: { select: { name: true, timezone: true } },
        breaks: { select: { startsAt: true, endsAt: true } },
        _count: { select: { changes: true } },
      },
    }),
    rota.publishedShifts(tx, actor.tenantId, {
      employeeIds: [me.id],
      from: since,
      to: new Date(now.getTime() + 24 * HOUR),
    }),
  ]);
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const fmt = (d: Date, tz: string) => rota.utcToZoned(d, tz).slice(11, 16);

  const open = entries.find((e) => !e.clockOutAt) ?? null;
  // The next shift they could clock in for (running or starting soon).
  const next =
    shifts.find(
      (s) => s.endsAt > now && s.startsAt.getTime() - now.getTime() < 12 * HOUR,
    ) ?? null;
  const siteNames = new Map(
    (
      await tx.site.findMany({
        where: {
          tenantId: actor.tenantId,
          id: { in: [...new Set(shifts.map((s) => s.siteId))] },
        },
        select: { id: true, name: true, timezone: true },
      })
    ).map((s) => [s.id, s]),
  );

  const approvedWeeks = await myApprovedWeeks(
    tx,
    actor.tenantId,
    me.id,
    new Date(now.getTime() - 35 * 24 * HOUR),
    now,
  );

  return {
    firstName: me.preferredName || me.givenName,
    approvedWeeks,
    canClock: Boolean(open || me.primarySiteId || next),
    open: open
      ? {
          id: open.id,
          since: fmt(open.clockInAt, open.site.timezone),
          siteName: open.site.name,
          onBreak: open.breaks.some((b) => !b.endsAt),
          tooLong:
            now.getTime() - open.clockInAt.getTime() > MAX_ENTRY_HOURS * HOUR,
        }
      : null,
    next: next
      ? {
          day: rota
            .utcToZoned(
              next.startsAt,
              siteNames.get(next.siteId)?.timezone ?? homeTz,
            )
            .slice(0, 10),
          start: fmt(
            next.startsAt,
            siteNames.get(next.siteId)?.timezone ?? homeTz,
          ),
          end: fmt(next.endsAt, siteNames.get(next.siteId)?.timezone ?? homeTz),
          siteName: siteNames.get(next.siteId)?.name ?? "Another site",
        }
      : null,
    recent: entries.map((e) => {
      const tz = e.site.timezone;
      const shift = e.shiftId ? (shiftById.get(e.shiftId) ?? null) : null;
      const flags: Flag[] = entryFlags(
        {
          clockInAt: e.clockInAt,
          clockOutAt: e.clockOutAt,
          corrected: e.source === "manager" || e._count.changes > 0,
        },
        shift,
        limits,
        now,
      ).filter((f) => f === "corrected" || f === "missed_clock_out");
      return {
        id: e.id,
        day: rota.utcToZoned(e.clockInAt, tz).slice(0, 10),
        clockIn: fmt(e.clockInAt, tz),
        clockOut: e.clockOutAt ? fmt(e.clockOutAt, tz) : null,
        siteName: e.site.name,
        breakMinutes: breakMinutes(e.breaks, e.clockOutAt ?? now),
        workedMinutes: workedMinutes(e, e.breaks, now),
        flags,
      };
    }),
  };
}

/** Clocks in now, matched to a published shift they're on (D3: no match = flagged). */
export async function clockIn(
  tx: TenantTx,
  actor: Actor,
  now = new Date(),
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me) return NOT_LINKED;
  if (await openEntry(tx, actor, me.id))
    return {
      ok: false,
      code: "conflict",
      message: "You're already clocked in.",
    };
  const shifts = await rota.publishedShifts(tx, actor.tenantId, {
    employeeIds: [me.id],
    from: new Date(now.getTime() - HOUR),
    to: new Date(now.getTime() + MATCH_BEFORE_MINUTES * 60_000 + 1),
  });
  const shift = matchShift(shifts, now);
  const siteId = shift?.siteId ?? me.primarySiteId;
  if (!siteId)
    return {
      ok: false,
      code: "invalid",
      message:
        "You have no shift now and no home site, so TeamHappi can't tell where you are. Ask your manager to record your times.",
    };
  try {
    const entry = await tx.timeEntry.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: me.id,
        siteId,
        shiftId: shift?.id ?? null,
        clockInAt: now,
        source: "self",
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await audit(tx, actor, "attendance.clocked_in", entry.id, {
      employeeId: me.id,
      siteId,
      shiftId: shift?.id ?? null,
    });
    return { ok: true, data: entry };
  } catch (e) {
    if (uniqueViolation(e))
      return {
        ok: false,
        code: "conflict",
        message: "You're already clocked in.",
      };
    throw e;
  }
}

const NOT_IN = {
  ok: false,
  code: "conflict",
  message: "You're not clocked in.",
} as const;

/** Starts or ends a break on their open entry. */
export async function toggleBreak(
  tx: TenantTx,
  actor: Actor,
  start: boolean,
  now = new Date(),
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me) return NOT_LINKED;
  const entry = await openEntry(tx, actor, me.id);
  if (!entry) return NOT_IN;
  const current = entry.breaks[0] ?? null;
  if (start) {
    if (current)
      return {
        ok: false,
        code: "conflict",
        message: "You're already on a break.",
      };
    try {
      const b = await tx.timeBreak.create({
        data: {
          tenantId: actor.tenantId,
          timeEntryId: entry.id,
          startsAt: now,
        },
        select: { id: true },
      });
      await audit(tx, actor, "attendance.break_started", entry.id, {
        breakId: b.id,
      });
      return { ok: true, data: { id: entry.id } };
    } catch (e) {
      if (uniqueViolation(e))
        return {
          ok: false,
          code: "conflict",
          message: "You're already on a break.",
        };
      throw e;
    }
  }
  if (!current)
    return { ok: false, code: "conflict", message: "You're not on a break." };
  await tx.timeBreak.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: current.id } },
    data: { endsAt: now },
    select: { id: true },
  });
  await audit(tx, actor, "attendance.break_ended", entry.id, {
    breakId: current.id,
  });
  return { ok: true, data: { id: entry.id } };
}

/** Clocks out now (ending an open break). Over 24 hours: the manager records it (D7). */
export async function clockOut(
  tx: TenantTx,
  actor: Actor,
  now = new Date(),
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me) return NOT_LINKED;
  const entry = await openEntry(tx, actor, me.id);
  if (!entry) return NOT_IN;
  if (now.getTime() - entry.clockInAt.getTime() > MAX_ENTRY_HOURS * HOUR)
    return {
      ok: false,
      code: "conflict",
      message:
        "You've been clocked in for over 24 hours. Ask your manager to enter the time you left.",
    };
  for (const b of entry.breaks)
    await tx.timeBreak.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: b.id } },
      data: { endsAt: now },
      select: { id: true },
    });
  await tx.timeEntry.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: entry.id } },
    data: { clockOutAt: now, updatedBy: actor.userId, updatedAt: now },
    select: { id: true },
  });
  await audit(tx, actor, "attendance.clocked_out", entry.id, {
    employeeId: me.id,
  });
  return { ok: true, data: { id: entry.id } };
}
