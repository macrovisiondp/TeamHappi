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
import { StageBadge } from "@/features/onboarding/labels";
import { can, getPerson, onboardingApi } from "@/lib/workspace";
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
                <StageBadge
                  status={onboarding.status}
                  progress={onboarding.progress}
                />
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
      </div>
    </div>
  );
}
