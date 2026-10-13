import { looksLikeSecret, redact } from "./redact";
import type { DeploymentEnvironment, ServiceCategory } from "./types";

// Platform audit events for integration changes. The durable, append-only
// table (`platform_audit_event`) arrives with M3.2/M3.5; until then events go
// to an injected sink. Payloads are metadata only: never secret values,
// message bodies, documents or personal data.

export type IntegrationAuditAction =
  | "provider.configured"
  | "provider.validated"
  | "provider.activated"
  | "provider.deactivated"
  | "provider.rolled_back"
  | "credential.registered"
  | "credential.validated"
  | "credential.activated"
  | "credential.revoked"
  | "credential.rotation_failed"
  | "credential.rotation_rolled_back"
  | "ai.kill_switch_changed"
  | "ai.feature_changed"
  | "ai.budget_changed";

export interface IntegrationAuditEvent {
  action: IntegrationAuditAction;
  actorUserId: string;
  category: ServiceCategory;
  providerId: string;
  environment: DeploymentEnvironment;
  /** Non-secret detail, such as a version number or a reason code. */
  detail: Record<string, string | number | boolean | null>;
  occurredAt: Date;
}

export type AuditSink = (event: IntegrationAuditEvent) => void | Promise<void>;

/**
 * Builds an event and checks it is safe to store. Throws rather than writing
 * an event that still contains something secret-looking after redaction.
 */
export function buildAuditEvent(
  input: Omit<IntegrationAuditEvent, "occurredAt">,
  now: Date = new Date(),
): IntegrationAuditEvent {
  const detail = redact(input.detail);
  for (const value of Object.values(detail)) {
    if (typeof value === "string" && looksLikeSecret(value))
      throw new Error("Audit detail contains a secret-looking value");
  }
  return Object.freeze({
    ...input,
    detail: Object.freeze(detail),
    occurredAt: now,
  });
}
