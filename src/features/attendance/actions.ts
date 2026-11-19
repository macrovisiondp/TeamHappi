"use server";

import { attendanceApi, getWorkspace } from "@/lib/workspace";

// Server actions for attendance (M11.1). The organisation, the acting member
// and every clock time come from the server; ids in a form are untrusted and
// are re-checked by the attendance module (permission, site scope, RLS).

export type AttendanceFormState =
  | { status: "idle" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string> };

async function ready() {
  const ws = await getWorkspace();
  return ws?.kind === "ready" ? ws : null;
}

const NO_WORKSPACE: AttendanceFormState = {
  status: "error",
  message: "Your session or access has changed. Sign in again and retry.",
};

type Res =
  | { ok: true; data: unknown }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string>;
    };

const toState = (r: Res, message: string): AttendanceFormState =>
  r.ok
    ? { status: "saved", message }
    : { status: "error", message: r.message, fieldErrors: r.fieldErrors };

const str = (form: FormData, key: string) => String(form.get(key) ?? "");

/** Staff: clock in, start or end a break, clock out (server time only). */
export async function clockAction(
  _prev: AttendanceFormState,
  form: FormData,
): Promise<AttendanceFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  switch (str(form, "intent")) {
    case "in":
      return toState(await attendanceApi.clockIn(ws), "Clocked in.");
    case "break-start":
      return toState(
        await attendanceApi.toggleBreak(ws, true),
        "Break started.",
      );
    case "break-end":
      return toState(
        await attendanceApi.toggleBreak(ws, false),
        "Break ended.",
      );
    case "out":
      return toState(await attendanceApi.clockOut(ws), "Clocked out.");
    default:
      return { status: "error", message: "Unknown action." };
  }
}

/** Managers: record, correct or remove an entry. */
export async function entryAction(
  _prev: AttendanceFormState,
  form: FormData,
): Promise<AttendanceFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  const times = {
    clockIn: str(form, "clockIn"),
    clockOut: str(form, "clockOut"),
    reason: str(form, "reason"),
  };
  switch (str(form, "intent")) {
    case "record":
      return toState(
        await attendanceApi.record(
          ws,
          str(form, "siteId"),
          str(form, "employeeId"),
          times,
        ),
        "Times recorded.",
      );
    case "correct":
      return toState(
        await attendanceApi.correct(ws, str(form, "entryId"), times),
        "Times corrected.",
      );
    case "remove":
      return toState(
        await attendanceApi.remove(
          ws,
          str(form, "entryId"),
          str(form, "reason"),
        ),
        "Entry removed.",
      );
    default:
      return { status: "error", message: "Unknown action." };
  }
}

/** Owners and admins: the flag limits. */
export async function settingsAction(
  _prev: AttendanceFormState,
  form: FormData,
): Promise<AttendanceFormState> {
  const ws = await ready();
  if (!ws) return NO_WORKSPACE;
  return toState(
    await attendanceApi.saveSettings(ws, {
      toleranceMinutes: str(form, "toleranceMinutes"),
      missedClockOutHours: str(form, "missedClockOutHours"),
    }),
    "Settings saved.",
  );
}
