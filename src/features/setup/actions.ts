"use server";

import { getWorkspace, mutate, type MutationResult } from "@/lib/workspace";
import { formToObject } from "@/lib/validation/organisation";

import type { FormState } from "./form-state";

// Server actions for organisation setup (M4.2). The organisation comes from the
// server session on every call; ids in the form are untrusted and re-checked
// by the mutation functions (permission, site scope, RLS). Next.js server
// actions are POST-only with an Origin check.

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: FormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

function toState(
  result: MutationResult,
  message: string,
  href?: string,
): FormState {
  if (result.ok) return { status: "saved", message, href };
  return {
    status: "error",
    message: result.message,
    fieldErrors: result.fieldErrors,
  };
}

export async function saveOrganisation(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await mutate.updateOrganisation(ws, formToObject(form)),
    "Organisation details saved.",
  );
}

export async function saveSite(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = String(form.get("id") ?? "");
  const input = formToObject(form);
  if (!id) {
    const result = await mutate.createSite(ws, input);
    return toState(
      result,
      "Site added.",
      result.ok ? `/settings/sites/${result.data.id}` : undefined,
    );
  }
  return toState(await mutate.updateSite(ws, id, input), "Site saved.");
}

export async function changeSiteStatus(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const status = form.get("status") === "archived" ? "archived" : "active";
  return toState(
    await mutate.setSiteStatus(ws, String(form.get("id") ?? ""), status),
    status === "archived" ? "Site deactivated." : "Site reactivated.",
  );
}

export async function saveTeam(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = String(form.get("id") ?? "");
  const input = formToObject(form);
  if (!id) {
    const result = await mutate.createTeam(ws, input);
    return toState(
      result,
      "Team added.",
      result.ok ? `/settings/teams/${result.data.id}` : undefined,
    );
  }
  return toState(await mutate.updateTeam(ws, id, input), "Team saved.");
}

export async function changeTeamStatus(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const archived = form.get("status") === "archived";
  return toState(
    await mutate.setTeamArchived(ws, String(form.get("id") ?? ""), archived),
    archived ? "Team deactivated." : "Team reactivated.",
  );
}

export async function saveEmployee(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = String(form.get("id") ?? "");
  const input = formToObject(form, ["teamIds"]);
  const result = id
    ? await mutate.updateEmployee(ws, id, input)
    : await mutate.createEmployee(ws, input);
  return toState(
    result,
    id ? "Changes saved." : "Person added.",
    result.ok ? `/people/${result.data.id}` : undefined,
  );
}
