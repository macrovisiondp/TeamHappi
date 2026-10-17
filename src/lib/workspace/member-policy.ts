// Member management rules (M6). Pure functions: the database layer
// (members.ts) loads the facts and these decide. Enforced on the server for
// every change; the UI only mirrors them.

import type { PermissionCode } from "@/lib/permissions/catalogue";

import type { Grants } from "./policy";

export const INVITATION_DAYS = 7;
/** Roles that only make sense organisation-wide. */
export const ORGANISATION_WIDE_ROLES = new Set(["owner", "admin"]);

export interface RoleFacts {
  key: string;
  permissions: readonly string[];
}

export type Refusal = { ok: false; message: string };
export type Decision = { ok: true } | Refusal;

const ok: Decision = { ok: true };
const no = (message: string): Refusal => ({ ok: false, message });

const orgWide = (grants: Grants, code: PermissionCode) =>
  grants.get(code) === "all";

/** Whether the actor can see the members page at all. */
export function canViewMembers(grants: Grants): boolean {
  return orgWide(grants, "member.invite") || orgWide(grants, "role.assign");
}

/**
 * Whether the actor may give someone `role` (at `siteId`, or everywhere).
 * You can't hand out a permission you don't hold organisation-wide, and only
 * an owner can make someone an owner.
 */
export function mayGrantRole(
  grants: Grants,
  actorIsOwner: boolean,
  role: RoleFacts,
  siteId: string | null,
): Decision {
  if (role.key === "owner" && !actorIsOwner)
    return no("Only an owner can make someone an owner.");
  if (ORGANISATION_WIDE_ROLES.has(role.key) && siteId !== null)
    return no("This role applies to the whole organisation, not one site.");
  const missing = role.permissions.filter(
    (p) => !orgWide(grants, p as PermissionCode),
  );
  if (missing.length)
    return no("You can't give someone permissions you don't have yourself.");
  return ok;
}

export interface TargetFacts {
  isSelf: boolean;
  isOwner: boolean;
  status: "active" | "suspended" | "invited" | "left";
}

/**
 * Whether the actor may change `target` at all (role or status). Nobody
 * changes their own access, and only owners change owners.
 */
export function mayChangeMember(
  actorIsOwner: boolean,
  target: TargetFacts,
): Decision {
  if (target.isSelf) return no("You can't change your own access.");
  if (target.status === "left")
    return no("This person has left. Invite them again to give them access.");
  if (target.isOwner && !actorIsOwner)
    return no("Only an owner can change another owner.");
  return ok;
}

/**
 * The organisation must always keep at least one active owner. `activeOwners`
 * counts active members holding the owner role organisation-wide.
 */
export function keepsAnOwner(
  target: TargetFacts,
  stillOwnerAfter: boolean,
  activeOnlyAfter: boolean,
  activeOwners: number,
): Decision {
  const losesOwner =
    target.isOwner &&
    target.status === "active" &&
    (!stillOwnerAfter || !activeOnlyAfter);
  if (losesOwner && activeOwners <= 1)
    return no(
      "This is the only owner. Make someone else an owner first, so the organisation always has one.",
    );
  return ok;
}

/** Which permission each kind of change needs (organisation-wide). */
export function permissionFor(
  change: "invite" | "role" | "status",
): PermissionCode {
  return change === "role" ? "role.assign" : "member.invite";
}

export function hasOrgWide(grants: Grants, code: PermissionCode): boolean {
  return orgWide(grants, code);
}
