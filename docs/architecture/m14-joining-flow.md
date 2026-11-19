# M14: The joining flow (scope)

**Status:** approved by the product owner on 19 November 2026 ("Yes, as recommended"): the flow below and decisions D1–D4.

**Why:** when an organisation hires someone, everything from the offer to the first shift should happen in TeamHappi, in the right order, with as little for the manager to remember as possible.

## The flow

1. **Offer** (M14.3): the applicant gets the offer letter by email and signs it through a secure link, with no login (D1).
2. **Hire** (M14.1): TeamHappi creates the staff record, starts onboarding, emails their invite, and sends the starter pack for their job title (D4).
3. **About you** (M14.2): the new starter fills in their home address, emergency contact, date of birth and NI number (D2).
4. **Payroll details** (M14.2): their bank account, held in a restricted section (D3).
5. **Sign**: their contract and the policies in their starter pack (M13, built).
6. **Right to work**: the manager checks documents or a share code (M7.2, built).
7. **Training**: assigned by job title or site, completed on the phone (M8, built).
8. **Sign-off**: then they can be put on the rota (built).

## Decisions

| # | Decision | Agreed |
|---|---|---|
| D1 | When the offer letter is signed | **Before hire, by the applicant, through a secure link** (no login). The signed offer is kept with their record. |
| D2 | "About you" details | **Home address, emergency contact, date of birth, NI number.** The person sees and edits their own. Owners, admins and HR see everything; site managers see the emergency contact only. Date of birth also lets the rota warn about under-18 working rules later (closes the M10 D9 gap). |
| D3 | Bank details | **Collected in TeamHappi, carefully:** owners, admins and HR only; masked (last 4 digits) unless deliberately revealed; every reveal audited; never in logs or exports; encrypted in the database with a key held only in Vercel. A short privacy assessment (DPIA) is written first. |
| D4 | Automation at hire | **Email the invite automatically, and send the starter pack** for their job title. |

## Increments

| Increment | Delivers | Migration |
|---|---|---|
| **M14.1** | Staff invites emailed automatically (and when sent again); starter packs (named sets of library policies, by job title or for everyone); at hire, invite and starter pack sent with ticked-by-default options | Add-only (starter packs) |
| **M14.2** | "About you" on the phone and on the person's record; restricted, encrypted bank details with masked display and audited reveal; DPIA | Add-only |
| **M14.3** | Offer letters at the Offer stage: upload the PDF, email the applicant a secure link, sign or decline without a login; the signed offer moves to their record at hire | Add-only |

## Not included

- Filling contract templates automatically from "About you" (later).
- HMRC starter checklist and payroll calculations (payroll release; project rule).
