import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env/schema";

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
