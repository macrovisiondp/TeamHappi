// ADR-0015: the Resend email provider (mocked fetch, no network) and how
// request code chooses a provider.

import { describe, expect, it, vi } from "vitest";

import { IntegrationError } from "@/integrations/core/types";
import {
  ResendRejectedError,
  explainResendFailure,
  resendProvider,
} from "@/integrations/email/resend";
import {
  appEmailProvider,
  liveEmailConfigured,
} from "@/integrations/email/runtime";

const message = {
  to: "someone@example.test",
  subject: "Verify your email",
  text: "Click https://app.example.test/verify?token=secret-token-123",
  idempotencyKey: "key-1",
};

const reply = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );

describe("resendProvider", () => {
  it("posts the message with the key, sender and idempotency key", async () => {
    const fetchImpl = reply(200, { id: "msg_1" });
    const p = resendProvider({
      apiKey: "re_test_123",
      from: "TeamHappi <noreply@example.test>",
      fetchImpl,
    });
    expect(await p.send(message)).toEqual({
      providerId: "resend",
      providerMessageId: "msg_1",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123");
    expect(headers["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "TeamHappi <noreply@example.test>",
      to: ["someone@example.test"],
      subject: "Verify your email",
      text: message.text,
    });
  });

  it("only treats 429 and 5xx as safe to retry", async () => {
    for (const [status, retryable] of [
      [429, true],
      [500, true],
      [503, true],
      [401, false],
      [403, false],
      [422, false],
    ] as const) {
      const p = resendProvider({
        apiKey: "re_x",
        from: "a@example.test",
        fetchImpl: reply(status, { message: "nope" }),
      });
      const e = await p.send(message).catch((x: unknown) => x);
      expect(e, String(status)).toBeInstanceOf(ResendRejectedError);
      expect((e as ResendRejectedError).retryable, String(status)).toBe(
        retryable,
      );
    }
  });

  it("never retries when no answer came back (it may have been sent)", async () => {
    const p = resendProvider({
      apiKey: "re_x",
      from: "a@example.test",
      fetchImpl: vi.fn(async () => {
        throw new TypeError("network down");
      }),
    });
    const e = await p.send(message).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(IntegrationError);
    expect((e as IntegrationError).retryable).toBe(false);
  });

  it("never puts the key, the body or the link in errors", async () => {
    const p = resendProvider({
      apiKey: "re_secret_456",
      from: "a@example.test",
      fetchImpl: reply(403, { message: "Key re_secret_456 can't send from x" }),
    });
    const e = (await p
      .send(message)
      .catch((x: unknown) => x)) as ResendRejectedError;
    const shown = `${e.message} ${e.reason} ${explainResendFailure(e)}`;
    expect(shown).not.toMatch(/re_secret_456|secret-token-123|verify\?token/);
    expect(explainResendFailure(e)).toMatch(/domain isn't verified/);
  });

  it("explains a rejected key plainly", async () => {
    const p = resendProvider({
      apiKey: "re_x",
      from: "a@example.test",
      fetchImpl: reply(401, { message: "API key is invalid" }),
    });
    const e = await p.send(message).catch((x: unknown) => x);
    expect(explainResendFailure(e)).toMatch(/rejected the API key/);
  });
});

describe("choosing the provider (ADR-0015)", () => {
  const all = {
    APPROVED_LIVE_PROVIDERS: "aws-s3, resend",
    RESEND_API_KEY: "re_x",
    EMAIL_FROM: "TeamHappi <noreply@example.test>",
  };

  it("uses Resend only with approval, a key and a sender", () => {
    expect(liveEmailConfigured(all)).toBe(true);
    for (const missing of [
      "APPROVED_LIVE_PROVIDERS",
      "RESEND_API_KEY",
      "EMAIL_FROM",
    ] as const)
      expect(
        liveEmailConfigured({ ...all, [missing]: undefined }),
        missing,
      ).toBe(false);
    expect(
      liveEmailConfigured({ ...all, APPROVED_LIVE_PROVIDERS: "aws-s3" }),
    ).toBe(false);
    expect(appEmailProvider(all, "production")?.id).toBe("resend");
  });

  it("logs locally, and sends nothing in production without Resend", () => {
    expect(appEmailProvider({}, "local")?.id).toBe("dev-mailer");
    expect(appEmailProvider({}, "production")).toBeNull();
  });
});
