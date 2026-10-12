import {
  DEMO_EMPLOYEES,
  DEMO_REFERENCE_DATE,
  DEMO_TODAY,
  demoSite,
  type DemoEmployee,
} from "@/features/demo/fixtures";
import { fullName } from "@/features/people/directory";
import { daysBetween, formatDate } from "@/lib/format";

export interface ComplianceItem {
  employeeId: string;
  name: string;
  site: string;
  issue: string;
  tone: "danger" | "warning";
  label: string;
}

export function complianceItems(
  employees: readonly DemoEmployee[] = DEMO_EMPLOYEES,
): ComplianceItem[] {
  const items: ComplianceItem[] = [];
  for (const e of employees) {
    if (e.status === "left") continue;
    const base = {
      employeeId: e.id,
      name: fullName(e),
      site: demoSite(e.siteId)?.name ?? "",
    };
    if (e.rightToWork === "action_needed") {
      items.push({
        ...base,
        issue: "Right-to-work check not yet recorded",
        tone: "danger",
        label: "Action needed",
      });
    } else if (e.rightToWork === "expiring" && e.rtwExpiresOn) {
      const days = daysBetween(DEMO_REFERENCE_DATE, e.rtwExpiresOn);
      items.push({
        ...base,
        issue: `Right-to-work evidence expires ${formatDate(e.rtwExpiresOn)} (in ${days} days)`,
        tone: "warning",
        label: "Expiring",
      });
    }
    for (const t of e.training) {
      if (t.status === "overdue") {
        items.push({
          ...base,
          issue: `${t.name} overdue`,
          tone: "danger",
          label: "Overdue",
        });
      }
    }
  }
  return items.sort((a, b) =>
    a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1,
  );
}

export function staffingSummary() {
  const scheduled = DEMO_TODAY.reduce((n, s) => n + s.scheduled, 0);
  const clockedIn = DEMO_TODAY.reduce((n, s) => n + s.clockedIn, 0);
  const openShifts = DEMO_TODAY.reduce((n, s) => n + s.openShifts, 0);
  const onboarding = DEMO_EMPLOYEES.filter((e) => e.status === "onboarding");
  return { scheduled, clockedIn, openShifts, onboarding };
}
