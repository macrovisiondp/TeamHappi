// "My shifts" (M10.2): a person's own PUBLISHED shifts, reached through
// OWNERSHIP (the employee record linked to the signed-in member), never through
// a role. Drafts are never shown (D2).
//
// They see this week and the next three: their shifts (at any site), what's new
// or changed since they last looked, shifts they were taken off or that were
// cancelled, and open shifts at their own site they can ASK to take (D7). A
// manager approves (every assignment check runs) or declines. They never see
// who else is working, other people's requests, or managers' notes on
// assignments.

import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  addDays,
  mondayOf,
  todayIn,
  utcToZoned,
  workedMinutes,
  type Actor,
} from "./policy";
import type { Result } from "./service";

const WEEKS_AHEAD = 4;

/** The signed-in member's own employee record, if linked and still employed. */
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
      primarySite: { select: { timezone: true, name: true } },
    },
  });
  return e && e.status !== "left" ? e : null;
}

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetId: string,
  detail: Record<string, string | null>,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType: "shift",
      targetId,
      detail,
    },
    select: { id: true },
  });
}

type Flag = "new" | "changed" | null;

export async function myShifts(tx: TenantTx, actor: Actor, now = new Date()) {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const homeTz = me.primarySite?.timezone ?? "Europe/London";
  const today = todayIn(homeTz, now);
  const from = mondayOf(today);
  const until = addDays(from, 7 * WEEKS_AHEAD);
  const seen = await tx.rotaSeen.findUnique({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: me.id },
    },
    select: { seenAt: true },
  });
  const lastSeen = seen?.seenAt ?? null;
  const publishedWeek = {
    status: "published",
    weekStart: { gte: asDate(from), lt: asDate(until) },
  };

  const [mine, changes, open, myRequests] = await Promise.all([
    tx.shiftAssignment.findMany({
      where: {
        tenantId: actor.tenantId,
        employeeId: me.id,
        removedAt: null,
        shift: { status: "active", week: publishedWeek },
      },
      select: {
        shift: {
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            breakMinutes: true,
            roleLabel: true,
            note: true,
            createdAt: true,
            team: { select: { name: true } },
            siteId: true,
            week: { select: { publishedAt: true } },
          },
        },
      },
    }),
    lastSeen
      ? tx.shiftChange.findMany({
          where: {
            tenantId: actor.tenantId,
            occurredAt: { gt: lastSeen },
            shift: { week: publishedWeek },
          },
          orderBy: { occurredAt: "asc" },
          select: {
            shiftId: true,
            kind: true,
            detail: true,
            shift: {
              select: { startsAt: true, endsAt: true, siteId: true },
            },
          },
        })
      : Promise.resolve([]),
    me.primarySiteId
      ? tx.shift.findMany({
          where: {
            tenantId: actor.tenantId,
            siteId: me.primarySiteId,
            status: "active",
            startsAt: { gt: now },
            week: publishedWeek,
            assignments: { none: { removedAt: null } },
          },
          orderBy: { startsAt: "asc" },
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            breakMinutes: true,
            roleLabel: true,
            team: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    tx.shiftRequest.findMany({
      where: { tenantId: actor.tenantId, employeeId: me.id, status: "pending" },
      select: { id: true, shiftId: true },
    }),
  ]);

  const siteRows = await tx.site.findMany({
    where: {
      tenantId: actor.tenantId,
      id: {
        in: [
          ...new Set([
            ...mine.map((a) => a.shift.siteId),
            ...changes.map((c) => c.shift.siteId),
          ]),
        ],
      },
    },
    select: { id: true, name: true, timezone: true },
  });
  const sites = new Map(siteRows.map((x) => [x.id, x]));
  const siteOf = (id: string) =>
    sites.get(id) ?? { name: "Another site", timezone: homeTz };

  // What's new or changed since they last looked.
  const flags = new Map<string, Flag>();
  const removed: {
    shiftId: string;
    kind: "removed" | "cancelled";
    when: string;
    site: string;
  }[] = [];
  const mineIds = new Set(mine.map((a) => a.shift.id));
  for (const c of changes) {
    const d = (c.detail ?? {}) as Record<string, unknown>;
    const aboutMe = d.employeeId === me.id || d.previousEmployeeId === me.id;
    if (mineIds.has(c.shiftId)) {
      if (c.kind === "assigned" && d.employeeId === me.id)
        flags.set(c.shiftId, "new");
      else if (flags.get(c.shiftId) !== "new") flags.set(c.shiftId, "changed");
    } else if (
      aboutMe &&
      (c.kind === "unassigned" ||
        c.kind === "cancelled" ||
        (c.kind === "assigned" && d.previousEmployeeId === me.id))
    ) {
      const site = siteOf(c.shift.siteId);
      const tz = site.timezone;
      removed.push({
        shiftId: c.shiftId,
        kind: c.kind === "cancelled" ? "cancelled" : "removed",
        when: `${utcToZoned(c.shift.startsAt, tz).replace("T", " ")}–${utcToZoned(c.shift.endsAt, tz).slice(11, 16)}`,
        site: site.name,
      });
    }
  }
  // Never looked: every upcoming shift is new, so the header badge invites them in.
  if (!lastSeen)
    for (const a of mine)
      if (a.shift.endsAt > now) flags.set(a.shift.id, "new");
  if (lastSeen)
    for (const a of mine) {
      const publishedAt = a.shift.week.publishedAt;
      if (publishedAt && publishedAt > lastSeen && !flags.has(a.shift.id))
        flags.set(a.shift.id, "new");
    }
  // Only the latest note per shift (they may have been put back on it since).
  const removedNow = [
    ...new Map(
      removed.filter((r) => !mineIds.has(r.shiftId)).map((r) => [r.shiftId, r]),
    ).values(),
  ];

  const pending = new Map(myRequests.map((r) => [r.shiftId, r.id]));
  const view = (
    s: {
      id: string;
      startsAt: Date;
      endsAt: Date;
      breakMinutes: number;
      roleLabel: string | null;
      team: { name: string } | null;
    },
    tz: string,
  ) => {
    const start = utcToZoned(s.startsAt, tz);
    return {
      id: s.id,
      day: start.slice(0, 10),
      weekStart: mondayOf(start.slice(0, 10)),
      start: start.slice(11, 16),
      end: utcToZoned(s.endsAt, tz).slice(11, 16),
      breakMinutes: s.breakMinutes,
      minutes: workedMinutes(s),
      roleLabel: s.roleLabel,
      teamName: s.team?.name ?? null,
    };
  };
  const shifts = mine
    .map((a) => ({
      ...view(a.shift, siteOf(a.shift.siteId).timezone),
      siteName: siteOf(a.shift.siteId).name,
      note: a.shift.note,
      flag: flags.get(a.shift.id) ?? null,
      past: a.shift.endsAt <= now,
    }))
    .sort((x, y) => `${x.day}${x.start}`.localeCompare(`${y.day}${y.start}`));
  return {
    firstName: me.preferredName || me.givenName,
    siteName: me.primarySite?.name ?? null,
    today,
    weeks: Array.from({ length: WEEKS_AHEAD }, (_, i) => addDays(from, 7 * i)),
    firstVisit: lastSeen === null,
    updates: [...flags.values()].filter(Boolean).length + removedNow.length,
    shifts,
    removed: removedNow,
    openShifts: open.map((s) => ({
      ...view(s, homeTz),
      requestId: pending.get(s.id) ?? null,
    })),
  };
}

