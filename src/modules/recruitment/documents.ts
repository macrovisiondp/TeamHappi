// CVs on applications (M9.2b). These functions decide who may upload, open
// and remove a CV and record it; the workspace layer moves the bytes to and
// from storage OUTSIDE the transaction. Access follows the application:
//   - open: anyone who can see the application in full (recruitment.view at
//     the vacancy's site), plus interviewers for their own candidate;
//   - upload and remove: recruitment.manage at the vacancy's site.
// Every upload, open and removal is audited with ids only: never the file
// name or its contents.

import { createHash } from "node:crypto";

import { isUuid, type TenantTx } from "@/lib/tenancy";

import { canAt, type Actor } from "./policy";
import type { Result } from "./service";

export const CV_MAX_BYTES = 4 * 1024 * 1024;
/** Stored CVs per application (a few versions, not an archive). */
export const CV_MAX_PER_APPLICATION = 5;

export const CV_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export type CvContentType = (typeof CV_TYPES)[keyof typeof CV_TYPES];

const forbidden = () =>
  ({
    ok: false,
    code: "forbidden",
    message: "Your role doesn't allow this change.",
  }) as const;
const notFound = () =>
  ({
    ok: false,
    code: "not_found",
    message: "That CV couldn't be found.",
  }) as const;
const conflict = (message: string) =>
  ({ ok: false, code: "conflict", message }) as const;

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/**
 * Checks a CV by its CONTENT (not the name or the browser's claimed type):
 * a PDF without scripts, launch actions or embedded files, or a Word .docx
 * without macros. Anything else is refused. This is a filter, not a malware
 * scan: files are always downloaded, never shown inside TeamHappi.
 */
export function inspectCv(
  bytes: Uint8Array,
  rawName: string,
):
  | { ok: true; contentType: CvContentType; fileName: string; sha256: string }
  | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "The file is empty." };
  if (bytes.length > CV_MAX_BYTES)
    return { ok: false, message: "CVs can be up to 4 MB." };
  const text = latin1(bytes);
  let contentType: CvContentType;
  if (text.startsWith("%PDF-")) {
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia)\b/.test(text))
      return {
        ok: false,
        message:
          "This PDF contains scripts or attachments. Save it again as a plain PDF and retry.",
      };
    contentType = CV_TYPES.pdf;
  } else if (text.startsWith("PK\x03\x04")) {
    // A .docx is a zip; its part names are stored uncompressed.
    if (
      !text.includes("[Content_Types].xml") ||
      !text.includes("word/document.xml")
    )
      return { ok: false, message: "Upload a PDF or a Word (.docx) file." };
    if (/vbaProject|macroEnabled|activeX/i.test(text))
      return {
        ok: false,
        message:
          "Word files with macros can't be uploaded. Save it as .docx or PDF.",
      };
    contentType = CV_TYPES.docx;
  } else {
    return { ok: false, message: "Upload a PDF or a Word (.docx) file." };
  }
  const ext = contentType === CV_TYPES.pdf ? "pdf" : "docx";
  return {
    ok: true,
    contentType,
    fileName: cleanFileName(rawName, ext),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** A safe display and download name that always ends in the real extension. */
export function cleanFileName(raw: string, ext: "pdf" | "docx"): string {
  const base = (raw.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.(pdf|docx?)$/i, "")
    .trim()
    .slice(0, 150);
  return `${base || "CV"}.${ext}`;
}

async function applicationAccess(tx: TenantTx, actor: Actor, id: string) {
  if (!isUuid(id)) return null;
  const a = await tx.application.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id } },
    select: {
      id: true,
      vacancy: { select: { siteId: true } },
      candidate: { select: { anonymisedAt: true } },
    },
  });
  if (!a) return null;
  const full = canAt(actor, "recruitment.view", a.vacancy.siteId);
  const interviewer =
    !full &&
    (await tx.interviewInterviewer.count({
      where: {
        tenantId: actor.tenantId,
        membershipId: actor.membershipId,
        removedAt: null,
        interview: { applicationId: a.id },
      },
    })) > 0;
  if (!full && !interviewer) return null;
  return {
    id: a.id,
    manage: full && canAt(actor, "recruitment.manage", a.vacancy.siteId),
    anonymised: a.candidate.anonymisedAt !== null,
  };
}

async function audit(
  tx: TenantTx,
  actor: Actor,
  action: string,
  applicationId: string,
  detail: Record<string, string | number>,
) {
  await tx.auditEvent.create({
    data: {
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      action,
      targetType: "application",
      targetId: applicationId,
      detail,
    },
    select: { id: true },
  });
}

/** CVs on an application the actor can see; null if they can't see it. */
export async function listDocuments(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
) {
  const access = await applicationAccess(tx, actor, applicationId);
  if (!access) return null;
  const docs = await tx.applicationDocument.findMany({
    where: { tenantId: actor.tenantId, applicationId, status: "stored" },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      uploadedBy: true,
      uploadedAt: true,
    },
  });
  const users = await tx.user.findMany({
    where: {
      id: {
        in: [
          ...new Set(
            docs.map((d) => d.uploadedBy).filter((v): v is string => !!v),
          ),
        ],
      },
    },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    canUpload:
      access.manage &&
      !access.anonymised &&
      docs.length < CV_MAX_PER_APPLICATION,
    canRemove: access.manage,
    documents: docs.map((d) => ({
      id: d.id,
      fileName: d.fileName!,
      kind: d.contentType === CV_TYPES.pdf ? "PDF" : "Word",
      sizeBytes: d.sizeBytes,
      // No uploader: the candidate sent it with an online application (M9.3).
      uploadedBy: d.uploadedBy
        ? (name.get(d.uploadedBy) ?? "A former member")
        : "the candidate",
      uploadedAt: d.uploadedAt,
    })),
  };
}

