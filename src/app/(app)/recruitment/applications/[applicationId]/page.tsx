import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import {
  ApplicationActions,
  EmailNotice,
  InterviewActions,
  NoteForm,
  ScheduleInterviewForm,
} from "@/features/recruitment/controls";
import {
  INTERVIEW_FORMAT,
  INTERVIEW_OUTCOME,
  INTERVIEW_STATUS,
  OUTCOME,
  REJECTION_REASON,
  SOURCE,
} from "@/features/recruitment/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate, formatTime } from "@/lib/format";
import { recruitmentApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Application" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const when = (d: Date) => `${formatDate(d)}, ${formatTime(d)}`;

export default async function ApplicationPage({
  params,
}: PageProps<"/recruitment/applications/[applicationId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { applicationId } = await params;
  // Not in your scope (and not your interview), or another organisation's: 404.
  const a = await recruitmentApi.application(ws, applicationId);
  if (!a || "ok" in a) notFound();
  const outcome = OUTCOME[a.outcome]!;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={
          a.full
            ? `/recruitment/vacancies/${a.vacancy.id}`
            : "/recruitment/interviews"
        }
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {a.full ? a.vacancy.title : "Interviews"}
      </Link>
      <PageHeader
        title={a.candidate.name}
        description={`${a.vacancy.title} · ${a.vacancy.siteName} · applied ${formatDate(a.appliedOn)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {a.outcome === "active" ? (
              <Badge tone="info">{a.labels[a.stage]}</Badge>
            ) : (
              <Badge tone={outcome.tone}>{outcome.label}</Badge>
            )}
          </div>
        }
      />

      {a.full ? (
        <Card aria-labelledby="candidate-heading">
          <CardTitle id="candidate-heading">Candidate</CardTitle>
          {a.candidate.anonymised ? (
            <p className="text-sm">
              This candidate&rsquo;s details were anonymised under your
              retention policy.
            </p>
          ) : (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-muted">Email</dt>
                <dd className="font-medium break-all">
                  {a.candidate.email ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Phone</dt>
                <dd className="font-medium">
                  {a.candidate.phone ?? "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-muted">Source</dt>
                <dd className="font-medium">{SOURCE[a.candidate.source]}</dd>
              </div>
            </dl>
          )}
          {a.outcome === "rejected" && a.rejectionReason ? (
            <CardDescription>
              Rejected: {REJECTION_REASON[a.rejectionReason]}
            </CardDescription>
          ) : null}
          {a.outcome === "hired" && a.hiredEmployeeId ? (
            <Link
              href={`/people/${a.hiredEmployeeId}`}
              className="w-fit text-sm font-semibold text-forest underline-offset-4 hover:underline"
            >
              Open their employee record
            </Link>
          ) : null}
        </Card>
      ) : (
        <p className="text-sm text-ink-muted">
          You can see this because you&rsquo;re interviewing. Record your
          outcome below.
        </p>
      )}

      {a.can.manage && !a.candidate.anonymised ? (
        <Card aria-labelledby="actions-heading">
          <CardTitle id="actions-heading">Progress</CardTitle>
          <ApplicationActions
            applicationId={a.id}
            stage={a.stage}
            labels={a.labels}
            canHire={a.can.hire}
            hireAuthorised={a.can.hireAuthorised}
            templates={a.templates}
            vacancyTitle={a.vacancy.title}
            name={a.candidate.name}
          />
        </Card>
      ) : null}

      <section
        aria-labelledby="interviews-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="interviews-heading" className="text-lg font-semibold">
          Interviews
        </h2>
        {a.full ? <EmailNotice /> : null}
        {a.interviews.length === 0 ? (
          <p className="text-sm">No interviews yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {a.interviews.map((i) => {
              const st = INTERVIEW_STATUS[i.status]!;
              return (
                <li key={i.id}>
                  <Card
                    aria-label={`Interview ${when(i.scheduledAt)}`}
                    className="gap-2"
                  >
                    <CardHeader>
                      <span className="font-semibold">
                        {when(i.scheduledAt)} · {i.durationMinutes} min ·{" "}
                        {INTERVIEW_FORMAT[i.format]}
                      </span>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </CardHeader>
                    <p className="text-sm">
                      {i.location ? `${i.location} · ` : ""}
                      With {i.interviewers.map((x) => x.name).join(", ")}
                    </p>
                    {i.outcome ? (
                      <p className="text-sm">
                        Outcome:{" "}
                        <span className="font-semibold">
                          {INTERVIEW_OUTCOME[i.outcome]}
                        </span>
                        {i.feedbackBy ? ` (${i.feedbackBy})` : ""}
                      </p>
                    ) : null}
                    {i.feedback ? (
                      <p className="text-sm whitespace-pre-line">
                        {i.feedback}
                      </p>
                    ) : null}
                    <InterviewActions
                      interviewId={i.id}
                      status={i.status}
                      canManage={a.can.manage}
                      canFeedback={
                        (a.can.manage || i.mine) && !a.candidate.anonymised
                      }
                    />
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
        {a.can.manage && !a.candidate.anonymised ? (
          <Card aria-labelledby="schedule-heading">
            <CardTitle id="schedule-heading">Schedule an interview</CardTitle>
            <ScheduleInterviewForm
              applicationId={a.id}
              members={a.members}
              self={ws.membershipId}
            />
          </Card>
        ) : null}
      </section>

      {a.full ? (
        <section
          aria-labelledby="notes-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="notes-heading" className="text-lg font-semibold">
            Notes
          </h2>
          {a.can.note && !a.candidate.anonymised ? (
            <NoteForm applicationId={a.id} />
          ) : null}
          {a.notes.length === 0 ? (
            <p className="text-sm">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {a.notes.map((n) => (
                <li
                  key={n.id}
                  className="rounded-[10px] border border-line p-3"
                >
                  <p className="text-sm whitespace-pre-line">
                    {n.redacted ? (
                      <em>Removed under the retention policy.</em>
                    ) : (
                      n.body
                    )}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {n.by}, {when(n.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {a.full ? (
        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="history-heading" className="text-lg font-semibold">
            History
          </h2>
          <ol className="flex flex-col gap-1 text-sm">
            {a.history.map((h) => (
              <li key={h.id}>
                {when(h.at)}: {h.from ? `${a.labels[h.from]} → ` : ""}
                <span className="font-semibold">{a.labels[h.to]}</span> ({h.by})
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
