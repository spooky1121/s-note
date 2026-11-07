# Private support conversations

Migration: `20261107042252_scoped_support_conversations.sql`, generated with Supabase CLI. It creates only new private support tables/functions; it does not change business records, company roles, vehicle sharing, Storage policy or existing RPCs.

A conversation belongs to one active user's company scope. A user changing companies cannot access the previous company's conversation through the current scope. Users may read/write only their own conversation; even an ordinary company administrator cannot inspect another user's support messages. All normal calls require an actual live Auth session and the existing active-member check. Their expected user/company arguments prevent delayed SDK token lookup from sending an old account's text with a newly signed-in account's credentials.

Operator calls use the existing strict platform-operator allowlist and actual Auth-session guard. No service key is needed for these actions. Public functions are security-invoker wrappers around checked private definer entry points with empty search paths. Private tables and sequences grant no direct anonymous/authenticated/service access and use RLS as a second barrier.

## RPC contract

Normal RPCs:

- `snote_support_messages(p_expected_company_id uuid,p_expected_user_id uuid,p_limit integer = 50,p_before bigint = null)`
- `snote_support_send(p_expected_company_id uuid,p_expected_user_id uuid,p_text text,p_request_id uuid)`
- `snote_support_read(p_expected_company_id uuid,p_expected_user_id uuid,p_message_ids uuid[])`

Operator RPCs:

- `snote_operator_support_threads(p_query jsonb = '{}')`, where query permits `query,page,status: all|unread,companyId`.
- `snote_operator_support_messages(p_conversation_id uuid,p_limit integer = 50,p_before bigint = null)`
- `snote_operator_support_read(p_conversation_id uuid,p_message_ids uuid[])`
- `snote_operator_support_reply(p_conversation_id uuid,p_text text,p_request_id uuid)`
- `snote_operator_support_unread()`

Message JSON is `{id,sequence,sender: user|operator,text,createdAt,readAt}`. Its sender's account ID is kept privately rather than disclosing operator identities to normal users. Text is plain text, trimmed, 1–2,000 characters, with newline/tab permitted and other control characters rejected. Send/reply retries use a unique `(sender_id,client_request_id)` and must match the original conversation, sender direction and text. A retry returns the same canonical message with `duplicate:true`, without inserting another row or another operator audit event.

History returns `{conversation,messages,hasMore,nextBefore,unreadCount}`. Messages are chronological within the latest requested page; use `nextBefore` to load older records. The default is 50, maximum 100. User history does not create an empty conversation. User conversation JSON contains `{id,companyId,userId,updatedAt}`; `id` is null before the first send.

Operator conversation metadata is `{id,companyId,companyName,userId,userName,email,updatedAt,lastMessage,lastMessageAt,unreadCount}`. Operator history/reply/read additionally return global `unreadTotal`. Thread lists return `{items,total,page,pageSize:20,unreadTotal}`; `unreadTotal` counts individual unread user messages across the inbox, not threads and not the filtered list. User `unreadCount` counts operator replies the user has not acknowledged.

Send/reply returns `{conversation,message,duplicate,unreadCount}` plus `unreadTotal` for operators. A read acknowledgement returns `{readCount,unreadCount}` plus operator `unreadTotal`. Operator unread returns `{unreadTotal}`.

## Reading and races

Fetching history never marks anything read. The UI acknowledges only the UUIDs actually displayed, at most 100 unique IDs per request. Every ID must exist in that conversation. Updates affect only the opposite sender's currently unread rows. Therefore a newly arriving message, including a delayed transaction with a lower sequence, remains unread unless its exact ID was acknowledged. Repeated acknowledgements return `readCount:0`; they cannot erase newer unread messages. Replying does not implicitly mark incoming messages read.

Messages have immutable content/identity; only first read receipts can be added. New operator replies and successful operator acknowledgements also append the existing immutable platform audit log with message/conversation IDs, not private message text.

## Verification

`NODE_PATH=/workspace/work/deps/node_modules node tests/support-chat.sql.cjs` runs isolated PGlite with the actual member/operator SQL and two real synthetic user identities plus a separate platform operator. All 14 groups passed: company/user isolation, ordinary-admin denial, exact session checks, idempotency, bidirectional replies, incoming-message counts, explicit-ID read races, delayed lower sequences, 50/100-message history, twenty-thread paging, text validation, ACL/RLS, immutable bodies and repeat migration. Race states are modeled on one isolated connection; no production data or external messages are used.

The test exports `createSupportFixture()` for worker/API integration. It loads the real operator baseline, taxonomy member guard and support migration; the caller may then seed only synthetic test actors/sessions and owns closing the returned database.
