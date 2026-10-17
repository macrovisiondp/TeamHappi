import { createHash, randomBytes } from "node:crypto";

// One-time invite link tokens (M6). 32 random bytes, sent only in the link's
// fragment (after "#"), so the token never appears in server logs or Referer
// headers. Only its SHA-256 hash is stored.

export function newInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInvitationToken(token) };
}

/** Lowercase hex SHA-256, or "" for anything that can't be a token. */
export function hashInvitationToken(token: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return "";
  return createHash("sha256").update(token).digest("hex");
}

export function invitationLink(appUrl: string, token: string): string {
  return `${new URL("/invite", appUrl).toString()}#${token}`;
}
