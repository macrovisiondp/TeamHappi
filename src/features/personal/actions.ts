"use server";

import { getWorkspace, personalApi } from "@/lib/workspace";

// Server actions for personal and bank details (M14.2). The member comes from
// the session; the person id in a form is untrusted and re-checked by the
// personal module (self, employee.personal, or nothing). Values are never logged.

export type PersonalFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

export type RevealState =
  | { status: "idle" }
  | { status: "shown"; lines: [string, string][] }
  | { status: "error"; message: string };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}
const NO_WORKSPACE = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
} as const;
const str = (form: FormData, key: string) => String(form.get(key) ?? "");

type Res =
  | { ok: true; data: unknown }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };
const toState = (r: Res, message: string): PersonalFormState =>
  r.ok
    ? { status: "saved", message }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };

export async function saveAboutAction(
  _prev: PersonalFormState,
  form: FormData,
): Promise<PersonalFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await personalApi.saveAbout(ws, str(form, "employeeId"), {
      addressLine1: str(form, "addressLine1"),
      addressLine2: str(form, "addressLine2"),
      town: str(form, "town"),
      postcode: str(form, "postcode"),
      dateOfBirth: str(form, "dateOfBirth"),
      emergencyName: str(form, "emergencyName"),
      emergencyRelationship: str(form, "emergencyRelationship"),
      emergencyPhone: str(form, "emergencyPhone"),
      niNumber: str(form, "niNumber"),
    }),
    "Saved.",
  );
}

export async function saveBankAction(
  _prev: PersonalFormState,
  form: FormData,
): Promise<PersonalFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await personalApi.saveBank(ws, str(form, "employeeId"), {
      accountName: str(form, "accountName"),
      sortCode: str(form, "sortCode"),
      accountNumber: str(form, "accountNumber"),
    }),
    "Bank details saved.",
  );
}

/** Shows an NI number or bank details in full (audited). */
export async function revealAction(
  _prev: RevealState,
  form: FormData,
): Promise<RevealState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const r = await personalApi.reveal(
    ws,
    str(form, "employeeId"),
    str(form, "field"),
  );
  if (!r.ok) return { status: "error", message: r.message };
  const d = r.data;
  return {
    status: "shown",
    lines:
      d.field === "ni"
        ? [["National Insurance number", d.niNumber]]
        : [
            ["Name on the account", d.accountName],
            [
              "Sort code",
              `${d.sortCode.slice(0, 2)}-${d.sortCode.slice(2, 4)}-${d.sortCode.slice(4)}`,
            ],
            ["Account number", d.accountNumber],
          ],
  };
}
