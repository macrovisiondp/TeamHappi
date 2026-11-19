import Link from "next/link";

/** Switches between Who's in and Timesheets, keeping the site. */
export function AttendanceTabs({
  current,
  siteId,
}: {
  current: "whos-in" | "timesheets";
  siteId: string;
}) {
  const tabs = [
    {
      key: "whos-in",
      label: "Who's in",
      href: `/attendance?site=${encodeURIComponent(siteId)}`,
    },
    {
      key: "timesheets",
      label: "Timesheets",
      href: `/attendance/timesheets?site=${encodeURIComponent(siteId)}`,
    },
  ] as const;
  return (
    <nav
      aria-label="Attendance views"
      className="flex gap-2 border-b border-line"
    >
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={current === t.key ? "page" : undefined}
          className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold ${current === t.key ? "border-forest text-forest" : "border-transparent text-ink-muted"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
