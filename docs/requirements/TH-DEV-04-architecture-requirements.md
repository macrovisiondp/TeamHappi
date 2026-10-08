<!-- Text extract of TH-DEV-04_Architecture_and_Multi-Tenancy_Requirements.docx. The .docx in source/ is authoritative. -->

# TeamHappi – Architecture and Multi-Tenancy Requirements

| Field | Value |
|---|---|
| Document | TH-DEV-04 Architecture and Multi-Tenancy Requirements |
| Version | 0.1 – Draft for review |
| Date | 6 October 2026 |
| Owner | Macrovision Digital Solution (product owner) |
| Related | TH-DEV-03, TH-DEV-05, TH-DEV-06, TH-DEV-07, TH-DEV-08 |

## 1. Purpose

This document states what the TeamHappi architecture must achieve. It does not choose the technology. The development team proposes the design and stack in TH-DEV-05, and records decisions as architecture decision records (ADRs).

Requirements marked MUST are mandatory. Items marked SHOULD are strong recommendations that need a recorded reason if not followed.

## 2. Logical structure

TeamHappi has one shared platform and seven capability modules. Modules exchange data through defined interfaces and events, not by reading each other's tables directly.

Key data hand-offs between modules:

| From | To | What passes |
|---|---|---|
| Recruitment | Onboarding | Hired candidate becomes a new starter (TH-DEV-06, section 4) |
| Onboarding | Rota | Worker is marked cleared to work only when required onboarding steps are complete |
| Onboarding | Training | New starter receives required training assignments |
| Training | Rota | Expired mandatory training can be flagged when scheduling |
| Rota | Time and attendance | Planned shifts are compared with time worked |
| Time and attendance | Payroll | Only approved hours and leave enter a pay run |
| Payroll | Worker | Finalised payslip becomes visible to the worker |

## 3. Architecture principles

| ID | Requirement | Level |
|---|---|---|
| AR-REQ-01 | One codebase and one product for all clients; client differences handled through configuration, not custom code | MUST |
| AR-REQ-02 | Modules have clear boundaries and can be switched on or off per tenant | MUST |
| AR-REQ-03 | Shared platform services (tenancy, identity, permissions, people, sites, documents, audit, notifications) are built once and used by all modules | MUST |
| AR-REQ-04 | All server functions are available through a versioned API used by the web and mobile clients | MUST |
| AR-REQ-05 | Design for many tenants from day one, including tenants with many sites | MUST |
| AR-REQ-06 | Prefer managed cloud services over self-managed infrastructure where they meet security and residency needs | SHOULD |
| AR-REQ-07 | Start as a modular monolith unless the team gives a recorded reason for separate services | SHOULD |

## 4. Multi-tenancy requirements

| ID | Requirement | Level |
|---|---|---|
| MT-01 | Every record holding client data carries a tenant identifier | MUST |
| MT-02 | Tenant context is set on the server from the authenticated session, never from a value the client can change | MUST |
| MT-03 | Tenant filtering is enforced in a central layer (for example database row-level security or a mandatory data-access layer), not left to each query | MUST |
| MT-04 | Files, caches, search indexes, background jobs, logs, exports and reports are all tenant-scoped | MUST |
| MT-05 | A user who works for two client businesses has a separate membership per tenant and sees only the data of the tenant they are working in | MUST |
| MT-06 | Tenant creation, configuration and suspension are automated and audited | MUST |
| MT-07 | A tenant's data can be exported in full and deleted in full at the end of a contract | MUST |
| MT-08 | One tenant's heavy usage must not degrade service for others (rate limits, queue fairness) | MUST |
| MT-09 | The design allows a large client to be moved to dedicated resources later without rewriting the application | SHOULD |

Tenancy model options (developers to recommend one in TH-DEV-05)

| Model | Isolation | Operational effort | Points to assess |
|---|---|---|---|
| Shared database, shared schema, row-level security | Logical | Lowest | Strength of central enforcement, risk of a missed filter, noisy neighbours |
| Shared database, schema per tenant | Stronger logical | Medium | Migrations across many schemas, connection management |
| Database per tenant | Strongest | Highest | Cost per tenant, provisioning, cross-tenant platform reporting |

## 5. Identity and access

