// Platform Admin: create an organisation (replaces the interim script). Kept
// apart from organisations.ts because it needs the application database client.

import { db as appDb } from "@/lib/db";
import type { PlatformStaffActor } from "@/platform/authz/internal";
import { assertPlatformGrant } from "@/platform/authz/internal";
import type { PlatformDbClient } from "@/platform/db";
import {
  createOrganisation,
  type CreateOrganisationInput,
} from "@/platform/tenancy/create-tenant";

/**
 * Creates an organisation (tenant, system roles, owner or owner invitation) in
 * the application database, then records it in the platform audit log. Needs
 * "tenant.create". A duplicate slug returns a conflict.
 */
export async function createOrganisationWithAudit(
  pdb: PlatformDbClient,
  actor: PlatformStaffActor,
  input: CreateOrganisationInput,
): Promise<
  | { ok: true; tenantId: string }
  | { ok: false; code: "conflict"; message: string }
> {
  assertPlatformGrant(actor, "tenant.create");
  let created: { tenantId: string };
  try {
    created = await createOrganisation(appDb(), actor, input);
  } catch (e) {
    if ((e as { code?: unknown }).code === "P2002")
      return {
        ok: false,
        code: "conflict",
        message: "That short name is already used. Choose another.",
      };
    throw e;
  }
  await pdb.platformAuditEvent.create({
    data: {
      actorUserId: actor.userId,
      action: "tenant.created",
      targetType: "tenant",
      targetId: created.tenantId,
      detail: {
        owner: "userId" in input.owner ? "existing_account" : "invitation",
      },
    },
    select: { id: true },
  });
  return { ok: true, tenantId: created.tenantId };
}
