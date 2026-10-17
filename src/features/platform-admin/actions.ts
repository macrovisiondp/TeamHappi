"use server";

import QRCode from "qrcode";

import { platformMfa } from "@/lib/auth";
import {
  getPlatformAccess,
  organisationAdmin,
  regenerateMyRecoveryCodes,
  staffAdmin,
  type PlatformAccess,
} from "@/lib/platform-access";

// Server actions for platform MFA and staff management (M5.1). Identity and
// session come from the server; every privileged change goes through
// src/lib/platform-access (grant + MFA within 15 minutes + real actor).
// Next.js server actions are POST-only with an Origin check.

export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string; href?: string; codes?: string[] }
  | { status: "error"; message: string; stepUp?: boolean };

const SAFE_NEXT = /^\/platform(\/[a-z0-9-]+)*$/;

function lockedMessage(until?: Date) {
  return until
    ? `Too many incorrect codes. Try again after ${until.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}.`
    : "Too many incorrect codes. Try again later.";
}

// --- MFA set-up and verification ---------------------------------------------

export async function startMfaSetup(): Promise<
  { ok: true; qr: string; manualKey: string } | { ok: false; message: string }
> {
  const result = await platformMfa.start();
  if (!result) return { ok: false, message: "Platform access is required." };
  if (!result.ok)
    return {
      ok: false,
      message:
        result.reason === "already_enrolled"
          ? "MFA is already set up for your account."
          : "Set-up couldn't start. Try again.",
    };
  const qr = await QRCode.toDataURL(result.uri, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
  return { ok: true, qr, manualKey: result.manualKey };
}

export async function confirmMfaSetup(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const result = await platformMfa.confirm(String(form.get("code") ?? ""));
  if (!result)
    return { status: "error", message: "Platform access is required." };
  if (result.ok)
    return {
      status: "ok",
      codes: result.recoveryCodes,
      href: "/platform/dashboard",
    };
  if (result.reason === "locked")
    return { status: "error", message: lockedMessage(result.lockedUntil) };
  return {
    status: "error",
    message:
      "That code didn't match. Check your authenticator app and try the newest code.",
  };
}

export async function verifyMfa(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  const method = form.get("method") === "recovery" ? "recovery" : "totp";
  const code = String(form.get("code") ?? "");
  const result =
    method === "recovery"
      ? await platformMfa.verifyRecovery(code)
      : await platformMfa.verify(code);
  if (!result)
    return { status: "error", message: "Platform access is required." };
  if (result.ok) {
    const next = String(form.get("next") ?? "");
    return {
      status: "ok",
      href: SAFE_NEXT.test(next) ? next : "/platform/dashboard",
      message:
        "remaining" in result && typeof result.remaining === "number"
          ? `Recovery code accepted. ${result.remaining} left.`
          : undefined,
    };
  }
  if (result.reason === "locked")
    return { status: "error", message: lockedMessage(result.lockedUntil) };
  if (result.reason === "not_enrolled")
    return { status: "ok", href: "/platform/mfa/setup" };
  return {
    status: "error",
    message:
      method === "recovery"
        ? "That recovery code isn't valid or has already been used."
        : "That code didn't match, or it has already been used. Wait for the next code and try again.",
  };
}

export async function regenerateRecoveryCodes(): Promise<ActionState> {
  const result = await regenerateMyRecoveryCodes();
  if (!result.ok)
    return {
      status: "error",
      message: result.message,
      stepUp: result.reason === "step_up",
    };
  return { status: "ok", codes: result.data };
}

// --- Staff management --------------------------------------------------------

async function requireStaff(): Promise<Extract<
  PlatformAccess,
  { kind: "staff" }
> | null> {
  const access = await getPlatformAccess();
  return access.kind === "staff" ? access : null;
}

const fromResult = (
  r: Awaited<ReturnType<typeof staffAdmin.grant>>,
  message: string,
): ActionState =>
  r.ok
    ? { status: "ok", message }
    : { status: "error", message: r.message, stepUp: r.reason === "step_up" };

export async function addStaff(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  return fromResult(
    await staffAdmin.grant(
      String(form.get("email") ?? ""),
      form.getAll("grants").map(String),
    ),
    "Staff member added. They must set up MFA before using Platform Admin.",
  );
}

export async function updateStaffMember(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  const userId = String(form.get("userId") ?? "");
  const intent = String(form.get("intent") ?? "grants");
  if (intent === "reset_mfa")
    return fromResult(
      await staffAdmin.resetMfa(userId),
      "MFA reset. They must set it up again.",
    );
  if (intent === "suspend" || intent === "reactivate" || intent === "revoke")
    return fromResult(
      await staffAdmin.update(userId, {
        status:
          intent === "suspend"
            ? "suspended"
            : intent === "revoke"
              ? "revoked"
              : "active",
      }),
      intent === "suspend"
        ? "Access suspended."
        : intent === "revoke"
          ? "Access revoked."
          : "Access reactivated.",
    );
  return fromResult(
    await staffAdmin.update(userId, {
      grants: form.getAll("grants").map(String),
    }),
    "Permissions saved.",
  );
}

// --- Client organisations (M5.2) --------------------------------------------

export async function changeOrganisationStatus(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  const next = form.get("next") === "active" ? "active" : "suspended";
  const r = await organisationAdmin.setStatus(
    String(form.get("tenantId") ?? ""),
    next,
    String(form.get("reason") ?? ""),
  );
  return r.ok
    ? {
        status: "ok",
        message:
          next === "suspended"
            ? "Organisation suspended. Its members lose access on their next page load."
            : "Organisation reactivated.",
      }
    : { status: "error", message: r.message, stepUp: r.reason === "step_up" };
}
