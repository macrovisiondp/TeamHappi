// Form fields for each provider's NON-SECRET configuration, and the names of
// the server environment variables that hold each provider's credentials
// (ADR-0011 stage 1: secret values live only in the hosting provider's
// encrypted environment settings, never in the database or the browser).

export type FieldType = "text" | "email" | "select" | "list";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
}

const sender: FieldDef[] = [
  {
    name: "senderName",
    label: "Sender name",
    type: "text",
    required: true,
    placeholder: "TeamHappi",
  },
  {
    name: "senderAddress",
    label: "Sender address",
    type: "email",
    required: true,
    placeholder: "noreply@yourdomain.com",
  },
  {
    name: "sendingDomain",
    label: "Sending domain",
    type: "text",
    required: true,
    hint: "Must be verified with the provider (SPF, DKIM, DMARC) before going live.",
  },
];

const region: FieldDef = {
  name: "region",
  label: "AWS region",
  type: "text",
  required: true,
  placeholder: "eu-west-2",
  hint: "eu-west-2 is London.",
};

const payments: FieldDef[] = [
  {
    name: "mode",
    label: "Mode",
    type: "select",
    required: true,
    options: [
      { value: "sandbox", label: "Sandbox (test)" },
      { value: "live", label: "Live" },
    ],
    hint: "Live payments need separate owner approval.",
  },
  {
    name: "currencies",
    label: "Currencies",
    type: "list",
    required: true,
    placeholder: "GBP, EUR",
    hint: "Three-letter codes, separated by commas.",
  },
];

const ai: FieldDef[] = [
  {
    name: "defaultModel",
    label: "Default model",
    type: "text",
    required: true,
  },
  {
    name: "dataRegion",
    label: "Data region",
    type: "text",
    hint: "Where the provider processes requests.",
  },
];

export const PROVIDER_FIELDS: Record<string, readonly FieldDef[]> = {
  resend: sender,
  "amazon-ses": [
    ...sender,
    region,
    { name: "configurationSet", label: "Configuration set", type: "text" },
  ],
  "aws-s3": [
    { name: "bucket", label: "Bucket name", type: "text", required: true },
    region,
    {
      name: "kmsKeyAlias",
      label: "KMS key alias",
      type: "text",
      placeholder: "alias/teamhappi-documents",
    },
  ],
  cloudinary: [
    { name: "cloudName", label: "Cloud name", type: "text", required: true },
    { name: "folder", label: "Folder", type: "text" },
  ],
  stripe: payments,
  paystack: payments,
  flutterwave: payments,
  anthropic: ai,
  openai: ai,
  "google-gemini": ai,
  "aws-bedrock": ai,
  "azure-openai": ai,
};

/** Environment variables that hold each provider's credentials. */
export const CREDENTIAL_ENV: Record<string, readonly string[]> = {
  resend: ["RESEND_API_KEY"],
  "amazon-ses": ["SES_ACCESS_KEY_ID", "SES_SECRET_ACCESS_KEY"],
  "aws-s3": ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
  cloudinary: ["CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  paystack: ["PAYSTACK_SECRET_KEY"],
  flutterwave: ["FLUTTERWAVE_SECRET_KEY", "FLUTTERWAVE_WEBHOOK_SECRET"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "google-gemini": ["GEMINI_API_KEY"],
  "aws-bedrock": ["BEDROCK_ACCESS_KEY_ID", "BEDROCK_SECRET_ACCESS_KEY"],
  "azure-openai": ["AZURE_OPENAI_API_KEY"],
};

/**
 * Whether each credential variable is set in THIS deployment. Only presence
 * is reported; values are never read into the result.
 */
export function credentialPresence(
  providerId: string,
  env: Record<string, string | undefined> = process.env,
): { name: string; present: boolean }[] {
  return (CREDENTIAL_ENV[providerId] ?? []).map((name) => ({
    name,
    present: typeof env[name] === "string" && env[name]!.trim().length > 0,
  }));
}

/** Converts submitted form strings into the shape the provider schema expects. */
export function formToConfig(
  providerId: string,
  form: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of PROVIDER_FIELDS[providerId] ?? []) {
    const raw = (form[field.name] ?? "").trim();
    if (!raw) continue; // optional fields stay absent
    out[field.name] =
      field.type === "list"
        ? raw
            .split(",")
            .map((v) => v.trim().toUpperCase())
            .filter(Boolean)
        : raw;
  }
  return out;
}
