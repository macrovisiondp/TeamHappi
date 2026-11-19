// Outgoing authentication email (verification links).
//
// - Live email (ADR-0015): when Resend is approved and configured in this
//   deployment (APPROVED_LIVE_PROVIDERS, RESEND_API_KEY, EMAIL_FROM), messages
//   are sent through it. Nothing about the message is logged.
// - Otherwise, development/test: the dev mailer prints the message to the
//   server console so a developer can click the link. Synthetic accounts only.
// - Otherwise, production: refuses to send and never logs the message,
//   because the body contains a single-use token.

import { randomUUID } from "node:crypto";

import type { EmailProvider } from "@/integrations/email";
import {
  appEmailProvider,
  liveEmailConfigured,
} from "@/integrations/email/runtime";
import { serverEnv } from "@/lib/env";

export interface AuthEmail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(email: AuthEmail): Promise<void>;
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("No email provider is configured for this environment");
    this.name = "MailerNotConfiguredError";
  }
}

export function devLogMailer(
  log: (line: string) => void = (line) => console.info(line),
): Mailer {
  if (process.env.NODE_ENV === "production") {
    throw new MailerNotConfiguredError();
  }
  return {
    async send({ to, subject, text }) {
      log(
        `[dev-mail] to=${to} subject="${subject}"\n${text}\n[dev-mail] (development only; not sent)`,
      );
    },
  };
}

export const productionMailer: Mailer = {
  async send() {
    // Deliberately no logging: the message contains a token.
    throw new MailerNotConfiguredError();
  },
};

/** A mailer that sends through a live provider (one message, one key). */
export function providerMailer(provider: EmailProvider): Mailer {
  return {
    async send({ to, subject, text }) {
      await provider.send({ to, subject, text, idempotencyKey: randomUUID() });
    },
  };
}

export function defaultMailer(): Mailer {
  const env = serverEnv();
  if (liveEmailConfigured(env)) return providerMailer(appEmailProvider(env)!);
  return process.env.NODE_ENV === "production"
    ? productionMailer
    : devLogMailer();
}
