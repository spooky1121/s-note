# Research vehicle catalog database switch

The user authorized replacing every old vehicle-selection source with the researched catalog on 2026-11-07. This changes selection data only. Existing vehicles, customers, company memberships and saved registration labels are not rewritten.

Migration: `supabase/migrations/20261107002437_researched_vehicle_catalog_replacement.sql`, created with Supabase CLI `migration new researched_vehicle_catalog_replacement`.

## Storage and backup

All new tables are in the unexposed `snote_catalog_private` schema, have RLS enabled, and grant no table privileges to `anon`, `authenticated` or `service_role`.

| Table | Purpose |
| --- | --- |
| `legacy_entries` | Immutable full-row JSON snapshot of the previous company-specific `public.zc_vehicle_taxonomy`. No company/user identifiers leave the private database. |
| `legacy_backup_manifest` | One immutable snapshot marker, full-row count and deterministic PostgreSQL JSONB SHA-256. |
| `datasets` | Version, expected count, exact runtime-file SHA-256, exact UTF-8 JSON source text and stage/activation timestamps. |
| `catalog_entries` | Complete observation payload, keyed by `(dataset_version, research_id)`, with a unique one-based source ordinal. |
| `active_dataset` | One pointer to a fully validated version. |
| `custom_entries` | Initially empty replacement epoch for future manual company registrations. |

The previous public table remains intact with direct privileges revoked and RLS enabled. The private snapshot has no foreign keys to operational company/auth tables, so later company removal cannot cascade into that backup. Backup rows and their manifest reject insert/update/delete/truncate after the first snapshot. Reapplying this migration preserves the first snapshot, all staged/active versions and every new manual entry.

Neither the old public table nor the private snapshot is queried by the application RPCs. Bundled CSV/browser caches/existing vehicle records must not be merged into the replacement catalog. Research observations do not use the former five-label deduplication key: distinct research IDs retain their own year, engine, fuel, market and evidence fields. All 154 GLOBAL observations remain stored and returned alongside the 2,974 KR observations. Client market filtering does not remove database rows.

## Client RPC contract

`public.snote_research_vehicle_catalog_list()` returns one JSON object:

```json
{
  "dataset_version": "research-20261107-v1",
  "manifest_sha256": "<SHA-256 of exact assets/vehicle-catalog.json UTF-8 bytes>",
  "entry_count": 3128,
  "entries": ["<complete runtime observation JSON, in original order>"]
}
```

`manifest_sha256` is the hash of the runtime file itself, including whitespace and its final newline. It is not the source `official-research.json` hash, a JSONB serialization hash, or a self-referential field inside the runtime file. The client can hash its fetched static file bytes with WebCrypto and compare the result to this RPC. Exact source text plus ordinal/payload validation binds that hash to every database observation.

The frozen `research-20261107-v1` runtime file contains 7,515,869 UTF-8 bytes with SHA-256 `3d7f84f304c3464f780485d5f1a005270ebfa2341d5d79663aea93f04ff34c3a`. The external integration manifest records that same file hash.

No active dataset returns SQLSTATE `55000`; callers must show a load error and retry, without silently reviving old sources. The RPC aggregates all rows into one JSON result, avoiding PostgREST's usual row-count pagination limit.

Existing `public.snote_vehicle_taxonomy_list()` and `public.snote_vehicle_taxonomy_upsert(p_entry jsonb, p_expected_company_id uuid)` retain their argument and JSON response formats. They operate only on the new `custom_entries` epoch. New company entries retain `verification: user_import` and `source: company_vehicle_registration`; they never become globally shared research facts. List returns `{company_id, entries}`; upsert returns `{company_id, entry, inserted}`. Input constraints, normalized five-label identity, idempotent retry and the expected-company guard remain unchanged for these future manual entries.

All three public RPCs are security-invoker wrappers. Only three checked private entry points are security-definer, with an empty search path. Each calls the existing `snote_taxonomy_private.member(boolean)` helper, which uses `auth.uid()` and actual active `zc_members` rows. Missing, inactive, ambiguous or unsupported memberships fail. Accountants can read, while only active dealers/admins can add company custom entries. JWT company/role metadata is not authorization. Private-schema `USAGE` and execution of only those three checked entry points are granted to authenticated callers; no table access, backup function or administrative activation is granted. Keep the private schema outside PostgREST's exposed schema list.

## Owner-only staging and atomic activation

