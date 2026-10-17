import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkPrivilege,
  decidePlatformAccess,
  MFA_ACCESS_MS,
  STEP_UP_MS,
  type IdentityInput,
} from "@/lib/platform-access/policy";
import { issuePlatformStaffActor } from "@/platform/authz/internal";

const NOW = new Date("2026-10-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const user = { userId: "u1", name: "Joseph", email: "joseph@example.test" };
const identity = (over: Partial<IdentityInput> = {}): IdentityInput => ({
  user,
  staff: { status: "active", grants: ["staff.manage", "audit.view"] },
  mfaEnrolled: true,
  mfaLockedUntil: null,
  mfaVerifiedAt: ago(60_000),
  ...over,
});

describe("platform access decision (server-side)", () => {
  it("signed-out users, non-staff and suspended or revoked staff get nothing", () => {
    expect(decidePlatformAccess(null, NOW)).toEqual({ kind: "none" });
    expect(decidePlatformAccess(identity({ staff: null }), NOW)).toEqual({
      kind: "none",
    });
    for (const status of ["suspended", "revoked"])
      expect(
        decidePlatformAccess(
          identity({ staff: { status, grants: ["staff.manage"] } }),
          NOW,
        ),
      ).toEqual({ kind: "none" });
  });

  it("staff without MFA must enrol; enrolled staff must verify in this session", () => {
    expect(
      decidePlatformAccess(identity({ mfaEnrolled: false }), NOW).kind,
    ).toBe("enrol");
    expect(
      decidePlatformAccess(identity({ mfaVerifiedAt: null }), NOW).kind,
    ).toBe("verify");
    expect(
      decidePlatformAccess(
        identity({ mfaVerifiedAt: ago(MFA_ACCESS_MS + 1) }),
        NOW,
      ).kind,
    ).toBe("verify");
    expect(decidePlatformAccess(identity(), NOW)).toMatchObject({
      kind: "staff",
    });
  });

  it("privileged actions need the grant AND MFA within 15 minutes", () => {
    const fresh = decidePlatformAccess(identity(), NOW);
    expect(checkPrivilege(fresh, "staff.manage", NOW)).toEqual({ ok: true });
    expect(checkPrivilege(fresh, "tenant.suspend", NOW)).toEqual({
      ok: false,
      reason: "forbidden",
    });
    const stale = decidePlatformAccess(
      identity({ mfaVerifiedAt: ago(STEP_UP_MS + 1) }),
      NOW,
    );
    expect(checkPrivilege(stale, "staff.manage", NOW)).toEqual({
      ok: false,
      reason: "step_up",
    });
    expect(checkPrivilege({ kind: "none" }, "staff.manage", NOW)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("the actor issuer independently refuses stale MFA and inactive staff", () => {
    const base = { userId: "u1", grants: ["staff.manage"] as const, now: NOW };
    expect(() =>
      issuePlatformStaffActor({
        ...base,
        status: "active",
        mfaVerifiedAt: ago(1000),
      }),
    ).not.toThrow();
    expect(() =>
      issuePlatformStaffActor({
        ...base,
        status: "active",
        mfaVerifiedAt: ago(STEP_UP_MS + 1),
      }),
    ).toThrow();
    expect(() =>
      issuePlatformStaffActor({
        ...base,
        status: "active",
        mfaVerifiedAt: null,
      }),
    ).toThrow();
    expect(() =>
      issuePlatformStaffActor({
        ...base,
        status: "suspended",
        mfaVerifiedAt: ago(1000),
      }),
    ).toThrow();
  });
});

// --- Source guards -------------------------------------------------------------

const ROOT = join(__dirname, "..", "..");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory())
      return name === "generated" ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const SRC = files(join(ROOT, "src")).map((full) => ({
  path: relative(ROOT, full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));

describe("platform and integration guards", () => {
  it("client components never import integration code or platform access", () => {
    const offenders = SRC.filter((f) => /^["']use client["']/m.test(f.text))
      .filter((f) =>
        /from\s+["']@\/(integrations|lib\/platform-access)/.test(f.text),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no secret is exposed through a NEXT_PUBLIC_ variable", () => {
    const offenders = SRC.filter((f) =>
      /NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD|DATABASE)/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("no preview allow-list or email-based platform access remains", () => {
    const offenders = SRC.filter((f) =>
      /PLATFORM_PREVIEW_STAFF_EMAILS|parseAllowList/.test(f.text),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only src/lib/platform-access uses staff administration and the actor issuer", () => {
    const admin = SRC.filter((f) => /platformStaffAdmin/.test(f.text))
      .filter(
        (f) =>
          !f.path.startsWith("src/lib/auth/") &&
          !f.path.startsWith("src/lib/platform-access/"),
      )
      .map((f) => f.path);
    expect(admin).toEqual([]);
    const issuer = SRC.filter((f) => /issuePlatformStaffActor/.test(f.text))
      .filter(
        (f) =>
          !f.path.startsWith("src/platform/") &&
          !f.path.startsWith("src/lib/platform-access/"),
      )
      .map((f) => f.path);
    expect(issuer).toEqual([]);
  });

  it("MFA and staff tables are reached only through src/lib/auth", () => {
    const offenders = SRC.filter((f) => !f.path.startsWith("src/lib/auth/"))
      .filter((f) =>
        /\.(platformStaff|userMfa|mfaRecoveryCode|platformAuditEvent)\./.test(
          f.text,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the console layout enforces MFA for every console page", () => {
    const layout = SRC.find(
      (f) => f.path === "src/app/platform/(console)/layout.tsx",
    )!.text;
    expect(layout).toMatch(/redirect\("\/platform\/mfa\/setup"\)/);
    expect(layout).toMatch(/redirect\("\/platform\/mfa\/verify"\)/);
    const outside = SRC.filter(
      (f) =>
        /^src\/app\/platform\/[^(]/.test(f.path) && f.path.endsWith("page.tsx"),
    )
      .map((f) => f.path)
      .sort();
    expect(outside).toEqual([
      "src/app/platform/mfa/setup/page.tsx",
      "src/app/platform/mfa/verify/page.tsx",
      "src/app/platform/page.tsx",
    ]);
  });

  it("the platform layout gates every page on the server and returns 404 otherwise", () => {
    const layout = SRC.find(
      (f) => f.path === "src/app/platform/layout.tsx",
    )!.text;
    expect(layout).toMatch(/getPlatformAccess\(\)/);
    expect(layout).toMatch(/notFound\(\)/);
  });

  it("every platform page renders per request", () => {
    const pages = SRC.filter((f) =>
      /^src\/app\/platform\/.*(page|layout)\.tsx$/.test(f.path),
    );
    expect(pages.length).toBeGreaterThanOrEqual(10);
    for (const page of pages)
      expect(page.text, page.path).toMatch(/export const instant = false/);
  });

  it("integration adapters make no network calls yet", () => {
    const offenders = SRC.filter((f) => f.path.startsWith("src/integrations/"))
      .filter((f) =>
        /\bfetch\(|from\s+["'](node:)?(https?|net|tls)["']|from\s+["'](@aws-sdk|stripe|resend|openai|@anthropic-ai|@google|cloudinary)/.test(
          f.text,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
