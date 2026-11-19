import { deploymentEnvironment } from "../core/environment";
import type { DeploymentEnvironment } from "../core/types";

import { devMailer, type EmailProvider } from "./index";
import { resendProvider } from "./resend";

// How request code finds its email provider (ADR-0015, mirroring ADR-0014 for
// storage): from the deployment's own settings, because request code can't
// read Platform Admin's tables. Resend is used only when ALL of these are set:
//   - APPROVED_LIVE_PROVIDERS includes "resend" (the owner's approval);
//   - RESEND_API_KEY (a Vercel secret);
//   - EMAIL_FROM, for example "TeamHappi <noreply@teamhappi.co.uk>".
// Otherwise: the log-only development mailer outside production, and nothing
// (callers refuse) in production.

export interface EmailEnv {
  APPROVED_LIVE_PROVIDERS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export function liveEmailConfigured(env: EmailEnv): boolean {
  const approved = (env.APPROVED_LIVE_PROVIDERS ?? "")
    .split(",")
    .map((v) => v.trim())
    .includes("resend");
  return Boolean(approved && env.RESEND_API_KEY && env.EMAIL_FROM);
}

export function appEmailProvider(
  env: EmailEnv,
  environment: DeploymentEnvironment = deploymentEnvironment(),
  fetchImpl?: typeof fetch,
): EmailProvider | null {
  if (liveEmailConfigured(env))
    return resendProvider({
      apiKey: env.RESEND_API_KEY!,
      from: env.EMAIL_FROM!,
      fetchImpl,
    });
  return environment === "production" ? null : devMailer();
}
