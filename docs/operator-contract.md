# S-NOTE platform operator contract

The platform operator is an explicit account capability, separate from an ordinary company administrator. The migration never chooses an account or inserts an allowlist entry. The deployment owner must provision only the confirmed Auth user explicitly approved by the user; never infer ownership from an email domain, company role, JWT metadata or signup fields.

Core migration: `20261107013019_platform_operator_console.sql` (created with Supabase CLI). Access tracking follows in the separate `20261107013521_platform_operator_access.sql`; see `operator-access.md`.

## Authorization and storage

`public.snote_operator_context()` returns `{allowed:false}` for an unauthorized authenticated account, or `{allowed:true,actorId,sessionId,email}`. Every privileged entry point repeats the server-side check. It requires all of:

- An actual confirmed, nonanonymous, nondeleted, nonbanned `auth.users` row.
- The signed JWT `session_id` matching an unexpired, existing `auth.sessions` row owned by that user.
- An active row in the private `operators` allowlist and no platform account archive.

A company administrator, dealer or accountant receives no platform authority. Missing, forged, expired or revoked sessions fail. Public wrappers are security-invoker; checked private entry points are security-definer with an empty search path. Helper functions grant no client execution. Server-only RPCs additionally require `service_role` and revalidate the explicitly supplied original operator/session. The service key belongs only in the Cloudflare server environment.

All new tables use RLS and grant no table access to anonymous, authenticated or service roles. The private schema must remain outside the exposed PostgREST schema list. `audit_log` rejects update/delete/truncate, including owner mistakes; operational audit contains actor/session/request identifiers and safe before/after values, never plaintext passwords, password hashes, resident numbers, encryption keys or raw customer ciphertext.

## Lists and editing

The three list RPCs accept one `p_query jsonb` object:

```json
{"query":"","page":1,"sort":"model","direction":"asc","status":"all","companyId":"optional UUID","ownerId":"optional UUID"}
```

They return `{items,total,page,pageSize:20}`. Search text is bounded, identifiers and sort/status values are validated, and SQL sort direction/keys cannot inject SQL.

| RPC | Status values | Sort values |
| --- | --- | --- |
| `snote_operator_vehicles_list` | `all`, `inventory`, `sold`, `archived` | `model`, `plate`, `companyName`, `ownerName`, `status`, `buy`, `sell`, `updatedAt` |
| `snote_operator_accounts_list` | `all`, `active`, `archived` | `displayName`, `email`, `createdAt`, `lastSignInAt` |
| `snote_operator_companies_list` | `all`, `active`, `archived` | `name`, `memberCount`, `vehicleCount`, `createdAt` |

Vehicle items contain `{companyId,companyName,ownerId,ownerName,carId,vehicle,revision,coversRevision,mediaCount,hasCustomer,updatedAt,recycleId}`. `vehicle` contains a safe field allowlist, excluding embedded customer and income identity ciphertext. Legacy fixed-cost JSON may use the old wire units; the API normalizes it with `SnoteMoney.car` before returning data to the UI or merging an edit. `customCosts` and `customCostLabels` always use won regardless of the fixed-cost legacy marker and survive copy/move unchanged. Each permits at most 128 stable `custom-UUID` keys, integer values from 0 through 1,000,000,000,000, and labels of at most 24 characters.

Account items contain `{userId,email,displayName,phone,address,memberships,active,archived,createdAt,lastSignInAt,version}` plus safe status metadata. Each membership contains `{companyId,companyName,role,active}`. Company items contain `{companyId,name,businessNumber,representativeName,businessPhone,postcode,address,addressDetail,active,archived,memberCount,vehicleCount,version}`. Account/company `version` is a hash of actual mutable server-owned state, so a concurrent self-profile or ordinary company edit causes a conflict.

Mutation RPCs all require a fresh UUID `p_request_id`. The same identifier and identical payload replay the committed result; reuse for a different operation/payload fails. Failed SQL mutations roll back their receipts and audit together.

