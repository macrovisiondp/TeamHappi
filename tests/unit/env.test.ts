import { describe, expect, it } from "vitest";

import {
  cleanEnvValue,
  describeDatabaseUrl,
  parseServerEnv,
  resolveAppUrl,
} from "@/lib/env/schema";

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

describe("pasted environment values", () => {
  const PW = ["p", "w", "1", "2", "3"].join("");
  const good = `postgresql://teamhappi_auth:${PW}@ep-x-pooler.eu-west-2.aws.neon.tech/teamhappi?sslmode=verify-full`;

  it("repairs quotes, whitespace, line breaks and a leading NAME=", () => {
    for (const pasted of [
      `"${good}"`,
      `  ${good}\n`,
      `AUTH_DATABASE_URL=${good}`,
      `AUTH_DATABASE_URL="${good}"`,
      good.replace("pooler.", "pooler.\n"),
    ])
      expect(cleanEnvValue("AUTH_DATABASE_URL", pasted)).toBe(good);
  });

  it("removes <> left around the password and encodes reserved characters", () => {
    expect(
      cleanEnvValue("AUTH_DATABASE_URL", good.replace(PW, `<${PW}>`)),
    ).toBe(good);
    const tricky = good.replace(PW, "a@b/c#d");
    const repaired = cleanEnvValue("AUTH_DATABASE_URL", tricky);
    expect(new URL(repaired).password).toBe(encodeURIComponent("a@b/c#d"));
    expect(new URL(repaired).hostname).toBe(
      "ep-x-pooler.eu-west-2.aws.neon.tech",
    );
  });

  it("parses a damaged paste and never puts the password in errors", () => {
    expect(
      parseServerEnv({ AUTH_DATABASE_URL: `"AUTH_DATABASE_URL=${good}"` })
        .AUTH_DATABASE_URL,
    ).toBe(good);
    let message = "";
    try {
      parseServerEnv({ AUTH_DATABASE_URL: `teamhappi_auth:${PW}@host/db` });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/AUTH_DATABASE_URL \(looks like/);
    expect(message).not.toContain(PW);
    expect(describeDatabaseUrl(good)).toBe(
      "postgresql://teamhappi_auth:****@ep-x-pooler.eu-west-2.aws.neon.tech/teamhappi",
    );
  });

  it("explains a short auth secret without revealing it", () => {
    expect(() =>
      parseServerEnv({ BETTER_AUTH_SECRET: "x".repeat(20) }),
    ).toThrow("BETTER_AUTH_SECRET (20 characters; needs at least 32)");
  });
});
