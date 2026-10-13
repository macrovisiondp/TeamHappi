// Shared vocabulary for external service integrations (ADR-0011).
//
// Business modules depend on the category interfaces (email, storage, payments,
// ai), never on a vendor SDK. Platform Admin chooses which provider backs each
// category; the choice is server-side configuration, never browser input.

export const SERVICE_CATEGORIES = [
  "email",
  "storage",
  "payments",
  "ai",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** Where the code is running. Credentials never cross environments. */
export type DeploymentEnvironment = "local" | "preview" | "production";

/**
 * How far a provider is from carrying real traffic:
 * - "synthetic": built-in adapter for local development and tests only.
 * - "adapter-ready": interface implemented, but no network calls until the
 *   owner approves live credentials for it.
 * - "planned": listed for design only; no adapter yet.
 */
export type ProviderReadiness = "synthetic" | "adapter-ready" | "planned";

export type HealthStatus =
  "healthy" | "degraded" | "down" | "unknown" | "not-configured";

export class IntegrationError extends Error {
  constructor(
    message: string,
    /** Safe to retry (or fall back) without risking a duplicate side effect. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

/** The provider exists in the registry but may not make network calls yet. */
export class ProviderNotActivatedError extends IntegrationError {
  constructor(providerId: string) {
    super(
      `Provider "${providerId}" is not activated for live use. Live connections need owner approval.`,
      false,
    );
    this.name = "ProviderNotActivatedError";
  }
}
