import { IntegrationError } from "../core/types";

import type { EmailMessage, EmailProvider, EmailReceipt } from "./index";

// Resend (https://resend.com), the product owner's choice of email provider
// (19 November 2026, free tier). Plain fetch, no SDK. Never logs the API key,
// message bodies or links (which may contain single-use tokens).
//
// Failures:
//   - 429 and 5xx: Resend did NOT accept the message, so it's safe to retry or
//     fall back (retryable);
//   - other 4xx: a problem with the request or account; retrying won't help;
//   - no response at all (network error, timeout): ambiguous, because the
//     request may have been accepted, so never retried elsewhere.

export const RESEND_API = "https://api.resend.com";

/** Resend's address that accepts test messages without delivering them. */
export const RESEND_TEST_RECIPIENT = "delivered@resend.dev";

export class ResendRejectedError extends IntegrationError {
  constructor(
    readonly status: number,
    readonly reason: string,
    retryable: boolean,
  ) {
    super(`Resend refused the message (${status})`, retryable);
    this.name = "ResendRejectedError";
  }
}

export interface ResendOptions {
  apiKey: string;
  /** "Name <address>" or a bare address. */
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Resend's error message, trimmed to something safe to show staff. */
async function reasonOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; name?: unknown };
    const text = typeof body.message === "string" ? body.message : "";
    return text.replace(/re_[A-Za-z0-9_]+/g, "[key]").slice(0, 200);
  } catch {
    return "";
  }
}

export function resendProvider(options: ResendOptions): EmailProvider {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: "resend",
    async send(message: EmailMessage): Promise<EmailReceipt> {
      let res: Response;
      try {
        res = await doFetch(`${RESEND_API}/emails`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: options.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
          }),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        });
      } catch {
        throw new IntegrationError("Resend could not be reached", false);
      }
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: unknown };
        return {
          providerId: "resend",
          providerMessageId: typeof body.id === "string" ? body.id : "",
        };
      }
      throw new ResendRejectedError(
        res.status,
        await reasonOf(res),
        res.status === 429 || res.status >= 500,
      );
    },
  };
}

/** Plain-English advice for a failed connection test. */
export function explainResendFailure(error: unknown): string {
  if (error instanceof ResendRejectedError) {
    if (error.status === 401 || error.status === 400)
      return "Resend rejected the API key. Check RESEND_API_KEY in Vercel, then redeploy.";
    if (error.status === 403)
      return `Resend refused to send${error.reason ? `: ${error.reason}` : ""}. Usually this means the sending domain isn't verified in Resend yet, or the sender address doesn't match it.`;
    if (error.status === 429)
      return "Resend's sending limit was reached. Try again later.";
    return "Resend had a problem. Try again in a few minutes.";
  }
  return "Resend couldn't be reached. Try again in a few minutes.";
}
