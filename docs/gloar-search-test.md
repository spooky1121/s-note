# GLOAR DATA search test

This is a separate test page, `/gloar-search-test`, backed by `/api/gloar-search`. It does not replace S-NOTE's existing Encar button. It does not open Google, use Tavily, return a saved demo result, change a vehicle, or write business records.

The server opens `https://gloar-data.com/en/catalog` in an isolated Browser Run context, selects the visible `Enter 17-digit VIN, Lot #, or Plate...` input, dispatches the real input/change events and Enter key, and waits for changed results. It can read top-search dropdown links. Candidate detail pages must display the exact full requested plate in their primary content before a link is returned. The first verified link ends the search. No search query parameter or detail UUID is guessed.

The client submits only `{plate}`. The same-origin endpoint verifies the existing S-NOTE Auth token and active staff membership before using the server's `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_BROWSER_TOKEN`. Neither credential is available to the page. GET is a presence-only configuration check, not a credential validity check. Search results, credentials, and browser state are not stored in business records. Existing server-owned short-lived browser session metadata reuse and isolated contexts remain handled by the existing transport.

Open the test on the same host where you log into S-NOTE. If this tab has no session, open its S-NOTE login link, sign in, then use browser Back. The test reads the existing selected Auth storage and idle-expiry marker without refreshing tokens, creating another client, or changing session storage.

The page distinguishes verified results, a confirmed empty result, an unsupported input, an unconfirmed result update, a provider access challenge, server configuration errors, and upstream service limits. Browser Run quotas and Retry-After are respected. Close/cancel stops the client request; server time is bounded to 50 seconds and owned contexts are released.

Validation: controlled DOM and API fixtures verify matching and failure behavior; Chromium verifies the actual test-page UI at desktop/mobile widths; native Workers checks verify compilation/runtime. These do not establish that the external site accepted a live search. Current environment policy does not allow direct GLOAR/Browser Run network traffic, so production live lookup remains a separate user-facing test. No successful live GLOAR link for `28오6877` is claimed or embedded.

Checks:

```sh
node --test --test-isolation=none tests/gloar-search.test.mjs tests/gloar-search-api.test.mjs
node tests/gloar-search-test.browser.cjs
NODE_PATH=/path/to/wrangler/node_modules node tests/gloar-search.workerd.cjs
```
