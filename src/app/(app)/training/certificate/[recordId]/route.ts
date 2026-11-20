import { getWorkspace, trainingApi } from "@/lib/workspace";

// A course certificate (M15, T5), made from the training record on download.
// For the person themselves and for anyone who can see their training; every
// download is audited. Not found for everyone else.

export async function GET(
  _req: Request,
  ctx: RouteContext<"/training/certificate/[recordId]">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const { recordId } = await ctx.params;
  const r = await trainingApi.certificate(ws, recordId);
  if (!r) return new Response("Not found", { status: 404 });
  const ascii = r.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "");
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${ascii}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
