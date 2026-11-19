import { getWorkspace, offerApi } from "@/lib/workspace";

// An offer letter or its signed copy, for staff who can hire at the vacancy's
// site (M14.3). Every view is audited; the file is checked against its
// fingerprint. Not found for everyone else.

export async function GET(
  req: Request,
  ctx: RouteContext<"/recruitment/offer-file/[offerId]">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const { offerId } = await ctx.params;
  const which =
    new URL(req.url).searchParams.get("v") === "signed" ? "signed" : "original";
  const r = await offerApi.staffFile(ws, offerId, which);
  if (!r.ok) return new Response("Not found", { status: 404 });
  const ascii = r.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "");
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${which === "signed" ? "attachment" : "inline"}; filename="${ascii}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
