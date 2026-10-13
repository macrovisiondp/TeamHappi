import { createHmac, timingSafeEqual } from "node:crypto";

import { IntegrationError } from "../core/types";

// Provider-independent SaaS billing (ADR-0011). Scope: TeamHappi's own
// subscription billing. Never payroll, never employee money.
//
// Rules this module enforces:
// - Card data never touches TeamHappi: checkout is provider-hosted.
// - Payment state changes ONLY from verified webhooks, never from the browser
//   (a "success" redirect is a hint to refresh, nothing more).
// - Webhooks are signature-checked, time-boxed and processed once per event.

export type PaymentMode = "sandbox" | "live";

export interface PaymentRoute {
  providerId: string;
  currencies: readonly string[];
  mode: PaymentMode;
}

/**
 * The provider for a currency. Live routes are ignored unless live payments
 * have been approved for this deployment.
 */
export function routeForCurrency(
  routes: readonly PaymentRoute[],
  currency: string,
  liveApproved: boolean,
): PaymentRoute {
  const route = routes.find(
    (r) =>
      r.currencies.includes(currency.toUpperCase()) &&
      (r.mode === "sandbox" || liveApproved),
  );
  if (!route)
    throw new IntegrationError(
      `No payment provider is configured for ${currency}`,
      false,
    );
  return route;
}

/** Five minutes either side, matching common provider guidance. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export class WebhookVerificationError extends Error {
  constructor(reason: string) {
    super(`Webhook rejected: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

/**
 * Verifies an HMAC-SHA256 signature over `${timestamp}.${rawBody}` (the
 * scheme Stripe uses; each provider adapter maps its header format onto this).
 * The raw body must be the exact bytes received, before JSON parsing.
 */
export function verifyWebhookSignature(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: Date;
}): void {
  const seconds = Number(input.timestamp);
  if (!Number.isInteger(seconds))
    throw new WebhookVerificationError("bad timestamp");
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - seconds) > WEBHOOK_TOLERANCE_SECONDS)
    throw new WebhookVerificationError("timestamp outside tolerance");
  const expected = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(input.signature, "hex");
  } catch {
    throw new WebhookVerificationError("bad signature");
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new WebhookVerificationError("bad signature");
}

/** Test helper and synthetic-provider signer. */
export function signWebhook(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded";

export interface PaymentEvent {
  providerId: string;
  eventId: string;
  paymentId: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
}

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["succeeded", "failed"],
  failed: ["succeeded"], // a retried charge may still succeed
  succeeded: ["refunded"],
  refunded: [],
};

/**
 * Applies verified webhook events exactly once. In production the "seen"
 * set is a unique (provider, event id) constraint in the billing event table,
 * written in the same transaction as the status change.
 */
export class PaymentLedger {
  private readonly seen = new Set<string>();
  private readonly status = new Map<string, PaymentStatus>();
  readonly history: PaymentEvent[] = [];

  statusOf(paymentId: string): PaymentStatus {
    return this.status.get(paymentId) ?? "pending";
  }

  /** Returns "duplicate" for a replayed event, "ignored" for an invalid transition. */
  apply(event: PaymentEvent): "applied" | "duplicate" | "ignored" {
    const key = `${event.providerId}:${event.eventId}`;
    if (this.seen.has(key)) return "duplicate";
    this.seen.add(key);
    this.history.push(event);
    const next = event.type.slice("payment.".length) as PaymentStatus;
    const current = this.statusOf(event.paymentId);
    if (!TRANSITIONS[current].includes(next)) return "ignored";
    this.status.set(event.paymentId, next);
    return "applied";
  }
}
