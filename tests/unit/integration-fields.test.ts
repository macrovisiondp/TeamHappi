import { describe, expect, it } from "vitest";

import {
  CREDENTIAL_ENV,
  credentialPresence,
  formToConfig,
  PROVIDER_FIELDS,
} from "@/integrations/fields";
import { PROVIDERS, validateProviderConfig } from "@/integrations/registry";

describe("provider form fields", () => {
  it("never include a secret field, and every non-synthetic provider has a form", () => {
    for (const p of PROVIDERS) {
      const names = (PROVIDER_FIELDS[p.id] ?? []).map((f) => f.name);
      for (const secret of p.secretFields)
        expect(names, `${p.id}.${secret}`).not.toContain(secret);
      if (p.readiness !== "synthetic")
        expect(names.length, p.id).toBeGreaterThan(0);
    }
  });

  it("every real provider lists the environment variables for its keys", () => {
    for (const p of PROVIDERS.filter((x) => x.readiness !== "synthetic"))
      expect(CREDENTIAL_ENV[p.id]?.length, p.id).toBeGreaterThan(0);
    // Variable names, never values, and never browser-exposed.
    for (const names of Object.values(CREDENTIAL_ENV))
      for (const name of names)
        expect(name).toMatch(/^(?!NEXT_PUBLIC_)[A-Z0-9_]+$/);
  });

  it("form values convert into settings the registry accepts", () => {
    expect(
      validateProviderConfig(
        "resend",
        formToConfig("resend", {
          senderName: " TeamHappi ",
          senderAddress: "noreply@example.test",
          sendingDomain: "example.test",
          apiKey: "ignored: not a form field",
        }),
      ),
    ).toEqual({
      ok: true,
      config: {
        senderName: "TeamHappi",
        senderAddress: "noreply@example.test",
        sendingDomain: "example.test",
      },
    });
    expect(
      formToConfig("stripe", { mode: "sandbox", currencies: "gbp, eur,," }),
    ).toEqual({ mode: "sandbox", currencies: ["GBP", "EUR"] });
    // Optional fields left blank stay absent.
    expect(
      formToConfig("aws-s3", {
        bucket: "b-1",
        region: "eu-west-2",
        kmsKeyAlias: " ",
      }),
    ).toEqual({ bucket: "b-1", region: "eu-west-2" });
  });
});

describe("credential presence", () => {
  it("reports only whether each variable is set, never its value", () => {
    const result = credentialPresence("amazon-ses", {
      SES_ACCESS_KEY_ID: "AKIA-secret-value",
      SES_SECRET_ACCESS_KEY: "   ",
    });
    expect(result).toEqual([
      { name: "SES_ACCESS_KEY_ID", present: true },
      { name: "SES_SECRET_ACCESS_KEY", present: false },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/secret-value/);
    expect(credentialPresence("dev-mailer", {})).toEqual([]);
  });
});
