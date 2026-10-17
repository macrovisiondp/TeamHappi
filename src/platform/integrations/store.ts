// Platform integration configuration (M5.3, ADR-0011 stage 1, ADR-0012).
//
// Runs as teamhappi_platform. Non-secret provider settings are stored as
// numbered, append-only versions; one provider is active per service and
// environment; AI controls are a platform setting. Credential VALUES never
// reach this module: only whether the environment variables are present.
//
// Activation rules (enforced here, not in the UI):
// - "synthetic" providers: only outside production.
// - "adapter-ready" providers: only when the owner has approved them for live
//   use (APPROVED_LIVE_PROVIDERS), their credentials are present, and their
//   latest configuration has been validated. Live network adapters are added
//   in later, separately approved increments, so validation for them is
//   refused until then.
// - "planned" providers: never.
// Every change needs a PlatformStaffActor with "integrations.manage" (MFA
// within 15 minutes) and is audited in the same transaction.

import { z } from "zod";

import type {
  DeploymentEnvironment,
  ServiceCategory,
} from "@/integrations/core/types";
import { credentialPresence } from "@/integrations/fields";
import {
  getProvider,
  providersFor,
  validateProviderConfig,
} from "@/integrations/registry";
import {
  assertPlatformGrant,
  type PlatformStaffActor,
} from "@/platform/authz/internal";
import type { PlatformDbClient } from "@/platform/db";

export type StoreResult =
  | { ok: true }
  | {
      ok: false;
      code: "invalid" | "not_found" | "refused";
      message: string;
      fieldErrors?: Record<string, string>;
    };

export interface ProviderState {
  providerId: string;
  active: boolean;
  latest: {
    version: number;
    settings: Record<string, unknown>;
    validatedAt: Date | null;
    createdAt: Date;
  } | null;
  versions: number;
  credentials: { name: string; present: boolean }[];
}

export interface CategoryState {
  category: ServiceCategory;
  environment: DeploymentEnvironment;
  activeProviderId: string | null;
  activatedAt: Date | null;
  providers: ProviderState[];
}

export async function categoryState(
  db: PlatformDbClient,
  category: ServiceCategory,
  environment: DeploymentEnvironment,
  env: Record<string, string | undefined> = process.env,
): Promise<CategoryState> {
  const [active, configs] = await Promise.all([
    db.integrationActive.findUnique({
      where: { category_environment: { category, environment } },
    }),
    db.integrationConfig.findMany({
      where: { category, environment },
      orderBy: [{ providerId: "asc" }, { version: "desc" }],
    }),
  ]);
  return {
    category,
    environment,
    activeProviderId: active?.providerId ?? null,
    activatedAt: active?.activatedAt ?? null,
    providers: providersFor(category).map((p) => {
      const mine = configs.filter((c) => c.providerId === p.id);
      const latest = mine[0];
      return {
        providerId: p.id,
        active: active?.providerId === p.id,
        latest: latest
          ? {
              version: latest.version,
              settings: (latest.settings ?? {}) as Record<string, unknown>,
              validatedAt: latest.validatedAt,
              createdAt: latest.createdAt,
            }
          : null,
        versions: mine.length,
        credentials: credentialPresence(p.id, env),
      };
    }),
  };
}

async function audit(
  tx: Pick<PlatformDbClient, "platformAuditEvent">,
  actor: PlatformStaffActor,
  action: string,
  targetId: string,
  detail: Record<string, string | number | boolean | null>,
) {
  await tx.platformAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      action,
      targetType: "integration",
      targetId,
      detail,
    },
    select: { id: true },
  });
}

