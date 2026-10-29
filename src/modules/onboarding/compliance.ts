// Right-to-work service (M7.2). Same rules as the onboarding service: a
// tenant-scoped transaction, an Actor from the server session, permission and
// site checks on every read and write, and an audit event for every change.
//
// Right-to-work records are RESTRICTED (IS-03):
// - only rtw.view holders see them, and every view writes an audit event;
// - everyone else with onboarding.view sees only whether a recorded check
//   covers the start date (decision D1);
// - audit detail holds ids and the kind of record only: never the method,
//   outcome, dates or notes;
// - records are append-only: a follow-up or correction supersedes the current
//   check and the history stays.

import { isUuid, type TenantTx } from "@/lib/tenancy";

import {
  IDENTIFIER_MESSAGE,
  currentOf,
  looksLikeIdentifier,
  rtwCovers,
  rtwStateOn,
  validateRtw,
  type RtwFacts,
  type RtwKind,
  type RtwState,
} from "./compliance-policy";
import { canAt, hasAny, type Actor } from "./policy";
import {
  activeMember,
  asDate,
  assignableMembers,
  audit,
  conflict,
  forbidden,
  invalid,
  isoOf,
  notFound,
  uniqueViolation,
  userNames,
  type Result,
} from "./shared";

const factsSelect = {
  id: true,
  employeeId: true,
  supersedesId: true,
  outcome: true,
  checkedOn: true,
  permissionEndsOn: true,
  followUpDueOn: true,
} as const;

type FactsRow = {
  id: string;
  employeeId: string;
  supersedesId: string | null;
  outcome: RtwFacts["outcome"];
  checkedOn: Date;
  permissionEndsOn: Date | null;
  followUpDueOn: Date | null;
};

const toFacts = (r: FactsRow): RtwFacts => ({
  outcome: r.outcome,
  checkedOn: isoOf(r.checkedOn)!,
  permissionEndsOn: isoOf(r.permissionEndsOn),
  followUpDueOn: isoOf(r.followUpDueOn),
});

function currentByEmployee(rows: readonly FactsRow[]) {
  const byEmployee = new Map<string, FactsRow[]>();
  for (const r of rows)
    byEmployee.set(r.employeeId, [...(byEmployee.get(r.employeeId) ?? []), r]);
  const current = new Map<string, RtwFacts>();
  for (const [employeeId, checks] of byEmployee) {
    const head = currentOf(checks);
    if (head) current.set(employeeId, toFacts(head));
  }
  return current;
}

/**
 * The current check's facts for each employee, for computing "cleared to
 * start". Internal to the module: callers show only the yes/no result to
 * people without rtw.view.
 */
export async function rtwFactsFor(
  tx: TenantTx,
  tenantId: string,
  employeeIds: readonly string[],
): Promise<Map<string, RtwFacts>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await tx.rtwCheck.findMany({
    where: { tenantId, employeeId: { in: [...new Set(employeeIds)] } },
    select: factsSelect,
  });
  return currentByEmployee(rows);
}

/**
 * For other modules (Rota, later): does a recorded right-to-work check cover
 * this date? Yes/no only, never the record. null if the person isn't visible.
 */
export async function isClearedToWork(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  onDate: string,
): Promise<boolean | null> {
  if (!isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: { id: true },
  });
  if (!e) return null;
  const facts = (await rtwFactsFor(tx, actor.tenantId, [e.id])).get(e.id);
  return rtwCovers(rtwStateOn(facts ?? null, onDate));
}

const nameOf = (e: {
  givenName: string;
  familyName: string;
  preferredName: string | null;
}) => `${e.preferredName || e.givenName} ${e.familyName}`;

async function rtwEmployee(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  code: "rtw.view" | "rtw.record",
) {
  if (!isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: {
      id: true,
      givenName: true,
      familyName: true,
      preferredName: true,
      jobTitle: true,
      status: true,
      startDate: true,
      primarySiteId: true,
    },
  });
  // Other organisations' people and people outside your scope look the same: not found.
  return e && canAt(actor, code, e.primarySiteId) ? e : null;
}

/**
 * The full right-to-work record for one person. Restricted: needs rtw.view
 * at their site, and every view is audited (even when there's nothing yet).
 */
