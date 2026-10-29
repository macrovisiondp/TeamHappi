// Compliance rules (M7.2). Pure functions, unit-tested; the service applies
// them on the server for every change.
//
// TeamHappi RECORDS the employer's right-to-work check. It never makes the
// legal decision: these rules only describe what was recorded and whether a
// recorded check covers a date. The wording and rules here are pending review
// by a qualified adviser (gate G4) before they go live.

import { canAt, dueDate, isIsoDate, type Actor, type Progress } from "./policy";

export type RtwMethod = "manual_document" | "online_check" | "idsp";
export type RtwList = "list_a" | "list_b_group_1" | "list_b_group_2";
export type RtwOutcome = "confirmed" | "time_limited" | "not_confirmed";
export type RtwKind = "initial" | "follow_up" | "correction";

export const RTW_METHODS: readonly RtwMethod[] = [
  "manual_document",
  "online_check",
  "idsp",
];
export const RTW_LISTS: readonly RtwList[] = [
  "list_a",
  "list_b_group_1",
  "list_b_group_2",
];
export const RTW_OUTCOMES: readonly RtwOutcome[] = [
  "confirmed",
  "time_limited",
  "not_confirmed",
];

/** Follow-ups show as due this many days before the follow-up date. */
export const FOLLOW_UP_WINDOW_DAYS = 60;

export interface RtwFacts {
  outcome: RtwOutcome;
  checkedOn: string; // YYYY-MM-DD
  permissionEndsOn: string | null;
  followUpDueOn: string | null;
}

/**
 * What the CURRENT recorded check says about one date:
 * - none: no check recorded (or the check was made after this date);
 * - not_confirmed: the employer recorded that it couldn't confirm;
 * - lapsed: time-limited permission ended before this date;
 * - follow_up_overdue / follow_up_due: still covered, follow-up needed;
 * - recorded: covered, nothing due.
 */
export type RtwState =
  | "none"
  | "not_confirmed"
  | "lapsed"
  | "follow_up_overdue"
  | "follow_up_due"
  | "recorded";

export function rtwStateOn(check: RtwFacts | null, onDate: string): RtwState {
  if (!check || check.checkedOn > onDate) return "none";
  if (check.outcome === "not_confirmed") return "not_confirmed";
  if (check.permissionEndsOn !== null && check.permissionEndsOn < onDate)
    return "lapsed";
  if (check.followUpDueOn !== null) {
    if (check.followUpDueOn < onDate) return "follow_up_overdue";
    if (check.followUpDueOn <= dueDate(onDate, FOLLOW_UP_WINDOW_DAYS))
      return "follow_up_due";
  }
  return "recorded";
}

/** A recorded check covers the date (follow-ups may still be due). */
export const rtwCovers = (s: RtwState) =>
  s === "recorded" || s === "follow_up_due" || s === "follow_up_overdue";

/** The latest check in an employee's history: the one nothing supersedes. */
export function currentOf<
  T extends { id: string; supersedesId: string | null },
>(checks: readonly T[]): T | null {
  const superseded = new Set(checks.map((c) => c.supersedesId));
  return checks.find((c) => !superseded.has(c.id)) ?? null;
}

export interface RtwInput {
  method: string;
  listType: string | null;
  checkedOn: string;
  personPresent: boolean;
  outcome: string;
  permissionEndsOn: string | null;
  followUpDueOn: string | null;
  note: string | null;
}

export interface ValidRtw {
  method: RtwMethod;
  listType: RtwList | null;
  checkedOn: string;
  personPresent: boolean;
  outcome: RtwOutcome;
  permissionEndsOn: string | null;
  followUpDueOn: string | null;
  note: string | null;
}

// Restricted identifiers must never be typed into free text (decision D4):
// long numbers (passport numbers), and long letter-and-digit codes, with or
// without spaces (document numbers, share codes).
const LONG_NUMBER = /\d{7,}/;
const MIXED_CODE = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8,}\b/i;
const SPACED_CODE = /\b[A-Z0-9]{3}[\s-][A-Z0-9]{3}[\s-][A-Z0-9]{3}\b/gi;

export function looksLikeIdentifier(text: string): boolean {
  if (LONG_NUMBER.test(text) || MIXED_CODE.test(text)) return true;
  return [...text.matchAll(SPACED_CODE)].some(
    (m) => /\d/.test(m[0]) && /[A-Z]/i.test(m[0]),
  );
}

export const IDENTIFIER_MESSAGE =
  "This looks like a document number or share code. Don't record those in TeamHappi; keep them in your own records.";

/**
 * Checks a recorded right-to-work check for internal consistency. It doesn't
 * judge the legal outcome; it stops records that contradict themselves.
 */
