// Local walkthrough of the Milestone 3.1 sign-in flows against the running dev
// server (npm run dev:db, npm run dev:seed, npm run dev). Uses only the
// synthetic accounts in .data/dev-accounts.md and never prints passwords,
// tokens or cookies. Local hosts only.
//
//   node scripts/demo-auth.mjs [http://localhost:3000]

import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  console.error("Local dev server only.");
  process.exit(1);
}
const rows = readFileSync(".data/dev-accounts.md", "utf8")
  .split("\n")
  .filter((l) => l.includes("@example.test"))
  .map((l) => l.split("|").map((c) => c.trim()));
const account = (email) => {
  const row = rows.find((r) => r[2] === email);
  return { email, password: row[4] };
};
const verified = account("ada.verified@example.test");
const unverified = account("ben.unverified@example.test");

const step = (n, text, ok) =>
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}. ${text}`);
const post = (path, body, cookie) =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      origin: base,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const page = async (path, cookie) => {
  const res = await fetch(`${base}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return { status: res.status, html: await res.text() };
};
const cookiesFrom = (res) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const signedInMarker = (html) => html.includes("Signed in as");
const redirectsToSignIn = (html) =>
  /NEXT_REDIRECT[^"]*\/sign-in|\/sign-in/.test(html) && !signedInMarker(html);

let r = await page("/dashboard");
step(
  1,
  "Signed-out visitor to /dashboard is sent to /sign-in",
  redirectsToSignIn(r.html),
);

r = await page("/sign-in");
step(2, "Sign-in page renders", r.status === 200 && r.html.includes("Sign in"));

let res = await post("/api/auth/sign-in/email", {
  email: verified.email,
  password: "not-the-password",
});
step(
  3,
  `Wrong password is refused (${res.status}, generic error)`,
  res.status === 401,
);

res = await post("/api/auth/sign-in/email", {
  email: "nobody@example.test",
  password: "not-the-password",
});
step(
  4,
  `Unknown email gets the same response (${res.status})`,
  res.status === 401,
);

res = await post("/api/auth/sign-in/email", {
  email: unverified.email,
  password: unverified.password,
});
const unverifiedBody = await res.json();
step(
  5,
  `Unverified account is refused (${res.status} ${unverifiedBody.code}); a new link is mailed to the dev log`,
  res.status === 403,
);

res = await post("/api/auth/sign-up/email", {
  name: "X",
  email: "self@example.test",
  password: "x".repeat(16),
});
step(6, `Public sign-up is not available (${res.status})`, res.status === 404);

res = await post("/api/auth/sign-in/email", {
  email: verified.email,
  password: verified.password,
});
const setCookie =
  res.headers.getSetCookie().find((c) => c.includes("session_token")) ?? "";
const cookie = cookiesFrom(res);
step(
  7,
  `Verified account signs in (${res.status}); cookie is HttpOnly + SameSite=Lax`,
  res.status === 200 &&
    /HttpOnly/i.test(setCookie) &&
    /SameSite=Lax/i.test(setCookie),
);

r = await page("/dashboard", cookie);
step(
  8,
  'Dashboard renders for the signed-in user ("Signed in as Ada Verified")',
  signedInMarker(r.html) && r.html.includes("Ada Verified"),
);

res = await post("/api/auth/sign-out", {}, cookie);
step(9, `Sign-out succeeds (${res.status})`, res.status === 200);

r = await page("/dashboard", cookie);
step(
  10,
  "The old cookie no longer works after sign-out",
  !signedInMarker(r.html),
);
