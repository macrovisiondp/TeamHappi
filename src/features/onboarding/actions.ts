"use server";

import type { FormState } from "@/features/setup/form-state";
import { getWorkspace, onboardingApi } from "@/lib/workspace";

// Server actions for onboarding (M7.1). The organisation and the acting member
// always come from the server session; every id in a form is untrusted and is
// re-checked by the onboarding module (permission, site scope, RLS).

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: FormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res = Awaited<ReturnType<typeof onboardingApi.startCase>>;

function toState(r: Res, message: string, href?: string): FormState {
  return r.ok
    ? { status: "saved", message, href }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function startOnboarding(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const r = await onboardingApi.startCase(ws, {
    employeeId: str(form, "employeeId"),
    templateId: str(form, "templateId"),
    startDate: str(form, "startDate"),
    ownerMembershipId: str(form, "ownerMembershipId") || null,
  });
  return toState(
    r,
    "Onboarding started.",
    r.ok ? `/onboarding/${r.data.id}` : undefined,
  );
}

export async function onboardingTaskCommand(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const caseId = str(form, "caseId");
  const taskId = str(form, "taskId");
  const intent = str(form, "intent");
  const cmd =
    intent === "complete"
      ? ({ kind: "complete" } as const)
      : intent === "reopen"
        ? ({ kind: "reopen" } as const)
        : intent === "waive"
          ? ({ kind: "waive", reason: str(form, "reason") } as const)
          : intent === "assign"
            ? ({
                kind: "assign",
                assigneeMembershipId: str(form, "assigneeMembershipId") || null,
                dueOn: str(form, "dueOn") || null,
              } as const)
            : null;
  if (!cmd) return { status: "error", message: "Unknown action." };
  return toState(
    await onboardingApi.updateTask(ws, caseId, taskId, cmd),
    intent === "complete"
      ? "Task done."
      : intent === "reopen"
        ? "Task reopened."
        : intent === "waive"
          ? "Exception recorded."
          : "Task updated.",
  );
}

export async function onboardingCaseCommand(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const caseId = str(form, "caseId");
  const intent = str(form, "intent");
  if (intent === "signoff")
    return toState(
      await onboardingApi.signOff(ws, caseId, str(form, "note")),
      "Onboarding signed off.",
    );
  if (intent === "cancel")
    return toState(
      await onboardingApi.cancel(ws, caseId, str(form, "reason")),
      "Onboarding cancelled.",
    );
  if (intent === "owner")
    return toState(
      await onboardingApi.changeOwner(
        ws,
        caseId,
        str(form, "ownerMembershipId"),
      ),
      "Owner changed.",
    );
  return { status: "error", message: "Unknown action." };
}

export async function saveOnboardingTemplate(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "id") || null;
  const r = await onboardingApi.saveTemplate(ws, id, {
    name: str(form, "name"),
    description: str(form, "description"),
    scope: str(form, "scope"),
    siteId: str(form, "siteId") || null,
    jobTitle: str(form, "jobTitle"),
  });
  return toState(
    r,
    id
      ? "Template saved. Onboarding already started keeps its own copy."
      : "Template created. Now add its tasks.",
    !id && r.ok ? `/onboarding/templates/${r.data.id}` : undefined,
  );
}

export async function onboardingTemplateCommand(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const templateId = str(form, "templateId");
  const intent = str(form, "intent");
  if (intent === "archive")
    return toState(
      await onboardingApi.archiveTemplate(ws, templateId),
      "Template archived. Onboarding already started isn't affected.",
      "/onboarding/templates",
    );
  if (intent === "remove-task")
    return toState(
      await onboardingApi.archiveTemplateTask(
        ws,
        templateId,
        str(form, "taskId"),
      ),
      "Task removed from the template.",
    );
  if (intent === "save-task")
    return toState(
      await onboardingApi.saveTemplateTask(
        ws,
        templateId,
        str(form, "taskId") || null,
        {
          title: str(form, "title"),
          guidance: str(form, "guidance"),
          category: str(form, "category"),
          ownerKind: str(form, "ownerKind"),
          dueOffsetDays: str(form, "dueOffsetDays") || "0",
          required: form.get("required") === "on",
        },
      ),
      str(form, "taskId") ? "Task saved." : "Task added.",
    );
  if (intent === "add-suggested") {
    const r = await onboardingApi.addSuggested(ws);
    return r.ok
      ? {
          status: "saved",
          message:
            r.data.added === 0
              ? "The suggested templates are already in your list."
              : `Added ${r.data.added} suggested template${r.data.added === 1 ? "" : "s"}. Review and edit them before use.`,
        }
      : { status: "error", message: r.message };
  }
  return { status: "error", message: "Unknown action." };
}
