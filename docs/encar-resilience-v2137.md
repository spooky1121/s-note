# Encar repeated lookup resilience — v2.137

Repeated vehicle-detail lookups now share an in-progress request for the same vehicle and signed-in context. A temporary HTTP 429/502/503/504 receives at most one client retry per endpoint, within one 75-second lookup deadline. Authentication, configuration, parsing, plate mismatch, request-budget exhaustion and Cloudflare 1102 failures are not blindly retried. Provider `Retry-After` values are preserved; waits longer than 30 seconds remain an explicit cooldown rather than an early retry.

## Confirmed defects and limits

- Candidate count did not bound actual network requests: aliases could require separate official-detail requests. A synthetic worst case made 53 outbound calls, beyond the Cloudflare Workers Free 50-subrequest limit. The resolver now accounts for actual fetches, including Auth and membership, and caps them at 44. Optional exploration reserves capacity for official verification. Exhaustion returns a specific safe diagnostic; a verified advertisement still succeeds when only optional price work is exhausted.
- Large screenshots used JavaScript byte-to-string Base64 conversion and requested full OCR geometry that the price parser never reads. A workerd CPU profile measured approximately 52.0 ms versus 7.1 ms for 1 MiB Base64 plus JSON after using native `Uint8Array.toBase64`. This establishes avoidable CPU cost, not proof that production returned Cloudflare 1102.
- Price verification previously turned temporary resolver failures into `VEHICLE_UNVERIFIED`, losing their stage and retry delay. Temporary verification failures now retain those details; definite mismatches and inactive advertisements remain rejected.
- Client diagnostic copying discarded useful stage information and did not distinguish lookup from automatic price recognition. Bounded, whitelisted diagnostics now identify the endpoint, stage, HTTP status, attempt, request budget, provider wait and supported Cloudflare error code/Ray ID. Raw HTML, OCR text, tokens, cookies and customer data are excluded.

The ordinary lookup route contains no two-or-three-use 503 counter. The application burst limiter returns 429 after 60 requests per minute per IP. Cloudflare Browser Run REST screenshot limits and provider availability are independent of that limiter. Respecting a provider cooldown is necessary; repeated immediate requests cannot remove a provider limit.

## Automatic price recognition

Screenshots request JPEG quality 98, retain bounded dimensions and image validation, and continue accepting a valid legacy PNG response. Vision requests only the text/error fields actually consumed by the parser. Live Vision tests used synthetic screenshots exclusively: the original readable plate and price passed with PNG and JPEG98, while JPEG88/95 regressed and were rejected. Three further PNG/JPEG98 pairs had identical plate acceptance outcomes and all six prices were correct; two faint-text cases failed plate recognition in both formats and stayed safely rejected. This is compression parity evidence, not a guarantee that OCR can read every advertisement.

A bounded 10-second cache stores only settled price/identity values. Every call still performs fresh server authentication, membership and exact official vehicle-number/current-ad checks before consulting it. Original price timestamps remain intact. No screenshot, OCR text, credential, pending promise, Response or stream is shared between Worker requests. Capture and Vision cooldowns are separate; an active Vision cooldown stops before another billed screenshot. Isolate-local caching is an optimization, not a distributed locking guarantee.

Lookup success is preserved if price recognition fails. Existing sale prices are never silently replaced. A price change still requires the existing explicit confirmation and acknowledged, scoped price-only database write; unrelated drafts and other vehicles remain protected.

## Validation and operational boundary

Run the offline API/frontend regression suite with `npm test --prefix tests/encar`. Run the real application and native price bridge in Chromium with:

```sh
node tests/encar/repeat-resilience.browser.cjs
```

The focused browser regression covers ten sequential lookups at desktop/mobile widths, a third-lookup 503 recovery, automatic-price 503 recovery, joined duplicate entries, final-error link/price preservation, safe copied diagnostics and a 60-second capture cooldown. All HTTP, login and database traffic in this browser test is synthetic. Separate native workerd regression covers fresh authorization before cached prices, concurrent warm requests, expiry, provider throttling and recovery.

Final validation passed: 1,175 offline regression tests (zero failures or skips), 24 native workerd cases, the desktop/mobile application browser scenarios above, and syntax checks for the changed modules and all seven inline scripts. The native cases include temporary Auth/membership failures with 60/120/180-second waits, no capture during failed verification, and recovery without losing authorization checks.

Read-only Supabase log/health checks did not establish a corresponding production outage. This execution environment blocks direct production S-NOTE, Encar and Cloudflare Browser API access, so the original user's raw 503 response cannot be conclusively attributed or replayed here. Live Vision validation and successful deployment checks must not be described as end-to-end production Encar verification. No production vehicle/customer records or database schema were changed for this fix.

If a future failure remains, diagnostic copying now supplies the release, endpoint, request ID, stage and edge evidence required to distinguish a provider throttle from an authentication outage or Worker resource error. Do not weaken full vehicle-number matching or accept a stale/inactive advertisement to hide an error.
