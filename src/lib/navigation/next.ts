// Where to go after signing in. Only same-site paths in known areas are
// accepted, so a crafted ?next= link can never send someone to another site
// (open redirect) or to an unexpected route.

const ALLOWED =
  /^\/(platform|dashboard|people|settings|organisations|demo|invite)(\/[A-Za-z0-9._~-]+)*\/?$/;

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  if (value.split("/").some((part) => part === "." || part === ".."))
    return null;
  return ALLOWED.test(value) ? value : null;
}
