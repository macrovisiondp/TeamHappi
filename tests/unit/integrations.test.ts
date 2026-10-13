import { describe, expect, it, vi } from "vitest";

import {
  AiRefusedError,
  planAiRequest,
  redactPersonalData,
  SYNTHETIC_MODEL,
  type AiModel,
  type AiSettings,
  type BudgetState,
} from "@/integrations/ai";
import {
  buildAuditEvent,
  type IntegrationAuditEvent,
} from "@/integrations/core/audit";
import {
  CircuitBreaker,
  CircuitOpenError,
} from "@/integrations/core/circuit-breaker";
import { ConfigHistory } from "@/integrations/core/config-versions";
import { deploymentEnvironment } from "@/integrations/core/environment";
import { REDACTED, redact } from "@/integrations/core/redact";
import {
  IntegrationError,
  ProviderNotActivatedError,
} from "@/integrations/core/types";
import { CredentialSet, inMemorySecretStore } from "@/integrations/credentials";
import {
  createEmailSender,
  devMailer,
  isSyntheticAddress,
  sendTestEmail,
  unactivatedEmailProvider,
  type EmailProvider,
} from "@/integrations/email";
import {
  PaymentLedger,
  routeForCurrency,
  signWebhook,
  verifyWebhookSignature,
  WebhookVerificationError,
} from "@/integrations/payments";
import { PROVIDERS, validateProviderConfig } from "@/integrations/registry";
import {
  assertObjectInTenant,
  assertProviderAllowed,
  checkUpload,
  DOCUMENT_POLICY,
  objectKey,
  providerForObject,
  syntheticStorage,
  unactivatedStorageProvider,
  type StorageProvider,
} from "@/integrations/storage";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const OBJECT_ID = "AbCdEfGhIjKlMnOpQr";
// Assembled at runtime so secret scanners don't flag test fixtures.
const FAKE_KEY = ["sk", "test", "x".repeat(24)].join("_");

