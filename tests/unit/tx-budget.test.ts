import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configureVerificationTxBudget,
  DEFAULT_TX_BUDGET,
  MAX_VERIFICATION_TX_BUDGET,
  resetTxBudget,
  txBudget,
  TxBudgetError,
} from "@/lib/tenancy/tx-budget";

const saved = { ...process.env };

beforeEach(() => {
  resetTxBudget();
});

afterEach(() => {
  process.env.VITEST = saved.VITEST;
  if (saved.TEAMHAPPI_NEON_VERIFY === undefined)
    delete process.env.TEAMHAPPI_NEON_VERIFY;
  else process.env.TEAMHAPPI_NEON_VERIFY = saved.TEAMHAPPI_NEON_VERIFY;
  resetTxBudget();
});

const enableVerification = () => {
  process.env.VITEST = "true";
  process.env.TEAMHAPPI_NEON_VERIFY = "approved";
};

describe("transaction time limits", () => {
  it("defaults to 10 s per transaction and 5 s to acquire one", () => {
    expect(DEFAULT_TX_BUDGET).toEqual({ timeoutMs: 10_000, maxWaitMs: 5_000 });
    expect(txBudget()).toEqual(DEFAULT_TX_BUDGET);
  });

  it("the defaults and maxima cannot be mutated", () => {
    expect(Object.isFrozen(DEFAULT_TX_BUDGET)).toBe(true);
    expect(Object.isFrozen(MAX_VERIFICATION_TX_BUDGET)).toBe(true);
  });

  it("allows the verification harness to raise limits within bounds", () => {
    enableVerification();
    configureVerificationTxBudget({ timeoutMs: 60_000, maxWaitMs: 30_000 });
    expect(txBudget()).toEqual({ timeoutMs: 60_000, maxWaitMs: 30_000 });
  });

  it("accepts the exact maximum", () => {
    enableVerification();
    configureVerificationTxBudget(MAX_VERIFICATION_TX_BUDGET);
    expect(txBudget()).toEqual({ timeoutMs: 120_000, maxWaitMs: 60_000 });
  });

  it.each([
    [
      "missing approval flag",
      { VITEST: "true", TEAMHAPPI_NEON_VERIFY: undefined },
    ],
    ["wrong approval value", { VITEST: "true", TEAMHAPPI_NEON_VERIFY: "yes" }],
    [
      "outside the test runner",
      { VITEST: "false", TEAMHAPPI_NEON_VERIFY: "approved" },
    ],
  ])("refuses when %s and keeps the defaults", (_label, env) => {
    process.env.VITEST = env.VITEST;
    if (env.TEAMHAPPI_NEON_VERIFY === undefined)
      delete process.env.TEAMHAPPI_NEON_VERIFY;
    else process.env.TEAMHAPPI_NEON_VERIFY = env.TEAMHAPPI_NEON_VERIFY;
    expect(() =>
      configureVerificationTxBudget({ timeoutMs: 60_000, maxWaitMs: 30_000 }),
    ).toThrow(TxBudgetError);
    expect(txBudget()).toEqual(DEFAULT_TX_BUDGET);
  });

  it.each([
    [
      "above the transaction maximum",
      { timeoutMs: 120_001, maxWaitMs: 30_000 },
    ],
    ["above the acquisition maximum", { timeoutMs: 60_000, maxWaitMs: 60_001 }],
    ["below the transaction default", { timeoutMs: 9_999, maxWaitMs: 30_000 }],
    ["below the acquisition default", { timeoutMs: 60_000, maxWaitMs: 4_999 }],
    ["not an integer", { timeoutMs: 60_000.5, maxWaitMs: 30_000 }],
    ["NaN", { timeoutMs: Number.NaN, maxWaitMs: 30_000 }],
    ["Infinity", { timeoutMs: Number.POSITIVE_INFINITY, maxWaitMs: 30_000 }],
    ["negative", { timeoutMs: -1, maxWaitMs: 30_000 }],
    [
      "a string",
      { timeoutMs: "60000" as unknown as number, maxWaitMs: 30_000 },
    ],
    [
      "missing",
      { maxWaitMs: 30_000 } as unknown as {
        timeoutMs: number;
        maxWaitMs: number;
      },
    ],
  ])("rejects a value %s and keeps the previous limits", (_label, budget) => {
    enableVerification();
    expect(() => configureVerificationTxBudget(budget)).toThrow(TxBudgetError);
    expect(txBudget()).toEqual(DEFAULT_TX_BUDGET);
  });
});
