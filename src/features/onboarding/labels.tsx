import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import type {
  Clearance,
  DocumentStatus,
  Progress,
  RtwList,
  RtwMethod,
  RtwOutcome,
  RtwState,
} from "@/modules/onboarding";

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
      right to work. Right-to-work checks are recorded separately by an owner,
      administrator or HR manager. TeamHappi records your check; it
      doesn&rsquo;t decide whether someone has the right to work.
    </Alert>
  );
}

// --- M7.2: right to work and documents ------------------------------------------------

export const RTW_METHOD_LABEL: Record<RtwMethod, string> = {
  manual_document: "Manual check of original documents",
  online_check: "Home Office online check (share code)",
  idsp: "Identity service provider (digital identity check)",
};

export const RTW_LIST_LABEL: Record<RtwList, string> = {
  list_a: "List A (continuous)",
  list_b_group_1: "List B group 1 (time-limited)",
  list_b_group_2: "List B group 2 (time-limited)",
};

export const RTW_OUTCOME_LABEL: Record<RtwOutcome, string> = {
  confirmed: "Confirmed, no follow-up needed",
  time_limited: "Confirmed, time-limited",
  not_confirmed: "Couldn't be confirmed",
};

export const RTW_KIND_LABEL = {
  initial: "First check",
  follow_up: "Follow-up check",
  correction: "Correction",
} as const;

/** What the CURRENT recorded check says today. Never a legal decision. */
export const RTW_STATE: Record<RtwState, { tone: Tone; label: string }> = {
  none: { tone: "warning", label: "No check recorded" },
  not_confirmed: { tone: "danger", label: "Recorded as not confirmed" },
  lapsed: { tone: "danger", label: "Permission has ended" },
  follow_up_overdue: { tone: "danger", label: "Follow-up check overdue" },
  follow_up_due: { tone: "warning", label: "Follow-up check due soon" },
  recorded: { tone: "success", label: "Check recorded" },
};

export const DOCUMENT_STATUS: Record<
  DocumentStatus,
  { tone: Tone; label: string }
> = {
  requested: { tone: "neutral", label: "Requested" },
  seen: { tone: "success", label: "Seen" },
  verified: { tone: "success", label: "Verified" },
  rejected: { tone: "danger", label: "Rejected" },
  waived: { tone: "info", label: "Waived" },
};

/** Cleared to start: computed, shown as yes/no with what's missing. */
export function ClearanceBadge({
  status,
  clearance,
}: {
  status: "active" | "completed" | "cancelled";
  clearance: Clearance;
}) {
  if (status !== "active") return null;
  return clearance.cleared ? (
    <Badge tone="success">Cleared to start</Badge>
  ) : (
    <Badge tone="warning">Not cleared</Badge>
  );
}

export function clearanceGaps(c: Clearance): string[] {
  return [
    c.tasksReady ? null : "Required tasks are still open",
    c.documentsReady ? null : "Required documents are still needed",
    c.rightToWork
      ? null
      : "No recorded right-to-work check covers the start date",
  ].filter((v): v is string => v !== null);
}

export function OnboardingTabs({
  current,
  showTemplates,
  showRightToWork = false,
}: {
  current: "people" | "templates" | "right-to-work";
  showTemplates: boolean;
  showRightToWork?: boolean;
}) {
  const tabs = [
    { href: "/onboarding" as const, label: "People", id: "people" },
    ...(showRightToWork
      ? [
          {
            href: "/onboarding/right-to-work" as const,
            label: "Right to work",
            id: "right-to-work",
          },
        ]
      : []),
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
              // Opening the right-to-work list is an audited view: never prefetch it.
              prefetch={t.id === "right-to-work" ? false : undefined}
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
