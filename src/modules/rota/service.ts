// Rota service (M10.1). Every function receives a transaction scoped to one
// organisation by withTenant() (so RLS applies) and an Actor from the server
// session. Permissions and site scope are checked here for every read and
// write. Changes to a PUBLISHED week are kept in shift_change (append-only) for
// staff highlights (M10.2) and Attendance (M11). The audit trail holds ids and
// codes only: never notes or override reasons.
//
// Assignment checks (scope decisions D3-D5):
//   blocked: no right-to-work check covers the shift date (yes/no only, from
//            onboarding); the person is already on an overlapping shift;
//   warned:  onboarding tasks open, mandatory training overdue or expired on
//            the shift date, short rest, long shift without a break, over 48h
//            in the week. Going ahead needs a written reason (kept on the
//            assignment, not in the audit trail).

import { isUuid, type TenantTx } from "@/lib/tenancy";
import * as onboarding from "@/modules/onboarding";
import * as training from "@/modules/training";

import {
  addDays,
  canAt,
  formatMinutes,
  isIsoDate,
  mondayOf,
  scopeSites,
  shiftTimes,
  todayIn,
  utcToZoned,
  weekDays,
  workedMinutes,
  workingTimeWarnings,
  zonedToUtc,
  type Actor,
  type TimedShift,
  type Warning,
} from "./policy";

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict" | "needs_reason";
      message: string;
      fieldErrors?: Record<string, string>;
      warnings?: Warning[];
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

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType: "rota_week" | "shift",
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

async function change(
  tx: TenantTx,
  actor: Actor,
  shiftId: string,
  kind: "created" | "updated" | "cancelled" | "assigned" | "unassigned",
  detail: Record<string, string | null> = {},
) {
  await tx.shiftChange.create({
    data: {
      tenantId: actor.tenantId,
      shiftId,
      kind,
      detail,
      actorUserId: actor.userId,
    },
    select: { id: true },
  });
}

async function siteOf(tx: TenantTx, actor: Actor, siteId: unknown) {
  if (typeof siteId !== "string" || !isUuid(siteId)) return null;
  return tx.site.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: siteId } },
    select: { id: true, name: true, timezone: true, status: true },
  });
}

async function weekRow(
  tx: TenantTx,
  actor: Actor,
  siteId: string,
  weekStart: string,
) {
  return tx.rotaWeek.findUnique({
    where: {
      tenantId_siteId_weekStart: {
        tenantId: actor.tenantId,
        siteId,
        weekStart: asDate(weekStart),
      },
    },
    select: { id: true, status: true, publishedAt: true },
  });
}

async function ensureWeek(
  tx: TenantTx,
  actor: Actor,
  siteId: string,
  weekStart: string,
) {
  const existing = await weekRow(tx, actor, siteId, weekStart);
  if (existing) return existing;
  return tx.rotaWeek.create({
    data: {
      tenantId: actor.tenantId,
      siteId,
      weekStart: asDate(weekStart),
      createdBy: actor.userId,
    },
    select: { id: true, status: true, publishedAt: true },
  });
}

// --- Reads ---------------------------------------------------------------------------

/** Sites whose rota the actor can see. */
export async function rotaSites(tx: TenantTx, actor: Actor) {
  const scope = scopeSites(actor, "rota.view");
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

const shiftSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  breakMinutes: true,
  roleLabel: true,
  note: true,
  teamId: true,
  status: true,
  team: { select: { name: true } },
  assignments: {
    where: { removedAt: null },
    select: {
      employeeId: true,
      overrideReason: true,
      employee: {
        select: { givenName: true, familyName: true, preferredName: true },
      },
    },
  },
} as const;

const nameOf = (e: {
  givenName: string;
  familyName: string;
  preferredName: string | null;
}) => `${e.preferredName || e.givenName} ${e.familyName}`;

/**
 * Checks for putting `employeeIds` on shifts. Returns a function giving the
 * warnings for one person on one shift.
 */
