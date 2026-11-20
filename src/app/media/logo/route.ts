import { imageHeaders } from "@/lib/images";
import { getWorkspace, imagesApi } from "@/lib/workspace";

// The signed-in member's organisation logo (M17). Not found without one.

export async function GET(req: Request) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response(null, { status: 404 });
  const img = await imagesApi.read(ws, { kind: "logo" });
  if (!img) return new Response(null, { status: 404 });
  if (req.headers.get("if-none-match") === `"${img.id}"`)
    return new Response(null, { status: 304 });
  return new Response(new Uint8Array(img.bytes), {
    headers: imageHeaders(img.contentType, img.id),
  });
}
