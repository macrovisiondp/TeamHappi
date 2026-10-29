import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  INTERVIEW_FORMAT,
  INTERVIEW_STATUS,
  RecruitmentTabs,
} from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDay, formatTime } from "@/lib/format";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Interviews" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/** The internal interview schedule: the last week and the next four (no external calendar). */
export default async function InterviewsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const rows = await recruitmentApi.schedule(ws);
  const list = Array.isArray(rows) ? rows : [];
  const hasView = ws.grants.has("recruitment.view");
  const settingsAccess = ws.grants.get("recruitment.settings") === "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Recruitment"
        description={
          hasView
            ? "Interviews at your sites, and the ones you're on."
            : "Interviews you've been asked to join."
        }
      />
      <RecruitmentTabs
        current="interviews"
        show={{
          vacancies: hasView,
          review: settingsAccess,
          settings: settingsAccess,
        }}
      />
      {list.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No interviews">
          Nothing in the last week or the next eight weeks.
        </EmptyState>
      ) : (
        <Table caption="Interview schedule">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Candidate</Th>
              <Th>Vacancy</Th>
              <Th>Format</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.map((i) => (
              <tr key={i.id}>
                <Td>
                  <span className="font-semibold">
                    {formatDay(i.scheduledAt)}
                  </span>
                  <p className="text-xs text-ink-muted">
                    {formatTime(i.scheduledAt)} · {i.durationMinutes} min
                  </p>
                </Td>
                <Td>
                  <Link
                    href={`/recruitment/applications/${i.applicationId}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {i.candidateName}
                  </Link>
                  {i.mine ? (
                    <p className="text-xs text-ink-muted">
                      You&rsquo;re interviewing
                    </p>
                  ) : null}
                </Td>
                <Td>
                  {i.vacancyTitle}
                  <p className="text-xs text-ink-muted">{i.siteName}</p>
                </Td>
                <Td>
                  {INTERVIEW_FORMAT[i.format]}
                  {i.location ? (
                    <p className="text-xs text-ink-muted">{i.location}</p>
                  ) : null}
                </Td>
                <Td>
                  <Badge tone={INTERVIEW_STATUS[i.status]!.tone}>
                    {INTERVIEW_STATUS[i.status]!.label}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
