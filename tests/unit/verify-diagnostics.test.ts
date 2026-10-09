import { describe, expect, it } from "vitest";

import { classifyFailure, redact } from "../helpers/verify-diagnostics";

describe("classifyFailure", () => {
  it.each([
    [
      "connection-acquisition-timeout",
      new Error(
        "Transaction API error: Unable to start a transaction in the given time.",
      ),
    ],
    [
      "transaction-timeout",
      new Error(
        "Transaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 10000 ms",
      ),
    ],
    [
      "statement-timeout",
      Object.assign(new Error("canceling statement due to statement timeout"), {
        code: "57014",
      }),
    ],
    ["test-timeout", new Error("Test timed out in 120000ms.")],
    [
      "assertion-failure",
      Object.assign(new Error("expected 3 to be +0"), {
        name: "AssertionError",
      }),
    ],
    ["other-error", new Error("relation does not exist")],
  ])("classifies %s", (category, error) => {
    expect(classifyFailure(error)).toBe(category);
  });
});

describe("redact", () => {
  it("removes connection strings, passwords and bearer tokens", () => {
    const text =
      "failed postgresql://user:s3cret@host.neon.tech/db?sslmode=verify-full " +
      "and postgres://a:b@c/d password=hunter2 Bearer abc.def.ghi";
    const out = redact(text);
    expect(out).not.toMatch(/s3cret|hunter2|abc\.def\.ghi|a:b@/);
    expect(out).toContain("postgresql://<redacted>");
    expect(out).toContain("password=<redacted>");
    expect(out).toContain("Bearer <redacted>");
  });
});
