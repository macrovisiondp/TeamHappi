import { describe, expect, it } from "vitest";

import { complianceItems } from "@/features/dashboard/summary";
import { DEMO_EMPLOYEES, type DemoEmployee } from "@/features/demo/fixtures";
import {
  DEFAULT_FILTERS,
  filterEmployees,
  fullName,
} from "@/features/people/directory";
import {
  daysBetween,
  formatDate,
  formatDay,
  formatTime,
  formatTimeRange,
} from "@/lib/format";

describe("UK formatting (en-GB, Europe/London)", () => {
  it("formats dates day-month-year", () => {
    expect(formatDate("2026-10-12T08:00:00Z")).toBe("12 Oct 2026");
    expect(formatDay("2026-10-12T08:00:00Z")).toBe("Monday 12 October");
  });

  it("uses the 24-hour clock in London time (BST in October, GMT in December)", () => {
    expect(formatTime("2026-10-12T16:30:00Z")).toBe("17:30");
    expect(formatTime("2026-12-12T16:30:00Z")).toBe("16:30");
    expect(
      formatTimeRange("2026-10-12T08:00:00Z", "2026-10-12T16:00:00Z"),
    ).toBe("09:00–17:00");
  });

  it("counts whole days", () => {
    expect(daysBetween("2026-10-12T08:00:00Z", "2026-11-30")).toBe(49);
  });
});

describe("people directory filtering", () => {
  it("returns everyone sorted by family name by default", () => {
    const all = filterEmployees(DEMO_EMPLOYEES, DEFAULT_FILTERS);
    expect(all).toHaveLength(DEMO_EMPLOYEES.length);
    const names = all.map((e) => e.familyName);
    expect(names).toEqual(
      [...names].sort((a, b) => a.localeCompare(b, "en-GB")),
    );
  });

  it("searches name, role and employee number, ignoring case and accents", () => {
    const people = [
      {
        ...DEMO_EMPLOYEES[0]!,
        givenName: "Zoë",
        familyName: "Ångström",
        role: "Chef",
      },
      {
        ...DEMO_EMPLOYEES[1]!,
        givenName: "Sam",
        familyName: "Lee",
        role: "Barista",
      },
    ] as DemoEmployee[];
    expect(
      filterEmployees(people, { ...DEFAULT_FILTERS, query: "zoe ang" }),
    ).toHaveLength(1);
    expect(
      filterEmployees(people, { ...DEFAULT_FILTERS, query: "BARISTA" })[0]!
        .givenName,
    ).toBe("Sam");
    expect(
      filterEmployees(people, {
        ...DEFAULT_FILTERS,
        query: people[1]!.employeeNumber,
      }),
    ).toHaveLength(1);
  });

  it("filters by site and status together", () => {
    const result = filterEmployees(DEMO_EMPLOYEES, {
      query: "",
      siteId: "site-lane",
      status: "onboarding",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(
      result.every(
        (e) => e.siteId === "site-lane" && e.status === "onboarding",
      ),
    ).toBe(true);
  });

  it("uses the preferred name when present", () => {
    expect(
      fullName({ givenName: "Robert", preferredName: "Bob", familyName: "Ng" }),
    ).toBe("Bob Ng");
  });
});

describe("dashboard compliance list", () => {
  it("lists urgent items first and ignores people who have left", () => {
    const items = complianceItems();
    const firstWarning = items.findIndex((i) => i.tone === "warning");
    const lastDanger = items.map((i) => i.tone).lastIndexOf("danger");
    expect(lastDanger).toBeLessThan(firstWarning);
    const leftIds = DEMO_EMPLOYEES.filter((e) => e.status === "left").map(
      (e) => e.id,
    );
    expect(items.some((i) => leftIds.includes(i.employeeId))).toBe(false);
  });

  it("every item carries a text label, not just a colour", () => {
    for (const item of complianceItems())
      expect(item.label.length).toBeGreaterThan(0);
  });
});

describe("demo fixtures", () => {
  it("use only reserved example email domains and drama phone numbers", () => {
    for (const e of DEMO_EMPLOYEES) {
      expect(e.email).toMatch(/@example\.test$/);
      expect(e.phone).toMatch(/^07700 900\d{3}$/);
    }
  });
});