describe("deployment environment", () => {
  it("maps Vercel environments and fails towards production", () => {
    expect(deploymentEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(deploymentEnvironment({ VERCEL_ENV: "production" })).toBe(
      "production",
    );
    expect(deploymentEnvironment({ VERCEL_ENV: "something-else" })).toBe(
      "production",
    );
    expect(deploymentEnvironment({ NODE_ENV: "development" })).toBe("local");
    expect(deploymentEnvironment({ NODE_ENV: "production" })).toBe(
      "production",
    );
    expect(deploymentEnvironment({ NODE_ENV: "production", CI: "true" })).toBe(
      "local",
    );
  });
});

describe("credential redaction", () => {
  it("removes secret keys and secret-looking values at any depth", () => {
    const out = redact({
      provider: "stripe",
      apiKey: FAKE_KEY,
      nested: { webhookSigningSecret: "abc", note: `Bearer ${"t".repeat(20)}` },
      list: [{ password: "hunter2" }, "plain text"],
    });
    expect(out).toEqual({
      provider: "stripe",
      apiKey: REDACTED,
      nested: { webhookSigningSecret: REDACTED, note: REDACTED },
      list: [{ password: REDACTED }, "plain text"],
    });
    expect(JSON.stringify(out)).not.toContain(FAKE_KEY);
  });

  it("refuses audit events that would still carry a secret", () => {
    const event = buildAuditEvent({
      action: "credential.activated",
      actorUserId: "user-1",
      category: "payments",
      providerId: "stripe",
      environment: "local",
      detail: { version: 2, apiKey: FAKE_KEY },
    });
    expect(event.detail.apiKey).toBe(REDACTED);
    expect(Object.isFrozen(event)).toBe(true);
  });
});

describe("provider registry and configuration validation", () => {
  it("has unique ids and covers every category", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of ["email", "storage", "payments", "ai"])
      expect(PROVIDERS.some((p) => p.category === category)).toBe(true);
  });

  it("accepts valid configuration and reports field errors", () => {
    expect(
      validateProviderConfig("amazon-ses", {
        senderName: "TeamHappi",
        senderAddress: "noreply@teamhappi.example",
        sendingDomain: "teamhappi.example",
        region: "eu-west-2",
      }),
    ).toMatchObject({ ok: true });
    const bad = validateProviderConfig("amazon-ses", {
      senderName: "",
      senderAddress: "nope",
      sendingDomain: "x",
      region: "London",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(Object.keys(bad.errors).sort()).toEqual([
        "region",
        "senderAddress",
        "senderName",
        "sendingDomain",
      ]);
  });

  it("rejects secrets submitted as plain configuration", () => {
    const result = validateProviderConfig("resend", {
      senderName: "TeamHappi",
      senderAddress: "noreply@teamhappi.example",
      sendingDomain: "teamhappi.example",
      apiKey: FAKE_KEY,
    });
    expect(result).toMatchObject({
      ok: false,
      errors: { apiKey: expect.any(String) },
    });
  });

  it("rejects unknown providers", () => {
    expect(validateProviderConfig("evil", {})).toMatchObject({ ok: false });
  });
});

describe("provider switching and configuration rollback", () => {
  it("activates only validated versions and rolls back to the last good one", () => {
    const history = new ConfigHistory<{ providerId: string }>();
    const v1 = history.propose({ providerId: "dev-mailer" }, "u1");
    expect(() => history.activate(v1.version)).toThrow(/not been validated/);
    history.markValidated(v1.version);
    history.activate(v1.version);
    const v2 = history.propose({ providerId: "resend" }, "u1");
    history.markValidated(v2.version);
    history.activate(v2.version);
    expect(history.active?.config.providerId).toBe("resend");
    expect(history.rollback().config.providerId).toBe("dev-mailer");
  });
});

describe("credential rotation", () => {
  function setup() {
    const events: IntegrationAuditEvent[] = [];
    const set = new CredentialSet(
      { providerId: "resend", category: "email", environment: "local" },
      inMemorySecretStore("local"),
      (e) => void events.push(e),
    );
    return { set, events };
  }

  it("register → validate → activate → revoke previous, with audit and no secret exposure", async () => {
    const { set, events } = setup();
    const first = await set.register("first-secret-value", "admin");
    await set.validate(first.id, async () => true, "admin");
    await set.activate(first.id, "admin");
    const second = await set.register("second-secret-value", "admin");
    await set.validate(second.id, async () => true, "admin");
    await set.activate(second.id, "admin");
    await set.revoke(first.id, "admin");

    expect(set.list().map((c) => c.status)).toEqual(["revoked", "active"]);
    expect(await set.activeSecret()).toBe("second-secret-value");
    expect(JSON.stringify(set.list())).not.toMatch(/secret-value|mem:/);
    expect(JSON.stringify(events)).not.toMatch(/secret-value/);
    expect(events.map((e) => e.action)).toContain("credential.revoked");
  });

  it("a credential that fails validation can never be activated", async () => {
    const { set, events } = setup();
    const bad = await set.register("bad-secret-value", "admin");
    expect(await set.validate(bad.id, async () => false, "admin")).toBe(false);
    await expect(set.activate(bad.id, "admin")).rejects.toThrow(/failed/);
    expect(events.at(-1)?.action).toBe("credential.rotation_failed");
  });

  it("a validator that throws counts as a failure", async () => {
    const { set } = setup();
    const c = await set.register("throwing-secret", "admin");
    expect(
      await set.validate(
        c.id,
        async () => {
          throw new Error("network");
        },
        "admin",
      ),
    ).toBe(false);
  });

  it("rolls back to the previous credential after a bad rotation", async () => {
    const { set } = setup();
    const old = await set.register("old-secret-value", "admin");
    await set.validate(old.id, async () => true, "admin");
    await set.activate(old.id, "admin");
    const next = await set.register("new-secret-value", "admin");
    await set.validate(next.id, async () => true, "admin");
    await set.activate(next.id, "admin");
    await set.rollback("admin");
    expect(await set.activeSecret()).toBe("old-secret-value");
    expect(set.active?.version).toBe(1);
  });

  it("the active credential cannot be revoked", async () => {
    const { set } = setup();
    const c = await set.register("only-secret-value", "admin");
    await set.validate(c.id, async () => true, "admin");
    await set.activate(c.id, "admin");
    await expect(set.revoke(c.id, "admin")).rejects.toThrow(/active/);
  });

  it("the in-memory secret store refuses production", () => {
    expect(() => inMemorySecretStore("production")).toThrow(/production/);
  });
});

describe("email", () => {
  const message = {
    to: "a@example.test",
    subject: "Hi",
    text: "token=abc",
    idempotencyKey: "k1",
  };

  it("the development mailer never logs the message body and refuses production", async () => {
    const log = vi.fn();
    await devMailer(log, "local").send(message);
    expect(log.mock.calls[0]![0]).not.toContain("token=abc");
    expect(() => devMailer(log, "production")).toThrow(
      ProviderNotActivatedError,
    );
  });

  it("live providers make no calls until activated", async () => {
    await expect(
      unactivatedEmailProvider("resend").send(message),
    ).rejects.toThrow(ProviderNotActivatedError);
  });

  it("falls back only on retryable failures, and never sends the same message twice", async () => {
    const failing: EmailProvider = {
      id: "primary",
      send: vi.fn(async () => {
        throw new IntegrationError("rate limited", true);
      }),
    };
    const backup = {
      id: "backup",
      send: vi.fn(async () => ({
        providerId: "backup",
        providerMessageId: "m1",
      })),
    };
    const failures: string[] = [];
    const send = createEmailSender({
      primary: failing,
      fallback: backup,
      onFailure: (f) => failures.push(f.providerId),
    });
    await send(message);
    await send(message); // retry of the same logical message
    expect(backup.send).toHaveBeenCalledTimes(1);
    expect(failures).toEqual(["primary"]);
  });

  it("does not fall back after an ambiguous (non-retryable) failure", async () => {
    const ambiguous: EmailProvider = {
      id: "primary",
      send: async () => {
        throw new IntegrationError("timeout after request sent", false);
      },
    };
    const backup = { id: "backup", send: vi.fn() };
    await expect(
      createEmailSender({ primary: ambiguous, fallback: backup })(message),
    ).rejects.toThrow(/timeout/);
    expect(backup.send).not.toHaveBeenCalled();
  });

  it("test emails go to reserved test domains only", async () => {
    expect(isSyntheticAddress("ops@example.test")).toBe(true);
    expect(isSyntheticAddress("real.person@gmail.com")).toBe(false);
    await expect(
      sendTestEmail(
        devMailer(() => {}, "local"),
        "real.person@gmail.com",
        "k",
      ),
    ).rejects.toThrow(/reserved test domains/);
  });
});

describe("storage tenant isolation", () => {
  const ref = (tenantId: string) => ({
    providerId: "synthetic-storage",
    key: objectKey(tenantId, OBJECT_ID),
    tenantId,
    classification: "restricted" as const,
  });

  it("builds keys inside the tenant prefix and rejects crafted ids", () => {
    expect(objectKey(TENANT_A, OBJECT_ID)).toBe(
      `tenants/${TENANT_A}/objects/${OBJECT_ID}`,
    );
    expect(() => objectKey("../etc", OBJECT_ID)).toThrow();
    expect(() => objectKey(TENANT_A, "../../x")).toThrow();
  });

  it("another tenant's object looks the same as a missing one", () => {
    expect(() => assertObjectInTenant(ref(TENANT_A), TENANT_A)).not.toThrow();
    expect(() => assertObjectInTenant(ref(TENANT_A), TENANT_B)).toThrow(
      "Object not found",
    );
    expect(() =>
      assertObjectInTenant({ ...ref(TENANT_B), tenantId: TENANT_A }, TENANT_A),
    ).toThrow("Object not found");
  });

  it("Cloudinary is refused for restricted HR documents", () => {
    expect(() =>
      assertProviderAllowed(
        unactivatedStorageProvider("cloudinary"),
        "restricted",
      ),
    ).toThrow(/not approved/);
    expect(() =>
      assertProviderAllowed(unactivatedStorageProvider("aws-s3"), "restricted"),
    ).not.toThrow();
  });

  it("enforces type and size limits", () => {
    expect(checkUpload(DOCUMENT_POLICY, "application/pdf", 1000)).toEqual({
      ok: true,
    });
    expect(
      checkUpload(DOCUMENT_POLICY, "application/x-msdownload", 1000),
    ).toMatchObject({ ok: false });
    expect(
      checkUpload(DOCUMENT_POLICY, "application/pdf", 50 * 1024 * 1024),
    ).toMatchObject({ ok: false });
  });

  it("switching the upload provider keeps existing objects readable from their own provider", async () => {
    const synthetic = syntheticStorage("local");
    await synthetic.presignUpload(ref(TENANT_A), "application/pdf", 10);
    const providers = new Map<string, StorageProvider>([
      ["synthetic-storage", synthetic],
      ["aws-s3", unactivatedStorageProvider("aws-s3")],
    ]);
    // Active upload provider is now aws-s3, but the old object still resolves.
    const access = await providerForObject(
      ref(TENANT_A),
      providers,
    ).presignDownload(ref(TENANT_A));
    expect(access.url).toContain(TENANT_A);
    expect(() =>
      providerForObject({ ...ref(TENANT_A), providerId: "gone" }, providers),
    ).toThrow(/not configured/);
  });
});

describe("payment webhooks", () => {
  const secret = "whsec-test-only-value";
  const body = JSON.stringify({ id: "evt_1" });
  const now = new Date("2026-10-13T12:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));

  it("accepts a valid signature", () => {
    expect(() =>
      verifyWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: signWebhook(body, ts, secret),
        secret,
        now,
      }),
    ).not.toThrow();
  });

  it("rejects a bad signature, a tampered body and a stale timestamp", () => {
    const sig = signWebhook(body, ts, secret);
    expect(() =>
      verifyWebhookSignature({
        rawBody: body,
        timestamp: ts,
        signature: "00",
        secret,
        now,
      }),
    ).toThrow(WebhookVerificationError);
    expect(() =>
      verifyWebhookSignature({
        rawBody: body + " ",
        timestamp: ts,
        signature: sig,
        secret,
        now,
      }),
    ).toThrow(/bad signature/);
    const old = String(Number(ts) - 3600);
    expect(() =>
      verifyWebhookSignature({
        rawBody: body,
        timestamp: old,
        signature: signWebhook(body, old, secret),
        secret,
        now,
      }),
    ).toThrow(/tolerance/);
  });

  it("processes each event once and ignores impossible transitions", () => {
    const ledger = new PaymentLedger();
    const ok = {
      providerId: "stripe",
      eventId: "evt_1",
      paymentId: "pay_1",
      type: "payment.succeeded" as const,
    };
    expect(ledger.apply(ok)).toBe("applied");
    expect(ledger.apply(ok)).toBe("duplicate");
    expect(
      ledger.apply({ ...ok, eventId: "evt_2", type: "payment.failed" }),
    ).toBe("ignored");
    expect(ledger.statusOf("pay_1")).toBe("succeeded");
  });

  it("routes by currency and ignores live routes until approved", () => {
    const routes = [
      { providerId: "stripe", currencies: ["GBP"], mode: "live" as const },
      {
        providerId: "synthetic-payments",
        currencies: ["GBP", "NGN"],
        mode: "sandbox" as const,
      },
    ];
    expect(routeForCurrency(routes, "gbp", false).providerId).toBe(
      "synthetic-payments",
    );
    expect(routeForCurrency(routes, "GBP", true).providerId).toBe("stripe");
    expect(() => routeForCurrency(routes, "USD", true)).toThrow(
      /No payment provider/,
    );
  });
});

