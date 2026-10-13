import { deploymentEnvironment } from "../core/environment";
import {
  IntegrationError,
  ProviderNotActivatedError,
  type DeploymentEnvironment,
} from "../core/types";

// Provider-independent object storage (ADR-0007, ADR-0011).
//
// Object keys are always built on the server from the server-resolved tenant
// and a random id; the browser never supplies a key or a tenant. Each stored
// object records its provider, so switching the provider for NEW uploads never
// orphans existing files: reads go to the provider the object was written to.

export type DataClassification = "media" | "business" | "restricted";

export interface StoredObjectRef {
  providerId: string;
  key: string;
  tenantId: string;
  classification: DataClassification;
}

export interface PresignedAccess {
  url: string;
  expiresAt: Date;
}

export interface StorageProvider {
  readonly id: string;
  /** The highest classification this provider may hold. */
  readonly maxClassification: DataClassification;
  presignUpload(
    ref: StoredObjectRef,
    contentType: string,
    bytes: number,
  ): Promise<PresignedAccess>;
  presignDownload(ref: StoredObjectRef): Promise<PresignedAccess>;
  remove(ref: StoredObjectRef): Promise<void>;
}

const RANK: Record<DataClassification, number> = {
  media: 0,
  business: 1,
  restricted: 2,
};

/** Upload and download links live for at most five minutes. */
export const MAX_PRESIGN_SECONDS = 300;

const TENANT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function objectKey(tenantId: string, objectId: string): string {
  if (!TENANT_ID.test(tenantId))
    throw new IntegrationError("Invalid tenant id", false);
  if (!OBJECT_ID.test(objectId))
    throw new IntegrationError("Invalid object id", false);
  return `tenants/${tenantId.toLowerCase()}/objects/${objectId}`;
}

/** Refuses any access where the key is not inside the caller's tenant prefix. */
export function assertObjectInTenant(
  ref: StoredObjectRef,
  tenantId: string,
): void {
  const prefix = `tenants/${tenantId.toLowerCase()}/`;
  if (
    ref.tenantId.toLowerCase() !== tenantId.toLowerCase() ||
    !ref.key.startsWith(prefix) ||
    ref.key.includes("..")
  ) {
    // Same error as "not found": never reveal another tenant's objects.
    throw new IntegrationError("Object not found", false);
  }
}

export function assertProviderAllowed(
  provider: Pick<StorageProvider, "id" | "maxClassification">,
  classification: DataClassification,
): void {
  if (RANK[classification] > RANK[provider.maxClassification])
    throw new IntegrationError(
      `${provider.id} is not approved for ${classification} data`,
      false,
    );
}

export interface UploadPolicy {
  allowedTypes: readonly string[];
  maxBytes: number;
}

export const DOCUMENT_POLICY: UploadPolicy = {
  allowedTypes: ["application/pdf", "image/jpeg", "image/png"],
  maxBytes: 10 * 1024 * 1024,
};

export const MEDIA_POLICY: UploadPolicy = {
  allowedTypes: ["image/jpeg", "image/png", "image/webp"],
  maxBytes: 5 * 1024 * 1024,
};

export function checkUpload(
  policy: UploadPolicy,
  contentType: string,
  bytes: number,
): { ok: true } | { ok: false; reason: string } {
  if (!policy.allowedTypes.includes(contentType.toLowerCase()))
    return { ok: false, reason: "This file type is not allowed" };
  if (!Number.isInteger(bytes) || bytes <= 0)
    return { ok: false, reason: "The file is empty" };
  if (bytes > policy.maxBytes)
    return { ok: false, reason: "The file is too large" };
  return { ok: true };
}

/**
 * Picks the provider for an existing object: always the one it was written to,
 * regardless of which provider is now active for new uploads.
 */
export function providerForObject(
  ref: StoredObjectRef,
  providers: ReadonlyMap<string, StorageProvider>,
): StorageProvider {
  const provider = providers.get(ref.providerId);
  if (!provider)
    throw new IntegrationError(
      `Storage provider "${ref.providerId}" for this object is not configured`,
      false,
    );
  return provider;
}

/** In-memory adapter for tests and local development. */
export function syntheticStorage(
  environment: DeploymentEnvironment = deploymentEnvironment(),
  now: () => Date = () => new Date(),
): StorageProvider & { readonly objects: ReadonlySet<string> } {
  if (environment === "production")
    throw new ProviderNotActivatedError("synthetic-storage");
  const objects = new Set<string>();
  const expires = () => new Date(now().getTime() + MAX_PRESIGN_SECONDS * 1000);
  return {
    id: "synthetic-storage",
    maxClassification: "restricted",
    objects,
    async presignUpload(ref) {
      objects.add(ref.key);
      return { url: `memory://${ref.key}?op=put`, expiresAt: expires() };
    },
    async presignDownload(ref) {
      if (!objects.has(ref.key))
        throw new IntegrationError("Object not found", false);
      return { url: `memory://${ref.key}?op=get`, expiresAt: expires() };
    },
    async remove(ref) {
      objects.delete(ref.key);
    },
  };
}

/** Placeholder for approved live providers. No network calls. */
export function unactivatedStorageProvider(
  id: "aws-s3" | "cloudinary",
): StorageProvider {
  const fail = async (): Promise<never> => {
    throw new ProviderNotActivatedError(id);
  };
  return {
    id,
    // Cloudinary is media-only until a separate assessment says otherwise.
    maxClassification: id === "cloudinary" ? "media" : "restricted",
    presignUpload: fail,
    presignDownload: fail,
    remove: fail,
  };
}
