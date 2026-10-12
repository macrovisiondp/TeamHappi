import { z } from "zod";

// Server environment contract. Variables for later milestones are added here
// when the milestone that needs them begins (see .env.example).
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  // Application role (teamhappi_app), pooled. Optional until a page needs the database.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  // Authentication role (teamhappi_auth), pooled. Identity tables only (ADR-0008).
  AUTH_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  // Signs session cookies and verification tokens. At least 32 characters.
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Report variable names only — never echo values, which may be secrets.
    const names = [
      ...new Set(result.error.issues.map((i) => i.path.join("."))),
    ];
    throw new Error(
      `Invalid server environment variables: ${names.join(", ")}`,
    );
  }
  return result.data;
}
