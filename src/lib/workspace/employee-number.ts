import type { TenantTx } from "@/lib/tenancy";

/**
 * Next free "E0001"-style number in this organisation. Shared by People
 * (M4.2) and recruitment hires (M9.1). A race with another insert is caught by
 * the UNIQUE(tenant_id, employee_number) constraint.
 */
export async function nextEmployeeNumber(tx: TenantTx): Promise<string> {
  const rows = await tx.employee.findMany({
    where: { employeeNumber: { startsWith: "E" } },
    select: { employeeNumber: true },
  });
  const max = rows.reduce((m, r) => {
    const n = /^E(\d+)$/.exec(r.employeeNumber);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `E${String(max + 1).padStart(4, "0")}`;
}
