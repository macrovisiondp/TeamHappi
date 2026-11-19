# Privacy assessment (DPIA): new starters' personal and bank details (M14.2)

**Status:** written on 19 November 2026 before building, as the product owner required (M14 decision D3). It's a short screening, not legal advice. The organisation using TeamHappi is the **controller**, and Macrovision (TeamHappi) is its **processor**. A data protection adviser should review it before real customer data is collected.

## 1. What we'll collect, and why

| Data | Why the employer needs it | Who enters it |
|---|---|---|
| Home address | Contract of employment (written statement of particulars), payroll | The person, or HR |
| Emergency contact (name, relationship, phone) | Safety at work | The person, or HR |
| Date of birth | Minimum wage rate by age; under-18 working-time rules; payroll | The person, or HR |
| National Insurance number | Payroll and HMRC reporting | The person, or HR |
| Bank account (name, sort code, account number) | Paying wages | The person, or HR |

**Lawful basis (for the employer):** performance of the employment contract, and legal obligations (tax, minimum wage, working time). Nothing is collected for marketing. No special category data (health, ethnicity and so on) is collected.

**Not collected:** passport or ID numbers (right-to-work evidence stays as a record that it was seen, M7.2), photographs, and payroll calculations (a later release).

## 2. Risks and how TeamHappi reduces them

| Risk | Reduction |
|---|---|
| Another organisation sees the data | Row-level security with forced policies; composite keys; cross-organisation requests return 404 (tested) |
| Too many people inside the organisation see it | New permission `employee.personal` for owners, admins and HR only. Site managers see the emergency contact only, at their sites. Staff see and edit only their own. |
| Bank or NI numbers leak through a database copy, backup or SQL access | **Encrypted in the database** (AES-256-GCM, Node's standard crypto library, no custom cryptography) with a key held only in Vercel (`PERSONAL_DATA_KEY`), never in the database or repository. A stolen database copy alone doesn't reveal them. |
| Shoulder-surfing or casual browsing | Bank account and NI numbers are shown **masked** (last 4 characters) by default. Seeing them in full needs a deliberate **Reveal**, and every reveal is audited. |
| Data appears in logs, emails, exports or the audit trail | Never logged. Not included in any export, email or notification. The audit trail records ids and actions only ("revealed bank details"), never values. |
| Wrong details entered | The person can correct their own. HR can correct with audit. UK sort codes and account numbers are format-checked (6 and 8 digits), as are NI numbers (two letters, six digits, one letter A to D). |
| Kept too long | Stays with the staff record. Removal on leaving follows the organisation's retention policy (TeamHappi's retention tooling, later). Until then the employer can clear the details. |
| The key is lost | The data can't be decrypted; the person re-enters it. The key is a Vercel secret, rotated per ADR-0011 (a new key version encrypts new data; old data is re-entered or re-encrypted on change). |

## 3. Residual risk and conditions

**Residual risk: low to medium.** It's acceptable for Release 1 if:
1. `PERSONAL_DATA_KEY` is set only in Vercel (Production and Preview separately). Without it, bank and NI fields are switched off and say so.
2. The employer's own privacy notice to staff mentions TeamHappi as where these details are held.
3. A data protection adviser reviews this assessment before real customers use it, and Macrovision's data processing agreement with each customer covers it.

## 4. Review

Review again before payroll features are built, or if anything here changes.
