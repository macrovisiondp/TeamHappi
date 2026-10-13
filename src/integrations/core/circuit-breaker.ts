// Stops calling a failing provider for a cool-down period, so an outage
// degrades into fast, explicit failures (and, where safe, fallback) instead of
// piling up slow requests.

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  coolDownMs: number;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" is temporarily unavailable`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private readonly now: () => number;

  constructor(
    readonly providerId: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.options.coolDownMs
      ? "half-open"
      : "open";
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === "open") throw new CircuitOpenError(this.providerId);
    try {
      const result = await operation();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      this.failures += 1;
      if (
        this.state === "half-open" ||
        this.failures >= this.options.failureThreshold
      ) {
        this.openedAt = this.now();
      }
      throw error;
    }
  }
}
