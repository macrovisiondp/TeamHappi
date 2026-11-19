import { appIcon } from "@/features/brand/app-icon";

// Icons for the web app manifest (M12): /app-icon/192, /app-icon/512 and
// /app-icon/maskable-512. Anything else is not found.

const SIZES: Record<string, [number, boolean]> = {
  "192": [192, false],
  "512": [512, false],
  "maskable-512": [512, true],
};

export async function GET(
  _req: Request,
  ctx: RouteContext<"/app-icon/[size]">,
) {
  const spec = SIZES[(await ctx.params).size];
  if (!spec) return new Response("Not found", { status: 404 });
  const res = appIcon(spec[0], spec[1]);
  res.headers.set("Cache-Control", "public, max-age=86400");
  return res;
}
