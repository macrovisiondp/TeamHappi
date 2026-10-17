import { Building2, CalendarClock, UserCheck, UsersRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { dashboardData } from "@/lib/workspace";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function DashboardPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const data = await dashboardData(ws);
  const empty = data.counts.sites === 0 && data.counts.active === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${ws.user.name.split(" ")[0]}. Here's ${ws.tenant.name} today.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sites"
          value={data.canViewSites ? data.counts.sites : "—"}
          detail={data.canViewSites ? "Active locations" : "Not in your role"}
          icon={Building2}
        />
        <StatCard
          label="Active staff"
          value={data.canViewPeople ? data.counts.active : "—"}
          detail={
            data.canViewPeople ? "Currently employed" : "Not in your role"
          }
          icon={UserCheck}
        />
        <StatCard
          label="Starting soon"
          value={data.canViewPeople ? data.counts.startingSoon : "—"}
          detail="In the next 30 days"
          icon={CalendarClock}
        />
        <StatCard
          label="Teams"
          value={data.canViewSites ? data.counts.teams : "—"}
          detail="Across your sites"
          icon={UsersRound}
        />
      </div>

      {empty ? (
        <EmptyState icon={Building2} title="Your workspace is ready">
          <p>
            Add your first site and your team to see staffing here. Site and
            people management arrive in the next releases; until then your
            TeamHappi contact can load them for you.
          </p>
        </EmptyState>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {data.canViewSites ? (
            <Card aria-labelledby="sites-heading">
              <CardHeader>
                <div>
                  <CardTitle id="sites-heading">Sites</CardTitle>
                  <CardDescription>Active staff at each site.</CardDescription>
                </div>
              </CardHeader>
              {data.sites.length ? (
                <Table caption="Active staff by site">
                  <thead>
                    <tr>
                      <Th>Site</Th>
                      <Th>Code</Th>
                      <Th className="text-right">Active staff</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sites.map((s) => (
                      <tr key={s.id}>
                        <Td className="font-semibold">{s.name}</Td>
                        <Td>{s.code}</Td>
                        <Td className="text-right">
                          {data.canViewPeople ? s.activeStaff : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <p className="text-sm text-ink-muted">No active sites yet.</p>
              )}
            </Card>
          ) : null}

          {data.canViewPeople ? (
            <Card aria-labelledby="soon-heading">
              <CardTitle id="soon-heading">Starting soon</CardTitle>
              {data.startingSoon.length ? (
                <ul className="flex flex-col divide-y divide-line text-sm">
                  {data.startingSoon.map((p) => (
                    <li key={p.id} className="flex flex-col gap-0.5 py-2.5">
                      <Link
                        href={`/people/${p.id}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {p.name}
                      </Link>
                      <span className="text-ink-muted">
                        {p.startDate
                          ? formatDate(p.startDate)
                          : "Date to be set"}
                        {p.siteName ? ` · ${p.siteName}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">
                  No one is due to start in the next 30 days.
                </p>
              )}
              <Button asChild variant="secondary" size="sm">
                <Link href="/people">View all people</Link>
              </Button>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
