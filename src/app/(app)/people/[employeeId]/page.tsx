import { ArrowLeft, FileText, Mail, Pencil, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, DemoBadge } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import {
  demoEmployee,
  demoSite,
  type RtwStatus,
  type TrainingStatus,
} from "@/features/demo/fixtures";
import {
  fullName,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/features/people/directory";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Employee profile" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const RTW: Record<
  RtwStatus,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  verified: { label: "Checked", tone: "success" },
  expiring: { label: "Expiring soon", tone: "warning" },
  action_needed: { label: "Check needed", tone: "danger" },
};

const TRAINING: Record<
  TrainingStatus,
  { label: string; tone: "success" | "warning" | "danger" }
> = {
  complete: { label: "Complete", tone: "success" },
  due_soon: { label: "Due soon", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
};

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function EmployeeProfilePage({
  params,
}: PageProps<"/people/[employeeId]">) {
  const { employeeId } = await params;
  const e = demoEmployee(employeeId);
  if (!e) notFound();
  const site = demoSite(e.siteId);
  const name = fullName(e);
  const rtw = RTW[e.rightToWork];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/people"
        className="flex min-h-11 w-fit items-center gap-2 text-sm font-semibold text-forest underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to people
      </Link>

      <header className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card md:flex-row md:items-center md:p-6">
        <Avatar name={name} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold md:text-3xl">{name}</h1>
            <DemoBadge />
          </div>
          <p className="text-ink-muted">
            {e.role} · {e.team} · {site?.name}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
            <Badge tone={rtw.tone}>Right to work: {rtw.label}</Badge>
          </div>
        </div>
        <Button
          variant="secondary"
          disabled
          disabledReason="Editing arrives with the People module (Milestone 3.7)"
        >
          <Pencil aria-hidden="true" />
          Edit details
        </Button>
      </header>

      <Alert tone="demo" title="Fictional employee">
        This profile is synthetic demo data. Contact details use reserved
        example addresses and numbers.
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="employment-heading">
          <CardHeader>
            <CardTitle id="employment-heading">Employment</CardTitle>
          </CardHeader>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Employee number">{e.employeeNumber}</Detail>
            <Detail label="Contract">{e.contract}</Detail>
            <Detail label="Start date">{formatDate(e.startDate)}</Detail>
            <Detail label="Site">{site?.name}</Detail>
          </dl>
        </Card>

        <Card aria-labelledby="contact-heading">
          <CardHeader>
            <CardTitle id="contact-heading">Contact</CardTitle>
          </CardHeader>
          <dl className="grid gap-4">
            <Detail label="Email">
              <span className="flex items-center gap-2">
                <Mail aria-hidden="true" className="size-4 text-ink-muted" />
                {e.email}
              </span>
            </Detail>
            <Detail label="Phone">
              <span className="flex items-center gap-2">
                <Phone aria-hidden="true" className="size-4 text-ink-muted" />
                {e.phone}
              </span>
            </Detail>
          </dl>
        </Card>

        {e.status === "onboarding" ? (
          <Card aria-labelledby="onboarding-heading">
            <CardHeader>
              <CardTitle id="onboarding-heading">Onboarding</CardTitle>
            </CardHeader>
            <Progress
              value={e.onboardingProgress ?? 0}
              label={`Onboarding progress for ${name}`}
            />
            <p className="text-sm text-ink-muted">
              First shift {formatDate(e.startDate)}. They can&apos;t be rostered
              until the right-to-work check and required steps are complete.
            </p>
          </Card>
        ) : null}

        <Card aria-labelledby="training-heading">
          <CardHeader>
            <CardTitle id="training-heading">Training</CardTitle>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-line">
            {e.training.map((t) => (
              <li
                key={t.name}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
              >
                <div>
                  <p className="text-sm font-semibold">{t.name}</p>
                  {t.expiresOn ? (
                    <p className="text-xs text-ink-muted">
                      Renews {formatDate(t.expiresOn)}
                    </p>
                  ) : null}
                </div>
                <Badge tone={TRAINING[t.status].tone}>
                  {TRAINING[t.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="documents-heading">
          <CardHeader>
            <CardTitle id="documents-heading">Documents</CardTitle>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-line">
            {e.documents.map((d) => (
              <li key={d.name} className="flex items-center gap-3 py-2.5">
                <FileText
                  aria-hidden="true"
                  className="size-5 shrink-0 text-forest"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <p className="text-xs text-ink-muted">
                    {d.type} · added {formatDate(d.addedOn)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled
                  disabledReason="Secure document storage arrives in Milestone 4"
                >
                  View
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