async function checker(
  tx: TenantTx,
  actor: Actor,
  employeeIds: readonly string[],
  shifts: readonly (TimedShift & { day: string })[],
  weekStartAt: Date,
  weekEndAt: Date,
  today: string,
) {
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return () => [] as Warning[];
  const days = [...new Set(shifts.map((s) => s.day))];
  const windowStart = new Date(
    Math.min(
      weekStartAt.getTime(),
      ...shifts.map((s) => s.startsAt.getTime()),
    ) -
      24 * 3600_000,
  );
  const windowEnd = new Date(
    Math.max(weekEndAt.getTime(), ...shifts.map((s) => s.endsAt.getTime())) +
      24 * 3600_000,
  );
  const [rtw, openTasks, gapsByDay, theirs] = await Promise.all([
    onboarding.rtwCoverage(tx, actor, ids),
    onboarding.openRequiredTasks(tx, actor, ids, today),
    Promise.all(
      days.map(
        async (d) =>
          [d, await training.mandatoryGapsOn(tx, actor, ids, d)] as const,
      ),
    ),
    // Every active shift these people are on around the week, at any site.
    tx.shiftAssignment.findMany({
      where: {
        tenantId: actor.tenantId,
        employeeId: { in: ids },
        removedAt: null,
        shift: {
          status: "active",
          startsAt: { lt: windowEnd },
          endsAt: { gt: windowStart },
        },
      },
      select: {
        employeeId: true,
        shift: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            breakMinutes: true,
          },
        },
      },
    }),
  ]);
  const gaps = new Map(gapsByDay);
  const byPerson = new Map<string, TimedShift[]>();
  for (const a of theirs)
    byPerson.set(a.employeeId, [
      ...(byPerson.get(a.employeeId) ?? []),
      a.shift,
    ]);
  return (employeeId: string, shift: TimedShift & { day: string }) => {
    const out: Warning[] = [];
    if (!rtw(employeeId, shift.day))
      out.push({
        code: "no_rtw",
        blocking: true,
        message:
          "No recorded right-to-work check covers this date. An owner, administrator or HR manager needs to record one first.",
      });
    const others = byPerson.get(employeeId) ?? [];
    out.push(
      ...workingTimeWarnings(
        shift,
        others,
        others.filter(
          (o) => o.startsAt >= weekStartAt && o.startsAt < weekEndAt,
        ),
      ),
    );
    const open = openTasks.get(employeeId);
    if (open)
      out.push({
        code: "onboarding",
        blocking: false,
        message: `Onboarding isn't finished (${open} required task${open === 1 ? "" : "s"} open).`,
      });
    const missing = gaps.get(shift.day)?.get(employeeId);
    if (missing?.length)
      out.push({
        code: "training",
        blocking: false,
        message: `Mandatory training overdue or expired by then: ${missing.join(", ")}.`,
      });
    return out;
  };
}

