import "server-only";

import { cache } from "react";

import {
  getPlatformIdentity,
  platformStaffAdmin,
  type PlatformAuditRow,
  type StaffResult,
  type StaffRow,
  type StaffStatus,
} from "@/lib/auth";
import { knownGrants } from "@/lib/permissions/platform";
import {
  issuePlatformStaffActor,
  type PlatformStaffActor,
} from "@/platform/authz/internal";
import { createPlatformDbClient, type PlatformDbClient } from "@/platform/db";
import * as integrationStore from "@/platform/integrations/store";
import * as organisations from "@/platform/tenants/organisations";
import { createOrganisationWithAudit } from "@/platform/tenants/create";
import { invitationLink, newInvitationToken } from "@/lib/invitations/token";
import { INVITATION_DAYS } from "@/lib/workspace/member-policy";
import { deploymentEnvironment } from "@/integrations/core/environment";
import {
  SERVICE_CATEGORIES,
  type ServiceCategory,
} from "@/integrations/core/types";
import { serverEnv } from "@/lib/env";

import {
  checkPrivilege,
  decidePlatformAccess,
  hasGrant,
  type PlatformAccess,
} from "./policy";

export {
  assertPrivilegedPlatformAction,
  hasGrant,
  PlatformActionUnavailableError,
  PRIVILEGED_DISABLED_REASON,
  stepUpFresh,
  type PlatformAccess,
} from "./policy";

/**
 * Platform access for this request, from the server-validated session, the
 * platform_staff register and this session's MFA state. Never from a cookie,
 * header or parameter the browser controls.
 */
export const getPlatformAccess = cache(async (): Promise<PlatformAccess> => {
  const identity = await getPlatformIdentity();
  return decidePlatformAccess(
    identity && {
      user: {
        userId: identity.user.userId,
        name: identity.user.name,
        email: identity.user.email,
      },
      staff: identity.staff && {
        status: identity.staff.status,
        grants: knownGrants(identity.staff.grants),
      },
      mfaEnrolled: identity.mfaEnrolled,
      mfaLockedUntil: identity.mfaLockedUntil,
      mfaVerifiedAt: identity.mfaVerifiedAt,
    },
    new Date(),
  );
});

export type PrivilegedResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      reason: "forbidden" | "step_up" | "rejected";
      message: string;
    };

const MESSAGES = {
  forbidden: "Your platform role doesn't allow this.",
  step_up: "For your security, confirm it's you with your authenticator first.",
} as const;

/** Grant + recent MFA, then the real PlatformStaffActor (which re-checks MFA). */
async function privileged<T>(
  grant: Parameters<typeof checkPrivilege>[1],
  fn: (actorUserId: string, actor: PlatformStaffActor) => Promise<T>,
): Promise<PrivilegedResult<T>> {
  const access = await getPlatformAccess();
  const now = new Date();
  const check = checkPrivilege(access, grant, now);
  if (!check.ok) return { ...check, message: MESSAGES[check.reason] };
  if (access.kind !== "staff")
    return { ok: false, reason: "forbidden", message: MESSAGES.forbidden };
  const actor = issuePlatformStaffActor({
    userId: access.viewer.userId,
    status: "active",
    grants: access.grants,
    mfaVerifiedAt: access.mfaVerifiedAt,
    now,
  });
  return { ok: true, data: await fn(actor.userId, actor) };
}

function fromStaffResult(
  r: PrivilegedResult<StaffResult>,
): PrivilegedResult<null> {
  if (!r.ok) return r;
  return r.data.ok
    ? { ok: true, data: null }
    : { ok: false, reason: "rejected", message: r.data.message };
}

/** Platform staff administration (grant: staff.manage; MFA within 15 minutes). */
export const staffAdmin = {
  async list(): Promise<StaffRow[] | null> {
    const access = await getPlatformAccess();
    return hasGrant(access, "staff.manage") ? platformStaffAdmin.list() : null;
  },
  grant: async (email: string, grants: readonly string[]) =>
    fromStaffResult(
      await privileged("staff.manage", (actor) =>
        platformStaffAdmin.grant(actor, email, grants),
      ),
    ),
  update: async (
    targetUserId: string,
    change: { grants?: readonly string[]; status?: StaffStatus },
  ) =>
    fromStaffResult(
      await privileged("staff.manage", (actor) =>
        platformStaffAdmin.update(actor, targetUserId, change),
      ),
    ),
  async resetMfa(targetUserId: string): Promise<PrivilegedResult<null>> {
    const access = await getPlatformAccess();
    if (access.kind === "staff" && access.viewer.userId === targetUserId)
      return {
        ok: false,
        reason: "rejected",
        message: "You can't reset your own MFA.",
      };
    return privileged("staff.manage", async (actor) => {
      await platformStaffAdmin.resetMfa(actor, targetUserId);
      return null;
    });
  },
};