export function validateRtw(
  v: RtwInput,
  today: string,
):
  { ok: true; data: ValidRtw } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const method = RTW_METHODS.find((m) => m === v.method);
  const outcome = RTW_OUTCOMES.find((o) => o === v.outcome);
  const listType =
    method === "manual_document"
      ? (RTW_LISTS.find((l) => l === v.listType) ?? null)
      : null;
  if (!method) errors.method = "Choose how the check was done";
  if (!outcome) errors.outcome = "Choose the outcome";
  if (method === "manual_document" && !listType)
    errors.listType = "Choose the list the document is on";
  if (!isIsoDate(v.checkedOn)) errors.checkedOn = "Enter the date of the check";
  else if (v.checkedOn > today)
    errors.checkedOn = "The check date can't be in the future";

  if (outcome && outcome !== "not_confirmed") {
    if (!v.personPresent)
      errors.personPresent =
        "A check can only be recorded as confirmed if the person was present";
    if (listType === "list_a" && outcome !== "confirmed")
      errors.outcome = "List A documents give continuous permission";
    if (listType && listType !== "list_a" && outcome !== "time_limited")
      errors.outcome = "List B documents give time-limited permission";
    if (method === "idsp" && outcome !== "confirmed")
      errors.outcome =
        "Identity service checks are for continuous permission only";
  }

  let permissionEndsOn: string | null = null;
  let followUpDueOn: string | null = null;
  if (outcome === "time_limited") {
    if (!isIsoDate(v.permissionEndsOn))
      errors.permissionEndsOn = "Enter when their permission ends";
    else if (isIsoDate(v.checkedOn) && v.permissionEndsOn <= v.checkedOn)
      errors.permissionEndsOn = "This must be after the check date";
    else permissionEndsOn = v.permissionEndsOn;
    const follow = v.followUpDueOn || permissionEndsOn;
    if (permissionEndsOn) {
      if (!isIsoDate(follow))
        errors.followUpDueOn = "Enter the follow-up check date";
      else if (follow > permissionEndsOn)
        errors.followUpDueOn =
          "The follow-up must be on or before the date permission ends";
      else if (isIsoDate(v.checkedOn) && follow < v.checkedOn)
        errors.followUpDueOn = "The follow-up can't be before the check";
      else followUpDueOn = follow;
    }
  }

  const note = v.note?.trim() || null;
  if (note && note.length > 500) errors.note = "Keep it under 500 characters";
  else if (note && looksLikeIdentifier(note)) errors.note = IDENTIFIER_MESSAGE;

  if (Object.keys(errors).length || !method || !outcome)
    return { ok: false, errors };
  return {
    ok: true,
    data: {
      method,
      listType,
      checkedOn: v.checkedOn,
      personPresent: v.personPresent,
      outcome,
      permissionEndsOn,
      followUpDueOn,
      note,
    },
  };
}

// --- Document checklist (metadata only) ---------------------------------------------

export type DocumentStatus =
  "requested" | "seen" | "verified" | "rejected" | "waived";

export interface DocumentFacts {
  required: boolean;
  status: DocumentStatus;
  expiresOn: string | null;
}

export interface DocumentProgress {
  total: number;
  /** Seen or verified (and not expired), or waived. */
  satisfied: number;
  /** Required documents not satisfied on the date. */
  requiredOutstanding: number;
  rejected: number;
  expired: number;
  expiringSoon: number;
}

const isExpired = (d: DocumentFacts, onDate: string) =>
  d.expiresOn !== null && d.expiresOn < onDate;

export function documentSatisfied(d: DocumentFacts, onDate: string) {
  if (d.status === "waived") return true;
  return (
    (d.status === "seen" || d.status === "verified") && !isExpired(d, onDate)
  );
}

export function documentProgressOf(
  docs: readonly DocumentFacts[],
  onDate: string,
): DocumentProgress {
  const soon = dueDate(onDate, FOLLOW_UP_WINDOW_DAYS);
  const held = docs.filter(
    (d) => d.status === "seen" || d.status === "verified",
  );
  return {
    total: docs.length,
    satisfied: docs.filter((d) => documentSatisfied(d, onDate)).length,
    requiredOutstanding: docs.filter(
      (d) => d.required && !documentSatisfied(d, onDate),
    ).length,
    rejected: docs.filter((d) => d.status === "rejected").length,
    expired: held.filter((d) => isExpired(d, onDate)).length,
    expiringSoon: held.filter(
      (d) =>
        d.expiresOn !== null && d.expiresOn >= onDate && d.expiresOn <= soon,
    ).length,
  };
}

/** Rejecting or waiving needs a reason; waiving a REQUIRED document needs sign-off rights. */
export function mayCloseDocument(
  actor: Actor,
  siteId: string | null,
  required: boolean,
  kind: "reject" | "waive",
  reason: string,
): { ok: true } | { ok: false; message: string; field?: true } {
  if (reason.trim().length < 3)
    return { ok: false, message: "Give a reason.", field: true };
  if (
    kind === "waive" &&
    required &&
    !canAt(actor, "onboarding.signoff", siteId)
  )
    return {
      ok: false,
      message:
        "Only an owner, administrator or HR manager can waive a required document.",
    };
  if (!canAt(actor, "onboarding.manage", siteId))
    return { ok: false, message: "Your role doesn't allow this change." };
  return { ok: true };
}

// --- Cleared to start -----------------------------------------------------------------

export interface Clearance {
  /** The date assessed: the start date, or today once they've started. */
  on: string;
  tasksReady: boolean;
  documentsReady: boolean;
  /** A recorded right-to-work check covers the date. Never a legal decision. */
  rightToWork: boolean;
  cleared: boolean;
}

/**
 * Cleared to start is computed from the facts, never ticked by hand: every
 * required task finished, every required document satisfied, and a recorded
 * right-to-work check covering the date.
 */
export function clearanceOf(
  progress: Progress,
  docs: readonly DocumentFacts[],
  rtw: RtwFacts | null,
  startDate: string,
  today: string,
): Clearance {
  const on = startDate > today ? startDate : today;
  const tasksReady = progress.operationallyReady;
  const documentsReady = documentProgressOf(docs, on).requiredOutstanding === 0;
  const rightToWork = rtwCovers(rtwStateOn(rtw, on));
  return {
    on,
    tasksReady,
    documentsReady,
    rightToWork,
    cleared: tasksReady && documentsReady && rightToWork,
  };
}
