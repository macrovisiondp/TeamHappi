<!-- Text extract of TH-DEV-02_Scope_Statement.docx. The .docx in source/ is authoritative. -->

# TeamHappi – Scope Statement

| Field | Value |
|---|---|
| Document | TH-DEV-02 Scope Statement |
| Version | 0.1 – Draft for review |
| Date | 6 October 2026 |
| Owner | Macrovision Digital Solution (product owner) |
| Related | TH-DEV-01, TH-DEV-03, TH-DEV-11 |

## 1. Purpose

This document sets the boundary of the TeamHappi product. It lists what is in scope, what is out of scope, and how releases will be planned. Anything not listed as in scope needs product owner approval before it is built.

## 2. Product scope (confirmed)

TeamHappi is a multi-tenant workforce management system for restaurant and hospitality businesses. It covers seven required capabilities, delivered on one shared platform.

Shared platform (required by all capabilities)

- Client workspaces (tenants) with full data isolation

- Sites, locations, teams and organisational structure per client

- User accounts, authentication and role- and site-based permissions

- People records shared by all modules

- Secure document storage

- Audit history

- Notifications (email, SMS, push, in-app – channels to be confirmed)

- Client configuration and settings

- Macrovision super-admin and support console with audited access

Capability 1 – Recruitment

- Vacancy creation, approval and publishing to a job board and careers pages

- Online applications, CV and supporting document upload

- Screening, pipeline stages and shortlisting

- Interview scheduling and interviewer feedback

- Offers, acceptance and rejection

- Conversion of a successful candidate into an employee record

Capability 2 – Onboarding and compliance

- Onboarding task lists and document collection

- Recording of employer-led right-to-work checks, evidence, expiry dates and follow-up actions

- Compliance status visible to managers

In the UK, the employer's right-to-work check must take place before employment begins. TeamHappi supports and records the employer's check. It does not make the legal decision.

Capability 3 – Training

- Assigning required training by role, site or person

- In-system completion where appropriate, and upload of external certificates

- Completion, outstanding, renewal and expiry tracking for managers

Capability 4 – Rota, scheduling and shifts

- Creating, publishing and changing rotas and shifts across sites and teams

- Worker schedule view

- Availability, change requests and shift swaps where enabled

- Notifications of published and changed shifts

Capability 5 – Time, attendance and holidays

- Timesheet submission or time recording

- Manager review and approval

- Holiday requests, approval and decline

- Leave balances and absence records

Capability 6 – Payroll and payslips

- Pay periods and pay runs

- Payroll calculation from approved time and leave data

- Adjustments, approvals, corrections and reversals

- An individual payslip for each worker, viewed securely by that worker

Payroll processing is required in-house. Integrations may supplement it but not replace it. UK calculations, deductions, statutory reporting and pay rules will be specified and validated with qualified payroll and legal specialists before build.

Capability 7 – Management and administration

- Employee records, roles, sites and approval chains

- Appraisals

- Reporting

- Client configuration

- Multi-client onboarding and support by Macrovision

## 3. Out of scope (until approved)

These items are not part of the confirmed scope. They may be proposed and prioritised later.

- Features beyond the seven capabilities (for example EPOS integration, tips management, job board syndication, e-signature)

- Countries other than the UK

- Custom builds for a single client

- Any automated legal decision on a person's right to work

- Any claim of statutory compliance or certification before evidence exists

## 4. Release planning (OPEN)

The product owner has not yet decided which capabilities belong in the first commercial release. Until then:

- Developers plan the shared platform first, because every capability depends on it.

- Module specifications are written as each release is confirmed.

- No module is dropped or deferred indefinitely; each will be assigned to a planned release.

| Release | Capabilities | Status |
|---|---|---|
| Foundation | Shared platform | Recommended to start first |
| Release 1 (first commercial) | To be decided by product owner | OPEN |
| Later releases | Remaining capabilities | OPEN |

## 5. Assumptions

- The launch country is the UK (confirmed).

- Clients range from single-site restaurants to multi-site hospitality groups.

- Workers mainly use phones; managers use phones and computers; payroll and admin staff mainly use computers.

## 6. Constraints

- All seven capabilities must remain in the product roadmap.

- Payroll rules must be specified and validated by qualified specialists before they are built.

- Personal data must be processed in line with UK data protection law (UK GDPR and the Data Protection Act 2018, as amended by the Data (Use and Access) Act 2025). Specific obligations must be confirmed by a qualified adviser.

## 7. Change control

Scope changes are requested in writing, assessed for impact on time, cost and other modules, and approved by the product owner. Approved changes are recorded in TH-DEV-11.
