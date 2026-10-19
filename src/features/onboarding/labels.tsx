import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import type { Progress } from "@/modules/onboarding";

export const CATEGORY_LABEL: Record<string, string> = {
  task: "Task",
  document: "Document",
  induction: "Induction",
  policy: "Policy",
};

export const OWNER_LABEL: Record<string, string> = {
  manager: "Manager",
  hr: "HR",
  employee: "The employee",
};

export const SCOPE_LABEL = (t: {
  scope: string;
  siteName: string | null;
  jobTitle: string | null;
}) =>
  t.scope === "site"
    ? `Site: ${t.siteName ?? "unknown"}`
    : t.scope === "job_title"
      ? `Job title: ${t.jobTitle}`
      : "Whole organisation";

/**
 * Three separate states, shown separately: task progress, operational
 * readiness and final sign-off. None of them is right-to-work clearance.
 */
export function StageBadge({
  status,
  progress,
}: {
  status: "active" | "completed" | "cancelled";
  progress: Progress;
}) {
  const [tone, label]: [Tone, string] =
    status === "completed"
      ? ["success", "Signed off"]
      : status === "cancelled"
        ? ["neutral", "Cancelled"]
        : progress.operationallyReady
          ? ["info", "Ready for sign-off"]
          : progress.overdue > 0
            ? ["warning", `${progress.overdue} overdue`]
            : ["neutral", "In progress"];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Shown wherever onboarding status appears (requirements 1 and 3). */
export function RightToWorkNotice() {
  return (
    <Alert tone="info" title="Right to work is separate">
      Onboarding progress and sign-off don&rsquo;t show whether someone has the
      right to work. Right-to-work checks will be recorded separately in a later
      update. Until then, keep your own records of every check.
    </Alert>
  );
}

export function OnboardingTabs({
  current,
  showTemplates,
}: {
  current: "people" | "templates";
  showTemplates: boolean;
}) {
  const tabs = [
    { href: "/onboarding" as const, label: "People", id: "people" },
    ...(showTemplates
      ? [
          {
            href: "/onboarding/templates" as const,
            label: "Templates",
            id: "templates",
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Onboarding sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1">
        {tabs.map((t) => (
          <li key={t.id}>
            <Link
              href={t.href}
              aria-current={current === t.id ? "page" : undefined}
              className={
                current === t.id
                  ? "flex min-h-11 items-center border-b-2 border-forest px-4 text-sm font-semibold text-forest-strong"
                  : "flex min-h-11 items-center border-b-2 border-transparent px-4 text-sm font-semibold text-ink-muted hover:text-ink"
              }
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
