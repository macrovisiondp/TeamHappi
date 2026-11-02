"use server";

import { getWorkspace, rotaApi } from "@/lib/workspace";

// Server actions for the rota (M10.1). The organisation and the acting member
// always come from the server session; every id in a form is untrusted and is
// re-checked by the rota module (permission, site scope, RLS).

export type RotaFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string>;
      /** Checks to show before assigning anyway (needs a reason) or that block it. */
      warnings?: { message: string; blocking: boolean }[];
      needsReason?: boolean;
    };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: RotaFormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res =
  | { ok: true; data: unknown }
  | {
      ok: false;
      code: string;
      message: string;
      fieldErrors?: Record<string, string>;
      warnings?: { message: string; blocking: boolean }[];
    };

function toState(r: Res, message: string): RotaFormState {
  if (r.ok) return { status: "saved", message };
  return {
    status: "error",
    message: r.message,
    fieldErrors: r.fieldErrors,
    warnings: r.warnings?.map((w) => ({
      message: w.message,
      blocking: w.blocking,
    })),
    needsReason: r.code === "needs_reason",
  };
}

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function saveShiftAction(
  _prev: RotaFormState,
  form: FormData,
): Promise<RotaFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const shiftId = str(form, "shiftId") || null;
  return toState(
    await rotaApi.saveShift(
      ws,
      str(form, "siteId"),
      str(form, "weekStart"),
      shiftId,
      {
        day: str(form, "day"),
        start: str(form, "start"),
        end: str(form, "end"),
        breakMinutes: str(form, "breakMinutes"),
        teamId: str(form, "teamId"),
        roleLabel: str(form, "roleLabel"),
        note: str(form, "note"),
      },
    ),
    shiftId ? "Shift saved." : "Shift added.",
  );
}

export async function shiftCommandAction(
  _prev: RotaFormState,
  form: FormData,
): Promise<RotaFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const shiftId = str(form, "shiftId");
  switch (str(form, "intent")) {
    case "assign":
      return toState(
        await rotaApi.assign(
          ws,
          shiftId,
          str(form, "employeeId"),
          str(form, "overrideReason"),
        ),
        "Shift assigned.",
      );
    case "unassign":
      return toState(await rotaApi.unassign(ws, shiftId), "Shift is now open.");
    case "cancel":
      return toState(
        await rotaApi.cancelShift(ws, shiftId),
        "Shift cancelled.",
      );
    default:
      return { status: "error", message: "Unknown action." };
  }
}

export async function weekCommandAction(
  _prev: RotaFormState,
  form: FormData,
): Promise<RotaFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const siteId = str(form, "siteId");
  const weekStart = str(form, "weekStart");
  if (str(form, "intent") === "publish")
    return toState(
      await rotaApi.publish(ws, siteId, weekStart),
      "Published. Changes from now on are kept in the week's history.",
    );
  if (str(form, "intent") === "copy") {
    const r = await rotaApi.copyPreviousWeek(ws, siteId, weekStart);
    if (!r.ok) return toState(r, "");
    const d = r.data;
    return {
      status: "saved",
      message:
        `Copied ${d.copied} shift${d.copied === 1 ? "" : "s"}.` +
        (d.leftOpen
          ? ` ${d.leftOpen} left open: the person needs checking first.`
          : "") +
        (d.skipped
          ? ` ${d.skipped} skipped: the time doesn't exist this week (clocks change).`
          : ""),
    };
  }
  return { status: "error", message: "Unknown action." };
}