/** Checked before the file is sent to storage, and again by recordUpload. */
export async function mayUpload(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
): Promise<Result<{ id: string }>> {
  const access = await applicationAccess(tx, actor, applicationId);
  if (!access)
    return {
      ok: false,
      code: "not_found",
      message: "That application couldn't be found.",
    };
  if (!access.manage) return forbidden();
  if (access.anonymised) return conflict("This candidate has been anonymised.");
  const stored = await tx.applicationDocument.count({
    where: { tenantId: actor.tenantId, applicationId, status: "stored" },
  });
  if (stored >= CV_MAX_PER_APPLICATION)
    return conflict(
      `An application can have up to ${CV_MAX_PER_APPLICATION} CVs. Remove one first.`,
    );
  return { ok: true, data: { id: access.id } };
}

/** Records a CV that is already in storage under `storageKey`. */
export async function recordUpload(
  tx: TenantTx,
  actor: Actor,
  applicationId: string,
  file: {
    fileName: string;
    contentType: CvContentType;
    sizeBytes: number;
    sha256: string;
    providerId: string;
    storageKey: string;
  },
): Promise<Result> {
  const allowed = await mayUpload(tx, actor, applicationId);
  if (!allowed.ok) return allowed;
  const doc = await tx.applicationDocument.create({
    data: {
      tenantId: actor.tenantId,
      applicationId,
      uploadedBy: actor.userId,
      ...file,
    },
    select: { id: true },
  });
  await audit(tx, actor, "recruitment.cv_uploaded", applicationId, {
    documentId: doc.id,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
  });
  return { ok: true, data: doc };
}

/**
 * Where to fetch a CV from, for someone allowed to open it. Writes the audit
 * event in the same transaction, so every download is recorded.
 */
export async function openDocument(
  tx: TenantTx,
  actor: Actor,
  documentId: string,
): Promise<
  Result<{
    storageKey: string;
    providerId: string;
    fileName: string;
    contentType: string;
  }>
> {
  if (!isUuid(documentId)) return notFound();
  const doc = await tx.applicationDocument.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: documentId } },
    select: {
      applicationId: true,
      status: true,
      fileName: true,
      contentType: true,
      providerId: true,
      storageKey: true,
    },
  });
  if (!doc || doc.status !== "stored") return notFound();
  if (!(await applicationAccess(tx, actor, doc.applicationId)))
    return notFound();
  await audit(tx, actor, "recruitment.cv_downloaded", doc.applicationId, {
    documentId,
  });
  return {
    ok: true,
    data: {
      storageKey: doc.storageKey,
      providerId: doc.providerId,
      fileName: doc.fileName!,
      contentType: doc.contentType,
    },
  };
}

/** Removes a CV from the application; the file is deleted from storage after. */
export async function removeDocument(
  tx: TenantTx,
  actor: Actor,
  documentId: string,
): Promise<Result> {
  if (!isUuid(documentId)) return notFound();
  const doc = await tx.applicationDocument.findUnique({
    where: { tenantId_id: { tenantId: actor.tenantId, id: documentId } },
    select: { applicationId: true, status: true },
  });
  if (!doc || doc.status !== "stored") return notFound();
  const access = await applicationAccess(tx, actor, doc.applicationId);
  if (!access) return notFound();
  if (!access.manage) return forbidden();
  await tx.applicationDocument.update({
    where: { tenantId_id: { tenantId: actor.tenantId, id: documentId } },
    data: {
      status: "deleting",
      fileName: null,
      deletedBy: actor.userId,
      deletedAt: new Date(),
      deleteReason: "removed",
    },
    select: { id: true },
  });
  await audit(tx, actor, "recruitment.cv_removed", doc.applicationId, {
    documentId,
  });
  return { ok: true, data: { id: documentId } };
}

/** Marks every stored CV on these applications for deletion (anonymisation). */
export async function markForDeletion(
  tx: TenantTx,
  actor: Actor,
  applicationIds: readonly string[],
): Promise<number> {
  const r = await tx.applicationDocument.updateMany({
    where: {
      tenantId: actor.tenantId,
      applicationId: { in: [...applicationIds] },
      status: "stored",
    },
    data: {
      status: "deleting",
      fileName: null,
      deletedBy: actor.userId,
      deletedAt: new Date(),
      deleteReason: "anonymised",
    },
  });
  return r.count;
}

/** Files waiting to be deleted from storage in this organisation. */
export async function pendingDeletions(tx: TenantTx, actor: Actor) {
  return tx.applicationDocument.findMany({
    where: { tenantId: actor.tenantId, status: "deleting" },
    orderBy: { deletedAt: "asc" },
    take: 50,
    select: { id: true, providerId: true, storageKey: true },
  });
}

/** Records that these files are gone from storage. */
export async function markDeleted(
  tx: TenantTx,
  actor: Actor,
  ids: readonly string[],
) {
  if (ids.length === 0) return;
  await tx.applicationDocument.updateMany({
    where: {
      tenantId: actor.tenantId,
      id: { in: [...ids] },
      status: "deleting",
    },
    data: { status: "deleted" },
  });
}
