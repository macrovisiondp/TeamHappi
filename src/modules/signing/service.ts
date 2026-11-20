// Documents to sign (M13). These functions decide and record; the workspace
// layer moves file bytes and builds signed PDFs OUTSIDE the transaction.
//
//   - documents.manage (owner, admin, HR; organisation-wide) uploads policy
//     PDFs to a library, uploads a person's own contract PDF, sends documents,
//     countersigns contracts, withdraws requests and opens any copy;
//   - staff reach only their OWN requests through their linked record, and sign
//     with a typed name and an explicit agreement (a simple electronic
//     signature) against the exact file, fixed by its SHA-256.
//
// Every upload, send, view, signature and withdrawal is audited with ids only:
// never names typed, titles, file names or contents. Pay and other contract
// details live only inside the private files.

import { createHash } from "node:crypto";

import type { PermissionCode } from "@/lib/permissions/catalogue";
import { checkJobTitle } from "@/lib/job-titles";
import { isUuid, type TenantTx } from "@/lib/tenancy";
import { can, type Grants } from "@/lib/workspace/policy";

export interface Actor {
  tenantId: string;
  userId: string;
  membershipId: string;
  grants: Grants;
}

export type Result<T = { id: string }> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "forbidden" | "not_found" | "invalid" | "conflict";
      message: string;
      fieldErrors?: Record<string, string>;
    };

const MANAGE: PermissionCode = "documents.manage";
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

const forbidden = {
  ok: false,
  code: "forbidden",
  message: "Your role doesn't allow this.",
} as const;
const notFound = (what = "document") =>
  ({
    ok: false,
    code: "not_found",
    message: `That ${what} couldn't be found.`,
  }) as const;
const invalid = (fieldErrors: Record<string, string>) =>
  ({
    ok: false,
    code: "invalid",
    message: "Check the highlighted fields.",
    fieldErrors,
  }) as const;
const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;

export const canManage = (actor: Actor) => can(actor.grants, MANAGE);

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  targetType: "sign_document" | "sign_request",
  targetId: string,
  detail: Record<string, string | boolean | null> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType,
      targetId,
      detail,
    },
    select: { id: true },
  });
}

// --- Files ------------------------------------------------------------------------------

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/**
 * Checks an upload by CONTENT: a PDF up to 4 MB without scripts, launch actions
 * or attachments. (The workspace layer also checks it opens and isn't
 * password-protected, because a signature page must be added later.)
 */
export function inspectPdf(
  bytes: Uint8Array,
  rawName: string,
):
  | { ok: true; fileName: string; sha256: string }
  | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "The file is empty." };
  if (bytes.length > MAX_PDF_BYTES)
    return { ok: false, message: "Documents can be up to 4 MB." };
  const text = latin1(bytes);
  if (!text.startsWith("%PDF-"))
    return {
      ok: false,
      message: "Upload a PDF. In Word, use File > Save As > PDF.",
    };
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(text))
    return {
      ok: false,
      message:
        "This PDF contains scripts or attachments. Save it again as a plain PDF and retry.",
    };
  const base = (rawName.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.pdf$/i, "")
    .slice(0, 150);
  return {
    ok: true,
    fileName: `${base || "document"}.pdf`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export const sha256Of = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function cleanTitle(raw: unknown): string | null {
  const t = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return t.length >= 1 && t.length <= 120 ? t : null;
}

export interface FileMeta {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  providerId: string;
  storageKey: string;
}

// --- Library (policies) -------------------------------------------------------------

export async function library(tx: TenantTx, actor: Actor) {
  if (!canManage(actor)) return null;
  return tx.signDocument.findMany({
    where: { tenantId: actor.tenantId, kind: "policy", archivedAt: null },
    orderBy: { title: "asc" },
    select: { id: true, title: true, fileName: true, uploadedAt: true },
  });
}

/** Checks a policy upload may go ahead (before the file is stored). */
export function mayUploadPolicy(
  actor: Actor,
  titleRaw: unknown,
): Result<{ title: string }> {
  if (!canManage(actor)) return forbidden;
  const title = cleanTitle(titleRaw);
  if (!title)
    return invalid({
      title: "Give the document a title (up to 120 characters)",
    });
  return { ok: true, data: { title } };
}

export async function recordPolicy(
  tx: TenantTx,
  actor: Actor,
  title: string,
  file: FileMeta,
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  const doc = await tx.signDocument.create({
    data: {
      tenantId: actor.tenantId,
      kind: "policy",
      title,
      ...file,
      uploadedBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "documents.uploaded", "sign_document", doc.id, {
    kind: "policy",
  });
  return { ok: true, data: doc };
}

/** Takes a policy out of the library. Requests already sent are unaffected. */
export async function archivePolicy(
  tx: TenantTx,
  actor: Actor,
  id: unknown,
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  if (typeof id !== "string" || !isUuid(id)) return notFound();
  const doc = await tx.signDocument.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: { id: true, kind: true, archivedAt: true },
  });
  if (!doc || doc.kind !== "policy" || doc.archivedAt) return notFound();
  await tx.signDocument.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    data: { archivedAt: new Date(), archivedBy: actor.userId },
    select: { id: true },
  });
  await audit(tx, actor, "documents.archived", "sign_document", id);
  return { ok: true, data: { id } };
}

