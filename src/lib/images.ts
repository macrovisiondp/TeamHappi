// Small uploaded images (M17): profile photos and logos. The type is worked
// out from the file's first bytes, never from its name or the browser's claim.
// Only PNG, JPEG and WebP; never SVG (it can contain scripts).

export const MAX_IMAGE_BYTES = 300 * 1024;

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffImage(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  )
    return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length > 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

export type ImageCheck =
  | { ok: true; bytes: Uint8Array; contentType: ImageType }
  | { ok: false; message: string };

export function checkImage(bytes: Uint8Array): ImageCheck {
  if (!bytes.length) return { ok: false, message: "Choose a picture." };
  if (bytes.length > MAX_IMAGE_BYTES)
    return {
      ok: false,
      message: "That picture is too large. Try a smaller one.",
    };
  const contentType = sniffImage(bytes);
  return contentType
    ? { ok: true, bytes, contentType }
    : {
        ok: false,
        message: "Use a PNG, JPEG or WebP picture.",
      };
}

/** Response headers for serving an image to signed-in members. */
export function imageHeaders(contentType: string, etag: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "private, max-age=86400",
    ETag: `"${etag}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
