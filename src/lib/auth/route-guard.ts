// The authentication endpoints exposed in Milestone 3.1. Better Auth serves many
// more (sign-up, password reset, account linking, session listing ...); anything
// not listed here returns 404 before Better Auth sees it.

const ALLOWED: Record<string, readonly ("GET" | "POST")[]> = {
  "/sign-in/email": ["POST"],
  "/sign-out": ["POST"],
  "/get-session": ["GET"],
  "/verify-email": ["GET"],
  "/send-verification-email": ["POST"],
};

export const AUTH_BASE_PATH = "/api/auth";

export function authEndpoint(pathname: string): string | null {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return null;
  return pathname.slice(AUTH_BASE_PATH.length);
}

export function isAllowedAuthRequest(
  method: string,
  pathname: string,
): boolean {
  const endpoint = authEndpoint(pathname);
  if (endpoint === null) return false;
  const methods = ALLOWED[endpoint];
  return !!methods && (methods as readonly string[]).includes(method);
}

/**
 * Resending a verification link must not reveal whether an address is
 * registered or already verified: every non-rate-limited outcome becomes the
 * same 200 response.
 */
export function normaliseAuthResponse(
  pathname: string,
  response: Response,
): Response {
  if (authEndpoint(pathname) !== "/send-verification-email") return response;
  if (response.status === 429) return response;
  return Response.json({ status: true }, { status: 200 });
}

export async function guardedAuthHandler(
  handler: (request: Request) => Promise<Response>,
  request: Request,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (!isAllowedAuthRequest(request.method, pathname)) {
    return Response.json(
      {
        type: "https://teamhappi.app/problems/not-found",
        title: "Not found",
        status: 404,
        code: "not_found",
      },
      {
        status: 404,
        headers: {
          "Content-Type": "application/problem+json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const response = await handler(request);
  return normaliseAuthResponse(pathname, response);
}
