import { NextResponse } from "next/server";

import { problem } from "@/lib/api/problem";
import { getCurrentUser } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { isUuid } from "@/lib/tenancy";
import {
  myUsableTenantIds,
  ORGANISATION_COOKIE,
  organisationCookieOptions,
} from "@/lib/workspace";

// Switches organisation (M4.1). A plain HTML form POST, so it works without
// JavaScript and ends in a full-page redirect.
// - Same-origin only: the Origin header must match APP_URL (CSRF), on top of
//   the SameSite=Lax session cookie.
// - The submitted tenant id is untrusted: accepted only if it is one of the
//   signed-in user's usable memberships. The cookie it sets is a preference;
//   access is re-checked on every request.
export async function POST(request: Request) {
  const expectedOrigin = new URL(serverEnv().APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin)
    return problem({
      status: 403,
      code: "forbidden",
      title: "Cross-site request refused",
    });

  const go = (path: string) =>
    NextResponse.redirect(new URL(path, expectedOrigin), 303);

  const user = await getCurrentUser();
  if (!user) return go("/sign-in");

  const form = await request.formData().catch(() => null);
  const tenantId = String(form?.get("tenantId") ?? "");
  if (
    !isUuid(tenantId) ||
    !(await myUsableTenantIds(user.userId)).has(tenantId)
  )
    return go("/organisations?error=unavailable");

  const response = go("/dashboard");
  response.cookies.set(
    ORGANISATION_COOKIE,
    tenantId,
    organisationCookieOptions(),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
