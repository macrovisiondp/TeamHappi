import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { dayLabel, minutesLabel, weekLabel } from "@/features/rota/labels";
import { PrintRotaButton } from "@/features/rota/print-button";
import { requireWorkspace } from "@/features/workspace/components";
import { rotaApi } from "@/lib/workspace";

export const metadata: Metadata = {
  title: "Printable rota",
  robots: { index: false, follow: false },
};

// Session-gated: renders per request, not prefetch-validated.
export const instant = false;

/**
 * A printable week (M10.1) for the staff room, including people without a
 * TeamHappi login (D8). Same access as the rota page.
 */
export default function PrintRotaPage({
  searchParams,
}: PageProps<"/print/rota">) {
  return (
    <Suspense fallback={<p className="p-8">Preparing the rota…</p>}>
      <PrintRota searchParams={searchParams} />
    </Suspense>
  );
}

async function PrintRota({
  searchParams,
}: {
  searchParams: PageProps<"/print/rota">["searchParams"];
}) {
  const ws = await requireWorkspace();
  if (ws.kind !== "ready") notFound();
  const p = await searchParams;
  const w = await rotaApi.week(ws, p.site, p.week);
  if (!w) notFound();
  const active = w.shifts.filter((s) => !s.cancelled);
  const rows = w.people.filter((x) =>
    active.some((s) => s.assignee?.id === x.id),
  );
  const open = active.filter((s) => !s.assignee);
  const cell = (list: typeof active) =>
    list
      .map((s) => `${s.start}–${s.end}${s.roleLabel ? ` ${s.roleLabel}` : ""}`)
      .join(", ");
  return (
    <div className="mx-auto flex max-w-[297mm] flex-col gap-4 p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/rota?site=${encodeURIComponent(w.site.id)}&week=${w.weekStart}`}
          className="text-sm font-semibold text-forest underline-offset-4 hover:underline"
        >
          Back to the rota
        </Link>
        <PrintRotaButton />
      </div>
      <h1 className="text-2xl font-bold">
        {w.site.name}: week of {weekLabel(w.weekStart)}
      </h1>
      <p className="text-sm">
        {w.status === "published" ? "Published" : "Draft: not final"} ·{" "}
        {minutesLabel(w.totalMinutes)} planned
      </p>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Shifts by person and day</caption>
        <thead>
          <tr>
            <th scope="col" className="border border-ink/40 p-2 text-left">
              Person
            </th>
            {w.days.map((d) => (
              <th
                key={d}
                scope="col"
                className="border border-ink/40 p-2 text-left"
              >
                {dayLabel(d)}
              </th>
            ))}
            <th scope="col" className="border border-ink/40 p-2 text-left">
              Hours
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id}>
              <th scope="row" className="border border-ink/40 p-2 text-left">
                {x.name}
              </th>
              {w.days.map((d) => (
                <td key={d} className="border border-ink/40 p-2 align-top">
                  {cell(
                    active.filter(
                      (s) => s.day === d && s.assignee?.id === x.id,
                    ),
                  )}
                </td>
              ))}
              <td className="border border-ink/40 p-2">{x.hours}</td>
            </tr>
          ))}
          {open.length ? (
            <tr>
              <th scope="row" className="border border-ink/40 p-2 text-left">
                Open shifts
              </th>
              {w.days.map((d) => (
                <td key={d} className="border border-ink/40 p-2 align-top">
                  {cell(open.filter((s) => s.day === d))}
                </td>
              ))}
              <td className="border border-ink/40 p-2" />
            </tr>
          ) : null}
        </tbody>
      </table>
      <p className="text-xs">
        Printed from TeamHappi. Check with your manager for any changes.
      </p>
    </div>
  );
}