// --- Sending ----------------------------------------------------------------------------

async function person(tx: TenantTx, actor: Actor, employeeId: unknown) {
  if (typeof employeeId !== "string" || !isUuid(employeeId)) return null;
  const e = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: employeeId } },
    select: { id: true, status: true, membershipId: true },
  });
  return e && e.status !== "left" ? e : null;
}

/** Checks a contract upload for a person (before the file is stored). */
export async function mayUploadContract(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
  titleRaw: unknown,
): Promise<Result<{ employeeId: string; title: string }>> {
  if (!canManage(actor)) return forbidden;
  const e = await person(tx, actor, employeeId);
  if (!e) return notFound("person");
  const title = cleanTitle(titleRaw);
  if (!title)
    return invalid({
      title: "Give the contract a title (up to 120 characters)",
    });
  return { ok: true, data: { employeeId: e.id, title } };
}

async function openRequest(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  docId: string,
  needsCountersign: boolean,
) {
  const existing = await tx.signRequest.findFirst({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      signDocumentId: docId,
      status: { in: ["awaiting_employee", "awaiting_countersign"] },
    },
    select: { id: true },
  });
  if (existing) return null;
  const r = await tx.signRequest.create({
    data: {
      tenantId: actor.tenantId,
      employeeId,
      signDocumentId: docId,
      needsCountersign,
      sentBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "documents.sent", "sign_request", r.id, {
    employeeId,
    documentId: docId,
  });
  return r;
}

/** Records a person's contract file and sends it to them (countersigned after). */
export async function recordContract(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
  title: string,
  file: FileMeta,
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  const doc = await tx.signDocument.create({
    data: {
      tenantId: actor.tenantId,
      kind: "contract",
      title,
      employeeId,
      ...file,
      uploadedBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "documents.uploaded", "sign_document", doc.id, {
    kind: "contract",
    employeeId,
  });
  const r = await openRequest(tx, actor, employeeId, doc.id, true);
  return { ok: true, data: { id: r!.id } };
}

/** Sends library policies to a person (skipping any already waiting). */
export async function sendPolicies(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
  ids: unknown,
): Promise<Result<{ sent: number }>> {
  if (!canManage(actor)) return forbidden;
  const e = await person(tx, actor, employeeId);
  if (!e) return notFound("person");
  const list = Array.isArray(ids)
    ? ids.filter((x): x is string => typeof x === "string" && isUuid(x))
    : [];
  if (!list.length)
    return invalid({ documents: "Choose at least one document" });
  const docs = await tx.signDocument.findMany({
    where: {
      tenantId: actor.tenantId,
      id: { in: list },
      kind: "policy",
      archivedAt: null,
    },
    select: { id: true },
  });
  if (docs.length !== new Set(list).size) return notFound();
  let sent = 0;
  for (const d of docs)
    if (await openRequest(tx, actor, e.id, d.id, false)) sent += 1;
  if (!sent)
    return conflict("Those documents are already waiting to be signed.");
  return { ok: true, data: { sent } };
}

export async function withdrawRequest(
  tx: TenantTx,
  actor: Actor,
  requestId: unknown,
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  if (typeof requestId !== "string" || !isUuid(requestId))
    return notFound("request");
  const r = await tx.signRequest.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
    select: { id: true, status: true },
  });
  if (!r) return notFound("request");
  if (r.status === "completed" || r.status === "withdrawn")
    return conflict("This request is already finished.");
  await tx.signRequest.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: r.id } },
    data: {
      status: "withdrawn",
      withdrawnAt: new Date(),
      withdrawnBy: actor.userId,
    },
    select: { id: true },
  });
  await audit(tx, actor, "documents.withdrawn", "sign_request", r.id);
  return { ok: true, data: { id: r.id } };
}

