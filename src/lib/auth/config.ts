import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import type { AuthDbClient } from "./db";
import type { Mailer } from "./mailer";

// Authentication policy (interim spec IS-07, ADR-0004/0008). Privileged-role
// timeouts (30 min idle / 12 h absolute) arrive with MFA in Milestone 3.4.
export const AUTH_POLICY = {
  cookiePrefix: "teamhappi",
  sessionIdleSeconds: 7 * 24 * 60 * 60, // expires if unused for 7 days
  sessionRefreshSeconds: 24 * 60 * 60, // sliding refresh at most once a day
  sessionAbsoluteSeconds: 30 * 24 * 60 * 60, // hard cap, enforced in session.ts
  verificationTokenSeconds: 60 * 60,
  minPasswordLength: 12,
  maxPasswordLength: 128,
  rateLimit: {
    default: { window: 60, max: 100 },
    signIn: { window: 60, max: 5 },
    sendVerification: { window: 300, max: 3 },
    verifyEmail: { window: 60, max: 10 },
  },
} as const;

export interface CreateAuthOptions {
  db: AuthDbClient;
  secret: string;
  /** Public origin of the app, e.g. https://app.teamhappi.example */
  baseURL: string;
  mailer: Mailer;
  /** Secure cookies (__Secure- prefix). Always true outside local development. */
  secureCookies: boolean;
  /** Headers that carry the client IP, set by the trusted platform proxy. */
  ipAddressHeaders?: string[];
}

export function createAuth(options: CreateAuthOptions) {
  if (options.secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  }
  const { rateLimit } = AUTH_POLICY;

  return betterAuth({
    appName: "TeamHappi",
    baseURL: options.baseURL,
    basePath: "/api/auth",
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    database: prismaAdapter(options.db, { provider: "postgresql" }),
    // No usage data leaves the system.
    telemetry: { enabled: false },
    logger: { level: "error" },

    emailAndPassword: {
      enabled: true,
      // Release 1 onboarding is Macrovision-led: no public self-service sign-up.
      // Accounts are provisioned server-side (provision.ts), later via invitations.
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: AUTH_POLICY.minPasswordLength,
      maxPasswordLength: AUTH_POLICY.maxPasswordLength,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: false,
      // An unverified user who signs in with the right password gets a new link.
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: AUTH_POLICY.verificationTokenSeconds,
      sendVerificationEmail: async ({ user, url }) => {
        await options.mailer.send({
          to: user.email,
          subject: "Verify your TeamHappi email address",
          text: `Confirm your email address to finish setting up your account:\n${url}\n\nThis link expires in 1 hour. If you didn't expect this email, you can ignore it.`,
        });
      },
    },

    session: {
      expiresIn: AUTH_POLICY.sessionIdleSeconds,
      updateAge: AUTH_POLICY.sessionRefreshSeconds,
      // Every request checks the session row, so sign-out and revocation apply
      // immediately (no signed-cookie session cache).
      cookieCache: { enabled: false },
    },

    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "rateLimit",
      window: rateLimit.default.window,
      max: rateLimit.default.max,
      customRules: {
        "/sign-in/email": rateLimit.signIn,
        "/send-verification-email": rateLimit.sendVerification,
        "/verify-email": rateLimit.verifyEmail,
      },
    },

    advanced: {
      cookiePrefix: AUTH_POLICY.cookiePrefix,
      useSecureCookies: options.secureCookies,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      },
      // Ids come from the database default (uuidv7()).
      database: { generateId: false },
      ipAddress: {
        ipAddressHeaders: options.ipAddressHeaders ?? ["x-forwarded-for"],
      },
    },

    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
