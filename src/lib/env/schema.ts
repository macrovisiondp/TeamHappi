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

/**
 * APP_URL if set; otherwise, on Vercel, the deployment's own HTTPS address
 * (the production domain for production, the branch alias for previews).
 * Better Auth uses it for cookies, trusted origins and links.
 */
export function resolveAppUrl(
  source: Record<string, string | undefined>,
): string | undefined {
  if (source.APP_URL) return source.APP_URL;
  const host =
    source.VERCEL_ENV === "production"
      ? source.VERCEL_PROJECT_PRODUCTION_URL
      : source.VERCEL_ENV
        ? (source.VERCEL_BRANCH_URL ?? source.VERCEL_URL)
        : undefined;
  return host ? `https://${host}` : undefined;
}

const SECRET_VARS = [
  "DATABASE_URL",
  "AUTH_DATABASE_URL",
  "BETTER_AUTH_SECRET",
] as const;
const DATABASE_VARS = new Set(["DATABASE_URL", "AUTH_DATABASE_URL"]);

/**
 * Undoes common copy-paste damage in hosting dashboards: surrounding
 * whitespace or quotes, a leading `NAME=`, line breaks inside a URL, and
 * `<…>` left around a password. Values are never logged.
 */
export function cleanEnvValue(name: string, raw: string): string {
  let value = raw.trim();
  for (let i = 0; i < 3; i++) {
    value = value.replace(/^[A-Z][A-Z0-9_]*\s*=\s*/, "").trim();
    const quoted = value.match(/^(["'`])([\s\S]*)\1$/);
    if (quoted) value = quoted[2]!.trim();
  }
  if (DATABASE_VARS.has(name))
    value = repairDatabaseUrl(value.replace(/\s+/g, ""));
  return value;
}

/**
 * Percent-encodes a database password that contains URL-reserved characters
 * (such as @ / : # ?), which would otherwise break the address.
 */
export function repairDatabaseUrl(value: string): string {
  // The host never contains "@", so the LAST "@" before the path ends the password.
  const m = value.match(
    /^(postgres(?:ql)?:\/\/)([^:/@]+):(.*)@([^@/]+(?:\/.*)?)$/,
  );
  if (!m) return value;
  const [, scheme, user, rawPassword, rest] = m;
  let password = rawPassword!;
  if (password.startsWith("<") && password.endsWith(">"))
    password = password.slice(1, -1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(password);
  } catch {
    decoded = password;
  }
  return `${scheme}${user}:${encodeURIComponent(decoded)}@${rest}`;
}

/** A safe description of a database URL for error messages: never the password. */
export function describeDatabaseUrl(value: string): string {
  const scheme = /^postgres(ql)?:\/\//.test(value)
    ? "postgresql://"
    : "(does not start with postgresql://)";
  const at = value.lastIndexOf("@");
  if (at < 0) return `${scheme} … (no "@" before the host)`;
  const user = value.slice(value.indexOf("//") + 2, at).split(":")[0] || "?";
  const afterAt = value.slice(at + 1);
  const host = afterAt.split(/[/?]/)[0] || "?";
  const database = afterAt.split("/")[1]?.split("?")[0] || "(no database name)";
  return `${scheme}${user}:****@${host}/${database}`;
}

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const cleaned: Record<string, string | undefined> = { ...source };
  for (const name of SECRET_VARS) {
    const raw = source[name];
    if (raw !== undefined)
      cleaned[name] = cleanEnvValue(name, raw) || undefined;
  }
  const result = serverEnvSchema.safeParse({
    ...cleaned,
    APP_URL: resolveAppUrl(cleaned),
  });
  if (!result.success) {
    // Never echo values, which may be secrets. Database URLs are described
    // with the password masked so the shape problem is visible in the logs.
    const names = [
      ...new Set(result.error.issues.map((i) => i.path.join("."))),
    ];
    const details = names.map((name) => {
      const value = cleaned[name];
      if (DATABASE_VARS.has(name) && value)
        return `${name} (looks like ${describeDatabaseUrl(value)})`;
      if (name === "BETTER_AUTH_SECRET" && value)
        return `${name} (${value.length} characters; needs at least 32)`;
      return name;
    });
    throw new Error(
      `Invalid server environment variables: ${details.join("; ")}`,
    );
  }
  return result.data;
}
