// M5.3 integration settings, run as the real teamhappi_platform role:
// append-only versions, no secrets stored, activation rules, AI controls, and
// what the other roles can't touch. No provider is contacted.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  issuePlatformStaffActorForTests,
  PlatformAuthorisationError,
} from "@/platform/authz/internal";
import { createPlatformDbClient, type PlatformDbClient } from "@/platform/db";
import {
  activateProvider,
  AI_DEFAULTS,
  approvedLiveProviders,
  categoryState,
  getAiControls,
  saveAiControls,
  saveProviderConfig,
  validateLatestConfig,
} from "@/platform/integrations/store";

import { admin, urls, withPg } from "../helpers/db";

let platform: PlatformDbClient;

const STAFF_ID = "01900000-0000-7000-8000-0000000000fe";
const manager = issuePlatformStaffActorForTests(STAFF_ID, [
  "integrations.manage",
]);
const viewerOnly = issuePlatformStaffActorForTests(STAFF_ID, ["tenant.view"]);
// This file owns the "preview" environment rows, so it never collides with
// other suites or the local dev data.
const ENV = "preview" as const;
const NO_APPROVALS = new Set<string>();
const NO_KEYS = {};

const resend = {
  senderName: "TeamHappi",
  senderAddress: "noreply@example.test",
  sendingDomain: "example.test",
};

beforeAll(() => {
  platform = createPlatformDbClient(urls.platformUrl!);
});

afterAll(async () => {
  await platform.$disconnect();
});

const auditFor = (action: string) =>
  admin(
    async (c) =>
      (
        await c.query<{ target_id: string; detail: Record<string, unknown> }>(
          `SELECT target_id, detail FROM platform_audit_event
           WHERE action = $1 AND actor_user_id = $2 ORDER BY occurred_at`,
          [action, STAFF_ID],
        )
      ).rows,
  );