| RPC | Arguments after the common request identifier | Result |
| --- | --- | --- |
| `snote_operator_vehicle_save` | `p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_vehicle jsonb` | `{ok,vehicle,revision}` |
| `snote_operator_vehicle_archive` | Same scope, `p_expected integer,p_expected_covers integer` | Safe recycle acknowledgement with `id` |
| `snote_operator_vehicle_restore` | `p_company uuid,p_entry uuid` | Safe recycle acknowledgement |
| `snote_operator_account_save` | `p_user uuid,p_expected text,p_patch jsonb` | `{ok,account:{...version}}` |
| `snote_operator_account_state` | `p_user uuid,p_expected text,p_active boolean` | `{ok,account,revokedSessions}` |
| `snote_operator_company_save` | `p_company uuid,p_expected text,p_patch jsonb` | `{ok,company:{...version}}` |
| `snote_operator_company_state` | `p_company uuid,p_expected text,p_active boolean` | `{ok,company,revokedSessions}` |

Vehicle save locks and checks the entire owner's dataset revision, preserves identifiers, existing top-level fields and all private cipher paths, validates numeric/custom fields, and stores the API's complete merged candidate with `moneyUnit:'KRW'`. The API loads the private full original through the server-only `snote_operator_vehicle_read(p_actor,p_session,p_company,p_owner,p_car_id)` before merging the frontend's safe patch. That read returns `{companyId,ownerId,carId,vehicle,revision,coversRevision,media}` only to the server.

Account patches permit `{displayName,phone,address,companyId,role}`. `companyId` chooses an existing membership for a role/name correction; it does not move the account's vehicles or create memberships. A role is one of `admin/dealer/accountant`. Without a selected company, a name correction updates existing memberships; an unassigned account retains the name in nonauthoritative display metadata. Phone/address update the private profile and the registered dealer contact; no Auth email/password fields are written through this RPC. Company patches permit the safe company fields listed above, never internal IDs or authorization flags.

## Recoverable deletion

Vehicle deletion uses the existing complete private recycle bundle, including linked customer rows, legacy resident-number ciphertext, media metadata and retained file bytes. The original tenant RPC/member guards are unchanged; separate operator-checked private helpers reuse the archival/collision/restore logic. No physical file deletion occurs. Restore rejects newer-row/media-slot collisions and verifies that retained files still exist.

Account archival deactivates every membership, archives the private state, disables any prior operator capability, and deletes all of the account's Auth sessions. It does not hard-delete `auth.users` or cascade vehicles/customers/files. Existing JWTs are immediately blocked from tenant business data because memberships are inactive; session deletion alone would not provide that guarantee. A trigger prevents ordinary company administration from reactivating platform-archived accounts or companies.

Company archival deactivates every company membership and revokes those members' sessions, while preserving company/business data. Archiving the operator's own company also revokes that current session; the operator must sign in again for further requests. Archiving the operator's own account is refused, and the final active platform operator cannot be removed.

A private membership-intent baseline preserves the original active/inactive state when account and company archives overlap. Restore in either order reactivates a membership only after both scopes are restored and only if that original membership was active. Previously inactive users remain inactive. Sessions are never resurrected by restore, and existing independent Auth bans/deletions are not cleared.

## Copy and move with real files

The server orchestrates a prepared job, actual Storage copies, cipher rewrapping and one atomic SQL commit. It must not report success after only editing JSON ownership fields.

All transfer RPCs are server-only and begin with `p_actor uuid,p_session uuid,p_request_id uuid`:

- `snote_operator_transfer_prepare(...,p_source jsonb,p_target jsonb,p_mode text)` accepts source `{companyId,ownerId,carId,revision,coversRevision}`, target `{companyId,ownerId}`, and `copy|move`. It locks the company scopes in a stable order and stores an immutable source snapshot plus fixed destination car/media IDs and paths.
- `snote_operator_transfer_get(...)` returns the same job and whether each exact target file already exists with matching size/MIME. The API may copy in bounded batches, returning a continuation with the same request ID.
- `snote_operator_transfer_commit(...,p_vehicle jsonb,p_customer jsonb)` accepts the original-shaped source vehicle and optional canonical customer payload with only identity ciphertext rewrapped. SQL checks that no other field changed, then applies destination IDs and provenance itself.
- `snote_operator_transfer_abort(...)` marks an uncommitted job aborted and returns only that job's exact `cleanupPaths`. A committed job returns no cleanup paths. An uncertain response is resolved by reading the same job, never by blindly deleting copied files.

The prepared result contains `{jobId,status,mode,source,target,vehicle,customer,media:[{source,target,copied}],cover,legacyRrnCount,blockers,result}`. The canonical customer may belong to a different original uploader; the API uses that row's actual AAD scope for its cipher. More than one canonical customer/legacy row is an explicit ambiguity blocker. Media likewise retains its original uploader in the source manifest but moves to the destination car owner. Fixed destination paths use `company/owner/newCar/newMedia.ext`.

