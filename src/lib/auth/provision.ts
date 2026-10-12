import { z } from "zod";

import { AUTH_POLICY, type Auth } from "./config";

// Server-side account creation. Public sign-up is disabled (Macrovision-led
// onboarding), so accounts are created here: by the development seed script
// now, and by invitation acceptance in Milestone 3.6. Passwords are hashed by
// Better Auth's own password hasher; there is no custom cryptography.

export const provisionInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z
    .string()
    .min(AUTH_POLICY.minPasswordLength)
    .max(AUTH_POLICY.maxPasswordLength),
  emailVerified: z.boolean().default(false),
});

export type ProvisionInput = z.input<typeof provisionInput>;

export class AccountExistsError extends Error {
  constructor() {
    super("An account with this email already exists");
    this.name = "AccountExistsError";
  }
}

export async function provisionUserWithPassword(
  auth: Auth,
  input: ProvisionInput,
): Promise<{ userId: string }> {
  const { name, email, password, emailVerified } = provisionInput.parse(input);
  const ctx = await auth.$context;

  if (await ctx.internalAdapter.findUserByEmail(email)) {
    throw new AccountExistsError();
  }
  const hash = await ctx.password.hash(password);
  const user = await ctx.internalAdapter.createUser(
    { name, email, emailVerified },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: hash,
  });
  return { userId: user.id };
}
