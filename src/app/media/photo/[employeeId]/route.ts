import { imageHeaders } from "@/lib/images";
import { getWorkspace, imagesApi } from "@/lib/workspace";

// A staff member's profile photo (M17), for people in the same organisation.
// Not found for everyone else, and when there's no photo.

export async function GET(
  req: Request,
  ctx: RouteContext<"/media/photo/[employeeId]">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response(null, { status: 404 });
  const { employeeId } = await ctx.params;
  const img = await imagesApi.read(ws, { kind: "photo", employeeId });
  if (!img) return new Response(null, { status: 404 });
  if (req.headers.get("if-none-match") === `"${img.id}"`)
    return new Response(null, { status: 304 });
  return new Response(new Uint8Array(img.bytes), {
    headers: imageHeaders(img.contentType, img.id),
  });
}