export async function getWeek(
  tx: TenantTx,
  actor: Actor,
  siteIdRaw: unknown,
  weekRaw: unknown,
) {
  const site = await siteOf(tx, actor, siteIdRaw);
  if (!site || !canAt(actor, "rota.view", site.id)) return null;
  const today = todayIn(site.timezone);
  const weekStart = mondayOf(isIsoDate(weekRaw) ? weekRaw : today);
  const tz = site.timezone;
  const weekStartAt = zonedToUtc(`${weekStart}T00:00`, tz)!;
  const weekEndAt = zonedToUtc(`${addDays(weekStart, 7)}T00:00`, tz)!;
  const week = await weekRow(tx, actor, site.id, weekStart);
  const [shifts, people, teams] = await Promise.all([
    week
      ? tx.shift.findMany({
          where: { tenantId: actor.tenantId, rotaWeekId: week.id },
          orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
          select: shiftSelect,
        })
      : Promise.resolve([]),
    tx.employee.findMany({
      where: {
        tenantId: actor.tenantId,
        primarySiteId: site.id,
        status: { in: ["pending", "active"] },
      },
      orderBy: [{ givenName: "asc" }, { familyName: "asc" }],
      select: {
        id: true,
        givenName: true,
        familyName: true,
        preferredName: true,
        jobTitle: true,
      },
    }),
    tx.team.findMany({
      where: { tenantId: actor.tenantId, siteId: site.id, archived: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const active = shifts.filter((s) => s.status === "active");
  const timed = active.map((s) => ({
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    breakMinutes: s.breakMinutes,
    day: utcToZoned(s.startsAt, tz).slice(0, 10),
  }));
  const assigned = active.flatMap((s) =>
    s.assignments.map((a) => ({ shiftId: s.id, employeeId: a.employeeId })),
  );
  const canManage = canAt(actor, "rota.manage", site.id);
  const check = canManage
    ? await checker(
        tx,
        actor,
        assigned.map((a) => a.employeeId),
        timed,
        weekStartAt,
        weekEndAt,
        today,
      )
    : () => [];
  const timedById = new Map(timed.map((t) => [t.id, t]));
  const hours = new Map<string, number>();
  for (const a of assigned)
    hours.set(
      a.employeeId,
      (hours.get(a.employeeId) ?? 0) + workedMinutes(timedById.get(a.shiftId)!),
    );
  return {
    site: { id: site.id, name: site.name, timeZone: tz },
    weekStart,
    days: weekDays(weekStart),
    previousWeek: addDays(weekStart, -7),
    nextWeek: addDays(weekStart, 7),
    status: (week?.status ?? "draft") as "draft" | "published",
    publishedAt: week?.publishedAt ?? null,
    shifts: shifts.map((s) => {
      const a = s.assignments[0];
      const local = utcToZoned(s.startsAt, tz);
      return {
        id: s.id,
        day: local.slice(0, 10),
        start: local.slice(11, 16),
        end: utcToZoned(s.endsAt, tz).slice(11, 16),
        breakMinutes: s.breakMinutes,
        minutes: workedMinutes(s),
        roleLabel: s.roleLabel,
        note: s.note,
        teamId: s.teamId,
        teamName: s.team?.name ?? null,
        cancelled: s.status === "cancelled",
        assignee: a
          ? {
              id: a.employeeId,
              name: nameOf(a.employee),
              overridden: a.overrideReason !== null,
            }
          : null,
        warnings:
          a && s.status === "active"
            ? check(a.employeeId, timedById.get(s.id)!)
            : [],
      };
    }),
    people: people.map((p) => ({
      id: p.id,
      name: nameOf(p),
      jobTitle: p.jobTitle,
      minutes: hours.get(p.id) ?? 0,
      hours: formatMinutes(hours.get(p.id) ?? 0),
    })),
    teams,
    totalMinutes: active.reduce((sum, s) => sum + workedMinutes(s), 0),
    openShifts: active.filter((s) => s.assignments.length === 0).length,
    can: {
      manage: canManage,
      publish: canAt(actor, "rota.publish", site.id),
    },
  };
}

// --- Shifts ---------------------------------------------------------------------------

export interface ShiftInput {
  day?: unknown;
  start?: unknown;
  end?: unknown;
  breakMinutes?: unknown;
  teamId?: unknown;
  roleLabel?: unknown;
  note?: unknown;
}

const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max + 1) : null;
};

async function loadShift(tx: TenantTx, actor: Actor, shiftId: unknown) {
  if (typeof shiftId !== "string" || !isUuid(shiftId)) return null;
  return tx.shift.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: shiftId } },
    select: {
      id: true,
      siteId: true,
      status: true,
      startsAt: true,
      endsAt: true,
      breakMinutes: true,
      teamId: true,
      roleLabel: true,
      note: true,
      week: { select: { id: true, weekStart: true, status: true } },
      assignments: {
        where: { removedAt: null },
        select: { id: true, employeeId: true },
      },
    },
  });
}

