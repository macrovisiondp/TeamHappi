# M9: Recruitment — scope proposal

**Status:** proposal for product-owner review (gate R1). No code, migration, AWS resource or external service has been created.
**Direction:** the product owner chose Recruitment before Rota (29 October 2026). The lifecycle is Recruitment → Employee record → Onboarding → Training → Rota → Attendance.
**Requirement:** TH-DEV-02 Capability 1, Recruitment (Release 1).
**Builds on:**
- M4.2: sites, teams, employee records and employee numbers;
- M6: memberships and the audit trail;
- M7: onboarding, and invitations that link a login;
- M8: training;
- ADR-0007: document storage (proposed);
- ADR-0011: secrets;
- ADR-0012: provider-independent email and storage.

---

## 0. Pre-flight verification (requested before M9)

| Check | Result |
|---|---|
| CI run #40 (merge of M8.2 to `main`, commit `72e5640`) | **Completed successfully** |
| Vercel deployment of M8.2 | **Deployed (completed)** to Production; the active deployment |
| CI run #31 (merge of M7.2, commit `6c31283`) | **Cause established.** Only the **Dependency audit** job failed ("Process completed with exit code 1"). The lint, types, tests, build and e2e job passed (35 files, 427 tests), and so did the secret scan. |

**How the run #31 cause was established:**
- The job log wouldn't render in the browser, so I re-ran the same blocking check (`node scripts/audit-check.mjs --omit=dev`) against that commit's `package.json`, `package-lock.json` and `audit-check.mjs`.
- **On `6c31283`** it exits **1**, listing unaccepted advisories:
  - **next 16.4.0:** GHSA-2464-fhr4-w9xw (critical), GHSA-673q-mjm6-r5xr (critical), GHSA-p3m5-59mp-jv5r (high);
  - **undici:** four high advisories (GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm);
  - **zod:** GHSA-mrhx-c7xc-m3w5 (high).
- **On `f479677`** (the security upgrade) the same check exits **0**.
- **Caveat:** this used today's advisory database. The failure annotation, the job that failed and the passing test job all match, but it can't prove the database was identical on the day.
- **Consequence:**
  - **Code:** the M7.2 code itself was fine.
  - **Exposure:** Vercel deployed it, and production ran Next.js 16.4.0, which had those advisories, until the 16.4.3 upgrade deployed later the same day.
  - **Correction:** this corrects my earlier guess that the deploy was skipped.
- **Follow-up:** from now on I check CI on `main` after every merge.

**No blockers for M9.**

---

## 1. Principles