describe("AI guards", () => {
  const expensive: AiModel = {
    providerId: "anthropic",
    model: "big",
    capabilities: ["text-generation"],
    pencePerThousandTokens: "1.5",
  };
  const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
    killSwitch: false,
    enabledFeatures: new Set(["job-descriptions"]),
    featureModels: {},
    defaultModel: "big",
    fallbackModels: ["synthetic-draft-1"],
    ...over,
  });
  const budget = (over: Partial<BudgetState> = {}): BudgetState => ({
    requestLimit: 10,
    tokenLimit: 10_000,
    spendLimitPence: 100,
    requests: 0,
    tokens: 0,
    spendPence: 0,
    ...over,
  });
  const request = {
    tenantId: TENANT_A,
    feature: "job-descriptions" as const,
    needs: ["text-generation" as const],
    prompt:
      "Write a job ad for a line cook. Contact jo@example.test or 07700 900123.",
    dataClasses: ["operational" as const],
    maxOutputTokens: 500,
  };

  it("the kill switch and disabled features refuse everything", () => {
    expect(() =>
      planAiRequest(
        settings({ killSwitch: true }),
        [expensive],
        budget(),
        request,
      ),
    ).toThrow(AiRefusedError);
    expect(() =>
      planAiRequest(
        settings({ enabledFeatures: new Set() }),
        [expensive],
        budget(),
        request,
      ),
    ).toThrow(/feature-disabled/);
  });

  it("refuses restricted personal data", () => {
    expect(() =>
      planAiRequest(settings(), [expensive], budget(), {
        ...request,
        dataClasses: ["right-to-work"],
      }),
    ).toThrow(/restricted-data/);
  });

  it("enforces request, token and spend budgets", () => {
    expect(() =>
      planAiRequest(settings(), [expensive], budget({ requests: 10 }), request),
    ).toThrow(/budget/);
    expect(() =>
      planAiRequest(
        settings(),
        [expensive],
        budget({ tokenLimit: 100 }),
        request,
      ),
    ).toThrow(/budget/);
    expect(() =>
      planAiRequest(
        settings(),
        [expensive],
        budget({ spendLimitPence: 0 }),
        request,
      ),
    ).toThrow(/budget/);
  });

  it("redacts personal data and falls back when a provider is down", () => {
    const b = budget();
    const plan = planAiRequest(
      settings(),
      [expensive, SYNTHETIC_MODEL],
      b,
      request,
      new Set(["anthropic"]),
    );
    expect(plan.model.model).toBe("synthetic-draft-1");
    expect(plan.prompt).not.toMatch(/jo@example|07700/);
    expect(b.requests).toBe(1);
    expect(redactPersonalData("NI AB 12 34 56 C")).toBe("NI [ni-number]");
  });
});

describe("circuit breaker", () => {
  it("opens after repeated failures and half-opens after the cool-down", async () => {
    let t = 0;
    const breaker = new CircuitBreaker("resend", {
      failureThreshold: 2,
      coolDownMs: 1000,
      now: () => t,
    });
    const fail = () => Promise.reject(new Error("down"));
    await expect(breaker.run(fail)).rejects.toThrow("down");
    await expect(breaker.run(fail)).rejects.toThrow("down");
    await expect(breaker.run(async () => 1)).rejects.toThrow(CircuitOpenError);
    t = 1000;
    expect(breaker.state).toBe("half-open");
    expect(await breaker.run(async () => 1)).toBe(1);
    expect(breaker.state).toBe("closed");
  });
});
