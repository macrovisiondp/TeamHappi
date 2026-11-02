import { CalendarDays, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/misc";
import { Table, Td, Th } from "@/components/ui/table";
import {
  ShiftActions,
  ShiftDialog,
  WeekActions,
} from "@/features/rota/controls";
import { dayLabel, minutesLabel, weekLabel } from "@/features/rota/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { rotaApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "Rota" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

export default async function RotaPage({ searchParams }: PageProps<"/rota">) {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const p = await searchParams;
  const sites = await rotaApi.sites(ws);
  if (sites.length === 0)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Rota" description="Weekly rotas for each site." />
        <EmptyState icon={CalendarDays} title="No rotas you can see">
          Rotas are managed by owners, administrators, HR managers and site
          managers.
        </EmptyState>
      </div>
    );
  const siteId =
    typeof p.site === "string" && sites.some((s) => s.id === p.site)
      ? p.site
      : sites[0]!.id;
  const w = await rotaApi.week(ws, siteId, p.week);
  if (!w) throw new Error("Rota unavailable");
  const href = (week: string) =>
    `/rota?site=${encodeURIComponent(w.site.id)}&week=${week}` as const;
  const active = w.shifts.filter((s) => !s.cancelled);
  const people = w.people.map((x) => ({
    id: x.id,
    name: x.name,
    jobTitle: x.jobTitle,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rota"
        description="Plan the week for each site, then publish it. Hours only: no pay is calculated here."
        actions={
          w.can.manage ? (
            <ShiftDialog
              siteId={w.site.id}
              weekStart={w.weekStart}
              days={w.days}
              teams={w.teams}
              label="Add shift"
            />
          ) : null
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <form
          method="get"
          className="flex flex-wrap items-end gap-3"
          aria-label="Choose a site"
        >
          <input type="hidden" name="week" value={w.weekStart} />
          <Field id="rota-site" label="Site">
            <Select id="rota-site" name="site" defaultValue={w.site.id}>
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
            href={href(w.previousWeek)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Previous<span className="sr-only"> week</span>
          </Link>
          <span className="px-2 text-sm font-semibold" aria-live="polite">
            Week of {weekLabel(w.weekStart)}
          </span>
          <Link
            href={href(w.nextWeek)}
            className="inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-sm font-semibold"
          >
            Next<span className="sr-only"> week</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        </nav>
      </div>

      <Card aria-labelledby="week-heading" className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id="week-heading">
              {w.site.name}: week of {weekLabel(w.weekStart)}
            </CardTitle>
            <Badge tone={w.status === "published" ? "success" : "neutral"}>
              {w.status === "published" ? "Published" : "Draft"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <WeekActions
              siteId={w.site.id}
              weekStart={w.weekStart}
              canCopy={w.can.manage && active.length === 0}
              canPublish={
                w.can.publish && w.status === "draft" && active.length > 0
              }
              shifts={active.length}
            />
            {active.length ? (
              <Link
                href={`/print/rota?site=${encodeURIComponent(w.site.id)}&week=${w.weekStart}`}
                target="_blank"
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-sm font-semibold"
              >
                <Printer aria-hidden="true" className="size-4" />
                Print<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            ) : null}
          </div>
        </div>
        <p className="text-sm text-ink-muted">
          {active.length} shift{active.length === 1 ? "" : "s"} ·{" "}
          {minutesLabel(w.totalMinutes)} planned · {w.openShifts} open
          {w.status === "draft"
            ? " · Staff can't see this week until it's published."
            : ""}
        </p>
      </Card>

      {w.shifts.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No shifts this week">
          {w.can.manage
            ? "Add shifts, or copy last week's."
            : "Nothing has been planned for this week yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
          {w.days.map((day) => {
            const dayShifts = w.shifts.filter((s) => s.day === day);
            return (
              <section
                key={day}
                aria-labelledby={`day-${day}`}
                className="flex flex-col gap-2"
              >
                <h2 id={`day-${day}`} className="text-sm font-semibold">
                  {dayLabel(day)}
                </h2>
                {dayShifts.length === 0 ? (
                  <p className="text-sm text-ink-muted">No shifts</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {dayShifts.map((s) => {
                      const summary = `${dayLabel(s.day)}, ${s.start} to ${s.end}${s.roleLabel ? `, ${s.roleLabel}` : ""}`;
                      const blocking = s.warnings.filter((x) => x.blocking);
                      return (
                        <li
                          key={s.id}
                          className={`flex flex-col gap-2 rounded-[10px] border p-3 text-sm ${s.cancelled ? "border-line opacity-60" : "border-line-strong"}`}
                        >
                          <p className="font-semibold">
                            {s.start}–{s.end}
                            {s.cancelled ? " (cancelled)" : ""}
                          </p>
                          <p className="text-ink-muted">
                            {[
                              s.roleLabel,
                              s.teamName,
                              `${minutesLabel(s.minutes)}${s.breakMinutes ? `, ${s.breakMinutes} min break` : ""}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                          <p>
                            {s.assignee ? (
                              <span className="font-semibold">
                                {s.assignee.name}
                              </span>
                            ) : (
                              <Badge tone="warning">Open</Badge>
                            )}
                          </p>
                          {s.note ? (
                            <p className="whitespace-pre-line text-ink-muted">
                              {s.note}
                            </p>
                          ) : null}
                          {s.warnings.length ? (
                            <ul
                              className="flex flex-col gap-1"
                              aria-label={`Checks for ${summary}`}
                            >
                              {s.warnings.map((x) => (
                                <li key={x.code}>
                                  <Badge
                                    tone={x.blocking ? "danger" : "warning"}
                                  >
                                    {x.message}
                                  </Badge>
                                </li>
                              ))}
                              {s.assignee?.overridden && !blocking.length ? (
                                <li className="text-xs text-ink-muted">
                                  Assigned anyway, with a reason recorded.
                                </li>
                              ) : null}
                            </ul>
                          ) : null}
                          {w.can.manage && !s.cancelled ? (
                            <div className="flex flex-col gap-2">
                              <ShiftDialog
                                siteId={w.site.id}
                                weekStart={w.weekStart}
                                days={w.days}
                                teams={w.teams}
                                label="Edit"
                                shift={{
                                  id: s.id,
                                  day: s.day,
                                  start: s.start,
                                  end: s.end,
                                  breakMinutes: s.breakMinutes,
                                  teamId: s.teamId,
                                  roleLabel: s.roleLabel,
                                  note: s.note,
                                }}
                              />
                              <ShiftActions
                                shiftId={s.id}
                                summary={summary}
                                people={people}
                                assigneeId={s.assignee?.id ?? null}
                              />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {w.people.length ? (
        <Card aria-labelledby="hours-heading">
          <CardTitle id="hours-heading">Hours this week</CardTitle>
          <Table caption={`Planned hours at ${w.site.name}`}>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Job title</Th>
                <Th>Planned</Th>
              </tr>
            </thead>
            <tbody>
              {[...w.people]
                .sort((a, b) => b.minutes - a.minutes)
                .map((x) => (
                  <tr key={x.id}>
                    <Td className="font-semibold">{x.name}</Td>
                    <Td>{x.jobTitle ?? "–"}</Td>
                    <Td>{x.minutes ? x.hours : "–"}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
          <p className="text-xs text-ink-muted">
            Working-time checks are guidance for managers, not legal advice.
            Rules for workers under 18 aren&rsquo;t checked.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
