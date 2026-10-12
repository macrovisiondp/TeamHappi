// Time limits for tenant-scoped transactions (withTenant).
//
// Defaults apply everywhere: 10 s per transaction, 5 s to acquire one. They can be
// raised ONLY for the approved Neon verification run, where the test machine is
// far from the database (~360 ms per round trip, multi-second connection setup).
// The override:
// - needs both VITEST=true and TEAMHAPPI_NEON_VERIFY=approved, so a deployed
//   application can never apply it, whatever its environment;
// - is called only from tests/setup/neon-verify-worker.ts (ESLint blocks importing
//   this file from application code; tests/unit/static-guards.test.ts checks that
//   nothing in src/ calls it);
// - may only raise the limits, within fixed maxima.
// There is no per-call override and no production environment variable.

export interface TxBudget {
  readonly timeoutMs: number;
  readonly maxWaitMs: number;
}

export const DEFAULT_TX_BUDGET: TxBudget = Object.freeze({
  timeoutMs: 10_000,
  maxWaitMs: 5_000,
});

export const MAX_VERIFICATION_TX_BUDGET: TxBudget = Object.freeze({
  timeoutMs: 120_000,
  maxWaitMs: 60_000,
});

let current: TxBudget = DEFAULT_TX_BUDGET;

export function txBudget(): TxBudget {
  return current;
}

export class TxBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxBudgetError";
  }
}

function checkLimit(name: keyof TxBudget, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TxBudgetError(
      `${name} must be an integer number of milliseconds`,
    );
  }
  if (value < DEFAULT_TX_BUDGET[name]) {
    throw new TxBudgetError(`${name} cannot be lower than the default`);
  }
  if (value > MAX_VERIFICATION_TX_BUDGET[name]) {
    throw new TxBudgetError(`${name} exceeds the verification maximum`);
  }
  return value;
}

/** Neon verification harness only. Throws in any other context. */
export function configureVerificationTxBudget(budget: TxBudget): TxBudget {
  if (
    process.env.VITEST !== "true" ||
    process.env.TEAMHAPPI_NEON_VERIFY !== "approved"
  ) {
    throw new TxBudgetError(
      "Transaction time limits can only be changed by the approved Neon verification run",
    );
  }
  current = Object.freeze({
    timeoutMs: checkLimit("timeoutMs", budget.timeoutMs),
    maxWaitMs: checkLimit("maxWaitMs", budget.maxWaitMs),
  });
  return current;
}

/** Test helper: restore the defaults. */
export function resetTxBudget(): void {
  current = DEFAULT_TX_BUDGET;
}
