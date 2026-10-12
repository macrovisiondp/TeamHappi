import {
  CalendarClock,
  ClipboardCheck,
  ShieldAlert,
  UserCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, PageHeader, StatCard } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Table, Td, Th } from "@/components/ui/table";
import { complianceItems, staffingSummary } from "@/features/dashboard/summary";
import {
  DEMO_ACTIVITY,
  DEMO_REFERENCE_DATE,
  DEMO_TODAY,
  demoSite,
} from "@/features/demo/fixtures";
import { fullName } from "@/features/people/directory";
import { formatDate, formatDay, formatTime } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default function DashboardPage() {
  const { scheduled, clockedIn, openShifts, onboarding } = staffingSummary();
  const compliance = complianceItems();
  const urgent = compliance.filter((c) => c.tone === "danger").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        demo
        description={`Staffing and compliance across your sites for ${formatDay(DEMO_REFERENCE_DATE)}.`}
        actions={
          <Button
            disabled
            disabledReason="Available when the Rota module is live"
          >
            <CalendarClock aria-hidden="true" />
            Publish rota
          </Button>
        }
      />

      <Alert tone="demo" title="You're looking at demo data">
        Every figure on this page is synthetic and for design review only.
        Nothing here reflects real staff, shifts or compliance. Live figures
        appear as each module is built.
      </Alert>

      <section
        aria-label="Today at a glance"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          label="On shift now"
          value={`${clockedIn} / ${scheduled}`}
          detail="Clocked in of those scheduled today"
          icon={UserCheck}
        />
        <StatCard
          label="Open shifts today"
          value={openShifts}
          detail="Shifts with nobody assigned"
          icon={CalendarClock}
          tone={openShifts > 0 ? "attention" : "default"}
        />
        <StatCard
          label="Starting soon"
          value={onboarding.length}
          detail="New starters in onboarding"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Compliance actions"
          value={compliance.length}
          detail={`${urgent} need action now`}
          icon={ShieldAlert}
          tone={compliance.length > 0 ? "attention" : "default"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card aria-labelledby="sites-heading">
          <CardHeader>
            <div>
              <CardTitle id="sites-heading">Today by site</CardTitle>
              <CardDescription>
                Scheduled staff, who has clocked in and gaps to fill.
              </CardDescription>
            </div>
          </CardHeader>
          <Table
            caption="Today's staffing by site (demo data)"
            className="shadow-none"
          >
            <thead>
              <tr>
                <Th>Site</Th>
                <Th className="text-right">Scheduled</Th>
                <Th className="text-right">Clocked in</Th>
                <Th>Open shifts</Th>
              </tr>
            </thead>
            <tbody>
              {DEMO_TODAY.map((row) => {
                const site = demoSite(row.siteId)!;
                return (
                  <tr key={row.siteId}>
                    <Td>
                      <p className="font-semibold">{site.name}</p>
                      <p className="text-xs text-ink-muted">{site.area}</p>
                    </Td>
                    <Td className="text-right">{row.scheduled}</Td>
                    <Td className="text-right">{row.clockedIn}</Td>
                    <Td>
                      {row.openShifts > 0 ? (
                        <Badge tone="warning">{row.openShifts} to fill</Badge>
                      ) : (
                        <Badge tone="success">Fully staffed</Badge>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card aria-labelledby="compliance-heading">
          <CardHeader>
            <div>
              <CardTitle id="compliance-heading">
                Compliance to review
              </CardTitle>
              <CardDescription>
                Right-to-work records and mandatory training.
              </CardDescription>
            </div>
          </CardHeader>
          <ul className="flex flex-col divide-y divide-line">
            {compliance.slice(0, 6).map((item) => (
              <li
                key={`${item.employeeId}-${item.issue}`}
                className="flex items-start gap-3 py-3"
              >
                <Avatar name={item.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/people/${item.employeeId}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {item.name}
                  </Link>
                  <p className="text-sm text-ink-muted">{item.issue}</p>
                  <p className="text-xs text-ink-muted">{item.site}</p>
                </div>
                <Badge tone={item.tone}>{item.label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card aria-labelledby="onboarding-heading">
          <CardHeader>
            <div>
              <CardTitle id="onboarding-heading">New starters</CardTitle>
              <CardDescription>
                Onboarding progress before their first shift.
              </CardDescription>
            </div>
          </CardHeader>
          <ul className="flex flex-col gap-4">
            {onboarding.map((e) => (
              <li key={e.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/people/${e.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {fullName(e)}
                  </Link>
                  <span className="text-sm text-ink-muted">
                    {e.role} · starts {formatDate(e.startDate)}
                  </span>
                </div>
                <Progress
                  value={e.onboardingProgress ?? 0}
                  label={`Onboarding progress for ${fullName(e)}`}
                />
              </li>
            ))}
          </ul>
        </Card>

        <Card aria-labelledby="activity-heading">
          <CardHeader>
            <div>
              <CardTitle id="activity-heading">Recent activity</CardTitle>
              <CardDescription>
                Latest changes across your sites.
              </CardDescription>
            </div>
          </CardHeader>
          <ol className="flex flex-col gap-3">
            {DEMO_ACTIVITY.map((a) => (
              <li key={a.at} className="flex gap-3 text-sm">
                <time
                  dateTime={a.at}
                  className="w-28 shrink-0 text-ink-muted tabular-nums"
                >
                  {formatDate(a.at)}, {formatTime(a.at)}
                </time>
                <p>{a.text}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