// --- Viewing ----------------------------------------------------------------------------

const requestSelect = {
  id: true,
  status: true,
  needsCountersign: true,
  sentAt: true,
  signedName: true,
  signedAt: true,
  countersignedName: true,
  countersignedAt: true,
  finalStorageKey: true,
  document: { select: { id: true, kind: true, title: true } },
} as const;

/** A person's requests, for managers (person page). */
export async function personRequests(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
) {
  if (!canManage(actor)) return null;
  if (typeof employeeId !== "string" || !isUuid(employeeId)) return null;
  const rows = await tx.signRequest.findMany({
    where: { tenantId: actor.tenantId, employeeId },
    orderBy: { sentAt: "desc" },
    select: requestSelect,
  });
  return rows.map(view);
}

const view = (r: {
  id: string;
  status: string;
  needsCountersign: boolean;
  sentAt: Date;
  signedName: string | null;
  signedAt: Date | null;
  countersignedName: string | null;
  countersignedAt: Date | null;
  finalStorageKey: string | null;
  document: { id: string; kind: string; title: string };
}) => ({
  id: r.id,
  status: r.status as
    "awaiting_employee" | "awaiting_countersign" | "completed" | "withdrawn",
  kind: r.document.kind as "policy" | "contract",
  title: r.document.title,
  needsCountersign: r.needsCountersign,
  sentAt: r.sentAt,
  signedName: r.signedName,
  signedAt: r.signedAt,
  countersignedName: r.countersignedName,
  countersignedAt: r.countersignedAt,
  hasSignedCopy: r.finalStorageKey !== null,
});

export type RequestView = ReturnType<typeof view>;

/** The signed-in person's own record, if linked and still employed. */
async function ownRecord(tx: TenantTx, actor: Actor) {
  const e = await tx.employee.findUnique({
    where: {
      tenantId_membershipId: {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
      },
    },
    select: { id: true, status: true },
  });
  return e && e.status !== "left" ? e : null;
}

/** Their own requests (My onboarding). Withdrawn ones are hidden. */
export async function myRequests(tx: TenantTx, actor: Actor) {
  const me = await ownRecord(tx, actor);
  if (!me) return null;
  const rows = await tx.signRequest.findMany({
    where: {
      tenantId: actor.tenantId,
      employeeId: me.id,
      status: { not: "withdrawn" },
    },
    orderBy: { sentAt: "desc" },
    select: requestSelect,
  });
  return rows.map(view);
}

/**
 * Opens a request's original or signed file for its own person, or for a
 * manager. Audited (restricted documents: every view is recorded).
 */
export async function openFile(
  tx: TenantTx,
  actor: Actor,
  requestId: unknown,
  which: "original" | "signed",
): Promise<
  Result<{
    providerId: string;
    storageKey: string;
    fileName: string;
    sha256: string;
  }>
