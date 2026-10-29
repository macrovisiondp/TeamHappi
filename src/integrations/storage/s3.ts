import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { IntegrationError } from "../core/types";
import { assertKey, type BlobStore, type S3Settings } from "./blob";

// Amazon S3 store (M9.2b). The ONLY file in src/ that talks to AWS
// (tests/unit/platform-access.test.ts checks this).
//
// The bucket is private (Block Public Access on); the IAM user may only put,
// get and delete objects in it. Objects are encrypted at rest with S3-managed
// keys (SSE-S3, no KMS: the product owner's decision). Errors never include
// the key, bucket or credentials.

export function s3Store(settings: S3Settings): BlobStore {
  const client = new S3Client({
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  const Bucket = settings.bucket;
  const fail = (what: string) => () => {
    throw new IntegrationError(`Storage ${what} failed`, true);
  };
  return {
    providerId: "aws-s3",
    async put(key, body, contentType) {
      assertKey(key);
      await client
        .send(
          new PutObjectCommand({
            Bucket,
            Key: key,
            Body: body,
            ContentType: contentType,
            ServerSideEncryption: "AES256",
            // Never overwrite an existing object (keys are random; this is a guard).
            IfNoneMatch: "*",
          }),
        )
        .catch(fail("upload"));
    },
    async get(key) {
      assertKey(key);
      const res = await client
        .send(new GetObjectCommand({ Bucket, Key: key }))
        .catch((e: unknown) => {
          if ((e as { name?: string }).name === "NoSuchKey")
            throw new IntegrationError("Object not found", false);
          return fail("download")();
        });
      if (!res.Body) throw new IntegrationError("Object not found", false);
      return res.Body.transformToByteArray();
    },
    async remove(key) {
      assertKey(key);
      await client
        .send(new DeleteObjectCommand({ Bucket, Key: key }))
        .catch(fail("delete"));
    },
  };
}
