# API Conventions (v1)

## Versioning

- Base path is `/api/v1`. Breaking changes require `/api/v2`. Additive changes (new optional fields or endpoints) stay in v1.
- A deprecated endpoint sends a `Deprecation` header and a `Sunset` date at least 90 days ahead.

## Resources and naming

- Plural nouns and kebab-case paths, with JSON field names in camelCase. Examples: `/api/v1/sites/{siteId}/shifts`, `/api/v1/employees/{employeeId}`.
- Actions that aren't plain CRUD use a sub-resource verb: `POST /api/v1/rotas/{id}/publish`.
- **The tenant is never in the URL or body.** It comes from the session's active tenant. Switching tenant is `POST /api/v1/session/active-tenant` (membership-checked).
- IDs are opaque UUID strings.

## Requests

- `Content-Type: application/json` is required for mutations. Every body and query is validated with Zod, and unknown keys are rejected.
- **Idempotency:** `POST` endpoints that create things accept an `Idempotency-Key` header. It is required for clock events and offline sync. Keys are stored per tenant for 24 h.
- **Concurrency:** mutable resources return an `ETag` (version). Updates send `If-Match`. A mismatch returns `412`.

## Responses

- Single resource: `{ "data": { ... } }`. List: `{ "data": [ ... ], "page": { "nextCursor": "...", "limit": 50 } }`.
- Dates are ISO 8601 UTC strings. Date-only values (`2026-10-08`) are used for things like expiry dates.
- Money (later) is decimal **strings**, for example `"12.3400"`, with a `currency: "GBP"` field. JSON numbers are never used for money.

## Pagination, filtering, sorting

- Pagination is cursor-based: `?limit=50&cursor=...`. The default limit is 25 and the maximum is 100.
- Filters are explicit allow-listed params, for example `?siteId=...&status=active`.
- Sorting is `?sort=startsAt` or `?sort=-startsAt`, from an allow-list only.

## Errors — RFC 9457 `application/problem+json`

```json
{
  "type": "https://teamhappi.app/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "code": "validation_failed",
  "detail": "One or more fields are invalid.",
  "errors": [{ "path": "startsAt", "message": "Must be before endsAt" }],
  "requestId": "req_01J..."
}
```

| Status | When |
|---|---|
| 400 | Malformed request |
| 401 | Not signed in |
| 403 | Signed in, lacks permission (only when the resource's existence is not secret) |
| **404** | Not found **or not visible in this tenant**. Cross-tenant access always returns 404, so existence is never confirmed. |
| 409 | State conflict, for example publishing an already published rota |
| 412 | ETag mismatch |
| 422 | Validation failed |
| 429 | Rate limited, with `Retry-After` |
| 500 | Generic message plus `requestId`. Details stay in the logs. |

## Security headers (all responses)

- `Content-Security-Policy` (nonce-based)
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- `frame-ancestors 'none'`
- API responses add `Cache-Control: no-store`.

## Auditing

Each endpoint's spec states whether it writes an audit event. All mutations on Confidential or Restricted data do. Every view of Restricted data does.
