# M13: Documents to sign (design)

**Status:** approved by the product owner on 19 November 2026 ("as recommended"), and built the same day. The migration is add-only, so it's applied to Neon dev under the standing approval ([record](../operations/m13-neon-approval.md)).

**Why:** HotRock (a prospective client) wants new starters to sign their contract and policies, and to get the signed copies back, without paper or a paid e-signature service.

## 1. How it works

**Policies (same for everyone).** Owners, admins and HR (`documents.manage`) upload each policy once, as a PDF (Onboarding → Documents). To change one, they add the new version and remove the old one. Anything already sent keeps the exact file that was sent.

**Contracts (one per person).** The manager fills in the person's details (name, address, job title, hourly rate, start date) in their own Word template, saves it as PDF, and uploads it on the person's record (People → person → Documents to sign → Send documents to sign). TeamHappi never holds pay or other contract details as data: they exist only inside the private file.

**Sending.** From the person's record: tick library policies and/or upload a contract. The person signs after accepting their TeamHappi invite (the existing hire → onboarding → invite flow).

**Signing (phone first).** On My onboarding, the person:
1. reads the document (opens the PDF);
2. ticks "I have read [document] and I agree to sign it electronically";
3. types their full name and presses **Sign**.

This is a simple electronic signature. UK employment contracts can generally be signed this way; an adviser should confirm the wording.

**Countersigning.** Contracts then wait for someone with `documents.manage` to countersign, by typing their name.

**The signed copy.** TeamHappi copies the original pages unchanged and adds one **signature page** recording:
- the document and organisation;
- the SHA-256 fingerprint of the exact file signed;
- who signed, the date and time (UK time) and how;
- for contracts, the countersignature.

The person and managers can download it. Policies are complete when the person signs; contracts are complete when countersigned.

## 2. Safeguards

- **Only the exact file is signed.** Each file's SHA-256 is recorded at upload. It's re-checked before showing, signing and countersigning; a changed file is refused.
- **Files** are PDFs up to 4 MB, checked by content (no scripts, launch actions or attachments, not password-protected). They're kept in private storage under the organisation's prefix, and shown in a sandbox (no scripts run).
- **Access:**
  - staff reach only their own requests, through their linked record;
  - `documents.manage` (owner, admin, HR; organisation-wide) does everything else;
  - site managers and recruiters have no access, because contracts contain pay;
  - other organisations get "not found".
- **Every view is audited**, as well as every upload, send, signature, countersignature, withdrawal and removal. The audit trail holds ids only (never typed names, titles or file names).
- **The database enforces the flow:**
  - a request can't be "completed" without a signature, a signed copy and (for contracts) a countersignature;
  - files, owners and fingerprints can't be changed;
  - only one open request per person and document;
  - the app role can't delete anything.
- **A double tap can't sign twice:** the signature is recorded only if the request is still waiting.

## 3. Data model (migration `20261111120000_documents_to_sign`)

| Table | Holds |
|---|---|
| `sign_document` | kind (`policy` library, or `contract` for one person), title, file name, size, SHA-256, storage location, uploaded by and at, archived |
| `sign_request` | person, document, needs countersign, status, the employee's typed name, who and when, the SHA-256 signed, the countersignature, the signed copy's location and SHA-256, withdrawn |

**New permission:** `documents.manage` (owner, admin, HR manager).

## 4. Needs before HotRock can use it

1. **Private storage switched on in production:** add `aws-s3` to `APPROVED_LIVE_PROVIDERS` in Vercel (the S3 keys are already set, ADR-0014), then deploy.
2. **HotRock finalises its documents** (they're marked "draft for owner approval") and saves them as PDF.
3. **Optional:** an adviser checks the signing statement wording.

## 5. Later

- Contract templates with blanks TeamHappi fills in from the person's record.
- Email notifications when documents are sent (with the Resend work).
- Signing before hire (applicants), if needed.
