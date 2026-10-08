# Operational Cost Assumptions

> These are **planning estimates only**, as of October 2026. They are not quotes. Provider pricing changes, and every figure must be confirmed on the provider's pricing page before purchase. GBP figures are approximate conversions from USD.

## Current phase — free tier (decision CR-003, 8 Oct 2026)

**£0 per month.** Vercel Hobby, Neon Free and GitHub Free only. No paid service is active or approved. See [free-tier-limits.md](free-tier-limits.md) for what this rules out (no real client data, no commercial use on Vercel Hobby).

The tables below are kept as **planning estimates for when upgrades are proposed**. They are not current spend.

## Development phase (if upgraded, before Release 1 beta)

| Service | Plan | Est. monthly | Note |
|---|---|---|---|
| Vercel | Pro, 1 seat | ~£16 | Needed for London function region pinning, team previews and commercial use |
| Neon | Launch (usage-based) | £5–£20 | Branches per PR, autosuspend |
| AWS (S3, KMS, GuardDuty Malware Protection, SES) | Pay-as-you-go | £5–£20 | Tiny volumes. One KMS key is about $1. |
| Inngest | Free tier | £0 | Upgrade at volume |
| Sentry | Free / Team | £0–£22 | EU region |
| GitHub | Free / Team | £0–£4 | Actions minutes are within the free tier for a private repo at this scale |
| **Total** | | **≈ £30–£80** | |

## Early production (≈ 5–20 tenants, ≈ 500–2,000 workers)

| Service | Est. monthly | Driver |
|---|---|---|
| Vercel Pro | £16–£60 | Seats plus function usage |
| Neon (production + staging projects) | £50–£150 | Compute hours, storage, PITR window |
| AWS | £20–£80 | Document volume, scanning per GB, email volume |
| Inngest | £0–£60 | Steps per month |
| Sentry | £22–£60 | Event volume |
| Log retention / uptime monitoring | £0–£40 | To be chosen |
| **Subtotal** | **≈ £110–£450** | |
| SMS (if phone OTP / SMS notifications approved) | **Variable** | Roughly 3–5p per UK SMS. This is the biggest variable, so OTP rate limits are essential. |

## Cost risks

- SMS pumping fraud on OTP endpoints. Mitigation: rate limits, UK-only numbers and CAPTCHA on repeats.
- Neon compute left running. Mitigation: autosuspend outside production.
- Large uploads and scanning. Mitigation: per-file size caps and per-tenant storage quotas.
