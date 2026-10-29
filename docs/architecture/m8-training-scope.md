# M8: Training — scope proposal

**Status:** proposal for product-owner review. No code, migration or Neon change has been made.
**Builds on:** M4.2 (sites, employee records, job titles), M6 (memberships, audit trail), M7 (onboarding, "My onboarding", linked employee logins).
**Requirement:** TH-DEV-02 Capability 3, "Training":
- assigning required training by role, site or person;
- in-system completion where appropriate, and upload of external certificates;
- completion, outstanding, renewal and expiry tracking for managers.

TeamHappi **tracks** training. It doesn't provide accredited courses, and it never says training is legally sufficient. Course names, renewal periods and suggestions are the business's own and are clearly labelled "suggested".

---

## 1. Principles

| Principle | What it means here |
|---|---|
| **Requirements are rules, not tasks** | "Bar staff need a personal licence", "everyone needs fire safety". Who needs what is **worked out** from the rules and each person's site and job title, so a new starter or a change of job title is covered automatically. This needs no background job or event system (the outbox isn't built yet). |
| **Records are history** | Each completion is a record with a date and, where it applies, an expiry. Records are append-only. A mistake is voided with a reason, never edited or deleted. |
| **Record, don't store (yet)** | External certificates are recorded as metadata only: provider, completion date, expiry and an optional certificate reference. Uploads wait for secure storage (ADR-0007, gate G7), as in M7. |
| **People before logins** | Managers record training for anyone, with or without a login. People with a linked login (M7.3) also see their own training and complete in-house courses themselves. |
| **Same tenant model** | Every table is tenant-owned with RLS ENABLE + FORCE, `UNIQUE(tenant_id, id)` and composite foreign keys. Site scope is checked on the server, and other organisations' records return 404. |
| **Free tier only** | No paid learning platform, content library or certificate verification service. |

## 2. Concepts

- **Course:** something people complete. For example "Level 2 Food Hygiene", "Allergen awareness", "Fire safety" or "Personal licence (APLH)".
  - **Type:**
    - **In-house:** content written by the business (text, plus optional links), completed in TeamHappi by reading and confirming;
    - **External:** done elsewhere; a manager records the certificate details.
  - **Renewal:** valid for N months, or never expires.
  - **Expiry warning:** a warning window, 60 days by default.
  - **Versioning:** editing an in-house course's content makes a new version, and each completion records the version it confirmed.
- **Requirement:** who must have a course, and by when.
  - **Applies to:** the whole organisation, one site, a job title, or one named person.
  - **Due:** a number of days after the person's start date (for example "within 14 days of starting"), or immediately for people already employed.
  - **Mandatory or recommended:** only mandatory requirements count towards "up to date".
- **Training record:** one completion of a course by a person.
  - **What's recorded:** completed on, expires on (worked out from the course, and can be overridden from a certificate), how it was done (in-house confirmation or external certificate), provider, optional reference, and who recorded it.
  - **Correcting it:** a record can be voided with a reason.

## 3. Status for a person and course (computed, never ticked by hand)

| Status | Meaning |
|---|---|
| **Up to date** | A valid record, not expiring within the warning window |
| **Expiring** | A valid record expiring within the warning window |
| **Due** | No valid record, and the due date hasn't passed yet |
| **Overdue** | No valid record, and the due date has passed |
| **Expired** | The last record has expired |
| **Not required** | No requirement applies (any records are kept, shown as extra) |

A person is **up to date** when none of their mandatory requirements is overdue or expired.

## 4. Screens

- **Training dashboard** (`/training`, replacing the "Planned" page): **a matrix of people (rows) by required courses (columns)** with the status in each cell, filterable by site, job title and status.
  - **Counts:** overdue, expired, expiring in the next 60 days, and people up to date.
  - **Who sees what:** site managers see only their sites; owners, admins and HR see everyone.
- **Courses and requirements** (`/training/courses`; owners, admins and HR):
  - create and edit courses and their requirements;
  - **add suggested UK hospitality courses** with one click, all editable and labelled "suggested";
  - suggestions include Level 2 Food Hygiene, Allergen awareness, Fire safety awareness, Health and safety induction, Manual handling, COSHH awareness, First aid at work, Personal licence (APLH) and Age-verification (Challenge 25).
  - **Renewal periods are suggestions to confirm with your adviser or provider, not legal advice.**
- **Person page:** a training card (status per required course), with **Record training** for managers.
- **My training** (phone first, for people with a linked login):
  - what's required and by when;
  - in-house courses to read and confirm ("I've completed this and understood it");
  - expiring certificates to renew;
  - their own history.

  They never see other people's training.
- **Onboarding link:** "My onboarding" shows a short "Training to complete" list with a link to My training. The onboarding page shows the person's training status as information. **It doesn't change "cleared to start"** unless you choose otherwise (decision D4).

