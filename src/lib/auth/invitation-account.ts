import { z } from "zod";

import { AUTH_POLICY, type Auth } from "./config";
import type { AuthDbClient } from "./db";
import { AccountExistsError, provisionUserWithPassword } from "./provision";

// Accounts created from an invite link (M6). The product owner decided that,
// until email delivery is approved, opening the one-time link counts as
// confirming the invited address. The account records that it was confirmed
// "by invitation" so it can be asked to confirm by email once email is live.
// The caller must have checked that the link is valid for exactly this address.

export const invitedAccountInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  password: z
    .string()
    .min(
      AUTH_POLICY.minPasswordLength,
      `Use at least ${AUTH_POLICY.minPasswordLength} characters`,
    )
    .max(AUTH_POLICY.maxPasswordLength),
});

export type InvitedAccountResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "invalid"; fieldErrors: Record<string, string> };

export async function accountExistsFor(
  auth: Auth,
  email: string,
): Promise<boolean> {
  const ctx = await auth.$context;
  return !!(await ctx.internalAdapter.findUserByEmail(email.toLowerCase()));
}

export async function createInvitedAccount(
  auth: Auth,
  db: AuthDbClient,
  email: string,
  raw: { name: unknown; password: unknown },
): Promise<InvitedAccountResult> {
  const parsed = invitedAccountInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [String(i.path[0]), i.message]),
      ),
    };
  try {
    const { userId } = await provisionUserWithPassword(auth, {
      name: parsed.data.name,
      email,
      password: parsed.data.password,
      emailVerified: true,
    });
    await db.user.update({
      where: { id: userId },
      data: { emailVerifiedVia: "invitation" },
      select: { id: true },
    });
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof AccountExistsError)
      return { ok: false, reason: "exists" };
    throw error;
  }
}
