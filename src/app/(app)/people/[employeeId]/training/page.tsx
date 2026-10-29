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
import { Table, Td, Th } from "@/components/ui/table";
import {
  RecordActions,
  RecordTrainingForm,
} from "@/features/training/controls";
import { METHOD_LABEL, StatusCell } from "@/features/training/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate, formatTime } from "@/lib/format";
import { trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Training" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const when = (d: Date) => `${formatDate(d)}, ${formatTime(d)}`;

export default async function PersonTrainingPage({
  params,
}: PageProps<"/people/[employeeId]/training">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { employeeId } = await params;
  // Other organisations' people and people outside your sites look the same: 404.
  const t = await trainingApi.person(ws, employeeId);
  if (!t) notFound();
  const kindOf = new Map(t.courses.map((c) => [c.id, c.kind]));

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/people/${t.person.id}`}
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t.person.name}
      </Link>
      <PageHeader
        title={`Training: ${t.person.name}`}
        description={
          [t.person.jobTitle, t.person.siteName].filter(Boolean).join(" · ") ||
          undefined
        }
        actions={
          t.required.length ? (
            <Badge tone={t.upToDate ? "success" : "warning"}>
              {t.upToDate ? "Up to date" : "Training needed"}
            </Badge>
          ) : null
        }
      />

      <section
        aria-labelledby="required-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="required-heading" className="text-lg font-semibold">
          Required and recommended
        </h2>
        {t.required.length === 0 ? (
          <p className="text-sm">
            No training rules apply to {t.person.name} at the moment.
          </p>
        ) : (
          <Table caption={`Training required for ${t.person.name}`}>
            <thead>
              <tr>
                <Th>Course</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {t.required.map((r) => (
                <tr key={r.courseId}>
                  <Td>
                    <span className="font-semibold">{r.courseName}</span>
                    <p className="text-xs text-ink-muted">
                      {r.mandatory ? "Mandatory" : "Recommended"}
                    </p>
                  </Td>
                  <Td>
                    <StatusCell s={r} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {t.can.record ? (
        <Card aria-labelledby="record-heading">
          <CardHeader>
            <div>
              <CardTitle id="record-heading">Record training</CardTitle>
              <CardDescription>
                Record training you&rsquo;ve seen evidence of. Keep any
                certificate in your own records: TeamHappi doesn&rsquo;t store
                files yet.
              </CardDescription>
            </div>
          </CardHeader>
          <RecordTrainingForm employeeId={t.person.id} courses={t.courses} />
        </Card>
      ) : null}

      <section
        aria-labelledby="history-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        {t.history.length === 0 ? (
          <p className="text-sm">No training recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {t.history.map((h) => (
              <li key={h.id}>
                <Card
                  aria-label={`${h.courseName}, ${formatDate(h.completedOn)}`}
                  className="gap-2"
                >
                  <CardHeader>
                    <span className="font-semibold">{h.courseName}</span>
                    {h.voided ? (
                      <Badge tone="neutral">Void</Badge>
                    ) : h.replacesId ? (
                      <Badge tone="info" icon={null}>
                        Correction
                      </Badge>
                    ) : null}
                  </CardHeader>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-muted">Completed</dt>
                      <dd>{formatDate(h.completedOn)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Expires</dt>
                      <dd>
                        {h.expiresOn
                          ? formatDate(h.expiresOn)
                          : "Doesn't expire"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">How</dt>
                      <dd>{METHOD_LABEL[h.method]}</dd>
                    </div>
                    {h.provider ? (
                      <div>
                        <dt className="text-ink-muted">Provider</dt>
                        <dd>{h.provider}</dd>
                      </div>
                    ) : null}
                    {h.reference ? (
                      <div>
                        <dt className="text-ink-muted">
                          Certificate reference
                        </dt>
                        <dd>{h.reference}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-ink-muted">Recorded by</dt>
                      <dd>
                        {h.recordedByName}, {when(h.recordedAt)}
                      </dd>
                    </div>
                  </dl>
                  {h.voided ? (
                    <p className="text-sm">
                      Void: {h.voided.reason} ({h.voided.by},{" "}
                      {when(h.voided.at)})
                    </p>
                  ) : t.can.record && kindOf.has(h.courseId) ? (
                    <RecordActions
                      employeeId={t.person.id}
                      record={{
                        id: h.id,
                        courseId: h.courseId,
                        courseName: h.courseName,
                        kind: kindOf.get(h.courseId)!,
                        completedOn: h.completedOn,
                        expiresOn: h.expiresOn,
                        provider: h.provider,
                        reference: h.reference,
                      }}
                    />
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
