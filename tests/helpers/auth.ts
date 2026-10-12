import { randomBytes } from "node:crypto";

import { createAuth, type Auth } from "@/lib/auth/config";
import { createAuthDbClient, type AuthDbClient } from "@/lib/auth/db";
import type { AuthEmail, Mailer } from "@/lib/auth/mailer";
import { guardedAuthHandler } from "@/lib/auth/route-guard";
import { provisionUserWithPassword } from "@/lib/auth/provision";

import { urls } from "./db";

export const BASE_URL = "https://app.teamhappi.test";

export interface TestAuth {
  auth: Auth;
  db: AuthDbClient;
  outbox: AuthEmail[];
  /** Calls the auth API exactly as the route handler does (allow-list included). */
  call: (
    path: string,
    init?: { method?: string; body?: unknown; cookie?: string; ip?: string },
  ) => Promise<Response>;
  provision: (opts?: {
    verified?: boolean;
    password?: string;
  }) => Promise<{ userId: string; email: string; password: string }>;
  close: () => Promise<void>;
}

export const syntheticPassword = () =>
  `Synthetic-${randomBytes(9).toString("base64url")}`;

export function createTestAuth(): TestAuth {
  const db = createAuthDbClient({ connectionString: urls.authUrl, max: 4 });
  const outbox: AuthEmail[] = [];
  const mailer: Mailer = {
    async send(email) {
      outbox.push(email);
    },
  };
  const auth = createAuth({
    db,
    secret: randomBytes(32).toString("base64url"),
    baseURL: BASE_URL,
    mailer,
    secureCookies: true,
  });

  const call: TestAuth["call"] = (path, init = {}) => {
    const headers = new Headers({
      origin: BASE_URL,
      "x-forwarded-for": init.ip ?? "198.51.100.7",
    });
    if (init.body !== undefined)
      headers.set("content-type", "application/json");
    if (init.cookie) headers.set("cookie", init.cookie);
    const request = new Request(`${BASE_URL}/api/auth${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    });
    return guardedAuthHandler(auth.handler, request);
  };

  const provision: TestAuth["provision"] = async (opts = {}) => {
    const email = `user-${randomBytes(5).toString("hex")}@example.test`;
    const password = opts.password ?? syntheticPassword();
    const { userId } = await provisionUserWithPassword(auth, {
      name: "Synthetic User",
      email,
      password,
      emailVerified: opts.verified ?? true,
    });
    return { userId, email, password };
  };

  return { auth, db, outbox, call, provision, close: () => db.$disconnect() };
}

/** "name=value" pairs from Set-Cookie headers, for the next request's Cookie header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.includes("session_token="));
}

/** The token part of the signed session cookie ("<token>.<signature>"). */
export function sessionTokenFrom(setCookie: string): string {
  const value = decodeURIComponent(setCookie.split(";")[0]!.split("=")[1]!);
  return value.split(".")[0]!;
}
