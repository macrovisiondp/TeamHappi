import { ArrowLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";
import { EMPLOYMENT_STATUSES, fullName } from "@/features/people/directory";
import { Progress } from "@/components/ui/progress";
import { ClearanceBadge, StageBadge } from "@/features/onboarding/labels";
import {
  can,
  getPerson,
  onboardingApi,
  recruitmentApi,
  trainingApi,
} from "@/lib/workspace";
import { STATUS as TRAINING_STATUS } from "@/features/training/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Employee" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function EmployeePage({
  params,
}: PageProps<"/people/[employeeId]">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const { employeeId } = await params;
  // Other organisations' people and people outside your sites look the same as
  // people who don't exist: 404.
  const person = await getPerson(ws, employeeId);
  if (!person) notFound();

  const name = fullName(person);
  // Onboarding (M7.1): shown only to people with onboarding.view at this site.
  const onboarding = ws.grants.has("onboarding.view")
    ? await onboardingApi.caseForEmployee(ws, person.id)
    : null;
  const canStartOnboarding =
    person.status !== "left" &&
    onboarding?.status !== "active" &&
    (person.primarySiteId === null
      ? ws.grants.get("onboarding.manage") === "all"
      : can(ws.grants, "onboarding.manage", person.primarySiteId));
  // Right to work (M7.2): owners, admins and HR only (decision D1).
  const canViewRightToWork =
    person.primarySiteId === null
      ? ws.grants.get("rtw.view") === "all"
      : can(ws.grants, "rtw.view", person.primarySiteId);
  // M7.3: owners and admins can invite the person, linking this record to a login.
  const canInvite = ws.grants.get("member.invite") === "all";
  // Training (M8.1): shown to people with training.view at this person's site.
  const training = ws.grants.has("training.view")
    ? await trainingApi.person(ws, person.id)
    : null;
  const trainingNeeds = (training?.required ?? []).filter(
    (r) => r.status !== "up_to_date",
  );
  // Recruitment (M9.1): the application they were hired from, for recruitment.view holders.
  const hiredFromRes = ws.grants.has("recruitment.view")
    ? await recruitmentApi.hiredFrom(ws, person.id)
    : null;
  const hiredFrom =
    hiredFromRes && !("ok" in hiredFromRes) ? hiredFromRes : null;
  const status = EMPLOYMENT_STATUSES[person.status]!;
  const canEdit =
    person.primarySiteId === null
      ? ws.grants.get("employee.manage") === "all"
      : can(ws.grants, "employee.manage", person.primarySiteId);
  const rows: [string, string][] = [
    ["Job title", person.jobTitle ?? "Not set"],
    ["Employee number", person.employeeNumber],
    ["Primary site", person.primarySite?.name ?? "Not set"],
    ["Teams", person.teams.map((t) => t.team.name).join(", ") || "None"],
    ["Start date", person.startDate ? formatDate(person.startDate) : "Not set"],
  ];
  if (person.endDate) rows.push(["End date", formatDate(person.endDate)]);
  if (hiredFrom)
    rows.push([
      "Hired from",
      `${hiredFrom.vacancyTitle}${hiredFrom.hiredAt ? ` (${formatDate(hiredFrom.hiredAt)})` : ""}`,
    ]);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/people"
        className="flex w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to people
      </Link>
      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={name} size="lg" />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-bold md:text-3xl">{name}</h1>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        {canEdit ? (
          <Button asChild variant="secondary" className="ml-auto">
            <Link href={`/people/${person.id}/edit`}>
              <Pencil aria-hidden="true" />
              Edit
            </Link>
          </Button>
        ) : null}
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="employment-heading">
          <CardHeader>
            <CardTitle id="employment-heading">Employment</CardTitle>
          </CardHeader>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card aria-labelledby="contact-heading">
          <CardHeader>
            <div>
              <CardTitle id="contact-heading">Contact</CardTitle>
              <CardDescription>Work contact details.</CardDescription>
            </div>
          </CardHeader>
          <dl className="grid gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-ink-muted">Email</dt>
              <dd className="font-medium break-words">
                {person.email ?? "Not recorded"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-ink-muted">Phone</dt>
              <dd className="font-medium">
                {person.phoneNumber ?? "Not recorded"}
              </dd>
            </div>
          </dl>
        </Card>
        {onboarding || canStartOnboarding ? (
          <Card aria-labelledby="onboarding-heading">
            <CardHeader>
              <div>
                <CardTitle id="onboarding-heading">Onboarding</CardTitle>
                <CardDescription>
                  Doesn&rsquo;t show right to work, which is recorded
                  separately.
                </CardDescription>
              </div>
              {onboarding ? (
                <div className="flex flex-wrap gap-1.5">
                  <StageBadge
                    status={onboarding.status}
                    progress={onboarding.progress}
                  />
                  <ClearanceBadge
                    status={onboarding.status}
                    clearance={onboarding.clearance}
                  />
                </div>
              ) : null}
            </CardHeader>
            {onboarding ? (
              <>
                <Progress
                  value={onboarding.progress.percent}
                  label={`Onboarding: ${onboarding.progress.finished} of ${onboarding.progress.total} tasks finished`}
                />
                <Link
                  href={`/onboarding/${onboarding.id}`}
                  className="w-fit text-sm font-semibold text-forest underline-offset-4 hover:underline"
                >
                  Open onboarding
                </Link>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                No onboarding yet. It works without a TeamHappi login.
              </p>
            )}
            {canStartOnboarding ? (
              <Button asChild variant="secondary" className="w-fit">
                <Link href={`/onboarding/new?employee=${person.id}`}>
                  Start onboarding
                </Link>
              </Button>
            ) : null}
          </Card>
        ) : null}
        {training ? (
          <Card aria-labelledby="training-heading">
            <CardHeader>
              <div>
                <CardTitle id="training-heading">Training</CardTitle>
                <CardDescription>
                  {training.required.length === 0
                    ? "No training rules apply at the moment."
                    : `${training.required.filter((r) => r.status === "up_to_date" || r.status === "expiring").length} of ${training.required.length} done${trainingNeeds.length ? ` · ${trainingNeeds.length} need attention` : ""}`}
                </CardDescription>
              </div>
              {training.required.length ? (
                <Badge tone={training.upToDate ? "success" : "warning"}>
                  {training.upToDate ? "Up to date" : "Training needed"}
                </Badge>
              ) : null}
            </CardHeader>
            {trainingNeeds.length ? (
              <ul className="flex flex-col gap-1 text-sm">
                {trainingNeeds.slice(0, 4).map((r) => (
                  <li key={r.courseId}>
                    {r.courseName}: {TRAINING_STATUS[r.status].label}
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href={`/people/${person.id}/training`}
              className="w-fit text-sm font-semibold text-forest underline-offset-4 hover:underline"
            >
              Open training
            </Link>
          </Card>
        ) : null}
        {canInvite ? (
          <Card aria-labelledby="login-heading">
            <CardHeader>
              <div>
                <CardTitle id="login-heading">TeamHappi login</CardTitle>
                <CardDescription>
                  {person.membershipId
                    ? "Linked to a TeamHappi login. They can see and complete their own onboarding tasks."
                    : "Not linked yet. Invite them so they can complete their own onboarding tasks on their phone."}
                </CardDescription>
              </div>
            </CardHeader>
            {!person.membershipId && person.status !== "left" ? (
              <Button asChild variant="secondary" className="w-fit">
                <Link href={`/people/${person.id}/invite`}>
                  Invite to TeamHappi
                </Link>
              </Button>
            ) : null}
          </Card>
        ) : null}
        {canViewRightToWork ? (
          <Card aria-labelledby="rtw-heading">
            <CardHeader>
              <div>
                <CardTitle id="rtw-heading">Right to work</CardTitle>
                <CardDescription>
                  Restricted. Opening the record is itself recorded.
                </CardDescription>
              </div>
            </CardHeader>
            <Link
              href={`/people/${person.id}/right-to-work`}
              // Opening the record is an audited view: never prefetch it.
              prefetch={false}
              className="w-fit text-sm font-semibold text-forest underline-offset-4 hover:underline"
            >
              Open the right-to-work record
            </Link>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
