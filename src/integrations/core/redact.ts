// Removes secret values before anything is logged, audited or sent to the
// browser. Two layers: keys that name a secret, and values that look like one
// (bearer tokens, private keys, long opaque strings).

export const REDACTED = "[redacted]";

const SECRET_KEY =
  /(secret|password|passwd|token|api[-_]?key|access[-_]?key|private[-_]?key|signing|credential|authorization|cookie|otp|cvv|cvc|card[-_]?number|pan)$/i;

const SECRET_VALUE = [
  /^bearer\s+\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^(sk|rk|pk|whsec|re)_[A-Za-z0-9_]{8,}/, // common provider key prefixes
  /^AKIA[0-9A-Z]{16}$/, // AWS access key id
  /^[A-Za-z0-9+/_=-]{32,}$/, // long opaque token
];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key.replace(/[^A-Za-z0-9_-]/g, ""));
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE.some((pattern) => pattern.test(value.trim()));
}

/** Deep copy with secrets replaced. Never mutates the input. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 8) return REDACTED as T;
  if (typeof value === "string")
    return (looksLikeSecret(value) ? REDACTED : value) as T;
  if (Array.isArray(value))
    return value.map((item) => redact(item, depth + 1)) as T;
  if (value && typeof value === "object") {
    if (value instanceof Date) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] =
        isSecretKey(key) && inner !== null && inner !== undefined
          ? REDACTED
          : redact(inner, depth + 1);
    }
    return out as T;
  }
  return value;
}
