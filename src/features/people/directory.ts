import type { Tone } from "@/components/ui/badge";
import type { EmploymentStatus } from "@/features/demo/fixtures";

/** What the directory needs from a person, whether real or demo. */
export interface DirectoryPerson {
  id: string;
  employeeNumber: string;
  givenName: string;
  familyName: string;
  preferredName?: string | null;
  role?: string | null;
  team?: string | null;
  siteId: string | null;
  status: string;
  startDate: string | null;
}

export interface DirectoryFilters {
  query: string;
  siteId: string; // "all" or a site id
  status: string; // "all" or a status key
}

export const DEFAULT_FILTERS: DirectoryFilters = {
  query: "",
  siteId: "all",
  status: "all",
};

export function fullName(
  e: Pick<DirectoryPerson, "givenName" | "familyName" | "preferredName">,
) {
  return `${e.preferredName ?? e.givenName} ${e.familyName}`;
}

/** Case- and accent-insensitive search over name, role and employee number. */
export function filterEmployees<T extends DirectoryPerson>(
  employees: readonly T[],
  filters: DirectoryFilters,
): T[] {
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
          `${fullName(e)} ${e.givenName} ${e.role ?? ""} ${e.employeeNumber}`,
        ).includes(q),
    )
    .sort((a, b) => a.familyName.localeCompare(b.familyName, "en-GB"));
}

export type StatusStyles = Record<string, { label: string; tone: Tone }>;

/** Demo workspace statuses. */
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

export const DEMO_STATUSES: StatusStyles = Object.fromEntries(
  Object.entries(STATUS_LABEL).map(([k, label]) => [
    k,
    { label, tone: STATUS_TONE[k as EmploymentStatus] },
  ]),
);

/** Real employee statuses (database enum employment_status). */
export const EMPLOYMENT_STATUSES: StatusStyles = {
  pending: { label: "Starting soon", tone: "info" },
  active: { label: "Active", tone: "success" },
  left: { label: "Left", tone: "neutral" },
};
