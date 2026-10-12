// Outgoing authentication email (verification links; invitations later).
//
// No email provider is approved yet (decision D-M3-1, risk R-4):
// - development/test: the dev mailer prints the message to the server console
//   so a developer can click the link. Synthetic accounts only.
// - production: refuses to send and never logs the message, because the body
//   contains a single-use token.

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

export function defaultMailer(): Mailer {
  return process.env.NODE_ENV === "production"
    ? productionMailer
    : devLogMailer();
}
