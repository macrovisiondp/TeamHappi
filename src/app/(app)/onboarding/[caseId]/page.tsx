import { ArrowLeft, CheckCircle2, Circle, MinusCircle } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
import { CaseActions, TaskActions } from "@/features/onboarding/controls";
import {
  CATEGORY_LABEL,
  OWNER_LABEL,
  RightToWorkNotice,
  StageBadge,
} from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate, formatTime } from "@/lib/format";
import { onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Onboarding" };
export const instant = false;

const when = (d: Date) => `${formatDate(d)}, ${formatTime(d)}`;

export default async function OnboardingCasePage({
  params,
}: PageProps<"/onboarding/[caseId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { caseId } = await params;
  // Other organisations' onboarding and other sites' look like nothing: 404.
  const c = await onboardingApi.getCase(ws, caseId);
  if (!c) notFound();
  const p = c.progress;
  const signOffBlockedReason =
    c.status !== "active" || !c.can.signOffAuthorised
      ? null
      : c.isOwnRecord
        ? "You can't sign off your own onboarding"
        : !p.operationallyReady
          ? `${p.requiredOutstanding} required task${p.requiredOutstanding === 1 ? "" : "s"} still open`
          : null;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/onboarding"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Onboarding
      </Link>
      <PageHeader
        title={c.name}
        description={`${c.templateName} (template version ${c.templateVersion}) · starts ${formatDate(c.startDate)}${c.siteName ? ` · ${c.siteName}` : ""}`}
        actions={<StageBadge status={c.status} progress={p} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card aria-labelledby="progress-heading">
          <CardTitle id="progress-heading">Task progress</CardTitle>
          <Progress
            value={p.percent}
            label={`${p.finished} of ${p.total} tasks finished`}
          />
          <CardDescription>
            {p.finished} of {p.total} finished
            {p.overdue ? ` · ${p.overdue} overdue` : ""}
          </CardDescription>
        </Card>
        <Card aria-labelledby="ready-heading">
          <CardTitle id="ready-heading">Operational readiness</CardTitle>
          <p className="text-sm">
            {p.operationallyReady
              ? "Every required task is finished."
              : `${p.requiredOutstanding} required task${p.requiredOutstanding === 1 ? " is" : "s are"} still open.`}
          </p>
          <CardDescription>
            Required tasks must be done, or have a recorded exception.
          </CardDescription>
        </Card>
        <Card aria-labelledby="signoff-heading">
          <CardTitle id="signoff-heading">Final sign-off</CardTitle>
          <p className="text-sm">
            {c.signedOff
              ? `Signed off by ${c.signedOff.by} on ${when(c.signedOff.at)}.`
              : c.cancelled
                ? `Cancelled on ${when(c.cancelled.at)}.`
                : "Not signed off yet. Needs an owner, administrator or HR manager."}
          </p>
          {c.signedOff?.note ? (
            <CardDescription>Note: {c.signedOff.note}</CardDescription>
          ) : null}
          {c.cancelled?.reason ? (
            <CardDescription>Reason: {c.cancelled.reason}</CardDescription>
          ) : null}
        </Card>
      </div>

      <RightToWorkNotice />

      {c.status === "active" ? (
        <CaseActions
          caseId={c.id}
          name={c.name}
          canManage={c.can.manage}
          canSignOff={c.can.signOff}
          signOffBlockedReason={signOffBlockedReason}
          ownerMembershipId={c.ownerMembershipId}
          members={c.members}
        />
      ) : null}
      <p className="text-sm text-ink-muted">
        Owner: {c.ownerName ?? "Not set"}
      </p>

      <section aria-labelledby="tasks-heading" className="flex flex-col gap-3">
        <h2 id="tasks-heading" className="text-lg font-semibold">
          Tasks
        </h2>
        <ul className="flex flex-col gap-3">
          {c.tasks.map((t) => {
            const Icon =
              t.status === "done"
                ? CheckCircle2
                : t.status === "waived"
                  ? MinusCircle
                  : Circle;
            return (
              <li key={t.id}>
                <Card aria-label={t.title} className="gap-3">
                  <CardHeader>
                    <div className="flex min-w-0 items-start gap-3">
                      <Icon
                        aria-hidden="true"
                        className={
                          t.status === "to_do"
                            ? "mt-0.5 size-5 shrink-0 text-ink-muted"
                            : "mt-0.5 size-5 shrink-0 text-forest"
                        }
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="font-semibold">{t.title}</span>
                        {t.guidance ? (
                          <span className="text-sm text-ink-muted">
                            {t.guidance}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {t.required ? (
                        <Badge tone="neutral" icon={null}>
                          Required
                        </Badge>
                      ) : (
                        <Badge tone="neutral" icon={null}>
                          Optional
                        </Badge>
                      )}
                      <Badge tone="neutral" icon={null}>
                        {CATEGORY_LABEL[t.category]}
                      </Badge>
                      {t.status === "done" ? (
                        <Badge tone="success">Done</Badge>
                      ) : t.status === "waived" ? (
                        <Badge tone="info">Exception</Badge>
                      ) : t.overdue ? (
                        <Badge tone="warning">Overdue</Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-ink-muted">Who does it</dt>
                      <dd>
                        {t.assigneeName ??
                          (t.ownerKind === "employee"
                            ? "The employee"
                            : `${OWNER_LABEL[t.ownerKind]} (not assigned)`)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-muted">Due</dt>
                      <dd>{t.dueOn ? formatDate(t.dueOn) : "No date"}</dd>
                    </div>
                    {t.completedAt ? (
                      <div>
                        <dt className="text-ink-muted">
                          {t.status === "waived" ? "Exception by" : "Done by"}
                        </dt>
                        <dd>
                          {t.completedByName}, {when(t.completedAt)}
                          {t.onBehalf ? " (on the employee's behalf)" : ""}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  {t.waivedReason ? (
                    <p className="text-sm">Reason: {t.waivedReason}</p>
                  ) : null}
                  {c.can.manage ? (
                    <TaskActions
                      caseId={c.id}
                      taskId={t.id}
                      title={t.title}
                      status={t.status}
                      required={t.required}
                      canWaiveRequired={c.can.waiveRequired}
                      assigneeMembershipId={t.assigneeMembershipId}
                      dueOn={t.dueOn}
                      members={c.members}
                      forEmployee={t.ownerKind === "employee"}
                    />
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
