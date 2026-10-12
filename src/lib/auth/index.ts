import "server-only";

import { headers } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { serverEnv } from "@/lib/env";

import { createAuth, type Auth } from "./config";
import { createAuthDbClient } from "./db";
import { defaultMailer } from "./mailer";
import { validateSession, type AuthenticatedUser } from "./session";

export type { AuthenticatedUser } from "./session";

const globalForAuth = globalThis as unknown as {
  teamhappiAuth?: Auth | null;
};

/**
 * The server's Better Auth instance, or null when authentication is not
 * configured (AUTH_DATABASE_URL / BETTER_AUTH_SECRET missing). Missing
 * configuration fails closed: every visitor is treated as signed out.
 */
export function getAuth(): Auth | null {
  if (globalForAuth.teamhappiAuth !== undefined)
    return globalForAuth.teamhappiAuth;
  const env = serverEnv();
  if (!env.AUTH_DATABASE_URL || !env.BETTER_AUTH_SECRET) {
    if (env.NODE_ENV === "production") {
      console.error(
        "[auth] Authentication is not configured (AUTH_DATABASE_URL, BETTER_AUTH_SECRET); all requests are treated as signed out.",
      );
    }
    globalForAuth.teamhappiAuth = null;
    return null;
  }
  const auth = createAuth({
    db: createAuthDbClient(env.AUTH_DATABASE_URL),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    mailer: defaultMailer(),
    secureCookies: new URL(env.APP_URL).protocol === "https:",
  });
  globalForAuth.teamhappiAuth = auth;
  return auth;
}

/**
 * The signed-in user for this request, validated against the database.
 * Memoised per request (React cache), never across requests.
 */
export const getCurrentUser = cache(
  async (): Promise<AuthenticatedUser | null> => {
    // Request-time only: session checks read the clock and the database, so
    // they must never be prerendered.
    await connection();
    const requestHeaders = await headers();
    const auth = getAuth();
    if (!auth) return null;
    return validateSession(auth, requestHeaders);
  },
);
