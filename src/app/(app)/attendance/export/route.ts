import { attendanceApi, getWorkspace } from "@/lib/workspace";

// Approved-hours export (M11.3, scope D11). Organisation-wide exporters only
// (attendance.export); approved weeks only; hours only, never money. Every
// export is audited by the attendance module. Always a download.

export async function GET(req: Request) {
  const ws = await getWorkspace();
  if (ws?.kind !== "ready") return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const r = await attendanceApi.exportHours(
    ws,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  if (!r.ok)
    return new Response(
      r.code === "forbidden"
        ? "Not found"
        : `${r.message} ${Object.values(r.fieldErrors ?? {}).join(". ")}`,
      {
        status: r.code === "forbidden" ? 404 : 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  return new Response(r.data.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.data.fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
