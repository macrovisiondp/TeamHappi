// RFC 9457 problem details (docs/development/api-conventions.md).

export type ProblemCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

export interface ProblemInit {
  status: number;
  code: ProblemCode;
  title: string;
  detail?: string;
  errors?: { path: string; message: string }[];
  requestId?: string;
  headers?: HeadersInit;
}

const PROBLEM_BASE = "https://teamhappi.app/problems/";

export function problem({ headers, ...init }: ProblemInit): Response {
  const body = {
    type: PROBLEM_BASE + init.code.replaceAll("_", "-"),
    title: init.title,
    status: init.status,
    code: init.code,
    ...(init.detail !== undefined && { detail: init.detail }),
    ...(init.errors !== undefined && { errors: init.errors }),
    ...(init.requestId !== undefined && { requestId: init.requestId }),
  };
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/problem+json");
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: responseHeaders,
  });
}

// Cross-tenant and missing resources share one response so existence is never confirmed.
export function notFound(requestId?: string): Response {
  return problem({
    status: 404,
    code: "not_found",
    title: "Not found",
    requestId,
  });
}