describe("saving provider settings", () => {
  it("needs the integrations.manage grant", async () => {
    await expect(
      saveProviderConfig(platform, viewerOnly, "resend", ENV, resend),
    ).rejects.toThrow(PlatformAuthorisationError);
    await expect(
      saveProviderConfig(platform, {} as never, "resend", ENV, resend),
    ).rejects.toThrow(PlatformAuthorisationError);
  });

  it("refuses secret fields, invalid values, unknown and planned providers", async () => {
    expect(
      await saveProviderConfig(platform, manager, "resend", ENV, {
        ...resend,
        apiKey: "re_live_should_never_be_stored",
      }),
    ).toMatchObject({
      ok: false,
      code: "invalid",
      fieldErrors: { apiKey: expect.any(String) },
    });
    expect(
      await saveProviderConfig(platform, manager, "resend", ENV, {
        ...resend,
        senderAddress: "not-an-email",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await saveProviderConfig(platform, manager, "nope", ENV, {}),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await saveProviderConfig(platform, manager, "openai", ENV, {
        defaultModel: "x",
      }),
    ).toMatchObject({ ok: false, code: "refused" });
    const stored = await admin(
      async (c) =>
        (await c.query(`SELECT settings::text AS s FROM integration_config`))
          .rows,
    );
    expect(JSON.stringify(stored)).not.toMatch(
      /re_live_should_never_be_stored/,
    );
  });

  it("stores each save as a new numbered version, with an audit event", async () => {
    expect(
      await saveProviderConfig(platform, manager, "resend", ENV, resend),
    ).toEqual({ ok: true });
    expect(
      await saveProviderConfig(platform, manager, "resend", ENV, {
        ...resend,
        senderName: "TeamHappi Ops",
      }),
    ).toEqual({ ok: true });
    const state = await categoryState(platform, "email", ENV, NO_KEYS);
    const p = state.providers.find((x) => x.providerId === "resend")!;
    expect(p.versions).toBe(2);
    expect(p.latest).toMatchObject({
      version: 2,
      settings: { senderName: "TeamHappi Ops" },
      validatedAt: null,
    });
    expect(p.credentials).toEqual([{ name: "RESEND_API_KEY", present: false }]);
    const events = await auditFor("integration.configured");
    expect(events.map((e) => e.detail.version)).toEqual(
      expect.arrayContaining([1, 2]),
    );
    expect(JSON.stringify(events)).not.toMatch(/noreply@example\.test/); // no settings in the audit trail
  });
});

describe("the database itself keeps versions append-only", () => {
  it("lets the platform role set only the validation time, and never delete", async () => {
    await withPg(urls.platformUrl!, async (c) => {
      await expect(
        c.query(
          `UPDATE integration_config SET settings = '{"senderName":"x"}' WHERE provider_id = 'resend'`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        c.query(`UPDATE integration_config SET version = 99`),
      ).rejects.toThrow(/permission denied/);
      for (const table of [
        "integration_config",
        "integration_active",
        "platform_setting",
      ])
        await expect(c.query(`DELETE FROM ${table}`), table).rejects.toThrow(
          /permission denied/,
        );
      await expect(
        c.query(
          `INSERT INTO integration_config (category, provider_id, environment, version, settings)
           VALUES ('email', 'resend', 'preview', 1, '{}')`,
        ),
      ).rejects.toThrow(/duplicate key/);
      await expect(
        c.query(
          `INSERT INTO integration_config (category, provider_id, environment, version, settings)
           VALUES ('email', 'resend', 'staging', 9, '{}')`,
        ),
      ).rejects.toThrow(/integration_config_environment/);
    });
  });

  it("gives the application and auth roles no access at all", async () => {
    for (const url of [urls.appUrl, urls.authUrl])
      await withPg(url, async (c) => {
        for (const table of [
          "integration_config",
          "integration_active",
          "platform_setting",
        ])
          await expect(
            c.query(`SELECT 1 FROM ${table} LIMIT 1`),
            table,
          ).rejects.toThrow(/permission denied/);
      });
  });
});

describe("testing and activating", () => {
  it("never tests a real provider without a live adapter approval (no request sent)", async () => {
    expect(
      await validateLatestConfig(platform, manager, "resend", ENV),
    ).toMatchObject({ ok: false, code: "refused" });
  });

  it("refuses a real provider without approval, then without credentials, then without a passed test", async () => {
    expect(
      await activateProvider(platform, manager, "resend", ENV, NO_APPROVALS, {
        RESEND_API_KEY: "set",
      }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/approval/) });
    const approved = new Set(["resend"]);
    expect(
      await activateProvider(platform, manager, "resend", ENV, approved, {
        RESEND_API_KEY: "  ",
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/credentials/),
    });
    expect(
      await activateProvider(platform, manager, "resend", ENV, approved, {
        RESEND_API_KEY: "set",
      }),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Test/) });
    expect(
      (await categoryState(platform, "email", ENV, NO_KEYS)).activeProviderId,
    ).toBeNull();
  });

  it("refuses planned providers and test adapters in production", async () => {
    expect(
      await activateProvider(
        platform,
        manager,
        "paystack",
        ENV,
        new Set(["paystack"]),
      ),
    ).toMatchObject({ ok: false, code: "refused" });
    expect(
      await activateProvider(
        platform,
        manager,
        "dev-mailer",
        "production",
        NO_APPROVALS,
      ),
    ).toMatchObject({ ok: false, code: "refused" });
    // Only adapter-ready providers can ever be approved for live use.
    expect([
      ...approvedLiveProviders(" resend, paystack ,dev-mailer,,x"),
    ]).toEqual(["resend"]);
  });

  it("activates a test adapter after a passed test, and records the switch", async () => {
    expect(
      await activateProvider(
        platform,
        manager,
        "dev-mailer",
        ENV,
        NO_APPROVALS,
      ),
    ).toMatchObject({ ok: false, message: expect.stringMatching(/Test/) });
    expect(
      await validateLatestConfig(platform, manager, "dev-mailer", ENV),
    ).toEqual({ ok: true });
    expect(
      await activateProvider(
        platform,
        manager,
        "dev-mailer",
        ENV,
        NO_APPROVALS,
      ),
    ).toEqual({ ok: true });
    const state = await categoryState(platform, "email", ENV, NO_KEYS);
    expect(state.activeProviderId).toBe("dev-mailer");
    expect(state.providers.find((p) => p.active)?.providerId).toBe(
      "dev-mailer",
    );
    const [event] = (await auditFor("integration.activated")).filter(
      (e) => e.target_id === "dev-mailer",
    );
    expect(event!.detail).toMatchObject({ environment: ENV, previous: null });
  });

  it("needs the grant for tests and activation too", async () => {
    await expect(
      validateLatestConfig(platform, viewerOnly, "dev-mailer", ENV),
    ).rejects.toThrow(PlatformAuthorisationError);
    await expect(
      activateProvider(platform, viewerOnly, "dev-mailer", ENV, NO_APPROVALS),
    ).rejects.toThrow(PlatformAuthorisationError);
  });
});

describe("AI controls", () => {
  it("default to switched off with zero budgets", async () => {
    expect(AI_DEFAULTS).toMatchObject({
      killSwitch: true,
      features: [],
      spendLimitPence: 0,
    });
  });

  it("reject fractional or negative budgets and unknown features", async () => {
    for (const bad of [
      { ...AI_DEFAULTS, spendLimitPence: 12.5 },
      { ...AI_DEFAULTS, requestLimit: -1 },
      { ...AI_DEFAULTS, features: ["write-contracts"] },
      { ...AI_DEFAULTS, killSwitch: "no" },
    ])
      expect(await saveAiControls(platform, manager, bad)).toMatchObject({
        ok: false,
        code: "invalid",
      });
    await expect(
      saveAiControls(platform, viewerOnly, AI_DEFAULTS),
    ).rejects.toThrow(PlatformAuthorisationError);
  });

  it("save and audit valid controls (amounts in whole pence)", async () => {
    expect(
      await saveAiControls(platform, manager, {
        killSwitch: false,
        features: ["job-descriptions", "job-descriptions"],
        requestLimit: 100,
        tokenLimit: 50_000,
        spendLimitPence: 2500,
      }),
    ).toEqual({ ok: true });
    expect(await getAiControls(platform)).toMatchObject({
      killSwitch: false,
      features: ["job-descriptions"],
      spendLimitPence: 2500,
    });
    const [event] = await auditFor("ai.controls_changed");
    expect(event!.detail).toMatchObject({
      killSwitch: false,
      spendLimitPence: 2500,
    });
    // Switch back off so other suites see the safe default.
    await saveAiControls(platform, manager, AI_DEFAULTS);
    expect((await getAiControls(platform)).killSwitch).toBe(true);
  });
});
