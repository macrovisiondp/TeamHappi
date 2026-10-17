import { z } from "zod";

// Validation for organisation setup (M4.2). Pure: shared by the forms (for
// field names and limits) and by the server, which always re-validates.
// Data minimisation: only what's needed to run rotas and staffing — no
// national insurance numbers, dates of birth, home addresses or documents.

const trimmed = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`);

const required = (max: number, label: string) =>
  trimmed(max, label).min(1, `Enter ${label.toLowerCase()}`);

/** "" or missing becomes null. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    schema
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  );

export const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Lagos",
  "America/New_York",
] as const;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return /^[A-Za-z_]+\/[A-Za-z_/+-]+$/.test(tz);
  } catch {
    return false;
  }
}

const timezone = z
  .string()
  .trim()
  .refine(isValidTimezone, "Choose a valid time zone");

const uuid = z.uuid("Choose an option from the list");

export const organisationSchema = z.object({
  name: required(200, "Organisation name"),
  timezone,
});

export const siteSchema = z.object({
  name: required(100, "Site name"),
  code: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[A-Z0-9][A-Z0-9-]{1,11}$/,
        "Use 2–12 letters, numbers or dashes",
      ),
  ),
  addressLine: optional(trimmed(200, "Address")),
  town: optional(trimmed(100, "Town or city")),
  postcode: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9 ]{1,9}$/, "Enter a valid postcode"),
  ),
  timezone,
});

export const teamSchema = z.object({
  name: required(80, "Team name"),
  siteId: uuid,
});

export const EMPLOYMENT_STATUSES = ["pending", "active", "left"] as const;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date")
  .refine(
    (v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
    "Enter a real date",
  );

export const employeeSchema = z
  .object({
    givenName: required(80, "First name"),
    familyName: required(80, "Last name"),
    preferredName: optional(trimmed(80, "Preferred name")),
    jobTitle: optional(trimmed(100, "Job title")),
    employeeNumber: optional(
      z
        .string()
        .trim()
        .regex(
          /^[A-Za-z0-9-]{1,20}$/,
          "Use up to 20 letters, numbers or dashes",
        ),
    ),
    email: optional(z.email("Enter a valid email address").max(254)),
    phoneNumber: optional(
      z
        .string()
        .trim()
        .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"),
    ),
    status: z.enum(EMPLOYMENT_STATUSES, "Choose a status"),
    startDate: optional(isoDate),
    endDate: optional(isoDate),
    primarySiteId: optional(uuid),
    teamIds: z.array(uuid).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.status === "left" && !v.endDate)
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Enter the date they left",
      });
    if (v.status !== "left" && v.endDate)
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Only add a leaving date when the status is Left",
      });
    if (v.startDate && v.endDate && v.endDate < v.startDate)
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "The leaving date must be on or after the start date",
      });
  });

export type OrganisationInput = z.infer<typeof organisationSchema>;
export type SiteInput = z.infer<typeof siteSchema>;
export type TeamInput = z.infer<typeof teamSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;

export type FieldErrors = Record<string, string>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** FormData → plain object; repeated keys (checkbox groups) become arrays. */
export function formToObject(
  form: FormData,
  arrays: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$")) continue; // React/Next internals
    out[key] = arrays.includes(key)
      ? form.getAll(key).map(String)
      : String(form.get(key) ?? "");
  }
  for (const key of arrays) out[key] ??= [];
  return out;
}
