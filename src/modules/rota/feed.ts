// Published shifts for other modules (M11 Attendance compares clocked time with
// the PUBLISHED rota, never drafts). No permission check here: the calling
// module checks its own permissions and site scope before asking. Reads run in
// the caller's tenant-scoped transaction, so RLS still applies.

import type { TenantTx } from "@/lib/tenancy";

export interface PublishedShift {
  id: string;
  siteId: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
  roleLabel: string | null;
}

/**
 * Active, assigned shifts in published weeks that overlap [from, to), filtered
 * by site and/or people.
 */
export async function publishedShifts(
  tx: TenantTx,
  tenantId: string,
  filter: {
    from: Date;
    to: Date;
    siteId?: string;
    employeeIds?: readonly string[];
  },
): Promise<PublishedShift[]> {
  if (filter.employeeIds && filter.employeeIds.length === 0) return [];
  const rows = await tx.shiftAssignment.findMany({
    where: {
      tenantId,
      removedAt: null,
      ...(filter.employeeIds
        ? { employeeId: { in: [...filter.employeeIds] } }
        : {}),
      shift: {
        status: "active",
        week: { status: "published" },
        startsAt: { lt: filter.to },
        endsAt: { gt: filter.from },
        ...(filter.siteId ? { siteId: filter.siteId } : {}),
      },
    },
    select: {
      employeeId: true,
      shift: {
        select: {
          id: true,
          siteId: true,
          startsAt: true,
          endsAt: true,
          breakMinutes: true,
          roleLabel: true,
        },
      },
    },
  });
  return rows
    .map((r) => ({ ...r.shift, employeeId: r.employeeId }))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/**
 * Members whose PUBLISHED shifts changed at or after `since`: everyone on a
 * week published since then, and anyone a recorded change was about (assigned,
 * taken off, or on a changed or cancelled shift). Only people with a linked
 * login. For notifications; the caller sends nothing private.
 */
export async function membersWithChangedShifts(
  tx: TenantTx,
  tenantId: string,
  since: Date,
): Promise<string[]> {
  const [published, changes] = await Promise.all([
    tx.shiftAssignment.findMany({
      where: {
        tenantId,
        removedAt: null,
        shift: {
          status: "active",
          week: { status: "published", publishedAt: { gte: since } },
        },
      },
      select: { employeeId: true },
    }),
    tx.shiftChange.findMany({
      where: { tenantId, occurredAt: { gte: since } },
      select: {
        detail: true,
        shift: {
          select: {
            assignments: {
              where: { removedAt: null },
              select: { employeeId: true },
            },
          },
        },
      },
    }),
  ]);
  const ids = new Set(published.map((a) => a.employeeId));
  for (const c of changes) {
    const d = (c.detail ?? {}) as Record<string, unknown>;
    for (const k of ["employeeId", "previousEmployeeId"])
      if (typeof d[k] === "string") ids.add(d[k] as string);
    for (const a of c.shift.assignments) ids.add(a.employeeId);
  }
  if (!ids.size) return [];
  const people = await tx.employee.findMany({
    where: {
      tenantId,
      id: { in: [...ids] },
      membershipId: { not: null },
      status: { not: "left" },
    },
    select: { membershipId: true },
  });
  return [...new Set(people.map((p) => p.membershipId!))];
}