/** Creates (shiftId null) or edits a shift in a site's week. */
export async function saveShift(
  tx: TenantTx,
  actor: Actor,
  siteIdRaw: unknown,
  weekRaw: unknown,
  shiftId: string | null,
  raw: ShiftInput,
): Promise<Result> {
  const site = await siteOf(tx, actor, siteIdRaw);
  if (!site || !canAt(actor, "rota.view", site.id)) return notFound("site");
  if (!canAt(actor, "rota.manage", site.id)) return forbidden();
  if (site.status !== "active") return conflict("This site is archived.");
  if (!isIsoDate(weekRaw) || mondayOf(weekRaw) !== weekRaw)
    return invalid({ day: "Choose a week" });
  const weekStart = weekRaw;
  const times = shiftTimes(
    raw.day,
    raw.start,
    raw.end,
    raw.breakMinutes,
    site.timezone,
  );
  if (!times.ok) return invalid(times.fieldErrors);
  const day = raw.day as string;
  if (day < weekStart || day > addDays(weekStart, 6))
    return invalid({ day: "Choose a day in this week" });
  const roleLabel = text(raw.roleLabel, 60);
  const note = text(raw.note, 500);
  const fieldErrors: Record<string, string> = {};
  if (roleLabel && roleLabel.length > 60)
    fieldErrors.roleLabel = "Keep the role to 60 characters";
  if (note && note.length > 500)
    fieldErrors.note = "Keep the note to 500 characters";
  let teamId: string | null = null;
  if (typeof raw.teamId === "string" && raw.teamId) {
    const team = isUuid(raw.teamId)
      ? await tx.team.findUnique({
          where: { tenantId_id: { tenantId: actor.tenantId, id: raw.teamId } },
          select: { id: true, siteId: true, archived: true },
        })
      : null;
    if (!team || team.siteId !== site.id || team.archived)
      fieldErrors.teamId = "Choose a team at this site";
    else teamId = team.id;
  }
  if (Object.keys(fieldErrors).length) return invalid(fieldErrors);

  const data = {
    teamId,
    roleLabel,
    note,
    startsAt: times.startsAt,
    endsAt: times.endsAt,
    breakMinutes: times.breakMinutes,
  };
  if (shiftId === null) {
    const week = await ensureWeek(tx, actor, site.id, weekStart);
    const shift = await tx.shift.create({
      data: {
        tenantId: actor.tenantId,
        rotaWeekId: week.id,
        siteId: site.id,
        createdBy: actor.userId,
        updatedBy: actor.userId,
        ...data,
      },
      select: { id: true },
    });
    if (week.status === "published")
      await change(tx, actor, shift.id, "created", {
        startsAt: times.startsAt.toISOString(),
        endsAt: times.endsAt.toISOString(),
      });
    return { ok: true, data: shift };
  }

  const existing = await loadShift(tx, actor, shiftId);
  if (!existing || existing.siteId !== site.id) return notFound("shift");
  if (existing.status !== "active")
    return conflict("This shift was cancelled.");
  if (isoOf(existing.week.weekStart) !== weekStart)
    return invalid({ day: "Choose a day in this shift's week" });
  // Someone is on it: the blocking checks apply to the new times too.
  const who = existing.assignments[0];
  if (who) {
    const timed = { id: existing.id, ...data, day };
    const check = await checker(
      tx,
      actor,
      [who.employeeId],
      [timed],
      zonedToUtc(`${weekStart}T00:00`, site.timezone)!,
      zonedToUtc(`${addDays(weekStart, 7)}T00:00`, site.timezone)!,
      day,
    );
    const blocking = check(who.employeeId, timed).filter((w) => w.blocking);
    if (blocking.length)
      return {
        ok: false,
        code: "conflict",
        message: blocking.map((w) => w.message).join(" "),
        warnings: blocking,
      };
  }
  await tx.shift.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: existing.id } },
    data: { ...data, updatedBy: actor.userId, updatedAt: new Date() },
    select: { id: true },
  });
  if (existing.week.status === "published")
    await change(tx, actor, existing.id, "updated", {
      startsAt: times.startsAt.toISOString(),
      endsAt: times.endsAt.toISOString(),
    });
  return { ok: true, data: { id: existing.id } };
}

