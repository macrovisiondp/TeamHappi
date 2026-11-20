// Shift cover (M16): courses marked "needed on every shift" (for example first
// aid), and who holds a valid record for each on given days. Used by the rota
// to warn when nobody working holds one. A record counts on a day if it was
// completed by then, hasn't expired, and isn't void.

import type { TenantTx } from "@/lib/tenancy";

import type { Actor } from "./policy";

export interface ShiftCover {
  courses: { id: string; name: string }[];
  /** courseId -> day (YYYY-MM-DD) -> employees holding it that day. */
  holders: Map<string, Map<string, Set<string>>>;
}

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export async function shiftCoverOn(
  tx: TenantTx,
  actor: Actor,
  employeeIds: string[],
  days: string[],
): Promise<ShiftCover> {
  const courses = await tx.trainingCourse.findMany({
    where: { tenantId: actor.tenantId, shiftCover: true, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const holders = new Map<string, Map<string, Set<string>>>();
  if (!courses.length || !employeeIds.length) return { courses, holders };
  const records = await tx.trainingRecord.findMany({
    where: {
      tenantId: actor.tenantId,
      courseId: { in: courses.map((c) => c.id) },
      employeeId: { in: [...new Set(employeeIds)] },
      voidedAt: null,
    },
    select: {
      courseId: true,
      employeeId: true,
      completedOn: true,
      expiresOn: true,
    },
  });
  for (const c of courses) {
    const byDay = new Map<string, Set<string>>();
    for (const day of days)
      byDay.set(
        day,
        new Set(
          records
            .filter(
              (r) =>
                r.courseId === c.id &&
                isoOf(r.completedOn) <= day &&
                (r.expiresOn === null || isoOf(r.expiresOn) >= day),
            )
            .map((r) => r.employeeId),
        ),
      );
    holders.set(c.id, byDay);
  }
  return { courses, holders };
}
