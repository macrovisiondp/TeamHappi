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
