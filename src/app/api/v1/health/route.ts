import { connection } from "next/server";

// Liveness check. Reports no configuration, secrets or dependency details.
export async function GET() {
  await connection();
  return Response.json(
    {
      data: {
        status: "ok",
        service: "teamhappi",
        time: new Date().toISOString(),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