/** New recovery codes for yourself (MFA within 15 minutes). */
export async function regenerateMyRecoveryCodes(): Promise<
  PrivilegedResult<string[]>
> {
  const access = await getPlatformAccess();
  if (access.kind !== "staff")
    return { ok: false, reason: "forbidden", message: MESSAGES.forbidden };
  if (Date.now() - access.mfaVerifiedAt.getTime() > 15 * 60_000)
    return { ok: false, reason: "step_up", message: MESSAGES.step_up };
  return {
    ok: true,
    data: await platformStaffAdmin.regenerateRecoveryCodes(
      access.viewer.userId,
    ),
  };
}

/** The platform audit trail (grant: audit.view). */
export async function platformAudit(
  limit?: number,
): Promise<PlatformAuditRow[] | null> {
  const access = await getPlatformAccess();
  return hasGrant(access, "audit.view")
    ? platformStaffAdmin.audit(limit)
    : null;
}

// --- Client organisations (M5.2, ADR-0009) ----------------------------------

const globalForPlatform = globalThis as unknown as {
  teamhappiPlatformDb?: PlatformDbClient | null;
};

/** The teamhappi_platform client, or null when PLATFORM_DATABASE_URL is unset. */
function platformDb(): PlatformDbClient | null {
  if (globalForPlatform.teamhappiPlatformDb !== undefined)
    return globalForPlatform.teamhappiPlatformDb;
  const url = serverEnv().PLATFORM_DATABASE_URL;
  globalForPlatform.teamhappiPlatformDb = url
    ? createPlatformDbClient(url)
    : null;
  return globalForPlatform.teamhappiPlatformDb;
}

export type OrganisationSummary = organisations.OrganisationSummary;

export type OrganisationRead<T> =
  { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "not_configured" };

async function viewOrganisations<T>(
  fn: (db: PlatformDbClient) => Promise<T>,
): Promise<OrganisationRead<T>> {
  const access = await getPlatformAccess();
  if (!hasGrant(access, "tenant.view")) return { kind: "forbidden" };
  const db = platformDb();
  if (!db) return { kind: "not_configured" };
  return { kind: "ok", data: await fn(db) };
}

/** Client organisation management (view: tenant.view; changes: tenant.suspend + MFA within 15 minutes). */
export interface NewOrganisation {
  legalName: string;
  slug: string;
  timezone: string;
  ownerEmail: string;
}

export type CreateOrganisationOutcome = {
  tenantId: string;
  /** Set when the owner has no verified login yet: share it with them. */
  inviteLink: string | null;
};

const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field problems in a new-organisation form, or null. */
export function newOrganisationErrors(
  input: NewOrganisation,
): Record<string, string> | null {
  const e: Record<string, string> = {};
  const name = input.legalName.trim();
  if (!name || name.length > 200) e.legalName = "Enter the organisation's name";
  if (!SLUG.test(input.slug))
    e.slug = "Use 3–63 lower-case letters, numbers and hyphens";
  if (!Intl.supportedValuesOf("timeZone").includes(input.timezone))
    e.timezone = "Choose a time zone";
  if (!EMAIL.test(input.ownerEmail.trim()) || input.ownerEmail.length > 254)
    e.ownerEmail = "Enter the owner's email address";
  return Object.keys(e).length ? e : null;
}

