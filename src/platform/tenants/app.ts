import "server-only";

import { db } from "@/lib/db";
import type { PlatformStaffActor } from "@/platform/authz/internal";
import type { PlatformDbClient } from "@/platform/db";
import type { CreateOrganisationInput } from "@/platform/tenancy/create-tenant";

import * as create from "./create";

// Binds the application database client for Platform Admin (src/lib/platform-
// access, which may not import @/lib/db itself). Tests call ./create directly.

export type { OwnerInvite } from "./create";

export const createOrganisationWithAudit = (
  pdb: PlatformDbClient,
  actor: PlatformStaffActor,
  input: CreateOrganisationInput,
) => create.createOrganisationWithAudit(db(), pdb, actor, input);

export const ownerInvite = (viewerUserId: string, tenantId: string) =>
  create.ownerInvite(db(), viewerUserId, tenantId);

export const replaceOwnerInvite = (
  pdb: PlatformDbClient,
  actor: PlatformStaffActor,
  tenantId: string,
  renew: Parameters<typeof create.replaceOwnerInvite>[4],
) => create.replaceOwnerInvite(db(), pdb, actor, tenantId, renew);
