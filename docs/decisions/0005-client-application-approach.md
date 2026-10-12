# ADR-0005: Client application approach

- **Status:** Direction provisionally approved (2026-10-08); details pending final review
- **Date:** 2026-10-08
- **Requirements:** TH-DEV-04 §12, AR-REQ-04, NT-01

## Decision

**A responsive web application that installs as a Progressive Web App (PWA).** Native apps are deferred. Because every capability is behind `/api/v1` (AR-REQ-04), native iOS and Android clients can be added later without back-end changes.

| §12 requirement | How it is met |
|---|---|
| Works on mid-range and older phones | Server-rendered pages, minimal client JavaScript on worker screens, a performance budget enforced in CI (provisional: worker routes ≤ 200 KB JS gzipped), and testing on a low-end Android profile |
| Push notifications for shift changes | Web Push through the service worker. Works on Android and desktop. **iOS needs iOS 16.4+ and the app added to the Home Screen.** Email and in-app notifications are the fallback. |
| Poor connectivity, including clock-in | The service worker caches the worker shell and "my shifts". Clock events are queued in IndexedDB with a device timestamp and a unique idempotency key, then synced when back online. The server records both device time and received time and **flags offline entries** for manager review. Exact rules need to be agreed. |
| Accessibility (TH-DEV-08) | Provisional target WCAG 2.2 AA. Radix-based components, axe checks in Playwright. |

## Alternatives considered

- **Native apps (React Native/Expo) from day one.** Better iOS push and offline support, but they add a second codebase, app-store releases and review delays before product-market fit.
- **Web only, without a PWA.** Fails the push and offline requirements.

## Consequences and risks

- iOS push depends on users installing the PWA. Onboarding must guide them through it. If adoption is poor, a thin native wrapper (Capacitor or Expo) is the fallback, and it reuses the same API.
- Offline clock-in creates a fraud and dispute surface. Manager review and audit are mandatory. Geolocation or site QR codes are **not** assumed; they are a product decision with privacy implications.
