import { IntegrationError } from "../core/types";

// Provider-independent AI (ADR-0011). AI drafts and suggests; a person decides.
// Nothing here makes employment, hiring, disciplinary or compliance decisions.
//
// Every request passes, in order: global kill switch → feature enabled →
// data guard → budget → capability routing. Adapters for external providers
// are not activated; only the synthetic adapter runs.

export type AiCapability =
  "text-generation" | "long-context" | "structured-output" | "vision";

export type AiFeature =
  | "recruitment-drafts"
  | "job-descriptions"
  | "training-drafts"
  | "operational-summaries"
  | "rota-suggestions"
  | "help-assistant";

export interface AiModel {
  providerId: string;
  model: string;
  capabilities: readonly AiCapability[];
  /** Estimated cost in pence per 1,000 tokens (decimal string, never float). */
  pencePerThousandTokens: string;
}

export interface AiSettings {
  killSwitch: boolean;
  enabledFeatures: ReadonlySet<AiFeature>;
  /** Model per feature; a feature without one uses `defaultModel`. */
  featureModels: Partial<Record<AiFeature, string>>;
  defaultModel: string;
  /** Tried in order when the chosen model's provider is unavailable. */
  fallbackModels: readonly string[];
}

export interface AiRequest {
  tenantId: string;
  feature: AiFeature;
  needs: readonly AiCapability[];
  prompt: string;
  /** Classifications of the data in the prompt, declared by the caller. */
  dataClasses: readonly DataClass[];
  maxOutputTokens: number;
}

export type DataClass =
  | "public"
  | "operational"
  | "personal"
  | "special-category"
  | "identity-document"
  | "right-to-work"
  | "payroll"
  | "health";

/** Allowed to leave TeamHappi without a separately approved privacy design. */
const SHAREABLE: ReadonlySet<DataClass> = new Set(["public", "operational"]);

export class AiRefusedError extends IntegrationError {
  constructor(
    readonly reason:
      | "kill-switch"
      | "feature-disabled"
      | "restricted-data"
      | "budget"
      | "no-model",
  ) {
    super(`AI request refused: ${reason}`, false);
    this.name = "AiRefusedError";
  }
}

/** Removes common UK personal identifiers that slipped into free text. */
export function redactPersonalData(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b/g, "[phone]")
    .replace(
      /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi,
      "[ni-number]",
    )
    .replace(/\b\d{2}-\d{2}-\d{2}\b/g, "[sort-code]")
    .replace(/\b\d{8}\b/g, "[number]");
}

export interface BudgetState {
  requestLimit: number;
  tokenLimit: number;
  /** Spend cap in pence for the period (integer). */
  spendLimitPence: number;
  requests: number;
  tokens: number;
  spendPence: number;
}

function estimatePence(model: AiModel, tokens: number): number {
  const [whole, fraction = ""] = model.pencePerThousandTokens.split(".");
  // Integer arithmetic in millionths of a penny to avoid floating point.
  const microPerThousand =
    Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0").slice(0, 6));
  return Math.ceil((microPerThousand * tokens) / 1000 / 1_000_000);
}

export function selectModel(
  settings: AiSettings,
  models: readonly AiModel[],
  request: Pick<AiRequest, "feature" | "needs">,
  unavailableProviders: ReadonlySet<string> = new Set(),
): AiModel {
  const preferred =
    settings.featureModels[request.feature] ?? settings.defaultModel;
  for (const name of [preferred, ...settings.fallbackModels]) {
    const model = models.find((m) => m.model === name);
    if (
      model &&
      !unavailableProviders.has(model.providerId) &&
      request.needs.every((c) => model.capabilities.includes(c))
    )
      return model;
  }
  throw new AiRefusedError("no-model");
}

export interface AiPlan {
  model: AiModel;
  prompt: string;
  reservedTokens: number;
  reservedPence: number;
}

/**
 * Checks a request against every guard and reserves budget. Callers send the
 * returned (redacted) prompt, never the original.
 */
export function planAiRequest(
  settings: AiSettings,
  models: readonly AiModel[],
  budget: BudgetState,
  request: AiRequest,
  unavailableProviders?: ReadonlySet<string>,
): AiPlan {
  if (settings.killSwitch) throw new AiRefusedError("kill-switch");
  if (!settings.enabledFeatures.has(request.feature))
    throw new AiRefusedError("feature-disabled");
  if (!request.tenantId) throw new AiRefusedError("restricted-data");
  if (request.dataClasses.some((c) => !SHAREABLE.has(c)))
    throw new AiRefusedError("restricted-data");

  const model = selectModel(settings, models, request, unavailableProviders);
  const prompt = redactPersonalData(request.prompt);
  const reservedTokens = Math.ceil(prompt.length / 4) + request.maxOutputTokens;
  const reservedPence = estimatePence(model, reservedTokens);
  if (
    budget.requests + 1 > budget.requestLimit ||
    budget.tokens + reservedTokens > budget.tokenLimit ||
    budget.spendPence + reservedPence > budget.spendLimitPence
  )
    throw new AiRefusedError("budget");

  budget.requests += 1;
  budget.tokens += reservedTokens;
  budget.spendPence += reservedPence;
  return { model, prompt, reservedTokens, reservedPence };
}

/** Deterministic adapter for tests and demos. Never calls out. */
export const SYNTHETIC_MODEL: AiModel = {
  providerId: "synthetic-ai",
  model: "synthetic-draft-1",
  capabilities: ["text-generation", "structured-output"],
  pencePerThousandTokens: "0",
};

export async function syntheticComplete(
  plan: AiPlan,
): Promise<{ text: string; reviewRequired: true }> {
  return {
    text: `[synthetic draft for review] ${plan.prompt.slice(0, 120)}`,
    reviewRequired: true,
  };
}
