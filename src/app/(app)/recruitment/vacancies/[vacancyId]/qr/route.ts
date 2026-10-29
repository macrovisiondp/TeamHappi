import type { NextRequest } from "next/server";
import QRCode from "qrcode";

import { getWorkspace, recruitmentApi, vacancyShareUrl } from "@/lib/workspace";

// QR code download for a vacancy's share link (M9.2a). Signed-in members who
// can see the vacancy only; the QR encodes the public link with ?s=qr so scans
// are counted separately. Not found for everyone else.

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/recruitment/vacancies/[vacancyId]/qr">,
) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const { vacancyId } = await ctx.params;
  const data = await recruitmentApi.vacancy(ws, vacancyId);
  if (!data || "ok" in data || !data.vacancy.publicCode)
    return new Response("Not found", { status: 404 });
  const url = vacancyShareUrl(data.vacancy.publicCode, true);
  const name = `vacancy-qr-${data.vacancy.publicCode}`;
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (req.nextUrl.searchParams.get("format") === "svg") {
    const svg = await QRCode.toString(url, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
    });
    return new Response(svg, {
      headers: {
        ...headers,
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `attachment; filename="${name}.svg"`,
      },
    });
  }
  const png = await QRCode.toBuffer(url, {
    type: "png",
    margin: 2,
    width: 1024,
    errorCorrectionLevel: "M",
  });
  return new Response(new Uint8Array(png), {
    headers: {
      ...headers,
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${name}.png"`,
    },
  });
}
