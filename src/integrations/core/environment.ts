import type { DeploymentEnvironment } from "./types";

/**
 * Which deployment this process belongs to. Vercel sets VERCEL_ENV on every
 * deployment ("production" | "preview" | "development"); without it we are on
 * a developer machine or in CI. Unknown values fail towards "production", the
 * most restrictive answer.
 *
 * Note: Neon's branch named `production` is a development database. Database
 * names never decide the environment.
 */
export function deploymentEnvironment(
  env: Record<string, string | undefined> = process.env,
): DeploymentEnvironment {
  const vercel = env.VERCEL_ENV;
  if (vercel === undefined || vercel === "") {
    return env.NODE_ENV === "production" && env.CI !== "true"
      ? "production"
      : "local";
  }
  if (vercel === "preview") return "preview";
  if (vercel === "development") return "local";
  return "production";
}