Cover lookup considers photo records only. Multiple photo owners with the same cover ID produce `AMBIGUOUS_COVER`; an absent referenced photo produces `COVER_MEDIA_MISSING`. Unsupported old cipher objects and resident-number flags with no usable canonical/legacy ciphertext stop the transfer with an explicit blocker. Source data remains intact.

The API copies the actual private object bytes, verifies ambiguous/lost-copy acknowledgements, and re-encrypts every embedded `smi1` and `isi1` cipher with the destination company/owner/car AAD. SQL rejects unchanged old ciphertext in a new AAD context. Legacy PGP ciphertext is handled inside the private database function: same-company copy preserves it; cross-company copy decrypts with the original company key and encrypts with the destination key without returning plaintext. Original expiry/creation times are preserved. Disabled target resident-number storage or missing keys are explicit blockers.

Commit checks source/target cars and covers revisions, complete customer timestamp/generation/payload, full media metadata and source Storage object metadata. Every fixed destination object must actually exist with the expected MIME/size. A restrictive Storage policy hides prepared/aborted destination paths from ordinary users, including their destination company; source objects are protected against writes while a valid job is prepared. Service copying/cleanup follows the existing server role. Destination metadata and the job's committed state become visible together in the SQL transaction.

Copy preserves the source. Move archives the full original bundle, revokes original shares and outstanding source intake links, then inserts the new vehicle/customer/media/cover atomically. Neither action copies share grants, OTP/token state or active customer-intake requests. Existing `intakeSource` remains historical provenance only; new `transferSource` records the original scope. Client aliases are rewritten to `cld_` plus the first 18 hyphen-free user-ID characters, including canonical customer `id/ownerId/carId`. Restoring a moved source restores that source bundle; it does not silently delete the destination.

## Email/password administration

Auth identity changes go through the server's Supabase Auth Admin API. `snote_operator_auth_prepare` accepts the actor/session, target user, expected account version, request ID, an opaque server HMAC fingerprint, changed field names and an optional new email. It persists no password or password hash. `snote_operator_auth_finalize` accepts success and a sanitized `{id,email?}` result, verifies the actual Auth email for email changes, revokes other target sessions, records an immutable result and returns the fresh account version.

Prepared Auth operations expire after 15 minutes and retain their original expected version. Replaying a pending operation rechecks that version, including the actual Auth `updated_at` timestamp, so an old request cannot overwrite a newer email/password change. Expired finalization also fails closed.

The external Auth HTTP operation and SQL audit finalization cannot form a single PostgreSQL transaction. A lost/uncertain Auth response remains a prepared job for reconciliation, without claiming success. If a self-password change revokes the operator's current session, strict finalization also requires signing in again; no revoked-session bypass is introduced.

## Validation boundaries

`tests/operator-core.sql.cjs` runs against isolated PGlite with the real tenant/recycle schema and synthetic accounts. No production or network writes occur. It verifies strict sessions/allowlist separation, exact ACL/RLS, immutable audit, CAS/replay, safe pagination/search, nested archive restoration, private-file staging visibility, copy/move/restore and Auth finalization. Its visibly synthetic PGP functions check SQL source/destination key choice and retention, not cryptographic primitives; production uses the existing `extensions.pgp_sym_*` implementation. API tests separately exercise real AES-GCM AAD rewrapping and actual copied-byte behavior through HTTP fixtures.

Final validation: all 16 core SQL groups passed, all 7 access SQL groups passed, and `tests/operator-api.sql.integration.test.mjs` passed with the actual worker and actual migrations. That integration covers copied bytes, differently owned canonical customer/media AAD, signatures, custom won costs, vehicle editing, move/archive/restore, account/company changes, Auth finalization and ordinary-admin/revoked-session denial. The verified core migration SHA-256 is `51d563d44e9da87945978271afe20fb641884471a9fdfaf4483d5830a2e0acea`.

Consulted current Supabase guidance: [Auth sessions and logout verification](https://supabase.com/docs/guides/auth/sessions), [database functions](https://supabase.com/docs/guides/database/functions), and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Production inspection was read-only; deployment, the one authorized allowlist seed and any production test are performed by the root/deployment agent after review.
