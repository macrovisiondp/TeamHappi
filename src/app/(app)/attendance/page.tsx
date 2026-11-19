import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { AttendanceTabs } from "@/features/attendance/tabs";
import {
  EntryActions,
  RecordEntryDialog,
  SettingsForm,
} from "@/features/attendance/controls";
import { dayLabel, minutesLabel } from "@/features/rota/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { attendanceApi } from "@/lib/workspace";
import { FLAG_LABELS, STATUS_LABELS, type Status } from "@/modules/attendance";

export const metadata: Metadata = { title: "Attendance" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

const STATUS_TONE: Record<Status, Tone> = {
  due: "neutral",
  late: "warning",
  no_clock_in: "danger",
  in: "success",
  on_break: "info",
  done: "neutral",
  missed_clock_out: "danger",
};

const hhmm = (local: string) => local.slice(11, 16);

/**
 * M11.1: Who's in for a site and a day, with flags, for managers. Staff
 * without attendance access clock in on My shifts.
 */
export default async function AttendancePage({
  searchParams,
}: PageProps<"/attendance">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const p = await searchParams;
  const sites = await attendanceApi.sites(ws);
  if (sites.length === 0 && (await attendanceApi.mine(ws)))
    redirect("/rota/me#clock");
  if (sites.length === 0)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Attendance" />
        <EmptyState icon={Clock} title="No attendance you can see">
          Attendance is managed by owners, administrators, HR managers and site
          managers.
        </EmptyState>
      </div>
    );
  const siteId =
    typeof p.site === "string" && sites.some((s) => s.id === p.site)
      ? p.site
      : sites[0]!.id;
  const w = await attendanceApi.whosIn(ws, siteId, p.day);
  if (!w) throw new Error("Attendance unavailable");
  const href = (day: string) =>
    `/attendance?site=${encodeURIComponent(w.site.id)}&day=${day}` as const;
  const counts = {
    in: w.rows.filter((r) => r.status === "in" || r.status === "on_break")
      .length,
    attention: w.rows.filter((r) =>
      ["late", "no_clock_in", "missed_clock_out"].includes(r.status),
    ).length,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Who's in, against the published rota. Real clock times are kept; nothing is rounded and no pay is calculated."
        actions={
          w.can.manage ? (
            <RecordEntryDialog siteId={w.site.id} day={w.day} staff={w.staff} />
          ) : null
        }
      />

      <AttendanceTabs current="whos-in" siteId={w.site.id} />

      <div className="flex flex-wrap items-end gap-3">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose a site"
        >
          <input type="hidden" name="day" value={w.day} />
          <Field id="att-site" label="Site">
            <Select id="att-site" name="site" defaultValue={w.site.id}>
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
        <nav aria-label="Change day" className="flex items-center gap-2">
          <Link
            href={href(w.previousDay)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous<span className="sr-only"> day</span>
          </Link>
          <span className="px-2 text-sm font-semibold" aria-live="polite">
            {dayLabel(w.day)}
            {w.day === w.today ? " (today)" : ""}
          </span>
          <Link
            href={href(w.nextDay)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            Next<span className="sr-only"> day</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
          {w.day !== w.today ? (
            <Link
              href={href(w.today)}
              className="inline-flex min-h-11 items-center rounded-[10px] px-3 text-sm font-semibold text-forest underline-offset-4 hover:underline"
            >
              Today
            </Link>
          ) : null}
        </nav>
      </div>

      <p className="text-sm" role="status">
        {counts.in} in now · {counts.attention} need
        {counts.attention === 1 ? "s" : ""} attention · {w.rows.length} on the
        list
      </p>

      {w.rows.length === 0 ? (
        <EmptyState icon={Clock} title="Nobody rostered or clocked in">
          Published shifts for this day and anyone who clocks in here appear on
          this list.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Who's in">
          {w.rows.map((r) => (
            <li
              key={r.employeeId}
              className="flex flex-col gap-2 rounded-[10px] border border-line-strong p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-semibold">{r.name}</p>
                <Badge tone={STATUS_TONE[r.status]}>
                  {STATUS_LABELS[r.status]}
                </Badge>
              </div>
              <p className="text-ink-muted">
                {r.shifts.length
                  ? `Rota: ${r.shifts
                      .map(
                        (s) =>
                          `${hhmm(s.start)}–${hhmm(s.end)}${s.roleLabel ? ` (${s.roleLabel})` : ""}`,
                      )
                      .join(", ")}`
                  : "Not on the published rota"}
              </p>
              {r.entries.map((e) => {
                const summary = `${r.name}, in ${hhmm(e.clockIn)}${e.clockOut ? `, out ${hhmm(e.clockOut)}` : ""}`;
                return (
                  <div
                    key={e.id}
                    className="flex flex-col gap-2 border-t border-line pt-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p>
                        <span className="font-semibold">
                          {e.clockIn.slice(0, 10) !== w.day
                            ? `${dayLabel(e.clockIn.slice(0, 10))} `
                            : ""}
                          In {hhmm(e.clockIn)}
                        </span>
                        {" · "}
                        {e.clockOut ? `Out ${hhmm(e.clockOut)}` : "Still in"}
                        {" · "}
                        {minutesLabel(e.workedMinutes)} worked
                        {e.breakMinutes ? ` · ${e.breakMinutes} min break` : ""}
                      </p>
                      {e.flags.map((f) => (
                        <Badge
                          key={f}
                          tone={
                            f === "corrected"
                              ? "info"
                              : f === "missed_clock_out"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {FLAG_LABELS[f]}
                        </Badge>
                      ))}
                    </div>
                    {e.history.length ? (
                      <details className="text-ink-muted">
                        <summary className="cursor-pointer">History</summary>
                        <ul className="mt-1 flex flex-col gap-1">
                          {e.history.map((h) => (
                            <li key={h.id}>
                              {h.at}: {h.kind}
                              {h.from ? ` from ${h.from}` : ""}
                              {h.to ? ` to ${h.to}` : ""}. {h.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {w.can.manage ? (
                      <EntryActions
                        entryId={e.id}
                        summary={summary}
                        clockIn={e.clockIn}
                        clockOut={e.clockOut}
                      />
                    ) : null}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}

      {w.can.settings ? (
        <Card aria-labelledby="att-settings" className="gap-3">
          <CardTitle id="att-settings">Flag settings</CardTitle>
          <p className="text-sm text-ink-muted">
            These only decide what gets flagged for review. They never change a
            recorded time.
          </p>
          <SettingsForm
            toleranceMinutes={w.limits.toleranceMinutes}
            missedClockOutHours={w.limits.missedClockOutHours}
          />
        </Card>
      ) : null}
    </div>
  );
}
