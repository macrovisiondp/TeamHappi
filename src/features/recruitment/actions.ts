"use server";

import type { FormState } from "@/features/setup/form-state";
import { getWorkspace, recruitmentApi } from "@/lib/workspace";

// Server actions for recruitment (M9.1). The organisation and the acting
// member always come from the server session; every id in a form is untrusted
// and is re-checked by the recruitment module (permission, site scope, RLS).

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: FormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res =
  | { ok: true; data: unknown }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

function toState(r: Res, message: string, href?: string): FormState {
  return r.ok
    ? { status: "saved", message, href }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function saveVacancyAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "id") || null;
  const r = await recruitmentApi.saveVacancy(ws, id, {
    title: str(form, "title"),
    jobTitle: str(form, "jobTitle"),
    siteId: str(form, "siteId"),
    teamId: str(form, "teamId") || null,
    employmentType: str(form, "employmentType"),
    description: str(form, "description"),
    openings: str(form, "openings") || "1",
    closesOn: str(form, "closesOn") || null,
    hiringManagerMembershipId: str(form, "hiringManagerMembershipId") || null,
    payMin: str(form, "payMin"),
    payMax: str(form, "payMax"),
    payPeriod: str(form, "payPeriod"),
  });
  return toState(
    r,
    id
      ? "Vacancy saved."
      : "Vacancy created. Open it when you're ready to add applicants.",
    !id && r.ok
      ? `/recruitment/vacancies/${(r.data as { id: string }).id}`
      : undefined,
  );
}

export async function vacancyStatusAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await recruitmentApi.setVacancyStatus(
      ws,
      str(form, "vacancyId"),
      str(form, "status"),
    ),
    "Vacancy status changed.",
  );
}

export async function addApplicationAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const vacancyId = str(form, "vacancyId");
  const r = await recruitmentApi.addApplication(ws, vacancyId, {
    candidateId: str(form, "candidateId") || undefined,
    givenName: str(form, "givenName"),
    familyName: str(form, "familyName"),
    email: str(form, "email"),
    phone: str(form, "phone"),
    source: str(form, "source") || undefined,
    confirmNew: form.get("confirmNew") === "on",
  });
  return toState(
    r,
    "Applicant added.",
    r.ok
      ? `/recruitment/applications/${(r.data as { id: string }).id}`
      : undefined,
  );
}

export async function applicationCommandAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "applicationId");
  const intent = str(form, "intent");
  if (intent === "move")
    return toState(
      await recruitmentApi.moveStage(ws, id, str(form, "stage")),
      "Stage changed.",
    );
  if (intent === "reject")
    return toState(
      await recruitmentApi.close(ws, id, {
        kind: "reject",
        reason: str(form, "reason"),
      }),
      "Application rejected.",
    );
  if (intent === "withdraw")
    return toState(
      await recruitmentApi.close(ws, id, { kind: "withdraw" }),
      "Application withdrawn.",
    );
  if (intent === "note")
    return toState(
      await recruitmentApi.addNote(ws, id, str(form, "body")),
      "Note added.",
    );
  if (intent === "schedule")
    return toState(
      await recruitmentApi.scheduleInterview(ws, id, {
        scheduledAt: str(form, "scheduledAt"),
        durationMinutes: str(form, "durationMinutes") || "30",
        format: str(form, "format"),
        location: str(form, "location"),
        interviewerIds: form.getAll("interviewerIds").map(String),
      }),
      "Interview scheduled. No email was sent: tell the candidate yourself.",
    );
  if (intent === "hire") {
    const r = await recruitmentApi.hire(ws, id, {
      startDate: str(form, "startDate"),
      startOnboarding: form.get("startOnboarding") === "on",
      templateId: str(form, "templateId") || undefined,
    });
    return r.ok
      ? {
          status: "saved",
          message: (r.data as { alreadyHired: boolean }).alreadyHired
            ? "This candidate was already hired."
            : "Hired. Their employee record has been created.",
          href: `/people/${(r.data as { employeeId: string }).employeeId}`,
        }
      : { status: "error", message: r.message, fieldErrors: r.fieldErrors };
  }
  return { status: "error", message: "Unknown action." };
}

export async function interviewCommandAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "interviewId");
  const intent = str(form, "intent");
  const cmd =
    intent === "feedback"
      ? ({
          kind: "feedback",
          outcome: str(form, "outcome"),
          feedback: str(form, "feedback"),
        } as const)
      : intent === "reschedule"
        ? ({
            kind: "reschedule",
            scheduledAt: str(form, "scheduledAt"),
            durationMinutes: str(form, "durationMinutes") || "30",
            format: str(form, "format"),
            location: str(form, "location"),
          } as const)
        : intent === "cancel"
          ? ({ kind: "cancel" } as const)
          : intent === "no_show"
            ? ({ kind: "no_show" } as const)
            : null;
  if (!cmd) return { status: "error", message: "Unknown action." };
  return toState(
    await recruitmentApi.updateInterview(ws, id, cmd),
    "Interview updated.",
  );
}

export async function saveRecruitmentSettingsAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const labels = Object.fromEntries(
    ["applied", "screening", "shortlisted", "interview", "offer"].map((k) => [
      k,
      str(form, `label-${k}`),
    ]),
  );
  return toState(
    await recruitmentApi.saveSettings(ws, {
      labels,
      retentionMonths: str(form, "retentionMonths"),
    }),
    "Settings saved.",
  );
}

export async function anonymiseCandidateAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await recruitmentApi.anonymise(ws, str(form, "candidateId")),
    "Candidate anonymised.",
  );
}
