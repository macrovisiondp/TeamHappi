import { getWorkspace, signingApi } from "@/lib/workspace";

// A document to sign, or its signed copy (M13). Only the person it was sent to
// or someone with documents.manage; every view is audited, and the file is
// checked against its recorded fingerprint. Shown by the browser's PDF viewer
// in a sandbox (no scripts can run). Not found for everyone else.

export async function GET(
  req: Request,
  ctx: RouteContext<"/onboarding/documents/file/[requestId]">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const { requestId } = await ctx.params;
  const which =
    new URL(req.url).searchParams.get("v") === "signed" ? "signed" : "original";
  const r = await signingApi.open(ws, requestId, which);
  if (!r.ok) return new Response("Not found", { status: 404 });
  const ascii = r.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "");
  const disposition = which === "signed" ? "attachment" : "inline";
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
