import { getAuth } from "@/lib/auth";
import { guardedAuthHandler } from "@/lib/auth/route-guard";

const unavailable = () =>
  Response.json(
    {
      type: "https://teamhappi.app/problems/unavailable",
      title: "Sign-in is not available",
      status: 503,
      code: "auth_unavailable",
    },
    {
      status: 503,
      headers: {
        "Content-Type": "application/problem+json",
        "Cache-Control": "no-store",
      },
    },
  );

// Better Auth endpoints, limited to the allow-list in route-guard.ts. Endpoints
// outside the allow-list return 404 whether or not authentication is configured.
async function handle(request: Request): Promise<Response> {
  const auth = getAuth();
  return guardedAuthHandler(
    auth ? auth.handler : async () => unavailable(),
    request,
  );
}

export const GET = handle;
export const POST = handle;