Only the database owner/deployment connection performs these steps. Never add a client or `service_role` grant to staging/activation. Schema and data activation are separate so the migration contains no research seed or company identifiers.

1. Read the final runtime JSON as exact UTF-8 text and compute its SHA-256 before loading it. Verify the external export manifest and the expected 3,128 unique IDs.
2. Insert a new dataset version, exact file hash and `expected_count: 3128` into `datasets` with `raw_document: ''`. Append SQL-quoted text chunks to `raw_document` in order. Do not reserialize the JSON or add/remove whitespace. Only unactivated versions accept updates.
3. Insert entries directly from the stored original JSON:

```sql
insert into snote_catalog_private.catalog_entries
  (dataset_version, research_id, ordinal, payload)
select d.dataset_version, item.payload ->> 'id', item.ordinal::integer, item.payload
from snote_catalog_private.datasets as d
cross join lateral jsonb_array_elements(d.raw_document::jsonb -> 'records')
  with ordinality as item(payload, ordinal)
where d.dataset_version = '<staged-version>';
```

4. Execute the owner-only finalizer:

```sql
select snote_catalog_private.activate_dataset('<staged-version>', '<exact-runtime-file-sha256>');
```

Activation verifies the exact document hash, declared version/schema/count, array length, staged row count, ordinal, stable `id`/`researchId`, and equality of each complete payload with its original source record. Malformed/missing/reordered/tampered observations reject the entire operation. Parent-row locks prevent concurrent stage writes from crossing validation; a transaction advisory lock serializes active-pointer switches. On success, the version becomes immutable and the single active pointer changes in the same transaction. Return JSON includes `previous_version`. Reads continue to see the prior version until the transaction commits.

Activated version metadata, raw document and rows cannot be edited/deleted; truncate is blocked. Fixes use a new version. A failed stage leaves the prior active pointer untouched. Owner rollback calls `activate_dataset` with a previously activated version and its original hash; it revalidates that immutable version before changing the pointer. Do not restore the old legacy selector or merge it into a new version during rollback.

## Verification

Run:

```sh
NODE_PATH=/workspace/work/deps/node_modules node tests/runtime-catalog.sql.cjs
```

The isolated PGlite/PostgreSQL suite performs no network or production writes. It covers repeated migration, exact private backup of six synthetic legacy rows, unchanged operational data/memberships, precise ACLs, RLS under accidental SELECT grants, invoker-only public RPCs, anonymous/service/unauthenticated denial, real active-membership checks, company isolation, accountant read-only behavior, input validation, custom registration retry, full payload/hash/count failures, immutable active/backup data, atomic switch/rollback and complete round-trip of the actual 3,128 runtime records including all 154 GLOBAL observations. This tests SQL execution/permissions in an isolated connection, not concurrent sessions or production network configuration.

All 12 database test groups passed. The separate original `tests/vehicle-taxonomy.sql.cjs` retains its old migration contract and passed all 13 groups. The updated `tests/vehicle-taxonomy.browser.cjs` loads both migrations, seeds/activates the actual runtime file, exercises the real page in Chromium, and passed every manual registration/vehicle ACK/catalog ACK/dropdown UUID/retry/lost ACK/company-switch/late-response regression. Its HTTP fixture intercepts every request; no external request, page error or unexpected endpoint remained.

Production inspection before this change confirmed six legacy entries, three with grades and all six with years; only aggregate counts and schema metadata were queried. No production write is performed by the schema/test author.

Current guidance consulted: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [row level security](https://supabase.com/docs/guides/database/postgres/row-level-security). The required changelog fetch was attempted first, but the browsing tool rejected its markdown content type and the managed network rejected the direct fetch; this did not prevent consulting the current docs through the Supabase documentation connector.

## Production activation record

Applied through the Supabase migration connector as version `20261107003314` (`researched_vehicle_catalog_replacement`); the repository retains the CLI-created source timestamp `20261107002437`. The exact runtime SHA `3d7f84f304c3464f780485d5f1a005270ebfa2341d5d79663aea93f04ff34c3a` was activated on 2026-11-07 at 00:38:57 UTC. All 3,128 observations, including 154 GLOBAL observations, were returned by the live authenticated RPC. The six legacy rows and the two operational vehicle datasets had unchanged complete-row hashes before and after activation. See [aggregate verification](runtime-catalog-verification.json); no company/user identifiers or private payloads are published there.
