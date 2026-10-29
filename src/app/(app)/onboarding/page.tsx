import {
  AlarmClock,
  CalendarClock,
  ClipboardCheck,
  FileClock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PermissionDenied } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Progress } from "@/components/ui/progress";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ClearanceBadge,
  OnboardingTabs,
  RightToWorkNotice,
  StageBadge,
} from "@/features/onboarding/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { formatDate } from "@/lib/format";
import { onboardingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Onboarding" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const STATUS_OPTIONS = [
  { value: "active", label: "In progress" },
  { value: "completed", label: "Signed off" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function OnboardingPage({
  searchParams,
}: PageProps<"/onboarding">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "active";
  const siteId = typeof params.site === "string" ? params.site : "";
  const data = await onboardingApi.dashboard(ws, { status, siteId });
  if (!data) {
    // M7.3: people being onboarded see their own onboarding instead.
    const mine = await onboardingApi.mine(ws);
    if (mine?.onboarding) redirect("/onboarding/me");
    return <PermissionDenied message="Your role doesn't include onboarding." />;
  }
  const canStart = ws.grants.has("onboarding.manage");
  const canTemplates = ws.grants.get("onboarding.template.manage") === "all";
  // A count only (not audited); the list itself is on the audited Right to work tab.
  const rtwAttention = ws.grants.has("rtw.view")
    ? await onboardingApi.rtwAttentionCount(ws)
    : null;
  const start = canStart ? (
    <Button asChild>
      <Link href="/onboarding/new">
        <Plus aria-hidden="true" />
        Start onboarding
      </Link>
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Onboarding"
        description="Get new starters ready, with every step recorded."
        actions={start}
      />
      <OnboardingTabs
        current="people"
        showTemplates={canTemplates}
        showRightToWork={rtwAttention !== null}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In progress" value={data.stats.active} icon={Users} />
        <StatCard
          label="Starting in the next 7 days"
          value={data.stats.startingSoon}
          icon={CalendarClock}
        />
        <StatCard
          label="Overdue tasks"
          value={data.stats.overdueTasks}
          icon={AlarmClock}
          tone={data.stats.overdueTasks ? "attention" : "default"}
        />
        <StatCard
          label="Ready for final sign-off"
          value={data.stats.readyForSignOff}
          detail="Every required task finished"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Not cleared to start"
          value={data.stats.notCleared}
          detail="Tasks, documents or right-to-work check missing"
          icon={ShieldAlert}
          tone={data.stats.notCleared ? "attention" : "default"}
        />
        <StatCard
          label="Documents expired or expiring"
          value={data.stats.documentsExpiring}
          detail="Within the next 60 days"
          icon={FileClock}
          tone={data.stats.documentsExpiring ? "attention" : "default"}
        />
        {rtwAttention !== null ? (
          <StatCard
            label="Right-to-work follow-ups"
            value={rtwAttention}
            detail="Due within 60 days, or needing attention"
            icon={ShieldCheck}
            tone={rtwAttention ? "attention" : "default"}
          />
        ) : null}
      </div>
      <RightToWorkNotice />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter onboarding"
      >
        <Field id="filter-status" label="Show">
          <Select id="filter-status" name="status" defaultValue={status}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {data.sites.length > 1 ? (
          <Field id="filter-site" label="Site">
            <Select id="filter-site" name="site" defaultValue={siteId}>
              <option value="">All your sites</option>
              {data.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {data.cases.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Nobody here yet"
          action={status === "active" ? (start ?? undefined) : undefined}
        >
          {status === "active"
            ? "Start onboarding for a new starter from their record, or here. They don't need a TeamHappi login."
            : "Nothing matches this filter."}
        </EmptyState>
      ) : (
        <Table caption="Onboarding">
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Starts</Th>
              <Th>Progress</Th>
              <Th>Stage</Th>
              <Th>Next due</Th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.id}>
                <Td>
                  <Link
                    href={`/onboarding/${c.id}`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {c.name}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {[c.jobTitle, c.siteName].filter(Boolean).join(" · ") ||
                      c.templateName}
                  </p>
                </Td>
                <Td>{formatDate(c.startDate)}</Td>
                <Td className="min-w-40">
                  <Progress
                    value={c.progress.percent}
                    label={`${c.name}: ${c.progress.finished} of ${c.progress.total} tasks finished`}
                  />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <StageBadge status={c.status} progress={c.progress} />
                    <ClearanceBadge status={c.status} clearance={c.clearance} />
                  </div>
                </Td>
                <Td>
                  {c.nextDue ? (
                    <>
                      <span>{c.nextDue.title}</span>
                      <p className="text-xs text-ink-muted">
                        {c.nextDue.dueOn
                          ? formatDate(c.nextDue.dueOn)
                          : "No date"}
                      </p>
                    </>
                  ) : (
                    "Nothing open"
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
