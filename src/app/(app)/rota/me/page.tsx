import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/misc";
import { ClockButtons } from "@/features/attendance/controls";
import {
  MarkShiftsSeen,
  MyChangeControls,
  MyShiftButton,
  RemoveUnavailability,
  SwapOfferButtons,
  UnavailabilityForm,
} from "@/features/rota/controls";
import { dayLabel, minutesLabel, weekLabel } from "@/features/rota/labels";
import {
  NoOrganisation,
  requireWorkspace,
} from "@/features/workspace/components";
import { attendanceApi, rotaApi } from "@/lib/workspace";

export const metadata: Metadata = { title: "My shifts" };

// Session-gated (see (app)/layout.tsx): renders per request, not prefetch-validated.
export const instant = false;

/**
 * M10.2: a person's own published shifts, phone first. Reached through their
 * own linked record (ownership), never through a role.
 */
export default async function MyShiftsPage() {
  const ws = await requireWorkspace();
  if (ws.kind === "none") return <NoOrganisation blocked={ws.blocked} />;
  const [me, clock] = await Promise.all([
    rotaApi.mine(ws),
    attendanceApi.mine(ws),
  ]);

  if (!me)
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="My shifts" />
        <EmptyState icon={CalendarDays} title="Nothing to show yet">
          Your TeamHappi login isn&rsquo;t linked to a staff record. Ask your
          manager to invite you from your record.
        </EmptyState>
      </div>
    );

  const total = me.shifts
    .filter((s) => !s.past)
    .reduce((sum, s) => sum + s.minutes, 0);
  return (
    <div className="flex flex-col gap-6">
      <MarkShiftsSeen />
      <PageHeader
        title="My shifts"
        description={`Hi ${me.firstName}. Your published shifts for the next four weeks.`}
      />

      {clock ? (
        <Card id="clock" aria-labelledby="clock-heading" className="gap-3">
          <CardTitle id="clock-heading">
            {clock.open
              ? clock.open.onBreak
                ? `On a break · in since ${clock.open.since}`
                : `Clocked in since ${clock.open.since}`
              : "Not clocked in"}
          </CardTitle>
          <p className="text-sm text-ink-muted">
            {clock.open
              ? `At ${clock.open.siteName}. Breaks are optional; record them if you take one.`
              : clock.next
                ? `Next shift: ${dayLabel(clock.next.day)}, ${clock.next.start}–${clock.next.end} at ${clock.next.siteName}.`
                : "No shift coming up. You can still clock in; your manager will see it has no shift."}
          </p>
          {clock.open?.tooLong ? (
            <Alert tone="warning" title="Clocked in for over 24 hours">
              Ask your manager to enter the time you left.
            </Alert>
          ) : clock.canClock ? (
            <ClockButtons
              clockedIn={Boolean(clock.open)}
              onBreak={Boolean(clock.open?.onBreak)}
            />
          ) : (
            <p className="text-sm">
              You have no home site yet, so ask your manager to record your
              times.
            </p>
          )}
          {clock.recent.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold">
                Your times, last 14 days
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {clock.recent.map((r) => (
                  <li key={r.id}>
                    {dayLabel(r.day)}, {r.clockIn}–{r.clockOut ?? "now"} ·{" "}
                    {minutesLabel(r.workedMinutes)}
                    {r.breakMinutes
                      ? ` · ${r.breakMinutes} min break`
                      : ""} · {r.siteName}
                    {r.flags.includes("corrected")
                      ? " · corrected by your manager"
                      : ""}
                    {r.flags.includes("missed_clock_out")
                      ? " · missed clock-out"
                      : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}

      {me.updates ? (
        <Alert
          tone="info"
          title={`${me.updates} update${me.updates === 1 ? "" : "s"} since you last looked`}
          role="status"
        >
          New and changed shifts are marked below.
        </Alert>
      ) : null}

      {me.removed.length ? (
        <Card aria-labelledby="removed-heading" className="gap-2">
          <CardTitle id="removed-heading">No longer yours</CardTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {me.removed.map((r) => (
              <li key={r.shiftId}>
                {r.when}, {r.site}:{" "}
                <span className="font-semibold">
                  {r.kind === "cancelled"
                    ? "cancelled"
                    : "you're not on this shift any more"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {me.weeks.map((week) => {
        const shifts = me.shifts.filter((s) => s.weekStart === week);
        return (
          <section
            key={week}
            aria-labelledby={`week-${week}`}
            className="flex flex-col gap-2"
          >
            <h2 id={`week-${week}`} className="text-lg font-semibold">
              Week of {weekLabel(week)}
            </h2>
            {shifts.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No published shifts for you.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {shifts.map((s) => (
                  <li
                    key={s.id}
                    className={`flex flex-col gap-1 rounded-[10px] border p-3 text-sm ${s.flag ? "border-forest" : "border-line-strong"} ${s.past ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-semibold">
                        {dayLabel(s.day)}, {s.start}–{s.end}
                      </p>
                      {s.flag === "new" ? (
                        <Badge tone="success">New</Badge>
                      ) : null}
                      {s.flag === "changed" ? (
                        <Badge tone="warning">Changed</Badge>
                      ) : null}
                    </div>
                    <p className="text-ink-muted">
                      {[
                        s.siteName,
                        s.roleLabel,
                        s.teamName,
                        `${minutesLabel(s.minutes)}${s.breakMinutes ? `, ${s.breakMinutes} min break` : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {s.note ? (
                      <p className="whitespace-pre-line">{s.note}</p>
                    ) : null}
                    {s.past ? null : (
                      <MyChangeControls
                        shiftId={s.id}
                        summary={`${dayLabel(s.day)}, ${s.start} to ${s.end}`}
                        change={s.change}
                        colleagues={me.colleagues}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <p className="text-sm text-ink-muted">
        {minutesLabel(total)} still to work in these weeks. Changes your manager
        makes show up here; ask them if anything looks wrong.
      </p>

      {me.swapOffers.length ? (
        <section
          aria-labelledby="offers-heading"
          className="flex flex-col gap-2"
        >
          <h2 id="offers-heading" className="text-lg font-semibold">
            Shifts offered to you
          </h2>
          <ul className="flex flex-col gap-2">
            {me.swapOffers.map((o) => {
              const summary = `${dayLabel(o.day)}, ${o.start} to ${o.end}`;
              return (
                <li
                  key={o.requestId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-forest p-3 text-sm"
                >
                  <div>
                    <p className="font-semibold">
                      {dayLabel(o.day)}, {o.start}–{o.end}
                    </p>
                    <p className="text-ink-muted">
                      {[o.siteName, o.roleLabel, minutesLabel(o.minutes)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p>{o.from} would like you to take this shift.</p>
                  </div>
                  <SwapOfferButtons requestId={o.requestId} summary={summary} />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="open-heading" className="flex flex-col gap-2">
        <h2 id="open-heading" className="text-lg font-semibold">
          Open shifts{me.siteName ? ` at ${me.siteName}` : ""}
        </h2>
        {me.openShifts.length === 0 ? (
          <p className="text-sm text-ink-muted">No open shifts right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {me.openShifts.map((s) => {
              const summary = `${dayLabel(s.day)}, ${s.start} to ${s.end}`;
              return (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line-strong p-3 text-sm"
                >
                  <div>
                    <p className="font-semibold">
                      {dayLabel(s.day)}, {s.start}–{s.end}
                    </p>
                    <p className="text-ink-muted">
                      {[s.roleLabel, s.teamName, minutesLabel(s.minutes)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {s.requestId ? (
                      <p className="font-semibold text-forest">
                        You&rsquo;ve asked for this shift.
                      </p>
                    ) : null}
                  </div>
                  <MyShiftButton
                    shiftId={s.id}
                    requestId={s.requestId}
                    summary={summary}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="availability-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="availability-heading" className="text-lg font-semibold">
          When you can&rsquo;t work
        </h2>
        <p className="text-sm text-ink-muted">
          Your manager sees a warning if they plan you then. They can still put
          you on a shift with a recorded reason, so tell them about anything
          important.
        </p>
        {me.unavailability.length ? (
          <ul className="flex flex-col gap-2">
            {me.unavailability.map((u) => (
              <li
                key={u.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line-strong p-3 text-sm"
              >
                <div>
                  <p className="font-semibold">{u.label}</p>
                  {u.note ? <p className="text-ink-muted">{u.note}</p> : null}
                </div>
                <RemoveUnavailability id={u.id} label={u.label} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">Nothing added yet.</p>
        )}
        <Card aria-labelledby="add-unav-heading" className="gap-3">
          <CardTitle id="add-unav-heading">
            Add a time you can&rsquo;t work
          </CardTitle>
          <UnavailabilityForm />
        </Card>
      </section>
    </div>
  );
}
