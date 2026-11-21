"use server";

import {
  getWorkspace,
  mutate,
  type MutationResult,
  welcomeNewStarter,
} from "@/lib/workspace";
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
      "Department added",
      result.ok ? "/settings/teams" : undefined,
    );
  }
  return toState(await mutate.updateTeam(ws, id, input), "Department saved");
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
    archived ? "Department deactivated" : "Department reactivated",
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
  // M19: a new person is invited and sent their starter pack straight away,
  // unless the box is unticked. Inviting needs their email address.
  const welcome = !id && form.get("sendWelcome") === "on";
  if (welcome && !String(form.get("email") ?? "").trim())
    return {
      status: "error",
      message: "Please check the highlighted fields.",
      fieldErrors: {
        email:
          "Add their email so we can invite them, or untick \u201cSend their invitation\u201d",
      },
    };
  const result = id
    ? await mutate.updateEmployee(ws, id, input)
    : await mutate.createEmployee(ws, input);
  if (!result.ok || id || !welcome)
    return toState(
      result,
      id ? "Changes saved" : "Person added",
      result.ok ? `/people/${result.data.id}` : undefined,
    );
  const w = await welcomeNewStarter(ws, result.data.id, {
    invite: true,
    pack: true,
  });
  const name = String(form.get("preferredName") || form.get("givenName") || "");
  const docs = w.pack.state === "sent" ? w.pack.documents : 0;
  const message =
    w.invite.state === "emailed"
      ? `${name} is added and invited${docs ? `, with ${docs} document${docs === 1 ? "" : "s"} to sign` : ""}`
      : `${name} is added. ${"reason" in w.invite ? w.invite.reason : "Use Send invitation on their record."}`;
  return toState(result, message, `/people/${result.data.id}`);
}
