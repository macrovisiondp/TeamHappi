// Field encryption for personal data (M14.2, DPIA §2). AES-256-GCM from Node's
// standard crypto library: no custom cryptography. Each value is bound to its
// organisation, person and field (additional authenticated data), so a
// ciphertext copied onto another record or field fails to decrypt.
//
// Stored as "v<key version>:<base64 of 12-byte IV | 16-byte tag | ciphertext>".
// The key (32 bytes, base64) comes only from the deployment's settings.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface FieldCipher {
  encrypt(plain: string, context: string): string;
  /** null if the value can't be decrypted (wrong key, record or field). */
  decrypt(stored: string, context: string): string | null;
}

export function fieldCipher(
  keys: Record<number, Buffer>,
  current: number,
): FieldCipher {
  const key = keys[current];
  if (!key || key.length !== 32) throw new Error("A 32-byte key is required");
  return {
    encrypt(plain, context) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      c.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return `v${current}:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
    },
    decrypt(stored, context) {
      const m = /^v(\d{1,3}):([A-Za-z0-9+/]+={0,2})$/.exec(stored);
      if (!m) return null;
      const k = keys[Number(m[1])];
      if (!k) return null;
      const raw = Buffer.from(m[2]!, "base64");
      if (raw.length < 29) return null;
      try {
        const d = createDecipheriv("aes-256-gcm", k, raw.subarray(0, 12));
        d.setAAD(Buffer.from(context, "utf8"));
        d.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString(
          "utf8",
        );
      } catch {
        return null;
      }
    },
  };
}

/** The cipher from settings, or null when personal-data encryption is off. */
export function cipherFromEnv(env: {
  PERSONAL_DATA_KEY?: string;
}): FieldCipher | null {
  if (!env.PERSONAL_DATA_KEY) return null;
  const key = Buffer.from(env.PERSONAL_DATA_KEY, "base64");
  if (key.length !== 32) return null;
  return fieldCipher({ 1: key }, 1);
}
