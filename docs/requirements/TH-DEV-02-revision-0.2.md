# TH-DEV-02 Scope Statement — Revision 0.2 (Release Decision)

| Field | Value |
|---|---|
| Document | TH-DEV-02 Scope Statement |
| Revision | 0.2. This **amends** v0.1. It does not replace it. |
| Date | 8 October 2026 |
| Approved by | Macrovision Digital Solution (product owner), Sprint 0 decisions of 8 Oct 2026 |
| Change record | [TH-DEV-11 CR-001](TH-DEV-11-change-log.md#cr-001) |
| Original preserved | [source/TH-DEV-02_Scope_Statement.docx](source/TH-DEV-02_Scope_Statement.docx) (v0.1, unchanged) and its [text extract](TH-DEV-02-scope-statement.md) |

Only the sections listed here change. Every other part of v0.1 stays in force unchanged.

## Amended §4 — Release planning

v0.1 marked the Release 1 content as **OPEN**. It is now **DECIDED: Option A — focused first commercial release.**

| Release | Capabilities | Status |
|---|---|---|
| Foundation | Shared platform: tenants and isolation, sites/teams, accounts and role/site permissions, people records, secure documents, audit, notifications, configuration and module activation, Macrovision admin/support console | **Approved — in progress** |
| Release 1 (first commercial) | Capability 1 Recruitment · Capability 2 Onboarding & compliance · Capability 3 Training · Capability 4 Rota, scheduling & shifts · Capability 5 **basic** time & attendance (see below) · essential Capability 7 administration · the worker self-service these need | **Approved** |
| Release 2 (provisional) | Capability 5 holiday requests, approval/decline, leave balances, absence records | Deferred, not dropped |
| Later releases | Capability 6 Payroll & payslips (after specialist validation of rules) · remaining Capability 7 items (appraisals, advanced reporting) | Deferred, not dropped. Architecture must stay ready (TH-DEV-04 §9). |

### Release 1 boundary for Capability 5 (basic time & attendance)

| In Release 1 | Deferred to Release 2 |
|---|---|
| Clock-in / clock-out | Holiday requests, approval and decline |
| Timesheet records | Leave balances and accrual |
| Planned-vs-actual hours (against the published rota) | Absence records |
| Manager review and approval of timesheets | |

## Amended §4 bullet "No module is dropped or deferred indefinitely"

This is unchanged and reaffirmed. Every deferred capability above has a planned release.

## Added note on worker sign-in (relates to TH-DEV-04 IA-04)

For Release 1 development, workers sign in with a **personal email address**. Mobile-number (SMS) sign-in is deferred until its operating requirements and costs are evaluated. Authentication must allow more sign-in methods to be added later without redesign.
