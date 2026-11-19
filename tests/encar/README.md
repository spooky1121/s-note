# Advertisement lookup test gates

The active Encar-button flow is now the read-only `/api/encar-id` contract. Run `npm test --prefix tests/encar` for the API, ordered resolver, retired endpoints, independent parsers and unrelated application regressions. Run `npm run test:browser --prefix tests/encar` for the actual list/card/detail ID-only UI.

The old `server`, `discovery`, `server-price`, `frontend`, `integration`, `saved-bridge`, `list-price-entry`, and automatic-price endpoint specs describe the removed workflow. They remain as historical reference; they are deliberately absent from the current gate. The original baseline is commit `07494c5cec445d741267ca0ca3b8a21d4d5eb533`. Their former Korean-page, automatic-price and database-write behavior must not be restored to make those old expectations pass.

Provider tests use injected search results. Actual Carnect/GLOAR/Trust search requests still need live verification in an environment allowing their domains. The default new API is intentionally fail-closed with `LOOKUP_NOT_CONFIGURED`; this branch is not ready for production until verified provider adapters are connected. Mocked UI or resolver success does not establish live-site search coverage.
