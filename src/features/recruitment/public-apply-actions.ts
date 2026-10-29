"use server";

import { headers } from "next/headers";

import { applyOnline } from "@/lib/workspace";

// Online application from a vacancy's share link (M9.3). Anyone with the link
// may call this: the database function decides whether the vacancy is open,
// applies the rate limits and refuses duplicates. Nothing here trusts the
// browser beyond the form values, which are checked again on the server.

export type PublicApplyState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
    }
  | { status: "received"; cv: "attached" | "none" | "failed" };

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function applyOnlineAction(
  _prev: PublicApplyState,
  form: FormData,
): Promise<PublicApplyState> {
  // Hidden trap field: people never see it; simple bots fill it in. Pretend
  // it worked so they learn nothing.
  if (str(form, "website")) return { status: "received", cv: "none" };
  const h = await headers();
  const clientAddress =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip")?.trim() ||
    "unknown";
  const raw = form.get("cv");
  const file =
    raw instanceof File && raw.size > 0
      ? { name: raw.name, bytes: new Uint8Array(await raw.arrayBuffer()) }
      : null;
  const r = await applyOnline({
    code: str(form, "code"),
    fields: {
      givenName: str(form, "givenName"),
      familyName: str(form, "familyName"),
      email: str(form, "email"),
      phone: str(form, "phone"),
      consent: str(form, "consent"),
    },
    file,
    clientAddress,
  });
  switch (r.kind) {
    case "received":
      return { status: "received", cv: r.cv };
    case "invalid":
      return {
        status: "error",
        message: "Check the highlighted fields.",
        fieldErrors: r.fieldErrors,
      };
    case "limited":
      return {
        status: "error",
        message:
          "Too many applications from this device. Please try again in an hour.",
      };
    case "closed":
      return {
        status: "error",
        message: "Sorry, this role is no longer accepting applications.",
      };
    default:
      return {
        status: "error",
        message: "This job link isn't available any more.",
      };
  }
}
