# Module Boundary Specification

- **Rule:** a module owns its tables. Other modules read them through the owner's public service API (`src/modules/<m>/index.ts`), or react to its domain events. Direct cross-module Prisma access is forbidden. This is enforced by an ESLint import restriction and by code review.
- **Module switch (AR-REQ-02):** every module's API and UI entry points call `requireModule(ctx, "<key>")`, which reads `module_configuration`. A disabled module's routes return 404. Its jobs no-op for that tenant.

## Ownership

| Module / service | Owns | Public API (examples) | Emits events | Consumes events |
|---|---|---|---|---|
| **platform/tenancy** | tenant, tenant_membership, tenant_setting, module_configuration | `resolveContext`, `switchTenant`, `getSetting`, `requireModule` | `tenant.created`, `tenant.suspended` | — |
| **platform/permissions** | role, role_permission, role_assignment, permission | `require(ctx, perm, scope)`, `listRoles`, `assignRole` | `membership.roles_changed` | — |
| **platform/documents** | document | `createUpload`, `getDownloadUrl`, `markScanResult` | `document.clean`, `document.quarantined`, `document.expiring` | — |
| **platform/audit** | audit_event, platform_audit_event | `record(ctx, event)`, `search` | — | — |
| **platform/notifications** | notification, notification_preference | `notify(ctx, recipient, template, refs)` | — | Many (subscribes per template) |
| **platform/outbox** | outbox_event, processed_event | `emit(tx, event)` | — | — |
| **administration** | site, team, team_member, employee (core record) | `createEmployee`, `getEmployee`, `listSites` | `employee.created`, `employee.left` | `recruitment.candidate.hired` |
| **recruitment** | vacancy, application, interview, offer, candidate | `publishVacancy`, `apply`, `hire` | `recruitment.candidate.hired` | `document.clean` |
| **onboarding** | onboarding_case, checklist_item, rtw_check | `startOnboarding`, `recordRtwCheck`, `isClearedToWork` | `onboarding.cleared`, `onboarding.rtw_expiring` | `employee.created` |
| **training** | training_requirement, training_assignment, training_record | `assign`, `complete`, `eligibility(employee, shift)` | `training.expired`, `training.expiring` | `onboarding.cleared` / `employee.created` |
| **rota** | rota, shift, shift_assignment, availability, swap_request | `publishRota`, `assign`, `myShifts` | `rota.published`, `rota.shift_changed` | `training.expired` (flag only), `employee.left` |
| **attendance** | clock_event, timesheet | `clockIn`, `clockOut`, `approveTimesheet` | `attendance.timesheet_approved` | `rota.published` (planned hours) |
| **payroll** *(later)* | pay_* tables | — | — | `attendance.timesheet_approved` (approved only, PAY) |

## TH-DEV-04 §2 hand-offs, mapped

| Hand-off | Mechanism |
|---|---|
| Recruitment → Onboarding | `recruitment.hire()` calls `administration.createEmployee()` in the same transaction (one user action, so it must be atomic), then emits `recruitment.candidate.hired`. Onboarding consumes `employee.created`. |
| Onboarding → Rota | Rota calls `onboarding.isClearedToWork(employeeId)` when assigning a shift. Uncleared workers can't be assigned (or a warning is shown, per a tenant setting to be confirmed). |
| Onboarding → Training | `onboarding.cleared` triggers the required training assignments. |
| Training → Rota | `training.eligibility()` is consulted at assignment. `training.expired` flags affected future shifts. |
| Rota → Attendance | Attendance reads planned shifts through `rota.plannedShifts(range)` for the planned-vs-actual view. |
| Attendance → Payroll | Only `timesheet.status = approved` crosses, as an immutable snapshot (later release). |

## Synchronous vs asynchronous

- **Synchronous** (a service call in the same transaction) when the user expects an immediate, consistent result, for example hiring creating an employee.
- **Asynchronous** (outbox event) for side effects that can retry independently: notifications, assignments derived from another module, reminders.
