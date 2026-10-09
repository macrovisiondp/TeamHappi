// Runs in every test worker of the neon-verify project (setupFiles).
// 1. Raises withTenant's time limits for the measured Neon latency, within the
//    bounds enforced by src/lib/tenancy/tx-budget.ts.
// 2. Prints one classified, redacted line for every failed test, so the report
//    separates infrastructure timeouts from security assertion failures.

import { beforeEach } from "vitest";

import { configureVerificationTxBudget } from "@/lib/tenancy/tx-budget";

import { classifyFailure, redact } from "../helpers/verify-diagnostics";

export const VERIFICATION_TX_BUDGET = {
  timeoutMs: 60_000, // one tenant-creation transaction ≈ 25 round trips × ~360 ms
  maxWaitMs: 30_000, // new pooled connections measured at 3.7–5.6 s
} as const;

configureVerificationTxBudget(VERIFICATION_TX_BUDGET);

beforeEach(({ task, onTestFailed }) => {
  onTestFailed((result) => {
    const errors = result.task?.result?.errors ?? [];
    for (const error of errors.length
      ? errors
      : [new Error("unknown failure")]) {
      console.log(
        `[verify-failure] test="${task.name}" category=${classifyFailure(error)} ` +
          `message="${redact(String(error.message ?? error)).slice(0, 300)}"`,
      );
    }
  });
});
