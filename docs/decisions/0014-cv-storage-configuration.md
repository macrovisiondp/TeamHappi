# ADR-0014: How production finds its CV storage

**Status:** Accepted by the product owner on 29 October 2026, with M9.2b. It narrows ADR-0012 for document storage. ADR-0012 is unchanged for every other provider.

## Context

- **ADR-0012 / M5.3 design:** a live provider becomes active through Platform Admin. The owner approves it (`APPROVED_LIVE_PROVIDERS`), its keys are set, its settings are saved and tested, and then it is "made active".
- **The problem for storage:** those settings tables are readable only by the platform role, so ordinary request code (the app role, inside an organisation) can't look them up. Copying them to the app role would widen its access.
- **Where things stand:** the product owner has already created the bucket and set `STORAGE_S3_BUCKET`, `STORAGE_S3_REGION`, `STORAGE_S3_ACCESS_KEY_ID` and `STORAGE_S3_SECRET_ACCESS_KEY` in Vercel (Production only).

## Decision

- **Where the settings come from:** the deployment's own environment.
  - S3 is used in production only when `APPROVED_LIVE_PROVIDERS` lists `aws-s3` **and** all four `STORAGE_S3_*` variables are set.
  - Otherwise uploads are switched off and the page says so.
- **Development and tests** use a local folder (`.data/blob-store/`), refused in production.
- **The owner's approval** is still a deliberate step: adding `aws-s3` to `APPROVED_LIVE_PROVIDERS`.
- **Platform Admin** keeps showing whether the S3 keys are set, under the new names.
- **Each stored file records its store**, so changing store later never strands old files.

## Consequences

- **Switching S3 on or off** means changing a Vercel variable and redeploying, not clicking in Platform Admin.
- **The keys are still Vercel secrets.** They are never in the database or the repository.
- **Recording past settings:** Platform Admin's integration history won't show S3 settings changes. Vercel's own history does.
- **If a later milestone needs per-organisation storage,** it should add a narrow, read-only lookup for the app role and supersede this ADR.