> {
  if (typeof requestId !== "string" || !isUuid(requestId)) return notFound();
  const r = await tx.signRequest.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: requestId } },
    select: {
      id: true,
      employeeId: true,
      status: true,
      finalProviderId: true,
      finalStorageKey: true,
      finalSha256: true,
      document: {
        select: {
          fileName: true,
          providerId: true,
          storageKey: true,
          sha256: true,
        },
      },
    },
  });
  if (!r) return notFound();
  const mine = (await ownRecord(tx, actor))?.id === r.employeeId;
  if (!canManage(actor) && !(mine && r.status !== "withdrawn"))
    return notFound();
  let file;
  if (which === "signed") {
    if (!r.finalStorageKey || !r.finalProviderId || !r.finalSha256)
      return notFound();
    file = {
      providerId: r.finalProviderId,
      storageKey: r.finalStorageKey,
      fileName: r.document.fileName.replace(/\.pdf$/i, " (signed).pdf"),
      sha256: r.finalSha256,
    };
  } else
    file = {
      providerId: r.document.providerId,
      storageKey: r.document.storageKey,
      fileName: r.document.fileName,
      sha256: r.document.sha256,
    };
  await audit(tx, actor, "documents.viewed", "sign_request", r.id, {
    which,
    own: mine,
  });
  return { ok: true, data: file };
}

// --- Signing ----------------------------------------------------------------------------

function typedName(raw: unknown): string | null {
  const n =
    typeof raw === "string"
      ? raw.normalize("NFC").replace(/\s+/g, " ").trim()
      : "";
  return n.length >= 2 && n.length <= 100 ? n : null;
}

export interface SigningContext {
  requestId: string;
  title: string;
  organisation: string;
  documentSha256: string;
  providerId: string;
  storageKey: string;
  needsCountersign: boolean;
  employeeSignature: { name: string; at: Date } | null;
}

async function context(tx: TenantTx, actor: Actor, id: string) {
  const r = await tx.signRequest.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      employeeId: true,
      status: true,
      needsCountersign: true,
      signedName: true,
      signedAt: true,
      document: {
        select: {
          title: true,
          sha256: true,
          providerId: true,
          storageKey: true,
        },
      },
    },
  });
  if (!r) return null;
  const org = await tx.tenant.findUnique({
    where: { id: actor.tenantId },
    select: { legalName: true },
  });
  return {
    row: r,
    ctx: {
      requestId: r.id,
      title: r.document.title,
      organisation: org?.legalName ?? "",
      documentSha256: r.document.sha256,
      providerId: r.document.providerId,
      storageKey: r.document.storageKey,
      needsCountersign: r.needsCountersign,
      employeeSignature:
        r.signedName && r.signedAt
          ? { name: r.signedName, at: r.signedAt }
          : null,
    } satisfies SigningContext,
  };
}

/** Checks the person may sign this request now; returns what the PDF needs. */
export async function prepareSign(
  tx: TenantTx,
  actor: Actor,
  requestId: unknown,
  nameRaw: unknown,
  agreed: unknown,
): Promise<Result<SigningContext & { name: string }>> {
  const me = await ownRecord(tx, actor);
  if (!me || typeof requestId !== "string" || !isUuid(requestId))
    return notFound();
  const c = await context(tx, actor, requestId);
  if (!c || c.row.employeeId !== me.id || c.row.status === "withdrawn")
    return notFound();
  if (c.row.status !== "awaiting_employee")
    return conflict("You've already signed this.");
  const errors: Record<string, string> = {};
  const name = typedName(nameRaw);
  if (!name) errors.name = "Type your full name to sign";
  if (agreed !== true)
    errors.agree = "Tick the box to confirm you agree to sign";
  if (Object.keys(errors).length) return invalid(errors);
  return { ok: true, data: { ...c.ctx, name: name! } };
}

/** Records the person's signature (and the signed copy when no countersign is due). */
export async function recordSign(
  tx: TenantTx,
  actor: Actor,
  prepared: SigningContext & { name: string },
  signedAt: Date,
  finalFile: { providerId: string; storageKey: string; sha256: string } | null,
): Promise<Result> {
  const me = await ownRecord(tx, actor);
  if (!me) return notFound();
  const done = !prepared.needsCountersign;
  if (done !== (finalFile !== null)) throw new Error("signed copy mismatch");
  // Conditional on the state checked earlier, so a double tap can't sign twice.
  const updated = await tx.signRequest.updateMany({
    where: {
      tenantId: actor.tenantId,
      id: prepared.requestId,
      employeeId: me.id,
      status: "awaiting_employee",
    },
    data: {
      status: done ? "completed" : "awaiting_countersign",
      signedName: prepared.name,
      signedBy: actor.userId,
      signedAt,
      signedSha256: prepared.documentSha256,
      ...(finalFile
        ? {
            finalProviderId: finalFile.providerId,
            finalStorageKey: finalFile.storageKey,
            finalSha256: finalFile.sha256,
          }
        : {}),
    },
  });
  if (updated.count !== 1) return conflict("You've already signed this.");
  await audit(
    tx,
    actor,
    "documents.signed",
    "sign_request",
    prepared.requestId,
    { completed: done },
  );
  return { ok: true, data: { id: prepared.requestId } };
}