/** Number of new or changed things since they last looked (header badge). */
export async function myShiftUpdates(tx: TenantTx, actor: Actor) {
  const me = await myShifts(tx, actor);
  return me ? me.updates : null;
}

/** Records that they've looked, so highlights clear next time. */
export async function markShiftsSeen(
  tx: TenantTx,
  actor: Actor,
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me)
    return {
      ok: false,
      code: "not_found",
      message: "Your login isn't linked to a staff record.",
    };
  const now = new Date();
  const row = await tx.rotaSeen.upsert({
    where: {
      tenantId_employeeId: { tenantId: actor.tenantId, employeeId: me.id },
    },
    create: { tenantId: actor.tenantId, employeeId: me.id, seenAt: now },
    update: { seenAt: now },
    select: { id: true },
  });
  return { ok: true, data: row };
}

/** Asks to take an open, published, future shift at their own site. */
export async function requestShift(
  tx: TenantTx,
  actor: Actor,
  shiftId: unknown,
  now = new Date(),
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  const notFound = {
    ok: false,
    code: "not_found",
    message: "That shift isn't available.",
  } as const;
  if (!me || typeof shiftId !== "string" || !isUuid(shiftId)) return notFound;
  const s = await tx.shift.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: shiftId } },
    select: {
      id: true,
      siteId: true,
      status: true,
      startsAt: true,
      week: { select: { status: true } },
      assignments: { where: { removedAt: null }, select: { id: true } },
    },
  });
  // Only open shifts they could see on My shifts; anything else looks the same.
  if (
    !s ||
    s.siteId !== me.primarySiteId ||
    s.status !== "active" ||
    s.week.status !== "published" ||
    s.startsAt <= now
  )
    return notFound;
  if (s.assignments.length)
    return {
      ok: false,
      code: "conflict",
      message: "Someone has already been put on this shift.",
    };
  const existing = await tx.shiftRequest.findFirst({
    where: {
      tenantId: actor.tenantId,
      shiftId: s.id,
      employeeId: me.id,
      status: "pending",
    },
    select: { id: true },
  });
  if (existing)
    return {
      ok: false,
      code: "conflict",
      message: "You've already asked for this shift.",
    };
  const r = await tx.shiftRequest.create({
    data: {
      tenantId: actor.tenantId,
      shiftId: s.id,
      employeeId: me.id,
      requestedBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "rota.shift_requested", s.id, {
    requestId: r.id,
    employeeId: me.id,
  });
  return { ok: true, data: r };
}

/** Withdraws their own pending request. */
export async function withdrawRequest(
  tx: TenantTx,
  actor: Actor,
  requestId: unknown,
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  const notFound = {
    ok: false,
    code: "not_found",
    message: "That request couldn't be found.",
  } as const;
  if (!me || typeof requestId !== "string" || !isUuid(requestId))
    return notFound;
  const r = await tx.shiftRequest.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
    select: { id: true, shiftId: true, employeeId: true, status: true },
  });
  if (!r || r.employeeId !== me.id) return notFound;
  if (r.status !== "pending")
    return {
      ok: false,
      code: "conflict",
      message: "This request has already been answered.",
    };
  await tx.shiftRequest.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: r.id } },
    data: {
      status: "withdrawn",
      decidedBy: actor.userId,
      decidedAt: new Date(),
    },
    select: { id: true },
  });
  await audit(tx, actor, "rota.shift_request_withdrawn", r.shiftId, {
    requestId: r.id,
  });
  return { ok: true, data: { id: r.id } };
}
