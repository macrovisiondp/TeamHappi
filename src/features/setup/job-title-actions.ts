"use server";

import { getWorkspace, jobTitlesApi } from "@/lib/workspace";

import type { FormState } from "./form-state";

// Job-title list (M16). The organisation and the member come from the session;
// the permission (tenant.settings.manage) is checked by the workspace layer.

export async function jobTitleAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready")
    return {
      status: "error",
      message: "Your session or access has changed. Sign in again and retry.",
    };
  const intent = String(form.get("intent") ?? "");
  if (intent === "add") {
    const r = await jobTitlesApi.add(ws, String(form.get("names") ?? ""));
    if (!r.ok)
      return {
        status: "error",
        message: r.message,
        fieldErrors: r.fieldErrors,
      };
    return {
      status: "saved",
      message:
        r.added === 0
          ? "Those job titles are already on the list."
          : `Added ${r.added} job title${r.added === 1 ? "" : "s"}.`,
    };
  }
  if (intent === "archive") {
    const r = await jobTitlesApi.archive(ws, String(form.get("id") ?? ""));
    return r.ok
      ? {
          status: "saved",
          message:
            "Removed from the list. People who have it keep it until their record is edited.",
        }
      : { status: "error", message: r.message };
  }
  return { status: "error", message: "Unknown action." };
}
