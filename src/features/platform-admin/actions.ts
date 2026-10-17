"use server";

import QRCode from "qrcode";

import { platformMfa } from "@/lib/auth";
import { formToConfig } from "@/integrations/fields";
import {
  AI_FEATURES,
  getPlatformAccess,
  integrationAdmin,
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
  | {
      status: "error";
      message: string;
      stepUp?: boolean;
      fieldErrors?: Record<string, string>;
    };

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

// --- Integrations (M5.3) -----------------------------------------------------
// The provider id comes from the form, but every rule (grant, MFA within 15
// minutes, readiness, approval, credentials, environment) is checked again on
// the server. The environment is never taken from the browser.

const fromIntegration = (
  r: Awaited<ReturnType<typeof integrationAdmin.configure>>,
  message: string,
): ActionState =>
  r.ok
    ? { status: "ok", message }
    : {
        status: "error",
        message: r.message,
        stepUp: r.reason === "step_up",
        fieldErrors: "fieldErrors" in r ? r.fieldErrors : undefined,
      };

export async function configureIntegration(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  const providerId = String(form.get("providerId") ?? "");
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (typeof value === "string" && key !== "providerId") values[key] = value;
  return fromIntegration(
    await integrationAdmin.configure(
      providerId,
      formToConfig(providerId, values),
    ),
    "Settings saved as a new version. Test the connection before making it active.",
  );
}

export async function integrationCommand(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  const providerId = String(form.get("providerId") ?? "");
  if (form.get("intent") === "activate")
    return fromIntegration(
      await integrationAdmin.activate(providerId),
      "Provider is now active for this environment.",
    );
  return fromIntegration(
    await integrationAdmin.test(providerId),
    "Connection test passed.",
  );
}

/** "12.50" → 1250. Whole pence from a decimal string, never floating point. */
function poundsToPence(raw: string): number | null {
  const m = raw
    .trim()
    .replace(/^£/, "")
    .match(/^(\d{1,6})(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}

function wholeNumber(raw: string): number | null {
  const v = raw.trim().replace(/,/g, "");
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
}

export async function saveAiControls(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  if (!(await requireStaff()))
    return { status: "error", message: "Platform access is required." };
  const fieldErrors: Record<string, string> = {};
  const requestLimit = wholeNumber(String(form.get("requestLimit") ?? ""));
  const tokenLimit = wholeNumber(String(form.get("tokenLimit") ?? ""));
  const spendLimitPence = poundsToPence(String(form.get("spendLimit") ?? ""));
  if (requestLimit === null) fieldErrors.requestLimit = "Enter a whole number.";
  if (tokenLimit === null) fieldErrors.tokenLimit = "Enter a whole number.";
  if (spendLimitPence === null)
    fieldErrors.spendLimitPence =
      "Enter an amount in pounds, for example 25.00.";
  if (Object.keys(fieldErrors).length)
    return {
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors,
    };
  const features = form
    .getAll("features")
    .map(String)
    .filter((f): f is (typeof AI_FEATURES)[number] =>
      (AI_FEATURES as readonly string[]).includes(f),
    );
  return fromIntegration(
    await integrationAdmin.saveAi({
      killSwitch: form.get("aiEnabled") !== "on",
      features,
      requestLimit,
      tokenLimit,
      spendLimitPence,
    }),
    "AI controls saved.",
  );
}
