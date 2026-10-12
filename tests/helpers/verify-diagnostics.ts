// Classifies database test failures so a Neon verification report can tell
// infrastructure timeouts apart from security assertion failures, and redacts
// anything that could carry credentials before it is printed.

export type FailureCategory =
  | "connection-acquisition-timeout"
  | "transaction-timeout"
  | "statement-timeout"
  | "test-timeout"
  | "assertion-failure"
  | "other-error";

export function classifyFailure(error: unknown): FailureCategory {
  const e = error as { name?: string; message?: string; code?: string };
  const message = e?.message ?? String(error);
  if (/Unable to start a transaction in the given time/i.test(message)) {
    return "connection-acquisition-timeout";
  }
  if (
    /expired transaction|Transaction already closed|transaction .*timed? ?out/i.test(
      message,
    )
  ) {
    return "transaction-timeout";
  }
  if (
    e?.code === "57014" ||
    /canceling statement due to statement timeout/i.test(message)
  ) {
    return "statement-timeout";
  }
  if (/Test timed out|Hook timed out/i.test(message)) return "test-timeout";
  if (e?.name === "AssertionError" || /^expected /i.test(message)) {
    return "assertion-failure";
  }
  return "other-error";
}

/** Removes connection strings, passwords and bearer tokens from text. */
export function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://<redacted>")
    .replace(/(password|passwd|pwd)\s*[=:]\s*[^\s&;'"`]+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer <redacted>");
}
