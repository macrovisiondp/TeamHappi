import type { DeploymentEnvironment } from "@/integrations/core/types";

// Who may open Macrovision Platform Admin, decided on the server only.
//
// Until M3.5 there is no platform_staff register and until M3.4 no MFA, so
// the only access is a read-only PREVIEW for named synthetic accounts, outside
// production. Preview access can never perform a privileged action: that needs
// a PlatformStaffActor (session + active staff grant + MFA), which application
// code cannot obtain yet.

export interface PlatformViewer {
  userId: string;
  name: string;
  email: string;
}

export type PlatformAccess =
  | {
      kind: "preview";
      viewer: PlatformViewer;
      mfaVerified: false;
      privilegedActions: false;
    }
  | { kind: "none" };

/** Only synthetic addresses can ever be preview staff. */
const SYNTHETIC_EMAIL =
  /@([a-z0-9-]+\.)*(example\.(com|org|net)|example|test)$/i;

export function parseAllowList(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e && SYNTHETIC_EMAIL.test(e)),
  );
}

export function decidePlatformAccess(
  user: PlatformViewer | null,
  environment: DeploymentEnvironment,
  allowList: ReadonlySet<string>,
): PlatformAccess {
  if (!user) return { kind: "none" };
  if (environment === "production") return { kind: "none" };
  if (!allowList.has(user.email.trim().toLowerCase())) return { kind: "none" };
  return {
    kind: "preview",
    viewer: user,
    mfaVerified: false,
    privilegedActions: false,
  };
}

export class PlatformActionUnavailableError extends Error {
  constructor() {
    super(
      "Privileged platform actions need platform staff access with MFA (M3.4–M3.5) and approved live integrations.",
    );
    this.name = "PlatformActionUnavailableError";
  }
}

/**
 * Called by every server action that would change integrations or
 * credentials. Refuses unconditionally until the real issuer exists.
 */
export function assertPrivilegedPlatformAction(access: PlatformAccess): never {
  void access;
  throw new PlatformActionUnavailableError();
}

/** Why a privileged control is disabled, shown next to it. */
export const PRIVILEGED_DISABLED_REASON =
  "Needs platform staff access with MFA (Milestone 3.4–3.5) and owner approval for live connections";
