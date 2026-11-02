// Rota display helpers (M10.1). Pure, safe on the server and in the browser.

/** "Mon 3 Nov" for a YYYY-MM-DD date. */
export const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** "Mon 3 Nov 2026" for a YYYY-MM-DD date (week headings). */
export const weekLabel = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));

/** "7h 30m" for minutes. */
export function minutesLabel(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
