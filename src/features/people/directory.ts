import type { DemoEmployee, EmploymentStatus } from "@/features/demo/fixtures";

export interface DirectoryFilters {
  query: string;
  siteId: string; // "all" or a site id
  status: EmploymentStatus | "all";
}

export const DEFAULT_FILTERS: DirectoryFilters = {
  query: "",
  siteId: "all",
  status: "all",
};

export function fullName(
  e: Pick<DemoEmployee, "givenName" | "familyName" | "preferredName">,
) {
  return `${e.preferredName ?? e.givenName} ${e.familyName}`;
}

/** Case- and accent-insensitive search over name, role and employee number. */
export function filterEmployees(
  employees: readonly DemoEmployee[],
  filters: DirectoryFilters,
): DemoEmployee[] {
  const normalise = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const q = normalise(filters.query.trim());
  return employees
    .filter((e) => filters.siteId === "all" || e.siteId === filters.siteId)
    .filter((e) => filters.status === "all" || e.status === filters.status)
    .filter(
      (e) =>
        !q ||
        normalise(
          `${fullName(e)} ${e.givenName} ${e.role} ${e.employeeNumber}`,
        ).includes(q),
    )
    .sort((a, b) => a.familyName.localeCompare(b.familyName, "en-GB"));
}

export const STATUS_LABEL: Record<EmploymentStatus, string> = {
  active: "Active",
  onboarding: "Onboarding",
  on_leave: "On leave",
  left: "Left",
};

export const STATUS_TONE = {
  active: "success",
  onboarding: "info",
  on_leave: "warning",
  left: "neutral",
} as const;
