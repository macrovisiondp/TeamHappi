import { z } from "zod";

import type { ProviderReadiness, ServiceCategory } from "./core/types";

// The provider registry: every provider TeamHappi knows about, with the
// schema of its NON-SECRET configuration and the names of its secret fields.
// Secret fields are submitted once, stored by the secret store (ADR-0010) and
// never returned to the browser. Adding a provider means adding an entry here
// plus an adapter that implements the category interface.

const region = z
  .string()
  .regex(
    /^[a-z]{2}-[a-z]+-\d$/,
    "Use an AWS region code, for example eu-west-2",
  );
const domain = z
  .string()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, "Enter a domain name");
const emailAddress = z.email("Enter an email address");
const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use an ISO 4217 code, for example GBP");

export interface ProviderDefinition {
  id: string;
  category: ServiceCategory;
  name: string;
  readiness: ProviderReadiness;
  summary: string;
  /** Validates the non-secret configuration. */
  configSchema: z.ZodType<Record<string, unknown>>;
  /** Field names that hold secrets. Write-only. */
  secretFields: readonly string[];
  /** Restrictions recorded by security review. */
  restrictions?: readonly string[];
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  // --- Email ------------------------------------------------------------------
  {
    id: "dev-mailer",
    category: "email",
    name: "Development mailer",
    readiness: "synthetic",
    summary: "Prints messages to the local server console. Never sends email.",
    configSchema: z.object({}),
    secretFields: [],
    restrictions: ["Refuses to run in production."],
  },
  {
    id: "resend",
    category: "email",
    name: "Resend",
    readiness: "adapter-ready",
    summary: "Transactional email API.",
    configSchema: z.object({
      senderName: z.string().min(1).max(60),
      senderAddress: emailAddress,
      sendingDomain: domain,
    }),
    secretFields: ["apiKey"],
  },
  {
    id: "amazon-ses",
    category: "email",
    name: "Amazon SES",
    readiness: "adapter-ready",
    summary: "AWS Simple Email Service, London region.",
    configSchema: z.object({
      senderName: z.string().min(1).max(60),
      senderAddress: emailAddress,
      sendingDomain: domain,
      region,
      configurationSet: z.string().max(64).optional(),
    }),
    secretFields: ["accessKeyId", "secretAccessKey"],
  },
  // --- Storage ----------------------------------------------------------------
  {
    id: "synthetic-storage",
    category: "storage",
    name: "Synthetic storage",
    readiness: "synthetic",
    summary: "In-memory object store for tests and local development.",
    configSchema: z.object({}),
    secretFields: [],
    restrictions: ["Refuses to run in production."],
  },
  {
    id: "aws-s3",
    category: "storage",
    name: "Amazon S3",
    readiness: "adapter-ready",
    summary:
      "Private, encrypted buckets for employee and compliance documents.",
    configSchema: z.object({
      bucket: z
        .string()
        .regex(
          /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
          "Enter a valid bucket name",
        ),
      region,
      kmsKeyAlias: z
        .string()
        .regex(/^alias\/[A-Za-z0-9/_-]+$/)
        .optional(),
    }),
    secretFields: ["accessKeyId", "secretAccessKey"],
  },
  {
    id: "cloudinary",
    category: "storage",
    name: "Cloudinary",
    readiness: "adapter-ready",
    summary: "Image and media delivery (logos, training media).",
    configSchema: z.object({
      cloudName: z.string().regex(/^[a-z0-9-]{2,64}$/i),
      folder: z.string().max(100).optional(),
    }),
    secretFields: ["apiKey", "apiSecret"],
    restrictions: [
      "Media only. Not approved for HR, identity or compliance documents without a separate security assessment.",
    ],
  },
  // --- Payments ---------------------------------------------------------------
  {
    id: "synthetic-payments",
    category: "payments",
    name: "Synthetic payments",
    readiness: "synthetic",
    summary: "Simulated checkout and webhooks for tests.",
    configSchema: z.object({}),
    secretFields: ["webhookSigningSecret"],
    restrictions: ["Refuses to run in production."],
  },
  {
    id: "stripe",
    category: "payments",
    name: "Stripe",
    readiness: "adapter-ready",
    summary: "Subscription billing with hosted Checkout.",
    configSchema: z.object({
      mode: z.enum(["sandbox", "live"]),
      currencies: z.array(currency).min(1),
    }),
    secretFields: ["secretKey", "webhookSigningSecret"],
  },
  {
    id: "paystack",
    category: "payments",
    name: "Paystack",
    readiness: "planned",
    summary: "Card and bank payments for African markets.",
    configSchema: z.object({
      mode: z.enum(["sandbox", "live"]),
      currencies: z.array(currency).min(1),
    }),
    secretFields: ["secretKey"],
  },
  {
    id: "flutterwave",
    category: "payments",
    name: "Flutterwave",
    readiness: "planned",
    summary: "Multi-currency payments for African markets.",
    configSchema: z.object({
      mode: z.enum(["sandbox", "live"]),
      currencies: z.array(currency).min(1),
    }),
    secretFields: ["secretKey", "webhookSigningSecret"],
  },
  // --- AI ---------------------------------------------------------------------
  {
    id: "synthetic-ai",
    category: "ai",
    name: "Synthetic AI",
    readiness: "synthetic",
    summary: "Deterministic test adapter. Makes no external calls.",
    configSchema: z.object({}),
    secretFields: [],
  },
  ...(
    [
      ["anthropic", "Anthropic", "Claude models via the Anthropic API."],
      ["openai", "OpenAI", "GPT models via the OpenAI API."],
      ["google-gemini", "Google Gemini", "Gemini models via the Gemini API."],
      ["aws-bedrock", "AWS Bedrock", "Several model families inside AWS."],
      [
        "azure-openai",
        "Azure OpenAI",
        "OpenAI models in a chosen Azure region.",
      ],
    ] as const
  ).map(([id, name, summary]): ProviderDefinition => ({
    id,
    category: "ai",
    name,
    readiness: "planned",
    summary,
    configSchema: z.object({
      defaultModel: z.string().min(1).max(100),
      dataRegion: z.string().max(40).optional(),
    }),
    secretFields:
      id === "aws-bedrock" ? ["accessKeyId", "secretAccessKey"] : ["apiKey"],
  })),
];

export function providersFor(category: ServiceCategory): ProviderDefinition[] {
  return PROVIDERS.filter((p) => p.category === category);
}

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export type ConfigValidation =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates submitted non-secret configuration. Secret fields are rejected
 * here so they can never be stored as plain configuration by mistake.
 */
export function validateProviderConfig(
  providerId: string,
  input: Record<string, unknown>,
): ConfigValidation {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, errors: { provider: "Unknown provider" } };
  const leaked = Object.keys(input).filter((k) =>
    provider.secretFields.includes(k),
  );
  if (leaked.length)
    return {
      ok: false,
      errors: Object.fromEntries(
        leaked.map((k) => [
          k,
          "Secrets are submitted through credential rotation, not configuration",
        ]),
      ),
    };
  const result = provider.configSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: Object.fromEntries(
      result.error.issues.map((i) => [i.path.join(".") || "config", i.message]),
    ),
  };
}
