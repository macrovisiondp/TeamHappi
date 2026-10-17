// Source-level guards that complement ESLint: they fail even if lint rules are
// edited or disabled with an inline comment.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "generated" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

// Comments are removed so documentation can mention set_config freely.
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const files = sourceFiles(SRC).map((full) => {
  const text = readFileSync(full, "utf8");
  return {
    path: relative(ROOT, full).split(sep).join("/"),
    text,
    code: stripComments(text),
  };
});

const CONTEXT_WRITE =
  /set_config|(^|[^a-z_])(set|reset)[ \t\r\n]+(session[ \t\r\n]+|local[ \t\r\n]+)?app[.]/i;

describe("tenant context can only be set transaction-locally, in one place", () => {
  it("only with-tenant.ts touches tenant settings", () => {
    const offenders = files
      .filter((f) => f.path !== "src/lib/tenancy/with-tenant.ts")
      .filter((f) => CONTEXT_WRITE.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("with-tenant.ts sets every setting with is_local = true", () => {
    const text = files.find(
      (f) => f.path === "src/lib/tenancy/with-tenant.ts",
    )!.code;
    const calls = [
      ...text.matchAll(/set_config\(([^)]*\([^)]*\))?[^)]*\)/g),
    ].map((m) => m[0]);
    expect(calls.length).toBe(3);
    for (const call of calls)
      expect(call.replace(/\s/g, "")).toMatch(/,true\)$/);
  });

  it("no unparameterised raw SQL anywhere in src", () => {
    const offenders = files
      .filter((f) => /\$(query|execute)RawUnsafe|Prisma\.raw\(/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("transaction time limits cannot be changed by application code", () => {
  it("only tx-budget.ts mentions the verification override", () => {
    const offenders = files
      .filter((f) => f.path !== "src/lib/tenancy/tx-budget.ts")
      .filter((f) => /configureVerificationTxBudget|resetTxBudget/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("withTenant takes no per-call timeout option", () => {
    const code = files.find(
      (f) => f.path === "src/lib/tenancy/with-tenant.ts",
    )!.code;
    expect(code).toMatch(
      /maxWait: txBudget\(\)\.maxWaitMs, timeout: txBudget\(\)\.timeoutMs/,
    );
    expect(code).not.toMatch(/options|timeoutMs\s*\?\?/);
  });
});

describe("authentication internals stay inside src/lib/auth (ADR-0008)", () => {
  it("only src/lib/auth creates the auth database client or the Better Auth instance", () => {
    const offenders = files
      .filter((f) => !f.path.startsWith("src/lib/auth/"))
      .filter((f) => !f.path.startsWith("src/lib/env/")) // declares the variable
      .filter((f) =>
        /createAuthDbClient|createAuth\(|betterAuth\(|AUTH_DATABASE_URL/.test(
          f.code,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only src/lib/auth and the auth route import auth internals", () => {
    const offenders = files
      .filter(
        (f) =>
          !f.path.startsWith("src/lib/auth/") &&
          !f.path.startsWith("src/app/api/auth/"),
      )
      .filter((f) =>
        /from\s+["']@\/lib\/auth\/(config|db|provision|session|mailer|route-guard)["']/.test(
          f.code,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the application database client never touches authentication tables", () => {
    const offenders = files
      .filter((f) => !f.path.startsWith("src/lib/auth/"))
      .filter((f) =>
        /\.(session|account|verification|rateLimit)\.(find|create|update|delete|upsert|count)/.test(
          f.code,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("platform operations are unreachable before Milestone 3", () => {
  const appCode = files.filter(
    (f) =>
      !f.path.startsWith("src/platform/") && !f.path.startsWith("src/lib/"),
  );

  it("no route, page, component or module imports platform code", () => {
    const offenders = appCode
      .filter((f) => /from\s+["']@\/platform\//.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("nothing outside src/platform references createTenant or the test issuer", () => {
    const offenders = files
      .filter((f) => !f.path.startsWith("src/platform/"))
      .filter((f) =>
        /createTenant|issuePlatformStaffActorForTests/.test(f.code),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("pages reach tenant data only through the workspace layer (M4.1)", () => {
  const pageCode = files.filter(
    (f) => f.path.startsWith("src/app/") || f.path.startsWith("src/features/"),
  );

  it("routes and features never open tenant transactions or the raw client", () => {
    const offenders = pageCode
      .filter((f) =>
        /\bwithTenant\b|\bwithUserContext\b|from\s+["']@\/lib\/db["']|resolveTenantContext/.test(
          f.code,
        ),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("client components never import the workspace layer", () => {
    const offenders = files
      .filter((f) => /^["']use client["']/m.test(f.text))
      .filter((f) => /from\s+["']@\/lib\/workspace/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("only with-tenant.ts and the workspace layer call app.my_memberships()", () => {
    const offenders = files
      .filter((f) => f.path !== "src/lib/workspace/resolve.ts")
      .filter((f) => /my_memberships/.test(f.code))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