/** Saves a new configuration version (non-secret settings only). */
export async function saveProviderConfig(
  db: PlatformDbClient,
  actor: PlatformStaffActor,
  providerId: string,
  environment: DeploymentEnvironment,
  input: Record<string, unknown>,
): Promise<StoreResult> {
  assertPlatformGrant(actor, "integrations.manage");
  const provider = getProvider(providerId);
  if (!provider)
    return { ok: false, code: "not_found", message: "Unknown provider." };
  if (provider.readiness === "planned")
    return {
      ok: false,
      code: "refused",
      message: `${provider.name} isn't available yet.`,
    };
  const parsed = validateProviderConfig(providerId, input);
  if (!parsed.ok)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: parsed.errors,
    };
  return db.$transaction(async (tx) => {
    const last = await tx.integrationConfig.findFirst({
      where: { category: provider.category, providerId, environment },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    await tx.integrationConfig.create({
      data: {
        category: provider.category,
        providerId,
        environment,
        version,
        settings: parsed.config as object,
        createdBy: actor.userId,
      },
      select: { id: true },
    });
    await audit(tx, actor, "integration.configured", providerId, {
      environment,
      version,
    });
    return { ok: true } as const;
  });
}

/**
 * Checks the latest configuration. Synthetic providers are checked locally;
 * real providers need a live adapter, which is a separately approved
 * increment, so their check is refused for now (no network calls).
 */
export async function validateLatestConfig(
  db: PlatformDbClient,
  actor: PlatformStaffActor,
  providerId: string,
  environment: DeploymentEnvironment,
): Promise<StoreResult> {
  assertPlatformGrant(actor, "integrations.manage");
  const provider = getProvider(providerId);
  if (!provider)
    return { ok: false, code: "not_found", message: "Unknown provider." };
  if (provider.readiness !== "synthetic")
    return {
      ok: false,
      code: "refused",
      message: `Testing ${provider.name} needs a live connection, which requires your separate approval. No request was sent.`,
    };
  return db.$transaction(async (tx) => {
    const latest = await tx.integrationConfig.findFirst({
      where: { category: provider.category, providerId, environment },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    // Synthetic providers need no settings: record an empty version on first test.
    const configId =
      latest?.id ??
      (
        await tx.integrationConfig.create({
          data: {
            category: provider.category,
            providerId,
            environment,
            version: 1,
            createdBy: actor.userId,
          },
          select: { id: true },
        })
      ).id;
    await tx.integrationConfig.update({
      where: { id: configId },
      data: { validatedAt: new Date() },
      select: { id: true },
    });
    await audit(tx, actor, "integration.validated", providerId, {
      environment,
      version: latest?.version ?? 1,
    });
    return { ok: true } as const;
  });
}

/** Makes a provider the active one for its service in this environment. */
export async function activateProvider(
  db: PlatformDbClient,
  actor: PlatformStaffActor,
  providerId: string,
  environment: DeploymentEnvironment,
  approvedLive: ReadonlySet<string>,
  env: Record<string, string | undefined> = process.env,
): Promise<StoreResult> {
  assertPlatformGrant(actor, "integrations.manage");
  const provider = getProvider(providerId);
  if (!provider)
    return { ok: false, code: "not_found", message: "Unknown provider." };
  if (provider.readiness === "planned")
    return {
      ok: false,
      code: "refused",
      message: `${provider.name} isn't available yet.`,
    };
  if (provider.readiness === "synthetic" && environment === "production")
    return {
      ok: false,
      code: "refused",
      message: "Test adapters can't be used in production.",
    };
  if (provider.readiness === "adapter-ready") {
    if (!approvedLive.has(providerId))
      return {
        ok: false,
        code: "refused",
        message: `Switching on ${provider.name} needs your separate approval for live use.`,
      };
    if (credentialPresence(providerId, env).some((c) => !c.present))
      return {
        ok: false,
        code: "refused",
        message: `${provider.name}'s credentials aren't set in this deployment.`,
      };
  }
  return db.$transaction(async (tx) => {
    const latest = await tx.integrationConfig.findFirst({
      where: { category: provider.category, providerId, environment },
      orderBy: { version: "desc" },
      select: { id: true, version: true, validatedAt: true },
    });
    if (!latest?.validatedAt)
      return {
        ok: false,
        code: "refused",
        message: "Test the connection successfully before making it active.",
      } as const;
    const previous = await tx.integrationActive.findUnique({
      where: {
        category_environment: { category: provider.category, environment },
      },
      select: { providerId: true },
    });
    await tx.integrationActive.upsert({
      where: {
        category_environment: { category: provider.category, environment },
      },
      create: {
        category: provider.category,
        environment,
        providerId,
        configId: latest.id,
        activatedBy: actor.userId,
      },
      update: {
        providerId,
        configId: latest.id,
        activatedBy: actor.userId,
        activatedAt: new Date(),
      },
      select: { category: true },
    });
    await audit(tx, actor, "integration.activated", providerId, {
      environment,
      version: latest.version,
      previous: previous?.providerId ?? null,
    });
    return { ok: true } as const;
  });
}

// --- AI controls -------------------------------------------------------------

export const AI_FEATURES = [
  "recruitment-drafts",
  "job-descriptions",
  "training-drafts",
  "operational-summaries",
  "rota-suggestions",
  "help-assistant",
] as const;

const aiSettingsSchema = z.object({
  killSwitch: z.boolean(),
  features: z.array(z.enum(AI_FEATURES)).max(AI_FEATURES.length),
  requestLimit: z.number().int().min(0).max(1_000_000),
  tokenLimit: z.number().int().min(0).max(100_000_000),
  /** Monthly spend cap in pence (integer, never floating point). */
  spendLimitPence: z.number().int().min(0).max(10_000_000),
});
export type AiControls = z.infer<typeof aiSettingsSchema>;

export const AI_DEFAULTS: AiControls = {
  killSwitch: true,
  features: [],
  requestLimit: 0,
  tokenLimit: 0,
  spendLimitPence: 0,
};

const AI_KEY = "ai.controls";

export async function getAiControls(
  db: PlatformDbClient,
): Promise<AiControls & { updatedAt: Date | null }> {
  const row = await db.platformSetting.findUnique({ where: { key: AI_KEY } });
  const parsed = aiSettingsSchema.safeParse(row?.value);
  return {
    ...(parsed.success ? parsed.data : AI_DEFAULTS),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function saveAiControls(
  db: PlatformDbClient,
  actor: PlatformStaffActor,
  input: unknown,
): Promise<StoreResult> {
  assertPlatformGrant(actor, "integrations.manage");
  const parsed = aiSettingsSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid",
      message: "Check the highlighted fields.",
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [
          String(i.path[0] ?? "form"),
          i.message,
        ]),
      ),
    };
  const value = {
    ...parsed.data,
    features: [...new Set(parsed.data.features)],
  };
  return db.$transaction(async (tx) => {
    await tx.platformSetting.upsert({
      where: { key: AI_KEY },
      create: { key: AI_KEY, value, updatedBy: actor.userId },
      update: { value, updatedBy: actor.userId, updatedAt: new Date() },
      select: { key: true },
    });
    await audit(tx, actor, "ai.controls_changed", "ai", {
      killSwitch: value.killSwitch,
      features: value.features.length,
      requestLimit: value.requestLimit,
      tokenLimit: value.tokenLimit,
      spendLimitPence: value.spendLimitPence,
    });
    return { ok: true } as const;
  });
}

/** Providers the owner has approved for live use (APPROVED_LIVE_PROVIDERS). */
export function approvedLiveProviders(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => getProvider(v)?.readiness === "adapter-ready"),
  );
}
