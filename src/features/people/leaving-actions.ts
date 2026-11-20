"use server";

import { getWorkspace, leavingApi } from "@/lib/workspace";

// Offboarding (M18). The organisation and member come from the session; who
// may record a leaving is checked by the workspace layer.

export type LeavingState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

const SIGNED_OUT: LeavingState = {
  status: "error",
  message: "Please sign in again, then try once more.",
};

export async function leavingAction(
  _prev: LeavingState,
  form: FormData,
): Promise<LeavingState> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return SIGNED_OUT;
  const employeeId = String(form.get("employeeId") ?? "");
  const intent = String(form.get("intent") ?? "");
  const done = (
    r:
      | { ok: true }
      | { ok: false; message: string; fieldErrors?: Record<string, string> },
    message: string,
  ): LeavingState =>
    r.ok
      ? { status: "saved", message }
      : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
  if (intent === "mark") {
    const endNow = form.get("endNow") === "on";
    return done(
      await leavingApi.mark(ws, employeeId, {
        lastDay: String(form.get("lastDay") ?? ""),
        reason: String(form.get("reason") ?? ""),
        note: String(form.get("note") ?? ""),
        templateId: String(form.get("templateId") ?? "") || null,
        endNow,
      }),
      endNow
        ? "Leaving recorded and their access has ended"
        : "Leaving recorded",
    );
  }
  if (intent === "cancel")
    return done(await leavingApi.cancel(ws, employeeId), "Leaving cancelled");
  if (intent === "end-now")
    return done(
      await leavingApi.endNow(ws, employeeId),
      "Their access has ended",
    );
  return { status: "error", message: "Please try again." };
}
