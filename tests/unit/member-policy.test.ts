import { describe, expect, it } from "vitest";

import {
  hashInvitationToken,
  invitationLink,
  newInvitationToken,
} from "@/lib/invitations/token";
import { safeNext } from "@/lib/navigation/next";
import { SYSTEM_ROLES } from "@/lib/permissions/catalogue";
import {
  canViewMembers,
  keepsAnOwner,
  mayChangeMember,
  mayGrantRole,
} from "@/lib/workspace/member-policy";
import { grantsFrom } from "@/lib/workspace/policy";

const role = (key: string) => {
  const r = SYSTEM_ROLES.find((x) => x.key === key)!;
  return { key: r.key, permissions: r.permissions };
};
const grantsOf = (key: string, siteId: string | null = null) =>
  grantsFrom([{ siteId, permissions: role(key).permissions }]);

describe("who can see and change members", () => {
  it("owners and admins can; HR, site managers and workers can't", () => {
    expect(canViewMembers(grantsOf("owner"))).toBe(true);
    expect(canViewMembers(grantsOf("admin"))).toBe(true);
    for (const key of ["hr_manager", "site_manager", "recruiter", "worker"])
      expect(canViewMembers(grantsOf(key)), key).toBe(false);
  });

  it("site-scoped grants never count as organisation-wide", () => {
    expect(canViewMembers(grantsOf("admin", "site-1"))).toBe(false);
  });
});

describe("granting roles", () => {
  it("only an owner can make someone an owner", () => {
    expect(mayGrantRole(grantsOf("admin"), false, role("owner"), null).ok).toBe(
      false,
    );
    expect(mayGrantRole(grantsOf("owner"), true, role("owner"), null).ok).toBe(
      true,
    );
    expect(mayGrantRole(grantsOf("admin"), false, role("admin"), null).ok).toBe(
      true,
    );
  });

  it("you can't hand out permissions you don't hold organisation-wide", () => {
    const hr = grantsOf("hr_manager");
    expect(mayGrantRole(hr, false, role("site_manager"), null)).toMatchObject({
      ok: false,
    });
    expect(mayGrantRole(hr, false, role("worker"), null).ok).toBe(true);
  });

  it("owner and admin roles can't be limited to one site", () => {
    expect(
      mayGrantRole(grantsOf("owner"), true, role("admin"), "site-1").ok,
    ).toBe(false);
    expect(
      mayGrantRole(grantsOf("owner"), true, role("site_manager"), "site-1").ok,
    ).toBe(true);
  });
});

describe("changing members", () => {
  const target = { isSelf: false, isOwner: false, status: "active" as const };

  it("nobody changes their own access, and only owners change owners", () => {
    expect(mayChangeMember(true, { ...target, isSelf: true }).ok).toBe(false);
    expect(mayChangeMember(false, { ...target, isOwner: true }).ok).toBe(false);
    expect(mayChangeMember(true, { ...target, isOwner: true }).ok).toBe(true);
    expect(mayChangeMember(true, { ...target, status: "left" }).ok).toBe(false);
  });

  it("the last active owner can't be demoted, suspended or removed", () => {
    const owner = { ...target, isOwner: true };
    expect(keepsAnOwner(owner, false, true, 1).ok).toBe(false); // demoted
    expect(keepsAnOwner(owner, true, false, 1).ok).toBe(false); // suspended/removed
    expect(keepsAnOwner(owner, false, true, 2).ok).toBe(true); // another owner remains
    expect(keepsAnOwner(owner, true, true, 1).ok).toBe(true); // stays owner
    expect(keepsAnOwner(target, false, false, 1).ok).toBe(true); // not an owner
    // A suspended owner isn't counted, so changing them can't strand anyone.
    expect(
      keepsAnOwner({ ...owner, status: "suspended" }, false, true, 1).ok,
    ).toBe(true);
  });
});

describe("invite link tokens", () => {
  it("are 32 random bytes; only the SHA-256 hash is stored", () => {
    const a = newInvitationToken();
    const b = newInvitationToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashInvitationToken(a.token));
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toContain(a.token);
  });

  it("reject anything that isn't a token", () => {
    for (const bad of [
      "",
      "abc",
      "a".repeat(44),
      "../../etc",
      `${"a".repeat(42)}=`,
    ])
      expect(hashInvitationToken(bad)).toBe("");
  });

  it("travel in the fragment, which browsers never send to the server", () => {
    const link = invitationLink(
      "https://team-happi.vercel.app",
      "x".repeat(43),
    );
    expect(link).toBe(`https://team-happi.vercel.app/invite#${"x".repeat(43)}`);
    expect(new URL(link).search).toBe("");
  });

  it("signing in can return to the invite page", () => {
    expect(safeNext("/invite")).toBe("/invite");
    expect(safeNext("//invite")).toBeNull();
  });
});
