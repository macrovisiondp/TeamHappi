import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { deploymentEnvironment } from "../core/environment";
import { IntegrationError } from "../core/types";
import type { DeploymentEnvironment } from "../core/types";

// Server-side file storage for restricted documents such as CVs (M9.2b).
//
// Files travel through our server (upload in a server action, download in a
// route handler), so the bucket never needs CORS or public access and the
// browser never sees a storage URL. Keys come from objectKey() in ./index.ts.
//
// Which store is used:
//   - production: Amazon S3, only when the product owner has approved it
//     (APPROVED_LIVE_PROVIDERS includes "aws-s3") and the four STORAGE_S3_*
//     variables are set. Otherwise uploads are switched off.
//   - everywhere else: files on this machine under .data/blob-store/
//     (synthetic data only; never used in production).

export interface BlobStore {
  readonly providerId: "aws-s3" | "local-disk";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

const KEY = /^tenants\/[0-9a-f-]{36}\/objects\/[A-Za-z0-9_-]{16,64}$/;

export function assertKey(key: string): void {
  if (!KEY.test(key)) throw new IntegrationError("Invalid object key", false);
}

/** Development and test store: files on disk, refused in production. */
export function localDiskStore(
  root = resolve(process.cwd(), ".data", "blob-store"),
  environment: DeploymentEnvironment = deploymentEnvironment(),
): BlobStore {
  if (environment === "production")
    throw new IntegrationError(
      "The local file store can't be used in production",
      false,
    );
  const pathOf = (key: string) => {
    assertKey(key);
    const full = resolve(root, ...key.split("/"));
    if (!full.startsWith(root + sep))
      throw new IntegrationError("Invalid object key", false);
    return full;
  };
  return {
    providerId: "local-disk",
    async put(key, body) {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body, { flag: "wx" });
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch {
        throw new IntegrationError("Object not found", false);
      }
    },
    async remove(key) {
      await rm(pathOf(key), { force: true });
    },
  };
}

export interface S3Settings {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** The S3 settings, when every value is present and the owner approved S3. */
export function s3Settings(
  env: Record<string, string | undefined> = process.env,
): S3Settings | null {
  const approved = (env.APPROVED_LIVE_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes("aws-s3");
  const bucket = env.STORAGE_S3_BUCKET?.trim();
  const region = env.STORAGE_S3_REGION?.trim();
  const accessKeyId = env.STORAGE_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.STORAGE_S3_SECRET_ACCESS_KEY?.trim();
  if (!approved || !bucket || !region || !accessKeyId || !secretAccessKey)
    return null;
  return { bucket, region, accessKeyId, secretAccessKey };
}

let cached: { store: BlobStore | null } | undefined;

/**
 * The store for new uploads in this deployment, or null when uploads are
 * switched off (production without approved S3 settings, or a preview).
 */
export async function blobStore(
  env: Record<string, string | undefined> = process.env,
): Promise<BlobStore | null> {
  if (cached) return cached.store;
  const environment = deploymentEnvironment(env);
  let store: BlobStore | null = null;
  if (environment === "production" || environment === "preview") {
    const settings = s3Settings(env);
    if (settings) store = (await import("./s3")).s3Store(settings);
  } else {
    store = localDiskStore();
  }
  cached = { store };
  return store;
}

/** The store an existing file was written to, or null if it isn't available here. */
export async function blobStoreFor(
  providerId: string,
): Promise<BlobStore | null> {
  const store = await blobStore();
  return store?.providerId === providerId ? store : null;
}