| ID | Requirement | Level |
|---|---|---|
| IA-01 | Authentication meets TH-DEV-07, section 3 (multi-factor authentication for privileged roles) | MUST |
| IA-02 | Authorisation follows the role, scope and tenant model in TH-DEV-03 | MUST |
| IA-03 | Candidates register with a separate, lighter account type that cannot reach employee functions | MUST |
| IA-04 | Workers without a work email can sign in (for example by mobile number or personal email) | MUST |
| IA-05 | Single sign-on for client administrators (Google, Microsoft) is supported by the design, even if built later | SHOULD |
| IA-06 | Permissions are cached safely and invalidated immediately when roles change | MUST |

## 6. Documents and files

| ID | Requirement | Level |
|---|---|---|
| DOC-01 | Files stored in encrypted object storage, separated by tenant | MUST |
| DOC-02 | Every upload is malware-scanned before anyone else can open it | MUST |
| DOC-03 | File type and size limits are enforced on the server | MUST |
| DOC-04 | Files are served only through short-lived, permission-checked links | MUST |
| DOC-05 | Every view and download of identity, right-to-work and payroll documents is audited | MUST |
| DOC-06 | Documents carry a type, owner, expiry date (where relevant) and retention rule | MUST |

## 7. Audit history

| ID | Requirement | Level |
|---|---|---|
| AUD-01 | Record who did what, to which record, when, from where, and the before and after values for sensitive fields | MUST |
| AUD-02 | Audit records cannot be edited or deleted by any application user | MUST |
| AUD-03 | Audit history is tenant-scoped and searchable by authorised client administrators | MUST |
| AUD-04 | Macrovision support access is recorded and visible to the client | MUST |

## 8. Notifications and background processing

| ID | Requirement | Level |
|---|---|---|
| NT-01 | A central notification service supports email, SMS, push and in-app channels | MUST |
| NT-02 | Users can manage non-essential notification preferences | MUST |
| NT-03 | Notifications never include sensitive data such as pay amounts or document contents | MUST |
| JOB-01 | Scheduled jobs (reminders, expiry checks, leave accruals, pay runs, reports) run per tenant, can be retried safely and are monitored | MUST |

## 9. Payroll engine readiness

Payroll rules are not yet specified. The architecture must still be ready for them.

| ID | Requirement | Level |
|---|---|---|
| PAY-01 | Pay calculations are deterministic: the same inputs and rules always give the same result | MUST |
| PAY-02 | Pay rules are versioned by effective date and tax year, so past pay runs can be reproduced exactly | MUST |
| PAY-03 | Finalised pay runs are locked; corrections are made through recorded adjustments or reversals, never by editing history | MUST |
| PAY-04 | Monetary values use exact decimal types, never floating point | MUST |
| PAY-05 | The design allows statutory submissions to HMRC to be added later. HMRC publishes payroll technical specifications and test data for developers each tax year; requirements for recognition must be confirmed with HMRC and the payroll specialist | MUST |
| PAY-06 | Payroll data and payslips are encrypted and access-restricted as the highest sensitivity tier (TH-DEV-06) | MUST |

## 10. Reporting, observability and recovery

| ID | Requirement | Level |
|---|---|---|
| REP-01 | Reporting respects the same tenant and scope rules as the application | MUST |
| REP-02 | Heavy reports do not slow down day-to-day use (for example by using a read replica or reporting store) | SHOULD |
| OBS-01 | Centralised logging, metrics, tracing and alerting, with tenant identifier on every log line | MUST |
| OBS-02 | Logs never contain passwords, tokens, bank details, identity document numbers or pay amounts | MUST |
| DR-01 | Automated, encrypted backups with regular restore tests; targets in TH-DEV-08 | MUST |
| DR-02 | All infrastructure defined as code so environments can be rebuilt | MUST |

## 11. Hosting and data residency

The UK is the launch country. Hosting provider and region are OPEN and part of the developer proposal. The proposal must state where all personal data, backups and logs are stored, and list every third-party service that receives personal data.

## 12. Client applications

The client approach (responsive web, installable web app, or native mobile apps) is OPEN and part of the developer proposal. Whatever is chosen MUST:

- work well on mid-range and older phones used by shift workers;

- support push notifications for shift changes;

- handle poor connectivity in kitchens and back-of-house areas, including for clocking in (exact offline behaviour to be agreed);

- meet the accessibility level in TH-DEV-08.

## 13. Deliverables required from the development team

| Deliverable | Due |
|---|---|
| Completed TH-DEV-05 proposal | Sprint 0 |
| Solution architecture document with C4 context and container diagrams | Sprint 0 |
| ADRs for tenancy model, stack, hosting, identity, client approach | Sprint 0 |
| Threat model for the shared platform | Sprint 0 |
| API conventions (versioning, errors, pagination) | Before first module build |