export const organisationAdmin = {
  list: (query?: string) =>
    viewOrganisations((db) => organisations.listOrganisations(db, query)),
  get: (tenantId: string) =>
    viewOrganisations((db) => organisations.getOrganisation(db, tenantId)),
  async history(tenantId: string): Promise<PlatformAuditRow[] | null> {
    const access = await getPlatformAccess();
    if (!hasGrant(access, "tenant.view")) return null;
    return platformStaffAdmin.audit(100, { type: "tenant", id: tenantId });
  },
  async setStatus(
    tenantId: string,
    next: "active" | "suspended",
    reason: string,
  ): Promise<PrivilegedResult<null>> {
    const db = platformDb();
    if (!db)
      return {
        ok: false,
        reason: "rejected",
        message: "Organisation management isn't configured on this deployment.",
      };
    const r = await privileged("tenant.suspend", (_id, actor) =>
      organisations.setOrganisationStatus(db, actor, tenantId, next, reason),
    );
    if (!r.ok) return r;
    return r.data.ok
      ? { ok: true, data: null }
      : { ok: false, reason: "rejected", message: r.data.message };
  },
  /** Whether the signed-in staff member may create organisations. */
  async canCreate(): Promise<boolean> {
    return hasGrant(await getPlatformAccess(), "tenant.create");
  },
  /**
   * Creates an organisation (grant: tenant.create; MFA within 15 minutes).
   * An owner with a verified login becomes the active owner; otherwise they get
   * an owner invitation link (shown once, never stored or logged).
   */
  async create(
    input: NewOrganisation,
  ): Promise<PrivilegedResult<CreateOrganisationOutcome>> {
    const pdb = platformDb();
    if (!pdb || !serverEnv().DATABASE_URL)
      return {
        ok: false,
        reason: "rejected",
        message: "Organisation management isn't configured on this deployment.",
      };
    if (newOrganisationErrors(input))
      return {
        ok: false,
        reason: "rejected",
        message: "Check the highlighted fields.",
      };
    const r = await privileged("tenant.create", async (_id, actor) => {
      const ownerId = await platformStaffAdmin.verifiedAccountId(
        input.ownerEmail,
      );
      const invite = ownerId ? null : newInvitationToken();
      const created = await createOrganisationWithAudit(pdb, actor, {
        legalName: input.legalName.trim(),
        slug: input.slug,
        timezone: input.timezone,
        owner: ownerId
          ? { userId: ownerId }
          : {
              inviteEmail: input.ownerEmail,
              tokenHash: invite!.hash,
              expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
            },
      });
      return created.ok
        ? {
            ...created,
            inviteLink: invite
              ? invitationLink(serverEnv().APP_URL, invite.token)
              : null,
          }
        : created;
    });
    if (!r.ok) return r;
    return r.data.ok
      ? {
          ok: true,
          data: { tenantId: r.data.tenantId, inviteLink: r.data.inviteLink },
        }
      : { ok: false, reason: "rejected", message: r.data.message };
  },
};

// --- Integrations (M5.3, ADR-0011 stage 1) -----------------------------------

export type IntegrationCategoryState = integrationStore.CategoryState;
export type AiControls = integrationStore.AiControls;
export { AI_FEATURES } from "@/platform/integrations/store";

/** Any active platform staff member may view; changes need integrations.manage. */
async function viewIntegrations<T>(
  fn: (db: PlatformDbClient) => Promise<T>,
): Promise<OrganisationRead<T>> {
  const access = await getPlatformAccess();
  if (access.kind !== "staff") return { kind: "forbidden" };
  const db = platformDb();
  if (!db) return { kind: "not_configured" };
  return { kind: "ok", data: await fn(db) };
}

const NOT_CONFIGURED = {
  ok: false,
  reason: "rejected",
  message: "Integration settings aren't configured on this deployment.",
} as const;

async function changeIntegrations(
  fn: (
    db: PlatformDbClient,
    actor: PlatformStaffActor,
  ) => Promise<integrationStore.StoreResult>,
): Promise<PrivilegedResult<null> & { fieldErrors?: Record<string, string> }> {
  const db = platformDb();
  if (!db) return NOT_CONFIGURED;
  const r = await privileged("integrations.manage", (_id, actor) =>
    fn(db, actor),
  );
  if (!r.ok) return r;
  return r.data.ok
    ? { ok: true, data: null }
    : {
        ok: false,
        reason: "rejected",
        message: r.data.message,
        fieldErrors: r.data.fieldErrors,
      };
}

const approvedLive = () =>
  integrationStore.approvedLiveProviders(serverEnv().APPROVED_LIVE_PROVIDERS);

/** The environment is decided by the deployment, never by the browser. */
export const integrationEnvironment = () => deploymentEnvironment();

export const integrationAdmin = {
  category: (category: ServiceCategory) =>
    viewIntegrations((db) =>
      integrationStore.categoryState(db, category, deploymentEnvironment()),
    ),
  overview: () =>
    viewIntegrations((db) =>
      Promise.all(
        SERVICE_CATEGORIES.map((c) =>
          integrationStore.categoryState(db, c, deploymentEnvironment()),
        ),
      ),
    ),
  ai: () => viewIntegrations((db) => integrationStore.getAiControls(db)),
  approvedLive: () => [...approvedLive()],
  configure: (providerId: string, settings: Record<string, unknown>) =>
    changeIntegrations((db, actor) =>
      integrationStore.saveProviderConfig(
        db,
        actor,
        providerId,
        deploymentEnvironment(),
        settings,
      ),
    ),
  test: (providerId: string) =>
    changeIntegrations((db, actor) =>
      integrationStore.validateLatestConfig(
        db,
        actor,
        providerId,
        deploymentEnvironment(),
      ),
    ),
  activate: (providerId: string) =>
    changeIntegrations((db, actor) =>
      integrationStore.activateProvider(
        db,
        actor,
        providerId,
        deploymentEnvironment(),
        approvedLive(),
      ),
    ),
  saveAi: (input: unknown) =>
    changeIntegrations((db, actor) =>
      integrationStore.saveAiControls(db, actor, input),
    ),
};
