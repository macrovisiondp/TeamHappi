# TH-DEV-11 — Change Log

TH-DEV-02 §7 refers to a change log called TH-DEV-11. No such document existed. This file starts it, so approved scope and requirement changes have a single record.

| ID | Date | Change | Documents affected | Requested / approved by | Impact |
|---|---|---|---|---|---|
| <a id="cr-001"></a>CR-001 | 2026-10-08 | Release 1 set to Option A. Holiday requests and leave balances deferred to Release 2. Payroll and payslips stay on the roadmap but are not built now. | TH-DEV-02 §4 → [rev 0.2](TH-DEV-02-revision-0.2.md) | Product owner | Release 1 scope is fixed for planning. No architecture change. |
| CR-002 | 2026-10-08 | Initial worker sign-in uses a personal email. SMS sign-in is deferred pending cost and operations review. | TH-DEV-04 IA-04 (how it is met, not the requirement itself), ADR-0004 | Product owner | IA-04 is still met: workers don't need a work email. Phone OTP is added later as an extra method. |
| CR-003 | 2026-10-08 | Free-tier-first development: Vercel Hobby, Neon Free, GitHub Free. No paid services until approved. | ADR-0003, ADR-0006, ADR-0007, [free-tier limits](../architecture/free-tier-limits.md) | Product owner | Some MUST requirements (DOC-02, OBS-01 retention, DR-01) **cannot be fully met on free tiers**. They must be met before handling real client data. See the free-tier limits document. |