export async function getRightToWork(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  today: string,
) {
  const e = await rtwEmployee(tx, actor, employeeId, "rtw.view");
  if (!e) return null;
  const rows = await tx.rtwCheck.findMany({
    where: { tenantId: actor.tenantId, employeeId: e.id },
    orderBy: { recordedAt: "desc" },
    select: {
      id: true,
      kind: true,
      supersedesId: true,
      method: true,
      listType: true,
      checkedOn: true,
      checkedByMembershipId: true,
      personPresent: true,
      outcome: true,
      permissionEndsOn: true,
      followUpDueOn: true,
      note: true,
      correctionReason: true,
      recordedBy: true,
      recordedAt: true,
    },
  });
  await audit(tx, actor, "rtw.record_viewed", "employee", e.id, {
    checks: rows.length,
  });
  const members = await assignableMembers(tx, actor);
  const memberNames = new Map(members.map((m) => [m.id, m.name]));
  // Checkers who have since left still need a name in the history.
  const missing = rows
    .map((r) => r.checkedByMembershipId)
    .filter((id) => !memberNames.has(id));
  if (missing.length) {
    const ms = await tx.tenantMembership.findMany({
      where: { tenantId: actor.tenantId, id: { in: missing } },
      select: { id: true, userId: true },
    });
    const n = await userNames(
      tx,
      ms.map((m) => m.userId),
    );
    for (const m of ms)
      memberNames.set(m.id, n.get(m.userId) ?? "A former member");
  }
  const recorders = await userNames(
    tx,
    rows.map((r) => r.recordedBy),
  );
  const current = currentOf(rows);
  const supersededBy = new Map(
    rows.filter((r) => r.supersedesId).map((r) => [r.supersedesId!, r.kind]),
  );
  const state = rtwStateOn(
    current ? toFacts({ ...current, employeeId: e.id }) : null,
    today,
  );
  const canRecord = canAt(actor, "rtw.record", e.primarySiteId);
  return {
    today,
    employee: {
      id: e.id,
      name: nameOf(e),
      jobTitle: e.jobTitle,
      status: e.status,
      startDate: isoOf(e.startDate),
    },
    state,
    currentId: current?.id ?? null,
    history: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      method: r.method,
      listType: r.listType,
      checkedOn: isoOf(r.checkedOn)!,
      checkedByName:
        memberNames.get(r.checkedByMembershipId) ?? "A former member",
      personPresent: r.personPresent,
      outcome: r.outcome,
      permissionEndsOn: isoOf(r.permissionEndsOn),
      followUpDueOn: isoOf(r.followUpDueOn),
      note: r.note,
      correctionReason: r.correctionReason,
      recordedByName: recorders.get(r.recordedBy) ?? "A former member",
      recordedAt: r.recordedAt,
      current: r.id === current?.id,
      supersededBy: supersededBy.get(r.id) ?? null,
    })),
    members,
    can: {
      // A new first check or a follow-up for people still employed; corrections always.
      record: canRecord,
      recordNew: canRecord && (current !== null || e.status !== "left"),
    },
  };
}

export interface RtwCommand {
  /** What the browser believes is the current check: guards against two people recording at once. */
  supersedesId?: unknown;
  kind?: unknown;
  method?: unknown;
  listType?: unknown;
  checkedOn?: unknown;
  checkedByMembershipId?: unknown;
  personPresent?: unknown;
  outcome?: unknown;
  permissionEndsOn?: unknown;
  followUpDueOn?: unknown;
  note?: unknown;
  correctionReason?: unknown;
}

const s = (v: unknown) => (typeof v === "string" ? v : "");

