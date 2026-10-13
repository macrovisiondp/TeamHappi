import { deploymentEnvironment } from "../core/environment";
import {
  IntegrationError,
  ProviderNotActivatedError,
  type DeploymentEnvironment,
} from "../core/types";

// Provider-independent email (ADR-0011). Business code calls EmailSender; the
// active provider is chosen by Platform Admin configuration on the server.

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Stable per logical message, so a retry or fallback never sends twice. */
  idempotencyKey: string;
}

export interface EmailReceipt {
  providerId: string;
  providerMessageId: string;
}

export interface EmailProvider {
  readonly id: string;
  send(message: EmailMessage): Promise<EmailReceipt>;
}

/** Recipients allowed for test sends: RFC 2606 / 6761 reserved domains only. */
export function isSyntheticAddress(address: string): boolean {
  return /@([a-z0-9-]+\.)*(example\.(com|org|net)|example|test|invalid)$/i.test(
    address.trim(),
  );
}

/**
 * The development mailer: logs the recipient and subject, never the body
 * (which may contain a single-use token), and refuses to exist outside local
 * development and previews.
 */
export function devMailer(
  log: (line: string) => void = (line) => console.info(line),
  environment: DeploymentEnvironment = deploymentEnvironment(),
): EmailProvider {
  if (environment === "production")
    throw new ProviderNotActivatedError("dev-mailer");
  let sequence = 0;
  return {
    id: "dev-mailer",
    async send({ to, subject }) {
      sequence += 1;
      log(
        `[dev-mail] to=${to} subject="${subject}" (development only; not sent)`,
      );
      return { providerId: "dev-mailer", providerMessageId: `dev-${sequence}` };
    },
  };
}

/**
 * Placeholder for an approved live provider (Resend, Amazon SES). Makes no
 * network calls: live sending needs owner approval and stored credentials.
 */
export function unactivatedEmailProvider(
  id: "resend" | "amazon-ses",
): EmailProvider {
  return {
    id,
    async send() {
      throw new ProviderNotActivatedError(id);
    },
  };
}

export interface DeliveryFailure {
  providerId: string;
  idempotencyKey: string;
  reason: string;
  retryable: boolean;
}

export interface EmailSenderOptions {
  primary: EmailProvider;
  /** Used only when the primary fails with a retryable error. */
  fallback?: EmailProvider;
  /** Remembers keys that were accepted, so repeats return the first receipt. */
  sent?: Map<string, EmailReceipt>;
  onFailure?: (failure: DeliveryFailure) => void;
}

/**
 * Sends through the primary provider, falling back only when the primary
 * failed in a way that guarantees it did not accept the message (retryable).
 * An ambiguous failure (for example a timeout after the request left) is not
 * retried elsewhere, because that could deliver the message twice.
 */
export function createEmailSender(options: EmailSenderOptions) {
  const sent = options.sent ?? new Map<string, EmailReceipt>();
  return async function send(message: EmailMessage): Promise<EmailReceipt> {
    const previous = sent.get(message.idempotencyKey);
    if (previous) return previous;

    const providers = [options.primary, options.fallback].filter(
      (p): p is EmailProvider => Boolean(p),
    );
    let lastError: unknown;
    for (const provider of providers) {
      try {
        const receipt = await provider.send(message);
        sent.set(message.idempotencyKey, receipt);
        return receipt;
      } catch (error) {
        lastError = error;
        const retryable = error instanceof IntegrationError && error.retryable;
        options.onFailure?.({
          providerId: provider.id,
          idempotencyKey: message.idempotencyKey,
          reason: error instanceof Error ? error.name : "UnknownError",
          retryable,
        });
        if (!retryable) break;
      }
    }
    throw lastError;
  };
}

/** Platform Admin "send test email": synthetic recipients only. */
export async function sendTestEmail(
  provider: EmailProvider,
  to: string,
  idempotencyKey: string,
): Promise<EmailReceipt> {
  if (!isSyntheticAddress(to))
    throw new IntegrationError(
      "Test emails can only go to reserved test domains such as example.test",
      false,
    );
  return provider.send({
    to,
    subject: "TeamHappi test email",
    text: "This is a TeamHappi configuration test. No action is needed.",
    idempotencyKey,
  });
}
