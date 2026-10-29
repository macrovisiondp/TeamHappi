"use server";

import type { FormState } from "@/features/setup/form-state";
import { getWorkspace, trainingApi } from "@/lib/workspace";

// Server actions for training (M8.1). The organisation and the acting member
// always come from the server session; every id in a form is untrusted and is
// re-checked by the training module (permission, site scope, RLS).

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: FormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res = Awaited<ReturnType<typeof trainingApi.saveCourse>>;

function toState(r: Res, message: string, href?: string): FormState {
  return r.ok
    ? { status: "saved", message, href }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function saveTrainingCourse(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "id") || null;
  const r = await trainingApi.saveCourse(ws, id, {
    name: str(form, "name"),
    description: str(form, "description"),
    category: str(form, "category"),
    kind: str(form, "kind"),
    completionMethod: str(form, "completionMethod"),
    certificateExpected: form.get("certificateExpected") === "on",
    validityMonths: str(form, "validityMonths"),
    warnDays: str(form, "warnDays") || "60",
    content: str(form, "content"),
  });
  return toState(
    r,
    id ? "Course saved." : "Course created. Now add who needs it.",
    !id && r.ok ? `/training/courses/${r.data.id}` : undefined,
  );
}

export async function trainingCourseCommand(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const courseId = str(form, "courseId");
  const intent = str(form, "intent");
  if (intent === "archive")
    return toState(
      await trainingApi.archiveCourse(ws, courseId),
      "Course archived. Its rules no longer apply; records are kept.",
      "/training/courses",
    );
  if (intent === "add-rule")
    return toState(
      await trainingApi.saveRule(ws, courseId, null, {
        scope: str(form, "scope"),
        siteId: str(form, "siteId") || null,
        jobTitle: str(form, "jobTitle"),
        employeeId: str(form, "employeeId") || null,
        mandatory: str(form, "mandatory") === "mandatory",
        dueDays: str(form, "dueDays") || "0",
      }),
      "Rule added.",
    );
  if (intent === "edit-rule")
    return toState(
      await trainingApi.saveRule(ws, courseId, str(form, "ruleId"), {
        mandatory: str(form, "mandatory") === "mandatory",
        dueDays: str(form, "dueDays") || "0",
      }),
      "Rule saved.",
    );
  if (intent === "remove-rule")
    return toState(
      await trainingApi.archiveRule(ws, courseId, str(form, "ruleId")),
      "Rule removed. Completion records are kept.",
    );
  if (intent === "add-suggested") {
    const r = await trainingApi.addSuggested(ws);
    return r.ok
      ? {
          status: "saved",
          message:
            r.data.added === 0
              ? "The suggested courses are already in your catalogue."
              : `Added ${r.data.added} suggested courses. Review them, then add who needs each one.`,
        }
      : { status: "error", message: r.message };
  }
  return { status: "error", message: "Unknown action." };
}

export async function trainingRecordCommand(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const employeeId = str(form, "employeeId");
  const intent = str(form, "intent");
  if (intent === "void")
    return toState(
      await trainingApi.voidRecord(
        ws,
        employeeId,
        str(form, "recordId"),
        str(form, "reason"),
      ),
      "Record marked void. It stays in the history.",
    );
  if (intent === "record" || intent === "correct")
    return toState(
      await trainingApi.record(ws, employeeId, {
        courseId: str(form, "courseId"),
        completedOn: str(form, "completedOn"),
        expiresOn: str(form, "expiresOn"),
        provider: str(form, "provider"),
        reference: str(form, "reference"),
        replacesId: intent === "correct" ? str(form, "replacesId") : undefined,
        voidReason: intent === "correct" ? str(form, "voidReason") : undefined,
      }),
      intent === "correct" ? "Record corrected." : "Training recorded.",
    );
  return { status: "error", message: "Unknown action." };
}

// --- M8.2: my training ----------------------------------------------------------------

export async function confirmMyTraining(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await trainingApi.confirmMine(ws, str(form, "courseId"), {
      acknowledge: form.get("acknowledge") === "on",
      version: str(form, "version"),
    }),
    "Thanks, your confirmation is recorded.",
  );
}
