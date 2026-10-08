# Sprint 0 — Requirements Review

| Field | Value |
|---|---|
| Status | Draft for product-owner review |
| Date | 8 October 2026 (updated after product-owner decisions, same day) |
| Inputs | TH-DEV-02 Scope Statement v0.1, TH-DEV-04 Architecture and Multi-Tenancy Requirements v0.1, Master Build Prompt (8 Oct 2026) |

## 1. Source hierarchy

| Subject | Authoritative source |
|---|---|
| Product scope, in/out of scope, constraints | TH-DEV-02 |
| Architecture, tenancy, identity, documents, audit, jobs, payroll readiness, observability, hosting | TH-DEV-04 |
| Release selection (Option A), stack preference, working rules | Master Build Prompt (product-owner instruction) |

Where the master prompt gives a technology *preference* and TH-DEV-04 leaves the choice to the developers, we treat the preference as a strong default. We record it as an ADR with the alternatives considered.

## 2. Confirmed requirements

Confirmed means stated by the product owner in an authoritative source.

- UK-only launch. Multi-tenant SaaS with full data isolation (TH-DEV-02 §2, §5).
- All seven capabilities stay on the roadmap. None may be dropped (TH-DEV-02 §6).
- **Release 1 = Option A.** This covers the shared platform, Recruitment, Onboarding & Compliance, Training, Rota & Scheduling, basic Time & Attendance, essential administration, and the worker self-service needed for those (master prompt Part 3).
- Payroll rules are specified and validated by qualified specialists before build. No payroll calculation is built in Sprint 0 (TH-DEV-02 §6, TH-DEV-04 §9).
- TeamHappi records the employer's right-to-work check. It never makes the legal decision (TH-DEV-02 §2, §3).
- Every TH-DEV-04 MUST item: AR-REQ-01..05, MT-01..08, IA-01..04, IA-06, DOC-01..06, AUD-01..04, NT-01..03, JOB-01, PAY-01..06, REP-01, OBS-01..02, DR-01..02.
- TH-DEV-04 SHOULD items: AR-REQ-06/07, MT-09, IA-05, REP-02. If we do not follow one, we must record the reason.
- Device assumptions: workers mainly use phones, managers use phones and computers, admin staff use computers (TH-DEV-02 §5).

## 3. Conflicts and items needing a document update

| # | Issue | Proposed resolution |
|---|---|---|
| C-1 | TH-DEV-02 §4 still says the Release 1 content is **OPEN**. The master prompt says Option A was selected. | ✅ **Resolved:** Option A confirmed. Recorded as [CR-001](TH-DEV-11-change-log.md#cr-001) and [TH-DEV-02 rev 0.2](TH-DEV-02-revision-0.2.md); the original is preserved. |
| C-2 | Option A defers "advanced holiday and leave". TH-DEV-02 Capability 5 lists holiday requests, leave balances and absence records together. | ✅ **Resolved:** holiday requests and leave balances are deferred to Release 2 (CR-001). |
| C-3 | NT-01 requires email, SMS, push and in-app channels. TH-DEV-02 says channels are "to be confirmed". | Build the notification service to support all four channels. Release 1 delivers in-app and email; push and SMS follow once providers and costs are approved. *Still open. Email needs an approved provider (see free-tier limits).* |

## 4. Referenced documents that are not available

**Confirmed by the product owner (8 Oct 2026): these are referenced names only. The documents do not exist.** We have not invented their contents. The developers proposed minimum interim specifications in [interim-specifications.md](interim-specifications.md), for review before the affected milestones. Where a design depends on one, it is marked as a provisional assumption.

| Document | Referenced by | What depends on it | Blocking? |
|---|---|---|---|
| TH-DEV-01 | TH-DEV-02 | Probably the project brief or vision | No |
| **TH-DEV-03** | TH-DEV-04 IA-02 | The role, scope and tenant permission model | **Yes, for Milestone 3** (authorisation). Milestone 2 can use a provisional role list. |
| TH-DEV-05 | TH-DEV-04 | The developer proposal. **Sprint 0 produces this** (see [solution architecture](../architecture/solution-architecture.md)). | — |
| **TH-DEV-06** | TH-DEV-04 §2, PAY-06 | Data classification tiers and the candidate-to-employee handoff (section 4) | **Yes, for Milestone 4** (document retention) and the Recruitment module |
| **TH-DEV-07** | TH-DEV-04 IA-01 | Security requirements, including MFA rules (section 3) | **Yes, for Milestone 3** |
| **TH-DEV-08** | TH-DEV-04 DR-01, §12 | Non-functional targets: RPO/RTO, accessibility level, performance | Before production. Provisional: WCAG 2.2 AA, RPO ≤ 1 h, RTO ≤ 4 h. |
| TH-DEV-11 | TH-DEV-02 §7 | The change log | No |
| Master project context | Master prompt | Supporting guidance | No |

## 5. Assumptions made in Sprint 0 (to confirm)

| # | Assumption |
|---|---|
| A-1 | A person can belong to several tenants. Each membership has its own roles (MT-05). |
| A-2 | Some employees will never have a login (for example, staff who are only on the rota). An Employee record does not require a User. |
| A-3 | Candidates use the same identity system as staff. A candidate account has **no tenant membership**, so it cannot reach employee functions (IA-03). |
| A-4 | Privileged roles (platform admin, tenant admin, HR, payroll) need app-based MFA (TOTP or passkey). Workers and candidates do not need MFA in Release 1. Proposed in interim spec IS-07. |
| A-5 | Tenants are UK businesses, and all personal data is stored in UK or EU regions (see the hosting ADR). |
| A-6 | Release 1 offline support is limited to clock-in/clock-out queued on the device. Other screens need connectivity. Exact rules to be agreed (TH-DEV-04 §12). |
| A-7 | Default branding is TeamHappi, with a per-tenant logo and colour accent. Custom domains are out of scope for Release 1. |

## 6. Product-owner decisions

Recorded in [sprint-0-report.md](../development/sprint-0-report.md#product-owner-decisions-8-october-2026).
