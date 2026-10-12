import { AUTH_POLICY, type Auth } from "./config";

// What the rest of the application may know about the signed-in user. Session
// tokens, password hashes and verification data never leave src/lib/auth.
export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
}

/**
 * Validates the session cookie in `headers` on the server, against the database.
 * Returns null for: no cookie, unknown or tampered token, expired session
 * (idle limit), session older than the absolute limit (which is also revoked),
 * or an unverified email address.
 */
export async function validateSession(
  auth: Auth,
  headers: Headers,
  now: Date = new Date(),
): Promise<AuthenticatedUser | null> {
  const result = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!result) return null;
  const { session, user } = result;

  const ageMs = now.getTime() - new Date(session.createdAt).getTime();
  if (ageMs > AUTH_POLICY.sessionAbsoluteSeconds * 1000) {
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteSession(session.token);
    return null;
  }
  if (!user.emailVerified) return null;

  return {
    userId: user.id,
    sessionId: session.id,
    name: user.name,
    email: user.email,
  };
}
