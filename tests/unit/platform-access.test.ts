import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertPrivilegedPlatformAction,
  decidePlatformAccess,
  parseAllowList,
  PlatformActionUnavailableError,
} from "@/lib/platform-access/policy";

const staff = { userId: "u1", name: "Ada", email: "ada.verified@example.test" };
const tenantAdmin = {
  userId: "u2",
  name: "Tia",
  email: "tenant.admin@example.test",
};
const allow = parseAllowList(
  " Ada.Verified@example.test , real.person@gmail.com ,",
);

describe("platform access decision (server-side)", () => {
  it("only accepts synthetic addresses in the preview allow-list", () => {
    expect([...allow]).toEqual(["ada.verified@example.test"]);
  });

  it("signed-out visitors get nothing", () => {
    expect(decidePlatformAccess(null, "local", allow)).toEqual({
      kind: "none",
    });
  });

  it("a tenant administrator who is not platform staff is refused", () => {
    expect(decidePlatformAccess(tenantAdmin, "local", allow)).toEqual({
      kind: "none",
    });
  });

  it("preview staff get read-only access outside production", () => {
    for (const env of ["local", "preview"] as const) {
      expect(decidePlatformAccess(staff, env, allow)).toMatchObject({
        kind: "preview",
        mfaVerified: false,
        privilegedActions: false,
      });
    }
  });

  it("preview access is never granted in production", () => {
    expect(decidePlatformAccess(staff, "production", allow)).toEqual({
      kind: "none",
    });
  });

  it("privileged platform actions are refused, even for preview staff", () => {
    const access = decidePlatformAccess(staff, "local", allow);
    expect(() => assertPrivilegedPlatformAction(access)).toThrow(
      PlatformActionUnavailableError,
    );
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

  it("only the access module reads the preview staff list", () => {
    const offenders = SRC.filter((f) =>
      /PLATFORM_PREVIEW_STAFF_EMAILS/.test(f.text),
    )
      .filter(
        (f) =>
          !f.path.startsWith("src/lib/platform-access/") &&
          f.path !== "src/lib/env/schema.ts",
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
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
