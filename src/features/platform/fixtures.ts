import type { IntegrationAuditAction } from "@/integrations/core/audit";
import type {
  DeploymentEnvironment,
  HealthStatus,
  ServiceCategory,
} from "@/integrations/core/types";
import type { CredentialStatus } from "@/integrations/credentials";

// SYNTHETIC Platform Admin data for design review. No real provider, account,
// key or customer appears here; nothing is fetched from any service.

export const PLATFORM_REFERENCE_DATE = "2026-10-13T09:00:00Z";
export const PLATFORM_ORGANISATION = "Macrovision platform";

export interface ProviderState {
  active: boolean;
  health: HealthStatus;
  environment: DeploymentEnvironment;
  lastValidatedAt: string | null;
  latencyMs: number | null;
  errors24h: number;
  /** Non-secret configuration, as Platform Admin would display it. */
  config: Record<string, string>;
}

const notConfigured: ProviderState = {
  active: false,
  health: "not-configured",
  environment: "preview",
  lastValidatedAt: null,
  latencyMs: null,
  errors24h: 0,
  config: {},
};

export const PROVIDER_STATE: Record<string, ProviderState> = {
  "dev-mailer": {
    active: true,
    health: "healthy",
    environment: "local",
    lastValidatedAt: "2026-10-13T08:40:00Z",
    latencyMs: 2,
    errors24h: 0,
    config: { Delivery: "Server console only" },
  },
  resend: {
    ...notConfigured,
    config: {
      "Sender name": "TeamHappi",
      "Sender address": "noreply@teamhappi.example",
      "Sending domain": "teamhappi.example (not verified)",
    },
  },
  "amazon-ses": { ...notConfigured, config: { Region: "eu-west-2 (London)" } },
  "synthetic-storage": {
    active: true,
    health: "healthy",
    environment: "local",
    lastValidatedAt: "2026-10-13T08:40:00Z",
    latencyMs: 1,
    errors24h: 0,
    config: { Location: "In memory, cleared on restart" },
  },
  "aws-s3": {
    ...notConfigured,
    config: {
      Bucket: "teamhappi-docs-example",
      Region: "eu-west-2 (London)",
      Encryption: "SSE-KMS",
    },
  },
  cloudinary: { ...notConfigured, config: { Use: "Media only" } },
  "synthetic-payments": {
    active: true,
    health: "healthy",
    environment: "local",
    lastValidatedAt: "2026-10-13T08:40:00Z",
    latencyMs: 3,
    errors24h: 2,
    config: { Mode: "Sandbox", Currencies: "GBP" },
  },
  stripe: {
    ...notConfigured,
    config: { Mode: "Sandbox (planned)", Currencies: "GBP, EUR" },
  },
  paystack: notConfigured,
  flutterwave: notConfigured,
  "synthetic-ai": {
    active: true,
    health: "healthy",
    environment: "local",
    lastValidatedAt: "2026-10-13T08:40:00Z",
    latencyMs: 4,
    errors24h: 0,
    config: { Model: "synthetic-draft-1" },
  },
  anthropic: notConfigured,
  openai: notConfigured,
  "google-gemini": notConfigured,
  "aws-bedrock": notConfigured,
  "azure-openai": notConfigured,
};

export interface CredentialRow {
  providerId: string;
  category: ServiceCategory;
  environment: DeploymentEnvironment;
  version: number | null;
  status: CredentialStatus | "not-registered";
  lastValidatedAt: string | null;
  lastRotatedAt: string | null;
  expiresAt: string | null;
  configVersion: number | null;
  health: HealthStatus;
}

