// Online applications on a vacancy's share link (M9.3): the rules for what a
// candidate may submit. Writing happens in app.public_apply (the public page
// has no organisation context); see src/lib/workspace/public-application.ts.

import { z } from "zod";

/** Bump when the privacy notice text changes; stored with each application. */
export const PRIVACY_NOTICE_VERSION = "2026-10-29";

const name = (what: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter your ${what}`)
    .max(100, `Your ${what} can be up to 100 characters`);

export const publicApplicationSchema = z.object({
  givenName: name("first name"),
  familyName: name("last name"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Enter a shorter email address")
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .max(30, "Enter a phone number of up to 30 characters")
    .refine((v) => v === "" || /^[0-9+()\s-]{5,30}$/.test(v), {
      message: "Enter a valid phone number",
    }),
  consent: z.literal("on", {
    error: "Confirm you've read the privacy notice",
  }),
});

export type PublicApplication = z.infer<typeof publicApplicationSchema>;

export function parsePublicApplication(
  raw: Record<string, unknown>,
):
  | { ok: true; data: PublicApplication }
  | { ok: false; fieldErrors: Record<string, string> } {
  const r = publicApplicationSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return {
    ok: false,
    fieldErrors: Object.fromEntries(
      r.error.issues.map((i) => [String(i.path[0] ?? "form"), i.message]),
    ),
  };
}
