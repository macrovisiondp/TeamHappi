import { ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import { AttendanceTabs } from "@/features/attendance/tabs";
import { EntryActions, TimesheetActions } from "@/features/attendance/controls";
import { dayLabel, minutesLabel, weekLabel } from "@/features/rota/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { attendanceApi } from "@/lib/workspace";
import { FLAG_LABELS, type TimesheetFlag } from "@/modules/attendance";

export const metadata: Metadata = { title: "Timesheets" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const flagLabel = (f: TimesheetFlag) =>
  f === "no_break" ? "No break recorded" : FLAG_LABELS[f];
const hhmm = (local: string) => local.slice(11, 16);

/**
 * M11.2: one site's week, planned against worked, for review and approval.
 * M11.3: approved hours export (organisation-wide exporters only).
 */
export default async function TimesheetsPage({
  searchParams,
}: PageProps<"/attendance/timesheets">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const p = await searchParams;
  const sites = await attendanceApi.sites(ws);
  if (sites.length === 0)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Timesheets" />
        <EmptyState icon={ClipboardCheck} title="No timesheets you can see">
          Timesheets are reviewed by owners, administrators, HR managers and
          site managers.
        </EmptyState>
      </div>
    );
  const siteId =
    typeof p.site === "string" && sites.some((s) => s.id === p.site)
      ? p.site
      : sites[0]!.id;
  const t = await attendanceApi.timesheet(ws, siteId, p.week);
  if (!t) throw new Error("Timesheet unavailable");
  const href = (week: string) =>
    `/attendance/timesheets?site=${encodeURIComponent(t.site.id)}&week=${week}` as const;
  const label = `${t.site.name}, week of ${weekLabel(t.weekStart)}`;
  const approved = t.status === "approved";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Timesheets"
        description="Planned hours (published rota) against worked hours (clocked time minus recorded breaks). Hours only: no pay is calculated."
        actions={
          t.can.approve && (approved || !t.blocker) ? (
            <TimesheetActions
              siteId={t.site.id}
              weekStart={t.weekStart}
              approved={approved}
              label={label}
            />
          ) : null
        }
      />
      <AttendanceTabs current="timesheets" siteId={t.site.id} />

      <div className="flex flex-wrap items-end gap-3">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose a site"
        >
          <input type="hidden" name="week" value={t.weekStart} />
          <Field id="ts-site" label="Site">
            <Select id="ts-site" name="site" defaultValue={t.site.id}>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <button
            type="submit"
            className="min-h-11 rounded-[10px] border border-line-strong px-4 text-sm font-semibold"
          >
            Show
          </button>
        </form>
        <nav aria-label="Change week" className="flex items-center gap-2">
          <Link
            href={href(t.previousWeek)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous<span className="sr-only"> week</span>
          </Link>
          <span className="px-2 text-sm font-semibold" aria-live="polite">
            Week of {weekLabel(t.weekStart)}
          </span>
          <Link
            href={href(t.nextWeek)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            Next<span className="sr-only"> week</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
        <Badge tone={approved ? "success" : "neutral"}>
          {approved ? `Approved ${t.approvedAt ?? ""}` : "Not approved"}
        </Badge>
      </div>

      {!approved && t.blocker ? (
        <Alert tone="info" title="Not ready to approve" role="status">
          {t.blocker}
        </Alert>
      ) : null}

      {t.rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nothing this week">
          Published shifts and clocked time at this site appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <Table caption={`Hours, ${label}`}>
            <thead>
              <tr>
                <Th scope="col">Person</Th>
                {t.days.map((d) => (
                  <Th key={d} scope="col">
                    {dayLabel(d)}
                  </Th>
                ))}
                <Th scope="col">Planned</Th>
                <Th scope="col">Worked</Th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr key={r.employeeId}>
                  <Th scope="row">
                    {r.name}
                    {r.flagged ? (
                      <span className="block text-xs font-normal text-warning">
                        {r.flagged} to check
                      </span>
                    ) : null}
                  </Th>
                  {r.days.map((d) => (
                    <Td key={d.day} className="whitespace-nowrap">
                      {d.planned || d.worked ? (
                        <>
                          <span className="sr-only">Planned </span>
                          {minutesLabel(d.planned)}
                          <span aria-hidden="true"> / </span>
                          <span className="sr-only">, worked </span>
                          <span className="font-semibold">
                            {minutesLabel(d.worked)}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-muted">–</span>
                      )}
                    </Td>
                  ))}
                  <Td>{minutesLabel(r.planned)}</Td>
                  <Td className="font-semibold">{minutesLabel(r.worked)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Th scope="row">Total</Th>
                <Td colSpan={7} />
                <Td>{minutesLabel(t.totals.planned)}</Td>
                <Td className="font-semibold">
                  {minutesLabel(t.totals.worked)}
                </Td>
              </tr>
            </tfoot>
          </Table>
        </div>
      )}
      <p className="text-sm text-ink-muted">Each day shows planned / worked.</p>

      {t.rows.some((r) => r.entries.length) ? (
        <section aria-labelledby="ts-entries" className="flex flex-col gap-3">
          <h2 id="ts-entries" className="text-lg font-semibold">
            Clocked times
          </h2>
          <ul className="flex flex-col gap-2">
            {t.rows.flatMap((r) =>
              r.entries.map((e) => {
                const summary = `${r.name}, ${dayLabel(e.day)}, in ${hhmm(e.clockIn)}${e.clockOut ? `, out ${hhmm(e.clockOut)}` : ""}`;
                return (
                  <li
                    key={e.id}
                    className="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p>
                        <span className="font-semibold">{r.name}</span> ·{" "}
                        {dayLabel(e.day)} · {hhmm(e.clockIn)}–
                        {e.clockOut ? hhmm(e.clockOut) : "still in"} ·{" "}
                        {minutesLabel(e.workedMinutes)} worked
                        {e.breakMinutes
                          ? ` · ${e.breakMinutes} min break`
                          : e.plannedBreakMinutes
                            ? ` · planned break ${e.plannedBreakMinutes} min (not deducted)`
                            : ""}
                      </p>
                      {e.flags.map((f) => (
                        <Badge
                          key={f}
                          tone={f === "corrected" ? "info" : "warning"}
                        >
                          {flagLabel(f)}
                        </Badge>
                      ))}
                    </div>
                    {t.can.manage && !approved ? (
                      <EntryActions
                        entryId={e.id}
                        summary={summary}
                        clockIn={e.clockIn}
                        clockOut={e.clockOut}
                      />
                    ) : null}
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      ) : null}

      {t.events.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">
            Approval history
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {t.events.map((e) => (
              <li key={e.id}>
                {e.at}: {e.kind}
                {e.reason ? `. ${e.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {t.can.export ? (
        <Card aria-labelledby="export-heading" className="gap-3">
          <CardTitle id="export-heading">Export approved hours</CardTitle>
          <p className="text-sm text-ink-muted">
            A CSV for your payroll, all sites: approved weeks only, hours only
            (no pay). Every export is recorded.
          </p>
          <form
            method="get"
            action="/attendance/export"
            className="flex flex-wrap items-end gap-3"
          >
            <Field id="exp-from" label="From">
              <Input
                id="exp-from"
                name="from"
                type="date"
                required
                defaultValue={t.weekStart}
              />
            </Field>
            <Field id="exp-to" label="To">
              <Input
                id="exp-to"
                name="to"
                type="date"
                required
                defaultValue={t.days[6]}
              />
            </Field>
            <button
              type="submit"
              className="min-h-11 rounded-[10px] bg-forest px-4 text-sm font-semibold text-white"
            >
              Download CSV
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
