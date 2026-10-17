import { describe, expect, it } from "vitest";

import { safeNext } from "@/lib/navigation/next";

describe("safeNext (post-sign-in destination)", () => {
  it("accepts same-site paths in known areas", () => {
    for (const ok of [
      "/platform",
      "/platform/staff",
      "/dashboard",
      "/people/abc-123",
      "/settings/sites",
    ])
      expect(safeNext(ok)).toBe(ok);
  });

  it("refuses other sites, protocol tricks and unknown areas", () => {
    for (const bad of [
      null,
      "",
      "https://evil.example/platform",
      "//evil.example/platform",
      "/\evil.example",
      "/platform?x=1",
      "/api/auth/sign-out",
      "/sign-in",
      "javascript:alert(1)",
      "/platform/../api",
    ])
      expect(safeNext(bad)).toBeNull();
  });
});