/** Cancels a shift (kept for history; it no longer counts anywhere). */
export async function cancelShift(
  tx: TenantTx,
  actor: Actor,
  shiftId: unknown,
): Promise<Result> {
  const s = await loadShift(tx, actor, shiftId);
  if (!s || !canAt(actor, "rota.view", s.siteId)) return notFound("shift");
  if (!canAt(actor, "rota.manage", s.siteId)) return forbidden();
  if (s.status !== "active")
    return conflict("This shift is already cancelled.");
  const now = new Date();
  await tx.shift.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: s.id } },
    data: {
      status: "cancelled",
      cancelledAt: now,
      cancelledBy: actor.userId,
      updatedBy: actor.userId,
      updatedAt: now,
    },
    select: { id: true },
  });
  if (s.week.status === "published") {
    await change(tx, actor, s.id, "cancelled", {
      employeeId: s.assignments[0]?.employeeId ?? null,
    });
    await audit(tx, actor, "rota.shift_cancelled", "shift", s.id, {
      weekId: s.week.id,
    });
  }
  return { ok: true, data: { id: s.id } };
}

// --- Assignments -------------------------------------------------------------------------

/**
 * Puts one person on a shift (replacing anyone already on it). Blocking checks
 * refuse; warnings need `overrideReason` (returned as needs_reason otherwise).
 */
export async function assignShift(
  tx: TenantTx,
  actor: Actor,
  shiftId: unknown,
  employeeIdRaw: unknown,
  overrideReasonRaw: unknown,
): Promise<Result> {
  const s = await loadShift(tx, actor, shiftId);
  if (!s || !canAt(actor, "rota.view", s.siteId)) return notFound("shift");
  if (!canAt(actor, "rota.manage", s.siteId)) return forbidden();
  if (s.status !== "active") return conflict("This shift was cancelled.");
  if (typeof employeeIdRaw !== "string" || !isUuid(employeeIdRaw))
    return invalid({ employeeId: "Choose a person" });
  const person = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeIdRaw } },
    select: { id: true, status: true },
  });
  if (!person || person.status === "left")
    return invalid({ employeeId: "Choose a current member of staff" });
  if (s.assignments[0]?.employeeId === person.id)
    return conflict("They're already on this shift.");
  // One assignment at a time per person: serialise on their record so two
  // managers can't double-book them at once.
  await tx.$queryRaw`SELECT 1 FROM "employee" WHERE "tenant_id" = ${actor.tenantId}::uuid AND "id" = ${person.id}::uuid FOR UPDATE`;

  const site = (await siteOf(tx, actor, s.siteId))!;
  const weekStart = isoOf(s.week.weekStart);
  const day = utcToZoned(s.startsAt, site.timezone).slice(0, 10);
  const timed = {
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    breakMinutes: s.breakMinutes,
    day,
  };
  const check = await checker(
    tx,
    actor,
    [person.id],
    [timed],
    zonedToUtc(`${weekStart}T00:00`, site.timezone)!,
    zonedToUtc(`${addDays(weekStart, 7)}T00:00`, site.timezone)!,
    day,
  );
  const warnings = check(person.id, timed);
  const blocking = warnings.filter((w) => w.blocking);
  if (blocking.length)
    return {
      ok: false,
      code: "conflict",
      message: blocking.map((w) => w.message).join(" "),
      warnings: blocking,
    };
  const reason =
    typeof overrideReasonRaw === "string" ? overrideReasonRaw.trim() : "";
  if (warnings.length && reason.length < 3)
    return {
      ok: false,
      code: "needs_reason",
      message: "Check these before going ahead, and say why it's OK.",
      fieldErrors: {
        overrideReason: "Give a short reason (at least 3 characters)",
      },
      warnings,
    };
  if (reason.length > 300)
    return invalid({ overrideReason: "Keep the reason to 300 characters" });

  const now = new Date();
  const previous = s.assignments[0];
  if (previous)
    await tx.shiftAssignment.update({
      where: { tenantId_id: { tenantId: actor.tenantId, id: previous.id } },
      data: { removedAt: now, removedBy: actor.userId },
      select: { id: true },
    });
  await tx.shiftAssignment.create({
    data: {
      tenantId: actor.tenantId,
      shiftId: s.id,
      employeeId: person.id,
      assignedBy: actor.userId,
      overrideReason: warnings.length ? reason : null,
    },
    select: { id: true },
  });
  if (s.week.status === "published")
    await change(tx, actor, s.id, "assigned", {
      employeeId: person.id,
      previousEmployeeId: previous?.employeeId ?? null,
    });
  await audit(tx, actor, "rota.shift_assigned", "shift", s.id, {
    employeeId: person.id,
    previousEmployeeId: previous?.employeeId ?? null,
    // Codes only; the reason itself stays on the assignment.
    overridden: warnings.map((w) => w.code).join(",") || null,
  });
  return { ok: true, data: { id: s.id } };
}

