import { brandLogo } from "@/lib/platform-access";

// The TeamHappi logo (M17): public, so the sign-in page can show it.

export async function GET(req: Request) {
  const logo = await brandLogo();
  if (!logo) return new Response(null, { status: 404 });
  if (req.headers.get("if-none-match") === `"${logo.version}"`)
    return new Response(null, { status: 304 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Content-Type": logo.contentType,
      "Cache-Control": "public, max-age=3600",
      ETag: `"${logo.version}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
