import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { grantsFrom } from "@/lib/workspace/policy";
import {
  dueDate,
  isIsoDate,
  isOverdue,
  maySignOff,
  mayWaive,
  progressOf,
  templateSuits,
  todayIn,
  SUGGESTED_TEMPLATES,
  type Actor,
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
const task = (
  required: boolean,
  status: "to_do" | "done" | "waived",
  dueOn: string | null = null,
) => ({ required, status, dueOn });

describe("progress, readiness and sign-off are separate", () => {
  it("counts finished tasks, overdue tasks and required ones still open", () => {
    const p = progressOf(
      [
        task(true, "done"),
        task(true, "to_do", "2026-10-19"),
        task(false, "waived"),
        task(false, "to_do", "2026-10-25"),
      ],
      T,
    );
    expect(p).toEqual({
      total: 4,
      finished: 2,
      percent: 50,
      requiredOutstanding: 1,
      overdue: 1,
      operationallyReady: false,
    });
  });

  it("is operationally ready when every REQUIRED task is done or waived, even with optional ones open", () => {
    expect(
      progressOf(
        [task(true, "done"), task(true, "waived"), task(false, "to_do")],
        T,
      ).operationallyReady,
    ).toBe(true);
  });

  it("overdue means open and due before today (not on the day)", () => {
    expect(isOverdue(task(true, "to_do", "2026-10-19"), T)).toBe(true);
    expect(isOverdue(task(true, "to_do", T), T)).toBe(false);
    expect(isOverdue(task(true, "done", "2026-10-01"), T)).toBe(false);
    expect(isOverdue(task(true, "to_do", null), T)).toBe(false);
  });

  it("sign-off needs the permission, readiness, and not your own record", () => {
    const ready = progressOf([task(true, "done")], T);
    const notReady = progressOf([task(true, "to_do")], T);
    expect(maySignOff(actor("owner"), null, ready, false).ok).toBe(true);
    expect(maySignOff(actor("hr_manager"), null, ready, false).ok).toBe(true);
    expect(maySignOff(actor("site_manager", "s1"), "s1", ready, false).ok).toBe(
      false,
    );
    expect(maySignOff(actor("owner"), null, notReady, false)).toMatchObject({
      ok: false,
      message: "1 required task is still open.",
    });
    expect(maySignOff(actor("owner"), null, ready, true).ok).toBe(false);
  });
});

describe("exceptions (waivers)", () => {
  it("need a reason; required tasks need an owner, admin or HR manager", () => {
    expect(mayWaive(actor("owner"), null, true, "").ok).toBe(false);
    expect(
      mayWaive(actor("owner"), null, true, "Already has the certificate").ok,
    ).toBe(true);
    expect(
      mayWaive(actor("site_manager", "s1"), "s1", true, "Reason given").ok,
    ).toBe(false);
    expect(
      mayWaive(actor("site_manager", "s1"), "s1", false, "Not needed here").ok,
    ).toBe(true);
    expect(
      mayWaive(actor("site_manager", "s1"), "s2", false, "Other site").ok,
    ).toBe(false);
  });
});

describe("dates", () => {
  it("works out due dates by calendar, across month and year ends", () => {
    expect(dueDate("2026-10-20", 0)).toBe("2026-10-20");
    expect(dueDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(dueDate("2026-12-30", 7)).toBe("2027-01-06");
    expect(dueDate("2026-03-02", -3)).toBe("2026-02-27");
  });

  it("uses the organisation's time zone for today", () => {
    // In winter London is on UTC, so 23:30 UTC is still the same day.
    expect(todayIn("Europe/London", new Date("2026-10-31T23:30:00Z"))).toBe(
      "2026-10-31",
    );
    // In British Summer Time, 23:30 UTC is the next day in London.
    expect(todayIn("Europe/London", new Date("2026-07-01T23:30:00Z"))).toBe(
      "2026-07-02",
    );
  });

  it("accepts only real calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "20-10-2026", "", null, 5])
      expect(isIsoDate(bad), String(bad)).toBe(false);
  });
});

describe("templates", () => {
  it("suit people by organisation, site or job title (ignoring capitals)", () => {
    const e = { primarySiteId: "s1", jobTitle: "Kitchen Porter" };
    expect(
      templateSuits({ scope: "organisation", siteId: null, jobTitle: null }, e),
    ).toBe(true);
    expect(
      templateSuits({ scope: "site", siteId: "s1", jobTitle: null }, e),
    ).toBe(true);
    expect(
      templateSuits({ scope: "site", siteId: "s2", jobTitle: null }, e),
    ).toBe(false);
    expect(
      templateSuits(
        { scope: "job_title", siteId: null, jobTitle: "kitchen porter " },
        e,
      ),
    ).toBe(true);
    expect(
      templateSuits({ scope: "job_title", siteId: null, jobTitle: "Chef" }, e),
    ).toBe(false);
  });

  it("suggested templates are labelled, have tasks, and contain no right-to-work step", () => {
    expect(SUGGESTED_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const t of SUGGESTED_TEMPLATES) {
      expect(t.name).toMatch(/\(suggested\)$/);
      expect(t.tasks.length).toBeGreaterThan(5);
      expect(JSON.stringify(t)).not.toMatch(
        /right to work|right-to-work|passport|share code|visa/i,
      );
      for (const task of t.tasks) {
        expect(task.title.length).toBeLessThanOrEqual(160);
        expect(task.due).toBeGreaterThanOrEqual(-90);
        expect(task.due).toBeLessThanOrEqual(365);
      }
    }
  });
});

describe("onboarding permissions on built-in roles", () => {
  const perms = (key: string) =>
    SYSTEM_ROLES.find((r) => r.key === key)!.permissions;
  it("matches the approved scope", () => {
    for (const key of ["owner", "admin", "hr_manager"])
      expect(perms(key)).toEqual(
        expect.arrayContaining([
          "onboarding.view",
          "onboarding.manage",
          "onboarding.template.manage",
          "onboarding.signoff",
        ]),
      );
    expect(perms("site_manager")).toEqual(
      expect.arrayContaining(["onboarding.view", "onboarding.manage"]),
    );
    expect(perms("site_manager")).not.toContain("onboarding.signoff");
    expect(perms("site_manager")).not.toContain("onboarding.template.manage");
    for (const key of ["recruiter", "worker"])
      expect(perms(key).filter((p) => p.startsWith("onboarding."))).toEqual([]);
  });
});
