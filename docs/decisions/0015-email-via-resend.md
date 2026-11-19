# ADR-0015: Email through Resend, configured by the deployment

**Status:** Accepted by the product owner on 19 November 2026 ("Resend free tier"; "build both here"). It narrows ADR-0012 for email, as ADR-0014 did for document storage. ADR-0012 is unchanged for every other provider.

## Context

- **Email until now:** TeamHappi only logged emails in development and refused to send in production. Nobody outside the team could verify an email address, and new organisation owners had to be sent their link by hand.
- **The product owner's choice:** Resend, on its free tier (3,000 emails a month, 100 a day at the time of writing). They've created the account and set `RESEND_API_KEY` in Vercel.
- **The same problem as storage (ADR-0014):** Platform Admin's integration settings are readable only by the platform database role. Sign-up and invitation emails are sent by ordinary request code, which can't read them without widening its access.

## Decision

- **Request code sends through Resend only when the deployment's own settings say so**, all three together:
  - `APPROVED_LIVE_PROVIDERS` includes `resend` (the owner's deliberate approval);
  - `RESEND_API_KEY` is set (a Vercel secret);
  - `EMAIL_FROM` is set, for example `TeamHappi <noreply@teamhappi.co.uk>`, on a domain verified in Resend.
- **Otherwise:** local development and tests log emails to the console, and production refuses to send.
- **Platform Admin's "Test connection" for Resend is live:**
  - it runs only when the owner has approved Resend and the key is set;
  - it sends one message from the saved sender to Resend's own test address (`delivered@resend.dev`), which checks the key, the sender and the domain together without emailing anyone (it counts as one email towards the quota);
  - a pass is recorded and audited, and "Make active" then works as before.
- **No SDK:** plain `fetch` to Resend's API, with the message's idempotency key sent as `Idempotency-Key`.
  - Only 429 and 5xx responses count as "not accepted".
  - A request that got no answer is never retried with another provider, because it may already have been sent.
  - The API key, message bodies and links are never logged.
- **What sends email now:**
  - email verification (sign-up and sign-in);
  - the owner's invitation when Platform Admin creates an organisation, and when an invitation is sent again;
  - a note to an existing user who has been made an owner.

## Consequences

- **Switching email on or off** means changing Vercel settings and redeploying, as for storage.
- **Platform Admin and Vercel must agree:** Platform Admin's saved sender is used for the test; `EMAIL_FROM` is used for real sending. Keep them the same address.
- **Before real customer data:**
  - Resend processes data in the US and EU, so a UK-GDPR check of its data processing terms is still due;
  - the free tier's daily limit applies.
- **Steps for the product owner:**
  1. In Resend, add and verify `teamhappi.co.uk` (Resend shows DNS records to add at the domain's registrar).
  2. In Vercel, set `APPROVED_LIVE_PROVIDERS` to include `resend`, `EMAIL_FROM` to `TeamHappi <noreply@teamhappi.co.uk>`, and keep `RESEND_API_KEY`.
  3. Redeploy, then in Platform Admin: Email, Resend, Test connection, Make active.