/** Checks a manager may countersign now; returns what the PDF needs. */
export async function prepareCountersign(
  tx: TenantTx,
  actor: Actor,
  requestId: unknown,
  nameRaw: unknown,
): Promise<Result<SigningContext & { name: string }>> {
  if (!canManage(actor)) return forbidden;
  if (typeof requestId !== "string" || !isUuid(requestId))
    return notFound("request");
  const c = await context(tx, actor, requestId);
  if (!c) return notFound("request");
  if (c.row.status !== "awaiting_countersign")
    return conflict("This isn't waiting for a countersignature.");
  const name = typedName(nameRaw);
  if (!name) return invalid({ name: "Type your full name to countersign" });
  return { ok: true, data: { ...c.ctx, name } };
}

export async function recordCountersign(
  tx: TenantTx,
  actor: Actor,
  prepared: SigningContext & { name: string },
  at: Date,
  finalFile: { providerId: string; storageKey: string; sha256: string },
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  const updated = await tx.signRequest.updateMany({
    where: {
      tenantId: actor.tenantId,
      id: prepared.requestId,
      status: "awaiting_countersign",
    },
    data: {
      status: "completed",
      countersignedName: prepared.name,
      countersignedBy: actor.userId,
      countersignedAt: at,
      finalProviderId: finalFile.providerId,
      finalStorageKey: finalFile.storageKey,
      finalSha256: finalFile.sha256,
    },
  });
  if (updated.count !== 1)
    return conflict("This isn't waiting for a countersignature.");
  await audit(
    tx,
    actor,
    "documents.countersigned",
    "sign_request",
    prepared.requestId,
  );
  return { ok: true, data: { id: prepared.requestId } };
}

// --- Starter packs (M14.1) --------------------------------------------------------------

const norm = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();

export async function starterPacks(tx: TenantTx, actor: Actor) {
  if (!canManage(actor)) return null;
  const packs = await tx.starterPack.findMany({
    where: { tenantId: actor.tenantId, archivedAt: null },
    orderBy: [{ jobTitle: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      jobTitle: true,
      documents: {
        where: { document: { archivedAt: null } },
        select: { document: { select: { id: true, title: true } } },
      },
    },
  });
  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    jobTitle: p.jobTitle,
    documents: p.documents.map((d) => d.document),
  }));
}

export async function createStarterPack(
  tx: TenantTx,
  actor: Actor,
  raw: { name?: unknown; jobTitle?: unknown; documentIds?: unknown },
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  const errors: Record<string, string> = {};
  const name =
    typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
  if (!name || name.length > 80)
    errors.name = "Give the pack a name (up to 80 characters)";
  const job =
    typeof raw.jobTitle === "string"
      ? raw.jobTitle.replace(/\s+/g, " ").trim()
      : "";
  if (job.length > 100)
    errors.jobTitle = "Keep the job title to 100 characters";
  const ids = Array.isArray(raw.documentIds)
    ? [
        ...new Set(
          raw.documentIds.filter(
            (x): x is string => typeof x === "string" && isUuid(x),
          ),
        ),
      ]
    : [];
  if (!ids.length) errors.documents = "Choose at least one document";
  // M16: the organisation's job-title list, if it keeps one.
  const title = await checkJobTitle(tx, job);
  if (!title.ok) errors.jobTitle = title.message;
  if (Object.keys(errors).length) return invalid(errors);
  const docs = await tx.signDocument.findMany({
    where: {
      tenantId: actor.tenantId,
      id: { in: ids },
      kind: "policy",
      archivedAt: null,
    },
    select: { id: true },
  });
  if (docs.length !== ids.length) return notFound();
  const pack = await tx.starterPack.create({
    data: {
      tenantId: actor.tenantId,
      name,
      jobTitle: title.ok ? title.value : null,
      createdBy: actor.userId,
    },
    select: { id: true },
  });
  await tx.starterPackDocument.createMany({
    data: ids.map((id) => ({
      tenantId: actor.tenantId,
      starterPackId: pack.id,
      signDocumentId: id,
    })),
  });
  await audit(tx, actor, "documents.pack_created", "sign_document", pack.id, {
    documents: String(ids.length),
  });
  return { ok: true, data: pack };
}

