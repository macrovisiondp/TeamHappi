import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { grantsFrom } from "@/lib/workspace/policy";
import {
  clearanceOf,
  currentOf,
  documentProgressOf,
  looksLikeIdentifier,
  mayCloseDocument,
  progressOf,
  rtwCovers,
  rtwStateOn,
  validateRtw,
  type Actor,
  type RtwFacts,
} from "@/modules/onboarding";

const actor = (roleKey: string, siteId: string | null = null): Actor => ({
  tenantId: "t",
  userId: "u",
  membershipId: "m",
  grants: grantsFrom([
    {
      siteId,
      permissions: SYSTEM_ROLES.find((r) => r.key === roleKey)!.permissions,
    },
  ]),
});

const T = "2026-10-20";
const check = (over: Partial<RtwFacts> = {}): RtwFacts => ({
  outcome: "confirmed",
  checkedOn: "2026-10-01",
  permissionEndsOn: null,
  followUpDueOn: null,
  ...over,
});
const timeLimited = (ends: string, followUp = ends) =>
  check({
    outcome: "time_limited",
    permissionEndsOn: ends,
    followUpDueOn: followUp,
  });

describe("what a recorded right-to-work check says about a date", () => {
  it("no check, or a check made after the date, covers nothing", () => {
    expect(rtwStateOn(null, T)).toBe("none");
    expect(rtwStateOn(check({ checkedOn: "2026-10-21" }), T)).toBe("none");
  });

  it("a confirmed (continuous) check covers every later date", () => {
    expect(rtwStateOn(check(), T)).toBe("recorded");
    expect(rtwStateOn(check(), "2040-01-01")).toBe("recorded");
    expect(rtwStateOn(check({ checkedOn: T }), T)).toBe("recorded"); // checked on the day
  });

  it("not confirmed never covers", () => {
    expect(rtwStateOn(check({ outcome: "not_confirmed" }), T)).toBe(
      "not_confirmed",
    );
    expect(rtwCovers("not_confirmed")).toBe(false);
  });

  it("time-limited: due within 60 days, overdue after the follow-up date, lapsed after permission ends", () => {
    expect(rtwStateOn(timeLimited("2027-06-01"), T)).toBe("recorded");
    expect(rtwStateOn(timeLimited("2026-12-19"), T)).toBe("follow_up_due"); // exactly 60 days
    expect(rtwStateOn(timeLimited("2026-12-20"), T)).toBe("recorded"); // 61 days
    expect(rtwStateOn(timeLimited("2026-11-30", "2026-10-19"), T)).toBe(
      "follow_up_overdue",
    );
    expect(rtwStateOn(timeLimited("2026-10-20"), T)).toBe("follow_up_due"); // permission ends today: still covered
    expect(rtwStateOn(timeLimited("2026-10-19"), T)).toBe("lapsed");
    expect(rtwCovers("follow_up_overdue")).toBe(true);
    expect(rtwCovers("lapsed")).toBe(false);
  });

  it("the current check is the one nothing supersedes", () => {
    const a = { id: "a", supersedesId: null };
    const b = { id: "b", supersedesId: "a" };
    const c = { id: "c", supersedesId: "b" };
    expect(currentOf([c, a, b])).toBe(c);
    expect(currentOf([a])).toBe(a);
    expect(currentOf([])).toBeNull();
  });
});

describe("recording a check: the record can't contradict itself", () => {
  const base: Parameters<typeof validateRtw>[0] = {
    method: "manual_document",
    listType: "list_a",
    checkedOn: "2026-10-15",
    personPresent: true,
    outcome: "confirmed",
    permissionEndsOn: null,
    followUpDueOn: null,
    note: null,
  };
  const errors = (over: Partial<typeof base>) => {
    const r = validateRtw({ ...base, ...over }, T);
    return r.ok ? {} : r.errors;
  };

  it("accepts a List A manual check and drops dates that don't apply", () => {
    const r = validateRtw(
      { ...base, permissionEndsOn: "2027-01-01", followUpDueOn: "2026-12-01" },
      T,
    );
    expect(r).toEqual({
      ok: true,
      data: { ...base, permissionEndsOn: null, followUpDueOn: null },
    });
  });

  it("needs a list for manual checks, and ignores it for other methods", () => {
    expect(errors({ listType: null })).toHaveProperty("listType");
    const r = validateRtw({ ...base, method: "online_check" }, T);
    expect(r.ok && r.data.listType).toBe(null);
  });

  it("matches the list to the outcome, and IDSP to continuous permission", () => {
    expect(errors({ outcome: "time_limited" })).toHaveProperty("outcome");
    expect(
      errors({
        listType: "list_b_group_1",
        outcome: "confirmed",
      }),
    ).toHaveProperty("outcome");
    expect(
      errors({ method: "idsp", listType: null, outcome: "time_limited" }),
    ).toHaveProperty("outcome");
    // "Couldn't be confirmed" is always recordable, whatever the method.
    expect(errors({ outcome: "not_confirmed", personPresent: false })).toEqual(
      {},
    );
  });

  it("time-limited needs an end date after the check, and a follow-up on or before it", () => {
    const tl = {
      listType: "list_b_group_1",
      outcome: "time_limited",
    };
    expect(errors(tl)).toHaveProperty("permissionEndsOn");
    expect(errors({ ...tl, permissionEndsOn: "2026-10-15" })).toHaveProperty(
      "permissionEndsOn",
    );
    expect(
      errors({
        ...tl,
        permissionEndsOn: "2027-01-01",
        followUpDueOn: "2027-01-02",
      }),
    ).toHaveProperty("followUpDueOn");
    const r = validateRtw(
      { ...base, ...tl, permissionEndsOn: "2027-01-01" },
      T,
    );
    expect(r.ok && r.data.followUpDueOn).toBe("2027-01-01"); // defaults to the end date
  });

  it("refuses future check dates and confirmed checks without the person present", () => {
    expect(errors({ checkedOn: "2026-10-21" })).toHaveProperty("checkedOn");
    expect(errors({ checkedOn: "2026-02-30" })).toHaveProperty("checkedOn");
    expect(errors({ personPresent: false })).toHaveProperty("personPresent");
  });

  it("keeps document numbers and share codes out of notes (decision D4)", () => {
    for (const note of [
      "Passport 123456789",
      "Share code W2X7K9P4R",
      "share code W2X 7K9 P4R",
      "BRP ZX1234567",
    ])
      expect(errors({ note }), note).toHaveProperty("note");
    for (const note of [
      "Checked in the office with the site manager",
      "Seen 15/10/2026, copy filed",
      "Level 2 done",
    ])
      expect(looksLikeIdentifier(note), note).toBe(false);
  });
});

