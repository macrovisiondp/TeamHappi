import "server-only";

import webpush from "web-push";

import { serverEnv } from "@/lib/env";

import type { PushKeys, PushSender } from "./push";

// The Web Push sender (M12). Keys come only from server settings
// (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT); with any missing, push
// is off. Never logs endpoints, keys or payloads.

export function pushKeys(): PushKeys | null {
  const env = serverEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return null;
  return {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
}

export function webPushSender(keys: PushKeys): PushSender {
  return async (sub, payload) => {
    try {
      const r = await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        {
          vapidDetails: {
            subject: keys.subject,
            publicKey: keys.publicKey,
            privateKey: keys.privateKey,
          },
          TTL: 12 * 60 * 60,
          urgency: "normal",
          timeout: 10_000,
        },
      );
      return r.statusCode;
    } catch (e) {
      const status = (e as { statusCode?: unknown }).statusCode;
      if (typeof status === "number") return status;
      throw new Error("Push delivery failed");
    }
  };
}