| Principle | What it means here |
|---|---|
| **Candidates are people, applications are events** | A candidate can apply to several vacancies. Each application has its own stage and history. Records are **never merged automatically**; a manager chooses whether to reuse an existing candidate. |
| **Minimise candidate data** | Name, contact details, application answers and documents only. No date of birth, nationality, photo, marital status or right-to-work details at application (right to work is checked by the employer before employment starts, in M7.2). Equality monitoring, if ever wanted, needs a separate, anonymous design. |
| **Hire once** | "Hire" creates exactly one employee record per application, even if clicked twice or retried, and starts M7 onboarding. It never creates a login (an M7.3 invitation does). |
| **Nothing goes out unapproved** | No real applicant email, public form or file upload until its gate is approved. Unavailable actions say so plainly; a development-only email is never shown as "sent". |
| **Same tenant model** | Tenant-owned tables with RLS ENABLE + FORCE, `UNIQUE(tenant_id, id)`, composite foreign keys and no app-role DELETE. Site scope is checked on the server. Platform staff have no access to applicant data (their role can't read tenant tables). |
| **Free tier first** | Every chargeable item (S3 storage, malware scanning, KMS, email) is listed with its approval gate. |

## 2. Recommended increments

| Increment | Delivers | Needs |
|---|---|---|
| **M9.1 Recruitment foundation** | Vacancies; candidates and applications (entered by managers); the pipeline; notes; interviews and an internal schedule; hire → employee record → onboarding; permissions; audit; a retention "due for review" list with manual anonymisation | R1 scope, R2 Neon migration |
| **M9.2 Secure documents (S3)** | S3 storage adapter; CV and document upload and download for managers; validation; malware scanning; audited access; retention | R3: AWS set-up per §6 plus a security review; R4 migration |
| **M9.3 Public careers** | Branded job listings; public vacancy pages; accessible application form with privacy notice; confirmation; Cloudflare Turnstile; rate limiting; duplicate protection; CV upload through M9.2 | R5: privacy notice, retention policy, Turnstile keys (free); R6 migration |
| **M9.4 Applicant email** | Acknowledgement, interview invitation and rescheduling, offer and status messages through the existing email interface; a delivery log | R7: provider (Resend or SES), sending domain, DNS, templates |

M9.1 delivers value without any external service. M9.2 to M9.4 can run in any order once their gates are approved. M9.3 needs M9.2 for CV upload, but could launch without uploads if you prefer.

## 3. M9.1 data model (proposed)

All tables are tenant-owned, with no app-role DELETE (records are closed, withdrawn or anonymised instead).

| Table | Key columns | Notes |
|---|---|---|
| `vacancy` | title, job_title (copied to the employee on hire), site_id, team_id?, employment_type (`full_time`, `part_time`, `casual`, `fixed_term`, `seasonal`), description, openings, status (`draft`, `open`, `paused`, `filled`, `closed`), closes_on?, hiring_manager_membership_id?, pay_min?, pay_max? (`numeric(10,2)`), pay_period? (`hour`, `year`) | Status changes are audited. Pay is optional, decimal, and never in the audit trail. |
| `candidate` | given_name, family_name, email?, phone?, source (`manual`, `referral`, `agency`, `careers_page`), retention_review_on, anonymised_at | No unique email: a duplicate check *suggests* existing candidates when a new application is added. |
| `application` | candidate_id, vacancy_id, stage, outcome (`active`, `hired`, `rejected`, `withdrawn`), applied_on, rejection_reason? (`not_suitable`, `role_filled`, `no_response`, `other`), hired_employee_id? (unique), hired_at, hired_by | `UNIQUE(tenant_id, candidate_id, vacancy_id)`: the same person can't apply twice to the same vacancy |
| `application_event` | application_id, from_stage, to_stage, actor, occurred_at | Append-only stage history (trigger) |
| `application_note` | application_id, author, body (≤ 2000 characters), created_at, redacted_at | Append-only. A mistake gets a follow-up note. Anonymisation blanks the body (a column grant and a trigger allow only that). |
| `interview` | application_id, scheduled_at, duration_minutes, format (`in_person`, `phone`, `video`), location?, status (`scheduled`, `completed`, `cancelled`, `no_show`), outcome? (`progress`, `hold`, `do_not_progress`), feedback? | Interviewers are in `interview_interviewer` (membership ids) |

**Pipeline (D2).** Eight **system stages**, always in this order:
- **Working stages:** Applied → Screening → Shortlisted → Interview → Offer.
- **End stages:** Hired, Rejected, Withdrawn. They're final and set by their own actions (Hire, Reject with a reason, Withdraw), never by a plain stage move.
- **Where it stops:** Rejected and Withdrawn can happen from any working stage. Hired only from Offer.

M9.1 lets each organisation **rename** the working stages (labels only), which keeps reports and integrations consistent. Custom extra stages could come later as sub-stages inside a system stage.

**Interview schedule:** an internal list by day and site (no external calendar). Interviewers see their own interviews.

## 4. Hire → employee → onboarding

**Hire** is available from **Offer**, needs `recruitment.hire` plus `employee.manage` at the vacancy's site, and is one transaction:
1. **Re-check the application:** it must be at Offer and active, and the vacancy in the actor's scope.
2. **Create the employee record:**
   - copied from the application: given and family names, email and phone;
   - copied from the vacancy: job title and site (primary site), plus the team if one is set;
   - entered at hire: the start date;
   - status `pending`, with a new employee number (the same generator as People).
3. **Claim the application:** a conditional update `hired_employee_id = <new id> WHERE hired_employee_id IS NULL` (plus a unique index).
   - If nothing is updated, someone already hired this application (a double click or a retry). The transaction rolls back and the existing employee is returned. **No duplicate is created.**
4. **Mark it hired:** the application becomes `outcome = hired, stage = hired`, and the history and audit are written.
5. **Fill the vacancy:** when the number of hires reaches the number of openings, it offers "Mark vacancy filled" (it doesn't silently close it).
6. **Start onboarding (optional, default on):** through the onboarding module's public API (`startCase`), with the chosen template and start date, but only if the actor has `onboarding.manage` there. Otherwise the employee is created and the page offers "Start onboarding" to someone who can.
7. **No login is created.** The person page already offers **Invite to TeamHappi** (M7.3).

**Links kept:** the application keeps the employee id, and the person page shows "Hired from: <vacancy>".

**Documents aren't copied:** CVs stay in recruitment and follow recruitment retention, unless a manager chooses to copy one to the employee's documents. That's an M9.2 decision.

## 5. Permissions (new)

| Code | Owner / admin | HR manager | Recruiter | Site manager | Worker |
|---|---|---|---|---|---|
| `recruitment.view`: vacancies, candidates, applications, notes | ✔ | ✔ | ✔ | ✔ (their sites) | – |
| `recruitment.manage`: vacancies, stages, notes, interviews | ✔ | ✔ | ✔ | ✔ (their sites) | – |
| `recruitment.hire`: convert to an employee (also needs `employee.manage`) | ✔ | ✔ | – | see D3 | – |
| `recruitment.settings`: stage labels, retention period | ✔ | ✔ | – | – | – |

- **Interviewers** who don't have `recruitment.view` (for example, a chef asked to sit in) see **only their own interviews**: the candidate's name, the vacancy, the time, and the CV once M9.2 exists. They record feedback for those interviews. That access comes from being the named interviewer, not from a role.
- **Site scope** follows the **vacancy's site**.
- **Other organisations and other sites** return "not found".
- **Platform administrators** get nothing: their database role can't read tenant tables, and no support-access feature exists.
- **Existing organisations** get the new codes on their built-in roles through the migration, as in M7 and M8. The built-in **Recruiter** role, which today has only `site.view`, finally gets its recruitment permissions.

## 6. M9.2: S3 document storage

### Design

- **Adapter:** `src/integrations/storage` gains an `aws-s3` adapter for the existing `StorageProvider` interface (presigned upload and download, removal, at most 5 minutes). Business code never imports the AWS SDK directly.
- **Keys:** keys look like `tenants/{tenantId}/recruitment/{documentId}`, built on the server from the server-resolved tenant and a random id. The browser never supplies a key, tenant or file name for the key.
- **Upload flow:**
  1. The manager (or, in M9.3, the applicant) asks to upload. The server checks permission and the declared type (PDF, DOCX, ODT or plain text) and size (at most **5 MB**).
  2. The server creates a `recruitment_document` row (`pending`) and returns a **presigned POST**. Its policy fixes the key, the exact `Content-Type` and a `content-length-range`, and it expires within 5 minutes.
  3. When the upload is done, the server checks the object's size and first bytes (by its actual contents, not its name), then marks it `scanning`.
- **Malware scanning:**
  - **Recommended:** Amazon GuardDuty Malware Protection for S3, which tags each object with its result. The app reads the tag before allowing any download.
  - **Outcomes:** `NO_THREATS_FOUND` → `clean`; anything else → `quarantined` (the object is deleted and the row kept).
  - **Not built in:** S3 itself provides no malware scanning, which is why this is needed.
- **Downloads:**
  - only when the file is `clean`;
  - only for people allowed to see that application;
  - through a presigned GET that expires in about **60 seconds**, with `Content-Disposition: attachment`;
  - **every view is audited** (`recruitment.document_viewed`).
- **No public URLs:** there are no public or long-lived URLs anywhere.
- **Replacing and removing:**
  - **Replace:** a new document supersedes the old one, and the old object is removed after a retention check.
  - **Remove:** deletes the object and keeps a tombstone row, with an audit event.
- **Retention:** documents follow the candidate's retention (§8). Anonymising a candidate removes their objects.
- **Separate environments:** each environment has its own bucket and its own credentials. Development never touches production storage.

### AWS set-up checklist (for the product owner; nothing will be created by me)

| Item | Recommendation |
|---|---|
| **Region** | `eu-west-2` (London), for UK data residency. Add S3 and GuardDuty to the data-processing register (sprint-0 risk R-8). |
| **Buckets** | One per environment, for example `teamhappi-dev-docs` and later `teamhappi-prod-docs`. Never shared. |
| **Object ownership** | *Bucket owner enforced* (ACLs disabled). |
| **Block Public Access** | All four settings on, at **account and bucket** level. |
| **Encryption at rest** | Dev: SSE-S3 (no extra cost). Prod: SSE-KMS with a customer-managed key (about $1 a month plus requests; **cost approval**), with a bucket key enabled. |
| **Bucket policy** | Deny requests without TLS (`aws:SecureTransport = false`). Deny `PutObject` without server-side encryption. Allow only the app's IAM principal on `tenants/*`. |
| **Versioning** | On (protects against accidental overwrite). |
| **Lifecycle** | Abort incomplete multipart uploads after 1 day; expire non-current versions after 30 days; no transitions (small volumes). |
| **CORS** (browser uploads only) | Allowed origins: the exact app origins per environment (for example `http://localhost:3000` for dev, the production domain for prod). Methods: `POST`. Headers: `Content-Type`. Max age: 300. No wildcards. |
| **IAM** | A dedicated principal per environment, with `s3:PutObject`, `s3:GetObject`, `s3:GetObjectTagging` and `s3:DeleteObject` on `arn:aws:s3:::<bucket>/tenants/*` only. No `s3:ListBucket`, no `s3:*`, no other buckets. Add `kms:GenerateDataKey` and `kms:Decrypt` on the one key if SSE-KMS is used. |
| **Credentials** | **Preferred:** Vercel OIDC federation to an IAM role (no long-lived keys). **Otherwise:** access keys stored only as server secrets (ADR-0011), rotated every 90 days, never in the browser or the repo. |
| **Malware scanning** | GuardDuty Malware Protection for S3 on the bucket (**chargeable** per GB and per object scanned; small at hospitality volumes, but needs **cost approval**). |
| **Configuration** | Through the existing Platform Admin integration settings (`aws-s3` in the registry: bucket, region and optional KMS alias, with secret fields stored as secrets). Names only in `.env.example`. |

## 7. M9.3 (public careers) and M9.4 (email), planned only

**M9.3 Public careers:**
- **Pages:** `/careers/<organisation>` and the vacancy pages, in the organisation's branding. Only `open` vacancies appear, and **only the fields chosen for publication**.
- **The form:** accessible, phone first. It asks for name, email, an optional phone number, short answers and an optional CV.
- **Privacy notice:** shown before submitting. **The organisation is the controller; TeamHappi is its processor.** The notice text needs your and your adviser's approval.
- **Protection:**
  - **Cloudflare Turnstile** (free);
  - Postgres-backed **rate limiting** per IP address and per vacancy (the free rate limiter that sign-in already uses);
  - a **duplicate guard:** the same email for the same vacancy within 24 hours is treated as the same submission, and each form render has a one-time submission token.
- **Confirmation:** a confirmation page now; a confirmation email once M9.4 is live.
- **Nothing launches** before R5 is approved.

**M9.4 Applicant email:**
- **How messages are sent:** they go through the existing `EmailProvider` interface (ADR-0012), with an idempotency key per message so a retry never sends twice.
- **Delivery log:** a new `outbound_message` table records each message's status (`queued`, `sent`, `not_sent_dev_only`, `failed`, `unavailable`) and the provider's message id. It stores **no message body or address**, which are re-derived when needed.
- **What the UI shows:**
  - with **no live provider:** "Email isn't set up yet. Copy the message and send it yourself", as for invitation links;
  - with the **development mailer:** "Not sent (development only)", never "sent" or "delivered".
- **What the development mailer logs:** only the recipient and subject, never applicant content.
- **Messages:** acknowledgement, interview invitation and rescheduling, offer, status update, and internal notices to hiring managers.

## 8. Privacy, security and retention

- **Lawful basis:** each organisation processes applicant data to take steps before entering a contract (UK GDPR Art. 6(1)(b)) and in its legitimate interests. **This needs adviser confirmation.**
- **Access:** RLS and server-side permission checks on every read and write, site scope by vacancy, and interviewer access by assignment only.
- **Notes and feedback:** visible only to people who can view the application. A warning beside the field: "Write as if the candidate will read it." Candidates can make subject access requests.
- **Audit:**
  - every stage change, note, interview change, hire and anonymisation;
  - every document view (M9.2);
  - detail holds ids and codes only: no names, contact details, notes, feedback or pay.
- **Proposed retention policy (for review, not approved):**

  | Situation | Proposal |
  |---|---|
  | Rejected or withdrawn | Review **6 months** after the application ended, then **anonymise**: personal fields blanked, notes and feedback cleared, documents deleted. Stage history and counts are kept for reporting. Configurable from 3 to 12 months. |
  | Hired | The recruitment record is anonymised 6 months after the hire date. The employee record continues under employment retention. |
  | Talent pool (M9.3, opt-in only) | Up to 12 months with the candidate's consent, then the same as rejected. |

  - **M9.1 doesn't delete automatically.** It shows a **"Due for review"** list, and a manager anonymises with one action, which is audited. Automatic anonymisation (a daily job) needs separate approval after the policy is agreed.
  - Interim specification IS-07 already says retention periods need an adviser's confirmation.
- **No real data in development:** synthetic candidates only (`@example.test`), and real CVs are never used.

## 9. Dependencies

- **M9.1:** none beyond what's merged (M4.2, M6, M7, M8).
- **M9.2:** your AWS set-up (§6); a security review of the adapter; GuardDuty cost approval.
- **M9.3:** M9.2 for CV upload; privacy notice text; retention policy; Turnstile site keys.
- **M9.4:** a Resend or SES account, a sending domain and DNS (SPF, DKIM, DMARC); the outbox is optional (messages are sent after the transaction commits, with idempotency keys).
- **Rota** (after M9): unaffected.

## 10. Approval gates

| Gate | What you approve | When |
|---|---|---|
| **R1** | This scope and decisions D1–D6 | Now |
| **R2** | M9.1 Neon migration (new tables; recruitment permissions on every organisation's built-in roles) | Before merging M9.1 |
| **R3** | AWS set-up done by you per §6 (dev bucket first), GuardDuty and KMS costs, and the storage security design | Before M9.2 is developed against real AWS |
| **R4** | M9.2 Neon migration (`recruitment_document`) | Before merging M9.2 |
| **R5** | Public careers: privacy notice, retention policy, Turnstile, abuse protection | Before M9.3 goes live |
| **R6** | M9.3 Neon migration | Before merging M9.3 |
| **R7** | Email provider, domain and DNS, and templates | Before any real applicant email |

As before, each migration comes with:
- the exact SQL, its SHA-256 and the effect on existing organisations;
- rollback notes and local test results;
- a read-only verification afterwards.

Nothing merges, deploys or touches AWS, Neon or email without the relevant approval.

## Decisions needed (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| D1 | Are candidates ever **merged** automatically when the same email appears? | **No.** Show "possible match" and let the manager choose to reuse an existing candidate. Merge tools can come later. |
| D2 | **Configurable pipeline:** fully custom stages, or renamable system stages? | **Renamable system stages** in M9.1 (consistent states and reports); custom sub-stages later if needed. |
| D3 | May **site managers hire** (create employee records) for their site? | **No by default.** They manage the pipeline and interviews at their sites; owners, admins and HR hire. You can grant `recruitment.hire` per role later. |
| D4 | Should **Hire** start onboarding automatically? | **Yes, pre-selected:** the person choosing Hire picks the template and start date, and can untick it. |
| D5 | Show **pay** on vacancies? | **Yes, optional**, as a decimal range and period. It's useful for public listings in M9.3, and never in logs or the audit trail. |
| D6 | Retention | **Accept the §8 proposal as the working policy** for review with your adviser. M9.1 provides only manual "due for review" anonymisation. |