describe("document checklist", () => {
  const doc = (
    required: boolean,
    status: "requested" | "seen" | "verified" | "rejected" | "waived",
    expiresOn: string | null = null,
  ) => ({ required, status, expiresOn });

  it("seen, verified or waived satisfies; expired, rejected and requested don't", () => {
    expect(
      documentProgressOf(
        [
          doc(true, "seen"),
          doc(true, "verified", "2026-10-19"), // expired
          doc(false, "waived"),
          doc(true, "rejected"),
          doc(false, "requested"),
          doc(true, "verified", "2026-12-01"), // expiring within 60 days
        ],
        T,
      ),
    ).toEqual({
      total: 6,
      satisfied: 3,
      requiredOutstanding: 2,
      rejected: 1,
      expired: 1,
      expiringSoon: 1,
    });
  });

  it("waiving a required document needs sign-off rights; every rejection or waiver needs a reason", () => {
    expect(
      mayCloseDocument(
        actor("site_manager", "s1"),
        "s1",
        true,
        "waive",
        "Not needed",
      ).ok,
    ).toBe(false);
    expect(
      mayCloseDocument(
        actor("site_manager", "s1"),
        "s1",
        false,
        "waive",
        "Not needed",
      ).ok,
    ).toBe(true);
    expect(
      mayCloseDocument(
        actor("site_manager", "s1"),
        "s1",
        true,
        "reject",
        "Blurred",
      ).ok,
    ).toBe(true);
    expect(
      mayCloseDocument(actor("hr_manager"), null, true, "waive", "Agreed").ok,
    ).toBe(true);
    expect(mayCloseDocument(actor("owner"), null, false, "reject", "")).toEqual(
      { ok: false, message: "Give a reason.", field: true },
    );
    expect(
      mayCloseDocument(
        actor("site_manager", "s1"),
        "s2",
        false,
        "reject",
        "Blurred",
      ).ok,
    ).toBe(false);
  });
});

describe("cleared to start", () => {
  const ready = progressOf(
    [{ required: true, status: "done", dueOn: null }],
    T,
  );
  const notReady = progressOf(
    [{ required: true, status: "to_do", dueOn: null }],
    T,
  );
  const reqDoc = { required: true, status: "seen" as const, expiresOn: null };

  it("needs required tasks, required documents and a recorded check covering the start date", () => {
    expect(clearanceOf(ready, [reqDoc], check(), "2026-11-01", T)).toEqual({
      on: "2026-11-01",
      tasksReady: true,
      documentsReady: true,
      rightToWork: true,
      cleared: true,
    });
    expect(
      clearanceOf(notReady, [reqDoc], check(), "2026-11-01", T).cleared,
    ).toBe(false);
    expect(
      clearanceOf(
        ready,
        [{ ...reqDoc, status: "requested" }],
        check(),
        "2026-11-01",
        T,
      ).documentsReady,
    ).toBe(false);
    expect(clearanceOf(ready, [], null, "2026-11-01", T).rightToWork).toBe(
      false,
    );
  });

  it("assesses the start date, or today once they've started", () => {
    // Permission ends before a future start date: not covered on the start date.
    expect(
      clearanceOf(ready, [], timeLimited("2026-10-30"), "2026-11-01", T)
        .rightToWork,
    ).toBe(false);
    // Started last week; a check recorded today covers today.
    const c = clearanceOf(ready, [], check({ checkedOn: T }), "2026-10-13", T);
    expect(c).toMatchObject({ on: T, rightToWork: true });
    // A certificate expiring before the start date doesn't count.
    expect(
      clearanceOf(
        ready,
        [{ ...reqDoc, expiresOn: "2026-10-31" }],
        check(),
        "2026-11-01",
        T,
      ).documentsReady,
    ).toBe(false);
  });
});

describe("right-to-work permissions on built-in roles (decision D1)", () => {
  it("owners, admins and HR view and record; site managers, recruiters and workers don't", () => {
    for (const key of ["owner", "admin", "hr_manager"])
      expect(actor(key).grants.get("rtw.record"), key).toBe("all");
    for (const key of ["site_manager", "recruiter", "worker"]) {
      expect(actor(key, "s1").grants.has("rtw.view"), key).toBe(false);
      expect(actor(key, "s1").grants.has("rtw.record"), key).toBe(false);
    }
  });
});
