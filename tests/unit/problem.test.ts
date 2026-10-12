import { describe, expect, it } from "vitest";

import { notFound, problem } from "@/lib/api/problem";

describe("problem", () => {
  it("returns an RFC 9457 problem+json response", async () => {
    const res = problem({
      status: 422,
      code: "validation_failed",
      title: "Validation failed",
      errors: [{ path: "startsAt", message: "Must be before endsAt" }],
      requestId: "req_1",
    });

    expect(res.status).toBe(422);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      type: "https://teamhappi.app/problems/validation-failed",
      title: "Validation failed",
      status: 422,
      code: "validation_failed",
      errors: [{ path: "startsAt", message: "Must be before endsAt" }],
      requestId: "req_1",
    });
  });

  it("omits optional fields that were not supplied", async () => {
    const body = await problem({
      status: 409,
      code: "conflict",
      title: "Conflict",
    }).json();
    expect(body).not.toHaveProperty("detail");
    expect(body).not.toHaveProperty("errors");
    expect(body).not.toHaveProperty("requestId");
  });

  it("keeps caller headers such as Retry-After", () => {
    const res = problem({
      status: 429,
      code: "rate_limited",
      title: "Too many requests",
      headers: { "Retry-After": "30" },
    });
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});

describe("notFound", () => {
  it("gives one generic 404 so resource existence is never confirmed", async () => {
    const res = notFound();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: "https://teamhappi.app/problems/not-found",
      title: "Not found",
      status: 404,
      code: "not_found",
    });
  });
});
