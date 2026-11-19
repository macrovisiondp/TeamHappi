"use server";

import { getWorkspace, offerApi, publicOffer } from "@/lib/workspace";

// Offer letters (M14.3). Staff actions take the organisation from the session
// and re-check permission (recruitment.hire at the vacancy's site). The
// applicant's actions take only the link's token, which the database checks.

export type OfferFormState =
  | { status: "idle" }
  | { status: "saved"; message: string; link?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}
const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function offerCommandAction(
  _prev: OfferFormState,
  form: FormData,
): Promise<OfferFormState> {
  const ws = await ready();
  if (!ws)
    return {
      status: "error",
      message: "Your session or access has changed. Sign in again and retry.",
    };
  if (str(form, "intent") === "withdraw") {
    const r = await offerApi.withdraw(ws, str(form, "offerId"));
    return r.ok
      ? {
          status: "saved",
          message: "Offer withdrawn. Its link no longer works.",
        }
      : { status: "error", message: r.message };
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0)
    return {
      status: "error",
      message: "Choose the offer letter (PDF).",
      fieldErrors: { file: "Choose a PDF" },
    };
  const r = await offerApi.send(
    ws,
    str(form, "applicationId"),
    str(form, "title"),
    {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    },
  );
  if (!r.ok)
    return { status: "error", message: r.message, fieldErrors: r.fieldErrors };
  return r.data.emailed
    ? {
        status: "saved",
        message:
          "Offer emailed to the candidate. They accept or decline from the link.",
      }
    : {
        status: "saved",
        message:
          "Offer saved, but email isn't set up, so send the candidate this private link yourself:",
        link: r.data.link,
      };
}

export type PublicOfferState =
  | { status: "idle" }
  | { status: "done"; outcome: "accepted" | "declined" }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

/** What the applicant sees for their link (no file locations). */
export async function lookupOfferAction(token: string) {
  const o = await publicOffer.view(token);
  return o.state === "missing"
    ? o
    : { ...o, expiresAt: o.expiresAt.toISOString() };
}

export async function respondOfferAction(
  _prev: PublicOfferState,
  form: FormData,
): Promise<PublicOfferState> {
  const r = await publicOffer.respond(
    str(form, "token"),
    str(form, "decision"),
    str(form, "name"),
    form.get("agree") === "on",
  );
  return r.ok
    ? { status: "done", outcome: r.outcome }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}
