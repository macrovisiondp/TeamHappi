# Sprint 0 Report — Architecture and Engineering Setup

## Milestone

**Sprint 0.** Inspect the repository, review the requirements, and produce the architecture package for product-owner review before any application code is written.

## Repository inspection (Step 1)

| Item | Finding |
|---|---|
| Remote | `https://github.com/macrovisiondp/TeamHappi.git` |
| Commits / branches | **None.** The GitHub repository is empty. Local branch `main` has no commits yet. |
| Files, package config, dependencies, framework config, env config, docs | None existed before Sprint 0 |
| Requirement docs | Provided separately (Downloads folder). Copied to `docs/requirements/source/`, with Markdown extracts alongside. |
| Local toolchain | Node 22.17.0, npm 10.9.2, Git, Python 3.13. **Docker is not installed.** |

**Missing** (everything is to be built): application, configuration, CI, tests, environment template, and the TH-DEV-01/03/06/07/08/11 documents.

## Implemented

Documentation only. No application code, packages or services were added.

## Files Changed (all new)

```
CLAUDE.md
README.md
.gitignore
docs/requirements/source/TH-DEV-02_Scope_Statement.docx
docs/requirements/source/TH-DEV-04_Architecture_and_Multi-Tenancy_Requirements.docx
docs/requirements/TH-DEV-02-scope-statement.md            (text extract)
docs/requirements/TH-DEV-04-architecture-requirements.md  (text extract)
docs/requirements/requirements-review.md
docs/architecture/solution-architecture.md   (TH-DEV-05 proposal, C4 L1 + L2)
docs/architecture/data-model.md
docs/architecture/module-boundaries.md
docs/architecture/cost-assumptions.md
docs/decisions/README.md, 0001..0007
docs/security/threat-model.md
docs/security/security-testing-strategy.md
docs/development/api-conventions.md
docs/development/deployment-strategy.md
docs/development/backlog.md
docs/development/sprint-0-report.md
```

## Database Changes

None. The proposed model is in [data-model.md](../architecture/data-model.md).

## Security Review

The design uses two-layer tenant isolation (data-access layer + RLS) with composite FKs, and fails closed. Authorisation is owned by TeamHappi. Privileged MFA is provisional. Documents are private with malware scanning. Audit is append-only. See the [threat model](../security/threat-model.md).

## Tests

None run. There is no code yet.

## Deployment

None. No cloud resources have been created.

## Decisions originally requested

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Approve the architecture package (ADRs 0001–0007) | Approve, or comment on specific ADRs |
| D-2 | Confirm the Release 1 attendance scope: holiday requests and leave balances deferred? (review C-2) | Defer holidays and leave to Release 2 |
| D-3 | Approve paid services for development: **Vercel Pro, Neon, AWS (S3/KMS/GuardDuty/SES), Inngest (free tier first), Sentry (free tier)**. Estimated £30–£80/month in development. | Approve. Needed by M2 (Neon) and M4 (AWS, Inngest). |
| D-4 | SMS provider for phone sign-in and SMS notifications (variable cost) | Defer. Release 1 starts with email or personal-email sign-in. Choose a provider before the worker pilot. |
| D-5 | Provide **TH-DEV-03** (roles/permissions), **TH-DEV-06** (data classification and retention), **TH-DEV-07** (security/MFA), **TH-DEV-08** (NFRs: RPO/RTO, accessibility) | Needed before M3/M4 sign-off. Provisional assumptions are used until then. |
| D-6 | Local database: install **Docker Desktop** (local Postgres, offline, free), or use a Neon dev branch | Docker Desktop. CI uses a Postgres container regardless. |
| D-7 | Git workflow: commit this package on a branch and open a PR? Enable branch protection on `main`? | Yes. Branch `docs/sprint-0-architecture`, then PR into `main`. |
| D-8 | Who is the second approver for destructive production operations, such as tenant purge? | Name a second Macrovision person |

## Outstanding Issues

- TH-DEV-02 §4 needs updating to record Option A (review C-1).
- Data residency and DPA/IDTA confirmation per provider needs a qualified adviser.
- PWA limits on iOS for push are accepted as a risk (ADR-0005).

## Next Step

After D-1 approval: **Foundation Milestone 1.** Scaffold Next.js with pinned versions, linting, formatting, Vitest and Playwright, env validation, the app shell and GitHub Actions. Then report against the M1 acceptance criteria.

Then **M2: PostgreSQL and tenant model.** This needs D-3 (Neon account) and D-6 (local DB).

---

## Product-owner decisions (8 October 2026)

| # | Decision |
|---|---|
| D-1 | Architecture **direction provisionally approved**: Next.js/TS modular monolith, Neon PostgreSQL, Prisma, shared DB with app-layer enforcement plus RLS, Better Auth (subject to validation), responsive web/PWA, Vercel. ADR details stay open for final review. |
| D-2 | Option A confirmed. Holidays and leave balances go to Release 2. Payroll stays in the architecture but is not built ([CR-001](../requirements/TH-DEV-11-change-log.md#cr-001), [TH-DEV-02 rev 0.2](../requirements/TH-DEV-02-revision-0.2.md)). |
| D-3 | **Free tier first** (CR-003). No paid services are approved. The product owner creates accounts and supplies credentials when a milestone needs them. |
| D-4 | Workers sign in with a personal email. SMS is deferred (CR-002). |
| D-5 | TH-DEV-03/06/07/08 do not exist. The developers propose [interim specifications](../requirements/interim-specifications.md) for review. |
| D-6 | No Docker. The product owner creates a Neon account and supplies the connection details for M2. |
| D-7 | Commit Sprint 0 docs to `docs/sprint-0-architecture` and prepare a PR. No force-push, no branch deletion, no merge without review. |
| D-8 | No destructive production operations. The second approver will be set up before production onboarding. |

## Material unresolved risks

| ID | Risk | Status / mitigation | Must close before |
|---|---|---|---|
| R-1 | Vercel Hobby is limited to **personal, non-commercial use**. TeamHappi is a commercial product. | Use Hobby only for private development with synthetic data. Product owner to confirm with Vercel's terms, or upgrade or choose another host. | Any client, pilot or commercial use |
| R-2 | GitHub Free can't enforce branch protection or required checks on private repos | Process rule: no merge while CI is red; no direct pushes to `main` | A second contributor joins, or production |
| R-3 | No approved storage that meets DOC-01/02 (private UK storage + malware scanning) | Dev-only local adapter, synthetic files only | Any real document upload |
| R-4 | No approved email provider, so sign-in codes and invites can't reach real users | Log-only dev mailer | End of M3 (first non-developer sign-in) |
| R-5 | Free-tier backups and logs can't meet DR-01 / OBS-01 | Synthetic data only | Any real data |
| R-6 | Security, roles, classification and NFR rules exist only as developer-proposed [interim specs](../requirements/interim-specifications.md) | Product-owner review | M3 (IS-03, IS-07), M4 (IS-06, IS-08) |
| R-7 | Better Auth approval is conditional | Validate in M3 with auth security tests, a session/MFA review and a dependency review | M3 sign-off |
| R-8 | Data residency and transfer mechanisms for each provider are unconfirmed (legal) | Data-processing register plus a qualified adviser | Any real data |
