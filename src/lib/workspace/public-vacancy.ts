import type { DbClient } from "@/lib/db/create-client";
import { isPublicCode } from "@/modules/recruitment";

// The public vacancy page (M9.2a) has no signed-in organisation. It reads
// through app.public_vacancy(code, source), a SECURITY DEFINER function that
// returns only the published fields of an open vacancy (or that it's closed)
// and counts link and QR views. No applicant data is collected.

export type PublicVacancy =
  | { state: "missing" }
  | { state: "closed"; organisation: string; title: string }
  | {
      state: "open";
      organisation: string;
      title: string;
      siteName: string;
      employmentType: string;
      description: string | null;
      howToApply: string | null;
      closesOn: string | null;
      pay: { min: string; max: string | null; period: string } | null;
    };

const money = (v: unknown) =>
  v === null || v === undefined ? null : Number(v).toFixed(2);

export async function publicVacancy(
  client: DbClient,
  code: string,
  source: "link" | "qr" | "none",
): Promise<PublicVacancy> {
  if (!isPublicCode(code)) return { state: "missing" };
  const [row] = await client.$queryRaw<
    {
      state: "open" | "closed";
      organisation: string;
      title: string;
      site_name: string | null;
      employment_type: string | null;
      description: string | null;
      how_to_apply: string | null;
      closes_on: Date | null;
      pay_min: unknown;
      pay_max: unknown;
      pay_period: string | null;
    }[]
  >`SELECT state, organisation, title, site_name, employment_type, description, how_to_apply,
           closes_on, pay_min, pay_max, pay_period
    FROM app.public_vacancy(${code}, ${source})`;
  if (!row) return { state: "missing" };
  if (row.state === "closed")
    return {
      state: "closed",
      organisation: row.organisation,
      title: row.title,
    };
  const min = money(row.pay_min);
  return {
    state: "open",
    organisation: row.organisation,
    title: row.title,
    siteName: row.site_name ?? "",
    employmentType: row.employment_type ?? "",
    description: row.description,
    howToApply: row.how_to_apply,
    closesOn: row.closes_on ? row.closes_on.toISOString().slice(0, 10) : null,
    pay:
      min && row.pay_period
        ? { min, max: money(row.pay_max), period: row.pay_period }
        : null,
  };
}
