import { cvApi, getWorkspace } from "@/lib/workspace";

// CV download (M9.2b). Signed-in members who can see the application (or
// interview the candidate) only; every download is audited before the file is
// read. Always a download, never shown in the browser: the file can't run
// anything on TeamHappi's pages. Not found for everyone else.

export async function GET(
  _req: Request,
  ctx: RouteContext<"/recruitment/cv/[documentId]">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const { documentId } = await ctx.params;
  const r = await cvApi.download(ws, documentId);
  if (!r.ok) return new Response("Not found", { status: 404 });
  const ascii = r.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/[\\"]/g, "");
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "Content-Type": r.contentType,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(r.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
