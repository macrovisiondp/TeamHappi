import { describe, expect, it } from "vitest";

import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import { grantsFrom } from "@/lib/workspace/policy";
import {
  WORKING_STAGES,
  mayHire,
  mayMove,
  parsePay,
  reviewDueOn,
  stageLabels,
  utcToZoned,
  zonedToUtc,
} from "@/modules/recruitment";

describe("pipeline (D2: fixed system stages, renamable labels)", () => {
  it("has the five working stages in order", () => {
    expect(WORKING_STAGES).toEqual([
      "applied",
      "screening",
      "shortlisted",
      "interview",
      "offer",
    ]);
  });

  it("renames only working stages, trimmed and limited", () => {
    const l = stageLabels({
      screening: "  Phone screen ",
      hired: "Welcome!",
      nonsense: "x",
      offer: "",
      interview: "x".repeat(60),
    });
    expect(l.screening).toBe("Phone screen");
    expect(l.hired).toBe("Hired"); // end stages keep their names
    expect(l.offer).toBe("Offer"); // blank keeps the default
    expect(l.interview).toHaveLength(40);
    expect(stageLabels(null).applied).toBe("Applied");
  });

  it("moves only between working stages, on open applications", () => {
    expect(mayMove("active", "applied", "interview").ok).toBe(true);
    expect(mayMove("active", "offer", "screening").ok).toBe(true); // backwards is allowed
    expect(mayMove("active", "applied", "applied").ok).toBe(false);
    expect(mayMove("active", "offer", "hired").ok).toBe(false); // only via Hire
    expect(mayMove("active", "offer", "rejected").ok).toBe(false); // only via Reject
    expect(mayMove("rejected", "rejected", "applied").ok).toBe(false); // closed
  });

  it("hires only from Offer, once", () => {
    expect(mayHire("active", "offer").ok).toBe(true);
    expect(mayHire("active", "interview")).toEqual({
      ok: false,
      message: "Move the application to Offer first.",
    });
    expect(mayHire("hired", "hired").ok).toBe(false);
    expect(mayHire("withdrawn", "withdrawn").ok).toBe(false);
  });
});

describe("retention review (D6, manual)", () => {
  it("is due N months after the last application closed, and never while one is open", () => {
    expect(reviewDueOn([{ closedOn: "2026-01-31" }], 6)).toBe("2026-07-31");
    expect(
      reviewDueOn([{ closedOn: "2026-01-10" }, { closedOn: "2026-03-05" }], 6),
    ).toBe("2026-09-05");
    expect(
      reviewDueOn([{ closedOn: "2026-01-10" }, { closedOn: null }], 6),
    ).toBeNull();
    expect(reviewDueOn([], 6)).toBeNull();
    expect(reviewDueOn([{ closedOn: "2026-08-31" }], 6)).toBe("2027-02-28"); // month-end
  });
});

describe("pay is a decimal string, never a float (D5)", () => {
  it("normalises valid amounts and refuses the rest", () => {
    expect(parsePay("12.5")).toBe("12.50");
    expect(parsePay("£11")).toBe("11.00");
    expect(parsePay("24000")).toBe("24000.00");
    expect(parsePay("")).toBeNull();
    expect(parsePay(undefined)).toBeNull();
    for (const bad of ["12.345", "-1", "abc", "1e3", "12,50", "123456789"])
      expect(parsePay(bad), bad).toBe(false);
  });
});

describe("interview times in the organisation's time zone", () => {
  const TZ = "Europe/London";
  it("converts local wall-clock time to an instant in winter and summer", () => {
    expect(zonedToUtc("2026-01-15T14:30", TZ)?.toISOString()).toBe(
      "2026-01-15T14:30:00.000Z",
    ); // GMT
    expect(zonedToUtc("2026-07-15T14:30", TZ)?.toISOString()).toBe(
      "2026-07-15T13:30:00.000Z",
    ); // BST
    expect(utcToZoned(new Date("2026-07-15T13:30:00Z"), TZ)).toBe(
      "2026-07-15T14:30",
    );
  });

  it("refuses malformed or impossible times", () => {
    for (const bad of [
      "2026-02-30T10:00",
      "2026-01-15 14:30",
      "",
      null,
      "2026-01-15T25:00",
    ])
      expect(zonedToUtc(bad, TZ), String(bad)).toBeNull();
  });
});

describe("recruitment permissions on built-in roles (D3)", () => {
  const grants = (key: string, site: string | null = null) =>
    grantsFrom([
      {
        siteId: site,
        permissions: SYSTEM_ROLES.find((r) => r.key === key)!.permissions,
      },
    ]);
  it("owners, admins and HR do everything; recruiters and site managers manage but don't hire; workers nothing", () => {
    for (const key of ["owner", "admin", "hr_manager"])
      for (const code of [
        "recruitment.view",
        "recruitment.manage",
        "recruitment.hire",
        "recruitment.settings",
      ] as const)
        expect(grants(key).get(code), `${key} ${code}`).toBe("all");
    for (const key of ["recruiter", "site_manager"]) {
      const g = grants(key, "s1");
      expect(g.has("recruitment.view"), key).toBe(true);
      expect(g.has("recruitment.manage"), key).toBe(true);
      expect(g.has("recruitment.hire"), key).toBe(false);
      expect(g.has("recruitment.settings"), key).toBe(false);
    }
    expect(grants("worker").has("recruitment.view")).toBe(false);
  });
});
