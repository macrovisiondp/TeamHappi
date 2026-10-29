import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { RightToWorkForm } from "@/features/onboarding/compliance-controls";
import {
  RTW_KIND_LABEL,
  RTW_LIST_LABEL,
  RTW_METHOD_LABEL,
  RTW_OUTCOME_LABEL,
  RTW_STATE,
} from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate, formatTime } from "@/lib/format";
import { onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Right to work" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const when = (d: Date) => `${formatDate(d)}, ${formatTime(d)}`;

export default async function RightToWorkPage({
  params,
}: PageProps<"/people/[employeeId]/right-to-work">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { employeeId } = await params;
  // Restricted: needs rtw.view at their site, and this view is audited.
  // Anyone else (and other organisations' people) gets "not found".
  const r = await onboardingApi.rightToWork(ws, employeeId);
  if (!r) notFound();
  const state = RTW_STATE[r.state];
  const current = r.history.find((h) => h.current) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/people/${r.employee.id}`}
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {r.employee.name}
      </Link>
      <PageHeader
        title={`Right to work: ${r.employee.name}`}
        description="Your record of the right-to-work checks you've made. Restricted: only owners, administrators and HR managers can see it, and every view is recorded."
        actions={<Badge tone={state.tone}>{state.label}</Badge>}
      />

      <Alert
        tone="info"
        title="TeamHappi records your check; it doesn't make the decision"
      >
        You, the employer, check right to work before employment starts and keep
        the evidence in your own records. TeamHappi doesn&rsquo;t store document
        numbers, share codes, nationality or copies of documents.{" "}
        <a
          href="https://www.gov.uk/government/publications/right-to-work-checks-employers-guide"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold underline"
        >
          Home Office employer&rsquo;s guide
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Alert>

      <Card aria-labelledby="current-heading">
        <CardHeader>
          <div>
            <CardTitle id="current-heading">Current record</CardTitle>
            <CardDescription>
              {current
                ? `${RTW_KIND_LABEL[current.kind]} recorded by ${current.recordedByName} on ${when(current.recordedAt)}.`
                : "No right-to-work check has been recorded for this person."}
            </CardDescription>
          </div>
        </CardHeader>
        {current ? <CheckDetails check={current} /> : null}
      </Card>

      {r.can.record ? (
        <Card aria-labelledby="record-heading">
          <CardHeader>
            <div>
              <CardTitle id="record-heading">
                {current
                  ? "Record a follow-up or a correction"
                  : "Record the check"}
              </CardTitle>
              <CardDescription>
                Records can&rsquo;t be edited or deleted. A follow-up or
                correction becomes the current record, and the earlier one stays
                in the history.
              </CardDescription>
            </div>
          </CardHeader>
          {r.can.recordNew || current ? (
            <RightToWorkForm
              employeeId={r.employee.id}
              currentId={r.currentId}
              members={r.members}
              selfMembershipId={ws.membershipId}
              today={r.today}
            />
          ) : (
            <p className="text-sm text-ink-muted">
              This person has left, and has no record to correct.
            </p>
          )}
        </Card>
      ) : null}

      {r.history.length > 1 ? (
        <section
          aria-labelledby="history-heading"
          className="flex flex-col gap-3"
        >
          <h2 id="history-heading" className="text-lg font-semibold">
            History
          </h2>
          <ul className="flex flex-col gap-3">
            {r.history
              .filter((h) => !h.current)
              .map((h) => (
                <li key={h.id}>
                  <Card
                    aria-label={`${RTW_KIND_LABEL[h.kind]} of ${formatDate(h.checkedOn)}`}
                    className="gap-3"
                  >
                    <CardHeader>
                      <span className="font-semibold">
                        {RTW_KIND_LABEL[h.kind]}, recorded by {h.recordedByName}{" "}
                        on {when(h.recordedAt)}
                      </span>
                      <Badge tone="neutral" icon={null}>
                        {h.supersededBy === "correction"
                          ? "Corrected"
                          : "Superseded"}
                      </Badge>
                    </CardHeader>
                    <CheckDetails check={h} />
                  </Card>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

type Check = NonNullable<
  Awaited<ReturnType<typeof onboardingApi.rightToWork>>
>["history"][number];

function CheckDetails({ check: c }: { check: Check }) {
  const rows: [string, string][] = [
    ["Method", RTW_METHOD_LABEL[c.method]],
    ...(c.listType
      ? ([["List", RTW_LIST_LABEL[c.listType]]] as [string, string][])
      : []),
    ["Date of the check", formatDate(c.checkedOn)],
    ["Checked by", c.checkedByName],
    ["Person present", c.personPresent ? "Yes" : "No"],
    ["Outcome", RTW_OUTCOME_LABEL[c.outcome]],
  ];
  if (c.permissionEndsOn)
    rows.push(["Permission ends", formatDate(c.permissionEndsOn)]);
  if (c.followUpDueOn)
    rows.push(["Follow-up check due by", formatDate(c.followUpDueOn)]);
  rows.push(["Evidence", "Kept in your own records"]);
  return (
    <>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {c.correctionReason ? (
        <p className="text-sm">Correction: {c.correctionReason}</p>
      ) : null}
      {c.note ? <p className="text-sm">Note: {c.note}</p> : null}
    </>
  );
}