## 5. Permissions (new)

| Code | Meaning | Owner / admin | HR manager | Site manager | Recruiter | Worker |
|---|---|---|---|---|---|---|
| `training.view` | See training status and records | ✔ | ✔ | ✔ (their sites) | – | own only (by ownership) |
| `training.record` | Record and void training records | ✔ | ✔ | ✔ (their sites) | – | own in-house confirmations only |
| `training.manage` | Courses and requirements | ✔ | ✔ | – | – | – |

As in M7, existing organisations get these on their **built-in** roles through the migration (an approval gate), and custom roles aren't touched.

## 6. Database (proposed, M8.1)

All tenant-owned, RLS ENABLE + FORCE, `UNIQUE(tenant_id, id)`, composite foreign keys, and no app-role DELETE.

| Table | Key columns |
|---|---|
| `training_course` | name, description, kind (`in_house`/`external`), content (in-house text, length-limited), version, validity_months?, warn_days, is_suggested, archived_at |
| `training_requirement` | course_id, scope (`organisation`/`site`/`job_title`/`employee`), site_id?, job_title?, employee_id?, mandatory, due_days_after_start, archived_at |
| `training_record` | employee_id, course_id, course_version, completed_on, expires_on?, method (`in_house`/`external`), provider?, reference?, recorded_by, self_completed, voided_at?, voided_by?, void_reason? |

- **Column-level UPDATE:** courses and requirements are edited or archived. Records can only be **voided** (an UPDATE of the void columns only), and their facts never change.
- **CHECK constraints:** scope matches its target; a void needs who, when and a reason; expiry comes after completion.

## 7. Audit

- **Every change is audited:** course and requirement edits, records added or voided, and self-completions.
- **Audit detail holds ids and codes only:** no names, references or free-text reasons, the same as M7.

## 8. Security tests (per increment)

- **Isolation:** another organisation's courses and records are invisible and unchangeable (404), including by guessed ids and cross-tenant foreign keys.
- **Site managers:** they see and record only for their sites, and can't edit courses or requirements.
- **Workers:** they see only their own training, can complete only in-house courses they're required to do, and can't record external certificates or touch anyone else's.
- **Records:** append-only (only the void columns can change); a voided record doesn't count.
- **Status:** requirements and status are calculated correctly, including date boundaries (unit tests).
- **Browser tests:** desktop and mobile with accessibility checks, covering the matrix, recording a certificate, and a worker completing an in-house course on a phone.

---

## Recommended increments

| Increment | Delivers | Needs |
|---|---|---|
| **M8.1 Training foundation** | Permissions; courses (with suggested set); requirements by organisation, site, job title or person; computed status; managers record external and in-house completions and void mistakes; training matrix dashboard; person-page card; audit | G1 scope, G2 migration |
| **M8.2 My training** | Worker view on the phone: required and expiring training, read-and-confirm for in-house courses, own history; "Training to complete" in My onboarding | Probably no migration (uses M8.1 tables) |
| **M8.3 Later, separately approved** | Email expiry reminders (G6); certificate uploads (G7); `training.isCurrent(person, course, date)` for Rota (built with Rota); quizzes for in-house courses | G6, G7, Rota |

Each increment gets its own branch, tests, Neon approval request and read-only verification, and is merged only when you say so.

## Approval gates

| Gate | What you approve | When |
|---|---|---|
| **G1** | This scope and decisions D1–D6 below | Now |
| **G2** | M8.1 migration on Neon (new tables, new permissions added to every organisation's built-in roles) | Before merging M8.1 |
| **G6 / G7** | As before: email (Resend and a domain) and secure document storage | Before reminders or uploads |

## Decisions needed (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| D1 | "By role": is that the **job title** on the person's record (Chef, Bartender) or the **TeamHappi permission role** (Worker, Site manager)? | **Job title**, plus site, organisation-wide and named person. Permission roles are about access, not the job someone does. |
| D2 | Should requirements be **worked out from rules**, or **assigned** to people one by one? | **Worked out from rules.** New starters and job changes are covered automatically, with no background job. A named-person rule covers one-offs. |
| D3 | What does "in-system completion" mean for now? | **Read and confirm** in-house content, recording the version confirmed. Quizzes later if you want them. |
| D4 | Should overdue **mandatory** training stop someone being "cleared to start" in onboarding? | **No, show it only.** Many hospitality courses are completed in the first weeks. Rota can later warn or block for specific courses (for example a personal licence for a bar shift). |
| D5 | May workers record **external** certificates themselves? | **Not yet.** Managers record them after seeing the certificate. Worker submissions make sense once uploads are approved (G7). |
| D6 | Default expiry warning window? | **60 days**, editable per course (the same as right-to-work follow-ups). |
