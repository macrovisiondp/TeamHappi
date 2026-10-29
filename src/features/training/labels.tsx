import Link from "next/link";

import { Badge, type Tone } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import type { CourseStatus, TrainingStatus } from "@/modules/training";

export const CATEGORY_LABEL: Record<string, string> = {
  food_safety: "Food safety",
  allergens: "Allergens",
  health_safety: "Health and safety",
  fire_safety: "Fire safety",
  first_aid: "First aid",
  manual_handling: "Manual handling",
  licensing: "Licensing",
  safeguarding: "Safeguarding",
  equality: "Equality",
  customer_service: "Customer service",
  other: "Other",
};

export const METHOD_LABEL: Record<string, string> = {
  read_and_confirm: "Read and confirm",
  in_person: "Given in person",
  external_certificate: "External certificate",
};

export const KIND_LABEL: Record<string, string> = {
  internal: "Internal",
  external: "External",
};

export const STATUS: Record<TrainingStatus, { tone: Tone; label: string }> = {
  up_to_date: { tone: "success", label: "Up to date" },
  expiring: { tone: "warning", label: "Expiring soon" },
  due: { tone: "info", label: "Due" },
  overdue: { tone: "danger", label: "Overdue" },
  expired: { tone: "danger", label: "Expired" },
  not_required: { tone: "neutral", label: "Not required" },
};

/** One cell: status, plus the date that matters for it. */
export function StatusCell({ s }: { s: CourseStatus }) {
  const st = STATUS[s.status];
  const date =
    s.status === "due" || s.status === "overdue"
      ? s.dueOn && `Due ${formatDate(s.dueOn)}`
      : s.expiresOn
        ? `${s.status === "expired" ? "Expired" : "Expires"} ${formatDate(s.expiresOn)}`
        : s.completedOn
          ? `Done ${formatDate(s.completedOn)}`
          : null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge tone={st.tone}>{st.label}</Badge>
      {date ? <span className="text-xs text-ink-muted">{date}</span> : null}
      {!s.mandatory && s.status !== "not_required" ? (
        <span className="text-xs text-ink-muted">Recommended</span>
      ) : null}
    </div>
  );
}

export function TrainingTabs({
  current,
  showCourses,
}: {
  current: "matrix" | "courses";
  showCourses: boolean;
}) {
  const tabs = [
    { href: "/training" as const, label: "Matrix", id: "matrix" },
    ...(showCourses
      ? [
          {
            href: "/training/courses" as const,
            label: "Courses",
            id: "courses",
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Training sections" className="border-b border-line">
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