/** Takes the person off a shift, leaving it open. */
export async function unassignShift(
  tx: TenantTx,
  actor: Actor,
  shiftId: unknown,
): Promise<Result> {
  const s = await loadShift(tx, actor, shiftId);
  if (!s || !canAt(actor, "rota.view", s.siteId)) return notFound("shift");
  if (!canAt(actor, "rota.manage", s.siteId)) return forbidden();
  const current = s.assignments[0];
  if (!current) return conflict("Nobody is on this shift.");
  await tx.shiftAssignment.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: current.id } },
    data: { removedAt: new Date(), removedBy: actor.userId },
    select: { id: true },
  });
  if (s.week.status === "published")
    await change(tx, actor, s.id, "unassigned", {
      employeeId: current.employeeId,
    });
  await audit(tx, actor, "rota.shift_unassigned", "shift", s.id, {
    employeeId: current.employeeId,
  });
  return { ok: true, data: { id: s.id } };
}

// --- Week actions ------------------------------------------------------------------------

/**
 * Copies last week's active shifts into an empty week (same wall-clock times, so
 * clock changes are handled). People are copied only where no check warns or
 * blocks; the rest are left open for the manager to look at.
 */
export async function copyPreviousWeek(
  tx: TenantTx,
  actor: Actor,
  siteIdRaw: unknown,
  weekRaw: unknown,
): Promise<
  Result<{
    copied: number;
    withPeople: number;
    leftOpen: number;
    skipped: number;
  }>
