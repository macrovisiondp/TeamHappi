# Free-Tier Development Strategy and Limits

- **Decision (product owner, 8 Oct 2026):** develop on free tiers. No paid subscriptions. The product owner creates all accounts. Credentials are requested only when a milestone needs them, and they never go in Git or the docs.
- **Caveat:** the limits below are as understood in October 2026. **Free-tier terms change often.** Check each provider's current pricing and terms page before relying on a number. Nothing here is legal advice on licence terms.

## Services in use

| Service | Free plan | Relevant limits (verify) | Commercial-use position | Effect on TeamHappi |
|---|---|---|---|---|
| **Vercel** | Hobby | Personal accounts only; one function region; lower function duration and usage caps; **cron jobs limited to once a day**; short runtime-log retention; private repos owned by a **GitHub organisation** can't be deployed on Hobby | ⚠️ **Hobby is restricted to personal, non-commercial use** under Vercel's terms. Building a commercial SaaS on it is at best a grey area. | **Material risk R-1.** Fine for early private development. **Move to Pro (or another host) before any client, pilot or commercial use**, and confirm now whether Vercel considers pre-revenue development of a business product "commercial". Set the function region to `lhr1` explicitly. |
| **Neon** | Free | Small storage per project (about 0.5 GB); monthly compute-hour allowance; scale-to-zero (cold start of about 0.5–1 s); limited branches; **short point-in-time restore window**; London region (`aws-eu-west-2`) available | No commercial restriction identified (verify) | Fine for development and synthetic data. **Not suitable for production data:** the restore window can't meet DR-01, and storage is too small. |
| **GitHub** | Free, private repo | Actions ≈ 2,000 Linux minutes a month; **branch protection and rulesets are not available on private repos on Free**; secret-scanning push protection for private repos is a paid add-on; Dependabot alerts and updates are free | Allowed | **Material risk R-2:** required CI checks can't be *enforced* on `main`. Mitigation: never merge a PR with failing CI (a process rule), plus gitleaks in CI. GitHub Pro or Team (low monthly cost) adds enforcement. Upgrade when a second developer joins, or before production. |

## Services not approved, and the free-tier substitutes

| Need | Planned paid service | Free-tier substitute now | Requirement gap |
|---|---|---|---|
| Background jobs (JOB-01) | Inngest | **Transactional outbox in Postgres.** Dispatch uses Next.js `after()` once the request completes, with a **daily** Vercel Cron sweep (the Hobby limit). | Retries are slower and per-tenant concurrency isn't enforced. Fine at development scale. Same outbox design, so it can switch to Inngest later without changes. |
| Rate limiting | Upstash/Redis | Postgres-backed counters (Better Auth supports database rate-limit storage) | Adds DB load at scale. Acceptable for now. |
| Email (sign-in codes, invites, notifications) | Amazon SES | **Dev mailer that writes to the server log.** No real email is sent. | **A real email provider is needed before anyone other than developers signs in (M3 end).** Free tiers exist (e.g. Resend, Brevo, SES within free usage), but **each needs your approval** and a check of where it stores data. |
| Document storage + malware scan (DOC-01..05) | S3 + GuardDuty (London) | **Development-only local filesystem adapter**, synthetic files only, behind the same `storage` interface | ❌ **DOC-02 (malware scanning) can't be met for free.** No real CVs or identity documents may be uploaded until a compliant store is approved (R-3). |
| Error monitoring (OBS-01) | Sentry EU | Structured JSON logs (pino) to Vercel runtime logs | ❌ Log retention on Hobby is short, so logs aren't centralised or searchable. It must be resolved before production. |
| Infrastructure as code (DR-02) | Terraform | Deferred. Environments are documented by hand. | Required before production. |

## Rule

**Free-tier environments hold synthetic data only.** No real employee, candidate or identity data goes into any environment until the product owner approves the gaps above (R-1, R-3, backups, monitoring) as closed.
