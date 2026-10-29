import Link from "next/link";

import type { Tone } from "@/components/ui/badge";

export const VACANCY_STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  open: { tone: "success", label: "Open" },
  paused: { tone: "warning", label: "Paused" },
  filled: { tone: "info", label: "Filled" },
  closed: { tone: "neutral", label: "Closed" },
};

export const EMPLOYMENT_TYPE: Record<string, string> = {
  full_time: "Full time",
  part_time: "Part time",
  casual: "Casual",
  fixed_term: "Fixed term",
  seasonal: "Seasonal",
};

export const OUTCOME: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "info", label: "In progress" },
  hired: { tone: "success", label: "Hired" },
  rejected: { tone: "neutral", label: "Rejected" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
};

export const REJECTION_REASON: Record<string, string> = {
  not_suitable: "Not suitable for this role",
  role_filled: "Role filled",
  no_response: "No response from the candidate",
  other: "Other",
};

export const INTERVIEW_FORMAT: Record<string, string> = {
  in_person: "In person",
  phone: "Phone",
  video: "Video call",
};

export const INTERVIEW_STATUS: Record<string, { tone: Tone; label: string }> = {
  scheduled: { tone: "info", label: "Scheduled" },
  completed: { tone: "success", label: "Completed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  no_show: { tone: "warning", label: "No show" },
};

export const INTERVIEW_OUTCOME: Record<string, string> = {
  progress: "Progress",
  hold: "Hold",
  do_not_progress: "Don't progress",
};

export const SOURCE: Record<string, string> = {
  manual: "Added by a manager",
  referral: "Referral",
  agency: "Agency",
  careers_page: "Careers page",
};

export function payText(v: {
  payMin: string | null;
  payMax: string | null;
  payPeriod: string | null;
}) {
  if (!v.payMin) return null;
  const per = v.payPeriod === "year" ? "a year" : "an hour";
  return v.payMax && v.payMax !== v.payMin
    ? `£${v.payMin}–£${v.payMax} ${per}`
    : `£${v.payMin} ${per}`;
}

export function RecruitmentTabs({
  current,
  show,
}: {
  current: "vacancies" | "interviews" | "review" | "settings";
  show: { vacancies: boolean; review: boolean; settings: boolean };
}) {
  const tabs = [
    ...(show.vacancies
      ? [{ href: "/recruitment" as const, label: "Vacancies", id: "vacancies" }]
      : []),
    {
      href: "/recruitment/interviews" as const,
      label: "Interviews",
      id: "interviews",
    },
    ...(show.review
      ? [
          {
            href: "/recruitment/review" as const,
            label: "Data review",
            id: "review",
          },
        ]
      : []),
    ...(show.settings
      ? [
          {
            href: "/recruitment/settings" as const,
            label: "Settings",
            id: "settings",
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Recruitment sections" className="border-b border-line">
      <ul className="-mb-px flex flex-wrap gap-1">
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