export const CREDENTIALS: CredentialRow[] = [
  {
    providerId: "synthetic-payments",
    category: "payments",
    environment: "local",
    version: 2,
    status: "active",
    lastValidatedAt: "2026-10-13T08:40:00Z",
    lastRotatedAt: "2026-10-01T10:15:00Z",
    expiresAt: "2026-12-31T23:59:00Z",
    configVersion: 3,
    health: "healthy",
  },
  {
    providerId: "synthetic-payments",
    category: "payments",
    environment: "local",
    version: 1,
    status: "revoked",
    lastValidatedAt: "2026-09-02T09:00:00Z",
    lastRotatedAt: "2026-09-02T09:00:00Z",
    expiresAt: null,
    configVersion: 2,
    health: "unknown",
  },
  ...(
    [
      ["resend", "email"],
      ["amazon-ses", "email"],
      ["aws-s3", "storage"],
      ["cloudinary", "storage"],
      ["stripe", "payments"],
      ["anthropic", "ai"],
      ["openai", "ai"],
    ] as const
  ).map(([providerId, category]): CredentialRow => ({
    providerId,
    category,
    environment: "preview",
    version: null,
    status: "not-registered",
    lastValidatedAt: null,
    lastRotatedAt: null,
    expiresAt: null,
    configVersion: null,
    health: "not-configured",
  })),
];

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: IntegrationAuditAction;
  providerId: string;
  detail: string;
}

export const AUDIT_EVENTS: AuditRow[] = [
  {
    id: "aud-6",
    at: "2026-10-13T08:40:00Z",
    actor: "Platform admin (demo)",
    action: "provider.validated",
    providerId: "dev-mailer",
    detail: "Configuration v1 validated",
  },
  {
    id: "aud-5",
    at: "2026-10-12T16:05:00Z",
    actor: "Platform admin (demo)",
    action: "ai.kill_switch_changed",
    providerId: "synthetic-ai",
    detail: "AI switched off for all organisations",
  },
  {
    id: "aud-4",
    at: "2026-10-01T10:20:00Z",
    actor: "Platform admin (demo)",
    action: "credential.revoked",
    providerId: "synthetic-payments",
    detail: "Version 1 revoked after rotation",
  },
  {
    id: "aud-3",
    at: "2026-10-01T10:15:00Z",
    actor: "Platform admin (demo)",
    action: "credential.activated",
    providerId: "synthetic-payments",
    detail: "Version 2 activated",
  },
  {
    id: "aud-2",
    at: "2026-10-01T10:12:00Z",
    actor: "Platform admin (demo)",
    action: "credential.validated",
    providerId: "synthetic-payments",
    detail: "Version 2 validated",
  },
  {
    id: "aud-1",
    at: "2026-10-01T10:10:00Z",
    actor: "Platform admin (demo)",
    action: "credential.registered",
    providerId: "synthetic-payments",
    detail: "Version 2 registered",
  },
];

export const AI_DEMO = {
  killSwitch: true,
  defaultModel: "synthetic-draft-1",
  features: [
    {
      id: "recruitment-drafts",
      label: "Recruitment message drafts",
      enabled: false,
    },
    { id: "job-descriptions", label: "Job description drafts", enabled: false },
    {
      id: "training-drafts",
      label: "Training material drafts",
      enabled: false,
    },
    {
      id: "operational-summaries",
      label: "Operational summaries",
      enabled: false,
    },
    {
      id: "rota-suggestions",
      label: "Rota planning suggestions",
      enabled: false,
    },
    { id: "help-assistant", label: "Internal help assistant", enabled: false },
  ],
  budget: { requests: "0 / 0", tokens: "0 / 0", spend: "£0.00 / £0.00" },
} as const;

export const PLATFORM_STATS = {
  organisations: 3,
  activeIntegrations: 4,
  needsAttention: 1,
  expiringCredentials: 0,
};

export const CATEGORY_LABEL: Record<ServiceCategory, string> = {
  email: "Email",
  storage: "File and document storage",
  payments: "Payments",
  ai: "AI",
};

export const CATEGORY_DESCRIPTION: Record<ServiceCategory, string> = {
  email:
    "Verification, invitation and notification email. The development mailer only prints to the server console.",
  storage:
    "Private, tenant-isolated storage for documents and media. Each file remembers which provider holds it.",
  payments:
    "TeamHappi's own subscription billing through provider-hosted checkout. Not payroll.",
  ai: "Optional drafting and summarising help. A person always reviews the output. Switched off by default.",
};
