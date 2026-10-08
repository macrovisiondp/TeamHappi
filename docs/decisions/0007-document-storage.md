# ADR-0007: Secure document storage

- **Status:** Proposed. **AWS NOT approved.** Development uses a local-filesystem adapter with synthetic files only. **No real documents may be stored until a compliant store is approved (risk R-3).**
- **Date:** 2026-10-08
- **Requirements:** DOC-01..06, MT-04, AUD-01

## Decision

### Storage set-up

- Private S3 buckets in `eu-west-2`:
  - Block Public Access on at both account and bucket level
  - SSE-KMS encryption and TLS-only bucket policy
  - Versioning on
- Object key: `tenants/{tenantId}/documents/{documentId}/{versionId}`. The original filename is never part of the key.

### Upload flow

1. The client asks to upload. The server checks permission and validates the declared type and size against an allow-list (DOC-03).
2. The server creates a `Document` row with `status = pending_scan`.
3. The server returns a short-lived **presigned PUT URL**. It has a content-length condition and expires in about 5 minutes.
4. The client uploads directly to S3.
5. GuardDuty Malware Protection scans the object (DOC-02). The result arrives through EventBridge, then a webhook to our API, which verifies the signature.
6. A worker double-checks the file type by its actual contents (magic bytes), not the claimed extension, then marks the document `clean` or `quarantined`.
7. Until it is `clean`, the document cannot be downloaded by anyone except the uploader's own "processing" view.

### Download flow

- The server checks the tenant, permission and status.
- It issues a presigned GET URL that expires in about 60 seconds, with `Content-Disposition: attachment`.
- Viewing an identity or right-to-work document writes an audit event (DOC-05).

### Metadata and retention

- `Document` holds the type, owner, retention class, expiry date and the hash of the clean version (DOC-06).
- Expiry reminders are background jobs.
- Retention deletions are scheduled jobs that delete the object, keep a tombstone row, and write an audit event.

## Alternatives considered

- **Serving files through our API (proxy).** Simpler access control, but every byte would pass through the serverless function, with size and time limits. Presigned URLs with short expiry give the same control.
- **Client-side scanning or ClamAV in a function.** It cannot be trusted (client) or does not fit (signature updates, function size and time limits).

## Consequences

- An AWS account is needed. Its credentials use a least-privilege IAM role per environment.
- Retention periods for each document class await TH-DEV-06 and legal advice. Until then, nothing is auto-deleted.