export async function archiveStarterPack(
  tx: TenantTx,
  actor: Actor,
  id: unknown,
): Promise<Result> {
  if (!canManage(actor)) return forbidden;
  if (typeof id !== "string" || !isUuid(id)) return notFound("pack");
  const r = await tx.starterPack.updateMany({
    where: { tenantId: actor.tenantId, id, archivedAt: null },
    data: { archivedAt: new Date(), archivedBy: actor.userId },
  });
  if (r.count !== 1) return notFound("pack");
  await audit(tx, actor, "documents.pack_archived", "sign_document", id);
  return { ok: true, data: { id } };
}

/**
 * Sends a person every policy in the starter packs for their job title (and
 * the packs for everyone), skipping any already waiting or signed.
 */
export async function sendStarterPack(
  tx: TenantTx,
  actor: Actor,
  employeeId: unknown,
): Promise<Result<{ sent: number; packs: number }>> {
  if (!canManage(actor)) return forbidden;
  const e = await person(tx, actor, employeeId);
  if (!e) return notFound("person");
  const job = await tx.employee.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: e.id } },
    select: { jobTitle: true },
  });
  const packs = (await starterPacks(tx, actor))!.filter(
    (p) => !p.jobTitle || norm(p.jobTitle) === norm(job?.jobTitle),
  );
  const docIds = [
    ...new Set(packs.flatMap((p) => p.documents.map((d) => d.id))),
  ];
  if (!docIds.length)
    return { ok: true, data: { sent: 0, packs: packs.length } };
  const already = await tx.signRequest.findMany({
    where: {
      tenantId: actor.tenantId,
      employeeId: e.id,
      signDocumentId: { in: docIds },
      status: {
        in: ["awaiting_employee", "awaiting_countersign", "completed"],
      },
    },
    select: { signDocumentId: true },
  });
  const done = new Set(already.map((r) => r.signDocumentId));
  let sent = 0;
  for (const id of docIds)
    if (!done.has(id) && (await openRequest(tx, actor, e.id, id, false)))
      sent += 1;
  return { ok: true, data: { sent, packs: packs.length } };
}

/** Job titles in use, to suggest when making a starter pack. */
export async function jobTitles(tx: TenantTx, actor: Actor) {
  if (!canManage(actor)) return [];
  const rows = await tx.employee.findMany({
    where: {
      tenantId: actor.tenantId,
      jobTitle: { not: null },
      status: { not: "left" },
    },
    distinct: ["jobTitle"],
    orderBy: { jobTitle: "asc" },
    select: { jobTitle: true },
    take: 200,
  });
  return rows.map((r) => r.jobTitle!).filter(Boolean);
}

/**
 * When someone leaves (M18): withdraws every document still waiting for them
 * to sign. Countersigning that's already due stays with the manager. Called by
 * the leaving process, which has already checked permission.
 */
export async function withdrawOpenFor(
  tx: TenantTx,
  actor: Actor,
  employeeId: string,
): Promise<number> {
  const r = await tx.signRequest.updateMany({
    where: {
      tenantId: actor.tenantId,
      employeeId,
      status: "awaiting_employee",
    },
    data: {
      status: "withdrawn",
      withdrawnAt: new Date(),
      withdrawnBy: actor.userId,
    },
  });
  return r.count;
}
