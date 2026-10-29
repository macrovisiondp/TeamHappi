import {
  AlarmClock,
  CalendarClock,
  GraduationCap,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PermissionDenied } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader, StatCard } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { StatusCell, TrainingTabs } from "@/features/training/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { trainingApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Training" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const STATUS_OPTIONS = [
  { value: "", label: "Any status" },
  { value: "overdue", label: "Overdue" },
  { value: "expired", label: "Expired" },
  { value: "expiring", label: "Expiring soon" },
  { value: "due", label: "Due" },
  { value: "up_to_date", label: "Up to date" },
];

export default async function TrainingPage({
  searchParams,
}: PageProps<"/training">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const p = await searchParams;
  const one = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
  const filter = {
    siteId: one("site"),
    teamId: one("team"),
    jobTitle: one("job"),
    status: one("status"),
  };
  const data = await trainingApi.matrix(ws, filter);
  if (!data)
    return <PermissionDenied message="Your role doesn't include training." />;
  const canCourses = ws.grants.get("training.manage") === "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Training"
        description="Who needs which training, and whether it's done, due or expiring. Worked out from your rules and each person's site and job title."
      />
      <TrainingTabs current="matrix" showCourses={canCourses} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="People up to date"
          value={`${data.stats.upToDate} of ${data.stats.people}`}
          detail="No mandatory training overdue or expired"
          icon={Users}
        />
        <StatCard
          label="Overdue"
          value={data.stats.overdue}
          icon={AlarmClock}
          tone={data.stats.overdue ? "attention" : "default"}
        />
        <StatCard
          label="Expired"
          value={data.stats.expired}
          icon={ShieldCheck}
          tone={data.stats.expired ? "attention" : "default"}
        />
        <StatCard
          label="Expiring soon"
          value={data.stats.expiring}
          detail="Within each course's warning period"
          icon={CalendarClock}
          tone={data.stats.expiring ? "attention" : "default"}
        />
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3"
        aria-label="Filter training"
      >
        {data.filters.sites.length > 1 ? (
          <Field id="filter-site" label="Site">
            <Select id="filter-site" name="site" defaultValue={filter.siteId}>
              <option value="">All your sites</option>
              {data.filters.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {data.filters.teams.length ? (
          <Field id="filter-team" label="Team">
            <Select id="filter-team" name="team" defaultValue={filter.teamId}>
              <option value="">All teams</option>
              {data.filters.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {data.filters.jobTitles.length ? (
          <Field id="filter-job" label="Job title">
            <Select id="filter-job" name="job" defaultValue={filter.jobTitle}>
              <option value="">All job titles</option>
              {data.filters.jobTitles.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="filter-status" label="Status">
          <Select id="filter-status" name="status" defaultValue={filter.status}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {data.courses.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No training required yet"
          action={
            canCourses ? (
              <Button asChild>
                <Link href="/training/courses">Set up courses</Link>
              </Button>
            ) : undefined
          }
        >
          {canCourses
            ? "Add courses, then say who needs each one (everyone, a site, a job title or a named person)."
            : "An owner, administrator or HR manager sets up courses and who needs them."}
        </EmptyState>
      ) : data.rows.length === 0 ? (
        <p className="text-sm">Nobody matches this filter.</p>
      ) : (
        <Table caption="Training matrix: people and their required courses">
          <thead>
            <tr>
              <Th className="sticky left-0 z-10">Person</Th>
              {data.courses.map((c) => (
                <Th key={c.id} className="min-w-36 whitespace-normal">
                  {c.name}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-line bg-surface px-4 py-3 text-left align-top font-normal"
                >
                  <Link
                    href={`/people/${r.id}/training`}
                    className="font-semibold underline-offset-4 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {[r.jobTitle, r.siteName].filter(Boolean).join(" · ") ||
                      "No job title"}
                  </p>
                </th>
                {data.courses.map((c) => {
                  const cell = r.cells[c.id];
                  return (
                    <Td key={c.id} className="align-top">
                      {cell ? (
                        <StatusCell s={cell} />
                      ) : (
                        <span className="text-xs text-ink-muted">
                          Not required
                        </span>
                      )}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
