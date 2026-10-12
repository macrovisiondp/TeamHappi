# ADR-0003: Hosting, environments and data residency

- **Status:** Vercel + Neon direction provisionally approved (2026-10-08). **Paid components (Vercel Pro, paid Neon, AWS, Sentry) NOT approved.** Development runs on free tiers per CR-003 and [free-tier-limits](../architecture/free-tier-limits.md).
- **Date:** 2026-10-08
- **Requirements:** AR-REQ-06, TH-DEV-04 §11, OBS-01/02, DR-01/02, DOC-01

## Decision

Managed services in **UK (London) regions** wherever the provider offers them.

| Purpose | Provider | Region | Personal data? |
|---|---|---|---|
| App hosting / serverless functions | Vercel (Pro) | Functions pinned to `lhr1` (London) | Yes, in transit and in request logs |
| PostgreSQL | Neon | `aws-eu-west-2` (London) | Yes, primary store |
| Private document storage | AWS S3 (SSE-KMS, Block Public Access on) | `eu-west-2` (London) | Yes: CVs, ID, right-to-work documents |
| Malware scanning | Amazon GuardDuty Malware Protection for S3 | `eu-west-2` | Scans file content; no copy retained |
| Transactional email | Amazon SES | `eu-west-2` | Recipient address, message body |
| Background jobs | Inngest (see ADR-0006) | Provider-hosted orchestration | **IDs only.** Payloads contain no personal data. |
| Error monitoring | Sentry, EU data region | EU (Germany) | Scrubbed. No request bodies; user ID only. |
| Push / SMS | To be chosen when those channels are approved | — | Phone number and message |

**Before production**, every provider above goes into a data-processing register. The register records the location of data, backups and logs, the DPA, and the UK international data transfer mechanism (IDTA or UK Addendum) where data leaves the UK. Vercel's platform log retention and location must be verified. **This needs a qualified adviser's confirmation. This ADR is not a compliance statement.**

## Environments

> **Current (free tier, CR-003):** a single Neon Free project, **`teamhappi-dev`** in `aws-eu-west-2`. It has a `main` branch for shared development and child branches for previews. Vercel Hobby runs previews and a development deployment only. **Synthetic data only.** The staging and production rows below are the target layout once upgrades are approved.


| Environment | Hosting | Database | Storage | Data |
|---|---|---|---|---|
| Local | `next dev` | Neon dev branch, or local Postgres 18 (Docker Desktop recommended, not currently installed) | Local S3-compatible stub or dev bucket | Synthetic seed only |
| Preview (per PR) | Vercel preview | Neon **branch of the staging project**, created per PR | Staging bucket, `preview/{branch}/` prefix | Synthetic only |
| Staging | Vercel `staging` environment | Separate Neon **staging project** | Staging bucket | Synthetic only |
| Production | Vercel production | Separate Neon **production project** | Separate prod bucket, ideally in a separate AWS account | Real |

- Production credentials exist **only** in Vercel's Production environment scope. Previews can never reach production data, because they hold no credentials for it.
- Database roles per environment: `migrator` (DDL, used only by the CI migration job) and `teamhappi_app` (DML, NOBYPASSRLS).
- **Infrastructure as code (DR-02):** Terraform for AWS, Neon and Vercel, introduced in Milestone 4, before any production resource is created.
- **Backups (DR-01):** Neon point-in-time restore. Window to be set to meet the TH-DEV-08 RPO; provisional 7 days on staging and ≥ 14 days on production. S3 versioning plus Object Lock for documents is to be evaluated. A **restore test** is done before launch and then quarterly.

## Alternatives considered

- **Cloudflare R2 or Vercel Blob for documents.** No London-specific region and no built-in malware scanning. S3 plus GuardDuty meets DOC-01/02 in one place.
- **Supabase (DB + storage + auth).** Viable, but it duplicates the Neon and Vercel preference and couples three concerns to one vendor.
- **Self-hosted (VMs/Kubernetes).** Against AR-REQ-06 and the team's size.

## Consequences

- Adds an AWS account. One account each for production and non-production is recommended.
- Neon free and launch tiers are fine for development. Production needs a paid plan for PITR and compute sizing.