export async function recordRtwCheck(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  today: string,
  raw: RtwCommand,
): Promise<Result> {
  if (!hasAny(actor, "rtw.record")) return forbidden();
  const e = await rtwEmployee(tx, actor, employeeId, "rtw.record");
  if (!e) return notFound("person");
  const checks = await tx.rtwCheck.findMany({
    where: { tenantId: actor.tenantId, employeeId: e.id },
    select: factsSelect,
  });
  const head = currentOf(checks);
  const expected = s(raw.supersedesId) || null;
  if (expected !== (head?.id ?? null))
    return conflict(
      "Someone else has recorded a check for this person. Reload the page and try again.",
    );
  let kind: RtwKind = "initial";
  if (head) {
    if (raw.kind !== "follow_up" && raw.kind !== "correction")
      return invalid({ kind: "Choose a follow-up check or a correction" });
    kind = raw.kind;
  }
  if (kind !== "correction" && e.status === "left")
    return conflict(
      "This person has left. You can only correct their existing record.",
    );

  const v = validateRtw(
    {
      method: s(raw.method),
      listType: s(raw.listType) || null,
      checkedOn: s(raw.checkedOn),
      personPresent: raw.personPresent === true,
      outcome: s(raw.outcome),
      permissionEndsOn: s(raw.permissionEndsOn) || null,
      followUpDueOn: s(raw.followUpDueOn) || null,
      note: s(raw.note) || null,
    },
    today,
  );
  const errors: Record<string, string> = v.ok ? {} : { ...v.errors };
  if (
    v.ok &&
    kind === "follow_up" &&
    head &&
    v.data.checkedOn < isoOf(head.checkedOn)!
  )
    errors.checkedOn = "A follow-up can't be dated before the previous check";
  const reason = s(raw.correctionReason).trim();
  if (kind === "correction") {
    if (reason.length < 3 || reason.length > 500)
      errors.correctionReason =
        "Say briefly what was wrong (3 to 500 characters)";
    else if (looksLikeIdentifier(reason))
      errors.correctionReason = IDENTIFIER_MESSAGE;
  }
  const checker = await activeMember(tx, actor, raw.checkedByMembershipId);
  if (checker === false)
    errors.checkedByMembershipId = "Choose an active member";
  if (!v.ok || Object.keys(errors).length) return invalid(errors);

  const d = v.data;
  try {
    const created = await tx.rtwCheck.create({
      data: {
        tenantId: actor.tenantId,
        employeeId: e.id,
        kind,
        supersedesId: head?.id ?? null,
        method: d.method,
        listType: d.listType,
        checkedOn: asDate(d.checkedOn),
        // false (not an active member) was rejected above.
        checkedByMembershipId: checker || actor.membershipId,
        personPresent: d.personPresent,
        outcome: d.outcome,
        permissionEndsOn: d.permissionEndsOn
          ? asDate(d.permissionEndsOn)
          : null,
        followUpDueOn: d.followUpDueOn ? asDate(d.followUpDueOn) : null,
        note: d.note,
        correctionReason: kind === "correction" ? reason : null,
        recordedBy: actor.userId,
      },
      select: { id: true },
    });
    // Ids and the kind of record only: the method, outcome, dates and notes are restricted.
    await audit(tx, actor, "rtw.check_recorded", "rtw_check", created.id, {
      employeeId: e.id,
      kind,
      supersedesId: head?.id ?? null,
    });
    return { ok: true, data: created };
  } catch (err) {
    if (uniqueViolation(err))
      return conflict(
        "Someone else has recorded a check for this person. Reload the page and try again.",
      );
    throw err;
  }
}

export interface RtwAttention {
  employeeId: string;
  name: string;
  jobTitle: string | null;
  employmentStatus: "pending" | "active" | "left";
  state: RtwState;
  followUpDueOn: string | null;
  permissionEndsOn: string | null;
}

/** People in the actor's rtw.view scope (not left), with their current state. */
async function rtwOverview(tx: TenantTx, actor: Actor, today: string) {
  const scope = actor.grants.get("rtw.view");
  if (!scope) return null;
  const employees = await tx.employee.findMany({
    where: {
      tenantId: actor.tenantId,
      status: { in: ["pending", "active"] },
      ...(scope === "all" ? {} : { primarySiteId: { in: [...scope] } }),
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    select: {
      id: true,
      givenName: true,
      familyName: true,
      preferredName: true,
      jobTitle: true,
      status: true,
    },
  });
  const facts = await rtwFactsFor(
    tx,
    actor.tenantId,
    employees.map((e) => e.id),
  );
  return employees.map((e): RtwAttention => {
    const f = facts.get(e.id) ?? null;
    return {
      employeeId: e.id,
      name: nameOf(e),
      jobTitle: e.jobTitle,
      employmentStatus: e.status,
      state: rtwStateOn(f, today),
      followUpDueOn: f?.followUpDueOn ?? null,
      permissionEndsOn: f?.permissionEndsOn ?? null,
    };
  });
}

const NEEDS_ACTION: readonly RtwState[] = [
  "lapsed",
  "follow_up_overdue",
  "follow_up_due",
  "not_confirmed",
];

/** How many people need right-to-work attention (a count only, so not audited). */
export async function rtwAttentionCount(
  tx: TenantTx,
  actor: Actor,
  today: string,
) {
  const all = await rtwOverview(tx, actor, today);
  return all ? all.filter((p) => NEEDS_ACTION.includes(p.state)).length : null;
}

/**
 * The follow-up list: who needs a follow-up check or has a problem recorded,
 * and who has no check recorded. Restricted (it reveals time-limited
 * permission), so each view is audited.
 */
export async function rtwFollowUps(tx: TenantTx, actor: Actor, today: string) {
  const all = await rtwOverview(tx, actor, today);
  if (!all) return null;
  const attention = all
    .filter((p) => NEEDS_ACTION.includes(p.state))
    .sort((a, b) =>
      (a.followUpDueOn ?? "0000").localeCompare(b.followUpDueOn ?? "0000"),
    );
  const unrecorded = all.filter((p) => p.state === "none");
  await audit(tx, actor, "rtw.follow_ups_viewed", "employee", null, {
    attention: attention.length,
    unrecorded: unrecorded.length,
  });
  return { attention, unrecorded };
}
