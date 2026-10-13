import { describe, expect, it } from "vitest";

import { parseServerEnv, resolveAppUrl } from "@/lib/env/schema";

describe("parseServerEnv", () => {
  it("applies safe defaults when optional variables are absent", () => {
    expect(parseServerEnv({})).toEqual({
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
      LOG_LEVEL: "info",
    });
  });

  it("accepts valid values", () => {
    const env = parseServerEnv({
      NODE_ENV: "production",
      APP_URL: "https://example.teamhappi.app",
      LOG_LEVEL: "warn",
    });
    expect(env.APP_URL).toBe("https://example.teamhappi.app");
    expect(env.LOG_LEVEL).toBe("warn");
  });

  it("rejects invalid values and names the variable without echoing its value", () => {
    const secretLooking = "not-a-url-but-maybe-a-secret";
    let message = "";
    try {
      parseServerEnv({ APP_URL: secretLooking });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("APP_URL");
    expect(message).not.toContain(secretLooking);
  });

  it("rejects an unknown log level", () => {
    expect(() => parseServerEnv({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });
});

describe("authentication settings", () => {
  it("accepts an auth database URL and a long secret", () => {
    const env = parseServerEnv({
      AUTH_DATABASE_URL:
        "postgresql://teamhappi_auth:x@localhost:5432/teamhappi",
      BETTER_AUTH_SECRET: "s".repeat(32),
    });
    expect(env.AUTH_DATABASE_URL).toContain("teamhappi_auth");
  });

  it("rejects a short auth secret without echoing it", () => {
    const secret = "too-short-secret";
    let message = "";
    try {
      parseServerEnv({ BETTER_AUTH_SECRET: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).not.toContain(secret);
  });
});

describe("APP_URL on Vercel", () => {
  it("prefers an explicit APP_URL", () => {
    expect(
      resolveAppUrl({ APP_URL: "https://a.example", VERCEL_ENV: "production" }),
    ).toBe("https://a.example");
  });
  it("uses the production domain in production and the branch alias in previews", () => {
    expect(
      resolveAppUrl({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "th.vercel.app",
      }),
    ).toBe("https://th.vercel.app");
    expect(
      resolveAppUrl({
        VERCEL_ENV: "preview",
        VERCEL_BRANCH_URL: "th-git-x.vercel.app",
        VERCEL_URL: "th-abc.vercel.app",
      }),
    ).toBe("https://th-git-x.vercel.app");
  });
  it("falls back to the local default off Vercel", () => {
    expect(resolveAppUrl({})).toBeUndefined();
    expect(parseServerEnv({}).APP_URL).toBe("http://localhost:3000");
  });
});
