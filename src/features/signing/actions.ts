"use server";

import { getWorkspace, signingApi } from "@/lib/workspace";

// Server actions for documents to sign (M13). The organisation and member come
// from the session; ids and files in a form are untrusted and re-checked by the
// signing module (permission, ownership, RLS).

export type SigningFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: SigningFormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res =
  | { ok: true; data: unknown }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

const toState = (r: Res, message: string): SigningFormState =>
  r.ok
    ? { status: "saved", message }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

async function fileFrom(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const NO_FILE: SigningFormState = {
  status: "error",
  message: "Choose a PDF to upload.",
  fieldErrors: { file: "Choose a PDF" },
};

export async function uploadPolicyAction(
  _prev: SigningFormState,
  form: FormData,
): Promise<SigningFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const file = await fileFrom(form);
  if (!file) return NO_FILE;
  return toState(
    await signingApi.uploadPolicy(ws, str(form, "title"), file),
    "Document added.",
  );
}

export async function archivePolicyAction(
  _prev: SigningFormState,
  form: FormData,
): Promise<SigningFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await signingApi.archivePolicy(ws, str(form, "id")),
    "Removed from the library.",
  );
}

/** Sends chosen policies and/or uploads and sends a contract to one person. */
export async function sendDocumentsAction(
  _prev: SigningFormState,
  form: FormData,
): Promise<SigningFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const employeeId = str(form, "employeeId");
  const policies = form.getAll("policyId").map(String);
  const file = await fileFrom(form);
  if (!policies.length && !file)
    return {
      status: "error",
      message: "Choose at least one policy, or upload a contract.",
    };
  let sent = 0;
  if (file) {
    const r = await signingApi.uploadContract(
      ws,
      employeeId,
      str(form, "title"),
      file,
    );
    if (!r.ok) return toState(r, "");
    sent += 1;
  }
  if (policies.length) {
    const r = await signingApi.sendPolicies(ws, employeeId, policies);
    if (!r.ok && !sent) return toState(r, "");
    if (r.ok) sent += r.data.sent;
  }
  return {
    status: "saved",
    message: `Sent ${sent} document${sent === 1 ? "" : "s"} to sign.`,
  };
}

export async function requestCommandAction(
  _prev: SigningFormState,
  form: FormData,
): Promise<SigningFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const id = str(form, "requestId");
  switch (str(form, "intent")) {
    case "sign":
      return toState(
        await signingApi.sign(
          ws,
          id,
          str(form, "name"),
          form.get("agree") === "on",
        ),
        "Signed. Thank you.",
      );
    case "countersign":
      return toState(
        await signingApi.countersign(ws, id, str(form, "name")),
        "Countersigned. The signed copy is ready.",
      );
    case "withdraw":
      return toState(await signingApi.withdraw(ws, id), "Request withdrawn.");
    default:
      return { status: "error", message: "Unknown action." };
  }
}

// --- M14.1 starter packs ---------------------------------------------------------------

export async function starterPackAction(
  _prev: SigningFormState,
  form: FormData,
): Promise<SigningFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  switch (str(form, "intent")) {
    case "create":
      return toState(
        await signingApi.createStarterPack(ws, {
          name: str(form, "name"),
          jobTitle: str(form, "jobTitle"),
          documentIds: form.getAll("documentId").map(String),
        }),
        "Starter pack saved.",
      );
    case "archive":
      return toState(
        await signingApi.archiveStarterPack(ws, str(form, "id")),
        "Starter pack removed.",
      );
    case "send": {
      const r = await signingApi.sendStarterPack(ws, str(form, "employeeId"));
      if (!r.ok) return toState(r, "");
      return r.data.packs === 0
        ? {
            status: "error",
            message: "No starter pack matches their job title.",
          }
        : {
            status: "saved",
            message:
              r.data.sent === 0
                ? "They already have everything in their starter pack."
                : `Sent ${r.data.sent} document${r.data.sent === 1 ? "" : "s"} to sign.`,
          };
    }
    default:
      return { status: "error", message: "Unknown action." };
  }
}