> {
  const site = await siteOf(tx, actor, siteIdRaw);
  if (!site || !canAt(actor, "rota.view", site.id)) return notFound("site");
  if (!canAt(actor, "rota.manage", site.id)) return forbidden();
  if (!isIsoDate(weekRaw) || mondayOf(weekRaw) !== weekRaw)
    return invalid({ week: "Choose a week" });
  const weekStart = weekRaw;
  const target = await ensureWeek(tx, actor, site.id, weekStart);
  const already = await tx.shift.count({
    where: {
      tenantId: actor.tenantId,
      rotaWeekId: target.id,
      status: "active",
    },
  });
  if (already)
    return conflict(
      "This week already has shifts. Copying only fills an empty week.",
    );
  const source = await weekRow(tx, actor, site.id, addDays(weekStart, -7));
  const shifts = source
    ? await tx.shift.findMany({
        where: {
          tenantId: actor.tenantId,
          rotaWeekId: source.id,
          status: "active",
        },
        orderBy: { startsAt: "asc" },
        select: shiftSelect,
      })
    : [];
  if (shifts.length === 0) return conflict("Last week has no shifts to copy.");
  const tz = site.timezone;
  const planned: {
    from: (typeof shifts)[number];
    startsAt: Date;
    endsAt: Date;
    day: string;
  }[] = [];
  let skipped = 0;
  for (const s of shifts) {
    const startLocal = utcToZoned(s.startsAt, tz);
    const endLocal = utcToZoned(s.endsAt, tz);
    const shift = (local: string) =>
      `${addDays(local.slice(0, 10), 7)}T${local.slice(11, 16)}`;
    const startsAt = zonedToUtc(shift(startLocal), tz);
    const endsAt = zonedToUtc(shift(endLocal), tz);
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      skipped++;
      continue;
    }
    planned.push({
      from: s,
      startsAt,
      endsAt,
      day: addDays(startLocal.slice(0, 10), 7),
    });
  }
  const created: {
    id: string;
    employeeId: string | null;
    timed: TimedShift & { day: string };
  }[] = [];
  for (const p of planned) {
    const row = await tx.shift.create({
      data: {
        tenantId: actor.tenantId,
        rotaWeekId: target.id,
        siteId: site.id,
        teamId: p.from.teamId,
        roleLabel: p.from.roleLabel,
        note: p.from.note,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        breakMinutes: p.from.breakMinutes,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      },
      select: { id: true },
    });
    if (target.status === "published")
      await change(tx, actor, row.id, "created", {
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt.toISOString(),
      });
    created.push({
      id: row.id,
      employeeId: p.from.assignments[0]?.employeeId ?? null,
      timed: {
        id: row.id,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        breakMinutes: p.from.breakMinutes,
        day: p.day,
      },
    });
  }
  // Assign one at a time, so each check sees the people already placed.
  let withPeople = 0;
  let leftOpen = 0;
  const weekStartAt = zonedToUtc(`${weekStart}T00:00`, tz)!;
  const weekEndAt = zonedToUtc(`${addDays(weekStart, 7)}T00:00`, tz)!;
  for (const c of created) {
    if (!c.employeeId) continue;
    const person = await tx.employee.findUnique({
      where: { tenantId_id: { tenantId: actor.tenantId, id: c.employeeId } },
      select: { status: true },
    });
    const check =
      person && person.status !== "left"
        ? await checker(
            tx,
            actor,
            [c.employeeId],
            [c.timed],
            weekStartAt,
            weekEndAt,
            c.timed.day,
          )
        : null;
    if (!check || check(c.employeeId, c.timed).length) {
      leftOpen++;
      continue;
    }
    await tx.shiftAssignment.create({
      data: {
        tenantId: actor.tenantId,
        shiftId: c.id,
        employeeId: c.employeeId,
        assignedBy: actor.userId,
      },
      select: { id: true },
    });
    if (target.status === "published")
      await change(tx, actor, c.id, "assigned", { employeeId: c.employeeId });
    withPeople++;
  }
  await audit(tx, actor, "rota.week_copied", "rota_week", target.id, {
    copied: created.length,
    withPeople,
    leftOpen,
    skipped,
  });
  return {
    ok: true,
    data: { copied: created.length, withPeople, leftOpen, skipped },
  };
}

/** Makes a week visible to staff (M10.2). Later changes are kept as history. */
export async function publishWeek(
  tx: TenantTx,
  actor: Actor,
  siteIdRaw: unknown,
  weekRaw: unknown,
): Promise<Result> {
  const site = await siteOf(tx, actor, siteIdRaw);
  if (!site || !canAt(actor, "rota.view", site.id)) return notFound("site");
  if (!canAt(actor, "rota.publish", site.id))
    return forbidden("Publishing needs the “Publish rotas” permission.");
  if (!isIsoDate(weekRaw) || mondayOf(weekRaw) !== weekRaw)
    return invalid({ week: "Choose a week" });
  const week = await weekRow(tx, actor, site.id, weekRaw);
  if (!week) return conflict("Add some shifts before publishing.");
  if (week.status === "published")
    return conflict("This week is already published.");
  const count = await tx.shift.count({
    where: { tenantId: actor.tenantId, rotaWeekId: week.id, status: "active" },
  });
  if (count === 0) return conflict("Add some shifts before publishing.");
  const now = new Date();
  await tx.rotaWeek.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: week.id } },
    data: {
      status: "published",
      publishedAt: now,
      publishedBy: actor.userId,
      updatedAt: now,
    },
    select: { id: true },
  });
  await audit(tx, actor, "rota.week_published", "rota_week", week.id, {
    siteId: site.id,
    weekStart: weekRaw,
    shifts: count,
  });
  return { ok: true, data: { id: week.id } };
}
