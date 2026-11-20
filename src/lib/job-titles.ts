// Job titles (M16). Each organisation may keep a list of job titles. Once it
// has any, every place a job title is entered (staff records, vacancies,
// training rules, onboarding templates, starter packs) accepts only a title
// from the list, stored with the list's exact spelling. Organisations without
// a list type titles freely, as before.
//
// Used inside a withTenant() transaction, so RLS limits it to one organisation.

import type { TenantTx } from "@/lib/tenancy";

export const normaliseTitle = (s: string) =>
  s.replace(/\s+/g, " ").trim().toLowerCase();

/** The organisation's live job titles, A to Z (empty: no list kept). */
export async function liveJobTitles(tx: TenantTx): Promise<string[]> {
  const rows = await tx.jobTitle.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

export type TitleCheck =
  { ok: true; value: string | null } | { ok: false; message: string };

/**
 * Checks a job title against the list. Empty stays empty (the caller decides
 * whether a title is required). With a list, the title must match one
 * (ignoring capitals and spaces) and the list's spelling is returned.
 */
export async function checkJobTitle(
  tx: TenantTx,
  raw: string | null | undefined,
): Promise<TitleCheck> {
  const typed = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!typed) return { ok: true, value: null };
  const list = await liveJobTitles(tx);
  if (!list.length) return { ok: true, value: typed };
  const match = list.find((t) => normaliseTitle(t) === normaliseTitle(typed));
  return match
    ? { ok: true, value: match }
    : {
        ok: false,
        message:
          "Choose a job title from your organisation's list (Settings › Job titles).",
      };
}
