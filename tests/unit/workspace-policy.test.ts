import { describe, expect, it } from "vitest";

import {
  can,
  chooseOrganisation,
  grantsFrom,
  siteIdsFor,
  type MembershipSummary,
} from "@/lib/workspace/policy";

const m = (
  tenantId: string,
  tenantStatus: MembershipSummary["tenantStatus"] = "active",
  membershipStatus: MembershipSummary["membershipStatus"] = "active",
): MembershipSummary => ({
  tenantId,
  name: tenantId,
  slug: tenantId,
  tenantStatus,
  membershipStatus,
});

describe("chooseOrganisation", () => {
  it("picks the only usable membership", () => {
    expect(chooseOrganisation([m("a")], undefined)).toEqual({
      kind: "selected",
      tenantId: "a",
    });
  });

  it("asks to choose between several, unless a valid preference exists", () => {
    expect(chooseOrganisation([m("a"), m("b")], undefined).kind).toBe("choose");
    expect(chooseOrganisation([m("a"), m("b")], "b")).toEqual({
      kind: "selected",
      tenantId: "b",
    });
  });

  it("ignores a preference that isn't a usable membership", () => {
    expect(chooseOrganisation([m("a")], "zzz")).toEqual({
      kind: "selected",
      tenantId: "a",
    });
    expect(chooseOrganisation([m("a"), m("b", "suspended")], "b")).toEqual({
      kind: "selected",
      tenantId: "a",
    });
  });

  it("reports blocked memberships when nothing is usable", () => {
    const blocked = [m("a", "suspended"), m("b", "active", "suspended")];
    expect(chooseOrganisation(blocked, "a")).toEqual({ kind: "none", blocked });
    expect(chooseOrganisation([], undefined)).toEqual({
      kind: "none",
      blocked: [],
    });
  });
});

describe("grants", () => {
  const grants = grantsFrom([
    { siteId: "s1", permissions: ["employee.view", "site.view"] },
    { siteId: "s2", permissions: ["employee.view"] },
    { siteId: null, permissions: ["site.view"] },
  ]);

  it("unions site scopes and lets organisation-wide win", () => {
    expect(siteIdsFor(grants.get("employee.view")!)?.sort()).toEqual([
      "s1",
      "s2",
    ]);
    expect(grants.get("site.view")).toBe("all");
  });

  it("checks permissions per site", () => {
    expect(can(grants, "employee.view", "s1")).toBe(true);
    expect(can(grants, "employee.view", "s3")).toBe(false);
    expect(can(grants, "employee.view")).toBe(false);
    expect(can(grants, "site.view", "anything")).toBe(true);
    expect(can(grants, "employee.manage", "s1")).toBe(false);
  });
});
