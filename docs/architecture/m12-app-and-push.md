# M12: Installable app and shift alerts (design)

**Status:** approved by the product owner on 19 November 2026 (installable app and push notifications; the offline clock-in queue was not chosen for now). Built the same day. The migration is add-only, so it's applied to Neon dev under the standing approval ([record](../operations/m12-neon-approval.md)).

## 1. Installable app (no app store)

- **What it is:** a web app manifest (`/manifest.webmanifest`). Phones can "Add to Home Screen" and open TeamHappi full screen, like an app, starting at the dashboard.
- **Icons:** drawn by the app ("TH" on forest green), so there are no image files in the repository. They're at `/icon`, `/apple-icon` and `/app-icon/192|512|maskable-512`.
- **Service worker** (`/sw.js`):
  - it **only shows alerts**: no caching, so pages are always fresh and nothing private is stored on the phone;
  - it's served with `no-cache` and a strict content security policy;
  - tapping an alert opens a TeamHappi page only.

## 2. Shift alerts

- **Turning them on:** on My shifts, a "Shift alerts" card lets someone turn alerts on or off **for that device**. On iPhone they must first add TeamHappi to the Home Screen (Apple's rule); the card says so. If alerts are blocked in the browser settings, it says that too.
- **When they're sent:** after a manager's change succeeds (publish, add or edit, cancel, assign, unassign, approve a request, swap or drop). TeamHappi works out whose **published** shifts changed and alerts each of their devices. Drafts alert nobody.
- **What they say:** **"TeamHappi: Your shifts have changed. Tap to see them."** Never names, times or places, so nothing private shows on a locked phone.
- **How sending works:** it happens after the response is sent (`after()`), outside any database transaction, and never slows or fails the manager's change. Devices the push service reports as gone (404 or 410) are switched off. One failing device never stops the others.
- **Shared phones:** if someone else turns alerts on with the same phone in the same organisation, the previous person's alerts on that phone stop.
- **No paid service:** Web Push is built into browsers. TeamHappi signs messages with its own key pair (VAPID), using the `web-push` library (MPL-2.0).

## 3. Data (migration `20261112120000_push_subscriptions`)

`push_subscription` holds, for each membership:
- the push endpoint (https only);
- the browser's two public keys;
- created, last sent and removed dates.

It has RLS (enabled, forced, tenant policy), one live row per device per organisation, and column-level UPDATE (last sent, removed). The app role can't delete. Endpoints and keys are never logged.

## 4. Settings (names only; values in Vercel)

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secret) and `VAPID_SUBJECT` (`mailto:` a support address). Generate the pair once with:

```bash
npx web-push generate-vapid-keys
```

With any of the three missing, alerts stay off and the card is hidden.

## 5. Not included

- The offline clock-in queue (not chosen for now).
- Alerts for anything other than shift changes.
- Alerts for people without a TeamHappi login (they still get the printed rota).
