// UK formatting: en-GB locale, Europe/London time zone, 24-hour clock.

const TZ = "Europe/London";

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TZ,
});

/** "12 Oct 2026" */
export function formatDate(value: Date | string): string {
  return dateFmt.format(new Date(value));
}

/** "Monday 12 October" */
export function formatDay(value: Date | string): string {
  return dayFmt.format(new Date(value));
}

/** "09:30" */
export function formatTime(value: Date | string): string {
  return timeFmt.format(new Date(value));
}

/** "09:30–17:00" (en dash) */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

/** Whole days from `from` to `to` (negative if `to` is in the past). */
export function daysBetween(from: Date | string, to: Date | string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.round(ms / 86_400_000);
}
