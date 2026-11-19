import { publicOffer } from "@/lib/workspace";

// The applicant's offer letter, or their signed copy once accepted (M14.3).
// POST only, so the token stays out of URLs and logs; the database finds the
// offer by the token's hash, and the file is checked against its fingerprint.
// Shown in a sandbox (no scripts run).

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  const r = await publicOffer.file(typeof token === "string" ? token : "");
  if (!r.ok) return new Response("Not found", { status: 404 });
  const ascii = r.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "");
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${r.signed ? "attachment" : "inline"}; filename="${ascii}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
