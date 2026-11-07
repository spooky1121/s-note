-- Private two-way support conversations. Existing business data and access
-- roles are unchanged; only explicit, authenticated messages create new rows.
begin;
create schema if not exists snote_support_private;
revoke all on schema snote_support_private from public,anon,authenticated,service_role;

create table if not exists snote_support_private.conversations(
 id uuid primary key default pg_catalog.gen_random_uuid(),
 company_id uuid not null references public.zc_companies(id),
 user_id uuid not null references auth.users(id),
 created_at timestamptz not null default pg_catalog.clock_timestamp(),
 updated_at timestamptz not null default pg_catalog.clock_timestamp(),
 unique(company_id,user_id)
);
create index if not exists support_conversations_user_idx on snote_support_private.conversations(user_id);
create index if not exists support_conversations_updated_idx on snote_support_private.conversations(updated_at desc,id desc);
create table if not exists snote_support_private.messages(
 id uuid primary key default pg_catalog.gen_random_uuid(),
 seq bigint generated always as identity unique check(seq between 1 and 9007199254740991),
 conversation_id uuid not null references snote_support_private.conversations(id),
 sender_id uuid not null references auth.users(id),
 sender_kind text not null check(sender_kind in('user','operator')),
 client_request_id uuid not null,
 body text not null check(pg_catalog.char_length(body) between 1 and 2000),
 created_at timestamptz not null default pg_catalog.clock_timestamp(),
 operator_read_at timestamptz,operator_read_by uuid,user_read_at timestamptz,
 unique(sender_id,client_request_id),
 check((operator_read_at is null)=(operator_read_by is null))
);
create index if not exists support_messages_thread_seq_idx on snote_support_private.messages(conversation_id,seq desc);
create index if not exists support_messages_operator_unread_idx on snote_support_private.messages(conversation_id,seq)
 where sender_kind='user' and operator_read_at is null;
create index if not exists support_messages_user_unread_idx on snote_support_private.messages(conversation_id,seq)
 where sender_kind='operator' and user_read_at is null;
alter table snote_support_private.conversations enable row level security;
alter table snote_support_private.messages enable row level security;
revoke all on table snote_support_private.conversations,snote_support_private.messages from public,anon,authenticated,service_role;
revoke all on all sequences in schema snote_support_private from public,anon,authenticated,service_role;

create or replace function snote_support_private.member(p_expected_company_id uuid,p_expected_user_id uuid)
returns table(company_id uuid,user_id uuid) language plpgsql set search_path='' as $$
declare v_member record;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' then raise exception 'SUPPORT_AUTH_REQUIRED' using errcode='42501';end if;
 perform 1 from snote_operator_private.verified_session(auth.uid(),snote_operator_private.claim_session());
 select * into v_member from snote_taxonomy_private.member(false);
 if p_expected_company_id is distinct from v_member.company_id or p_expected_user_id is distinct from v_member.actor_id then
  raise exception 'SUPPORT_CONTEXT_CHANGED' using errcode='42501';
 end if;
 return query select v_member.company_id,v_member.actor_id;
end$$;
create or replace function snote_support_private.validate_text(p_text text)
returns text language plpgsql immutable set search_path='' as $$
declare v_text text:=pg_catalog.btrim(p_text);
begin
 if v_text is null or pg_catalog.char_length(v_text) not between 1 and 2000
  or pg_catalog.regexp_replace(v_text,E'[\n\r\t]','','g')~'[[:cntrl:]]' then raise exception 'SUPPORT_INVALID_TEXT' using errcode='22023';end if;
 return v_text;
end$$;
create or replace function snote_support_private.message_json(p_message snote_support_private.messages)
returns jsonb language sql stable set search_path='' as $$
 select pg_catalog.jsonb_build_object('id',p_message.id,'sequence',p_message.seq,'sender',p_message.sender_kind,
 'text',p_message.body,'createdAt',p_message.created_at,'readAt',case when p_message.sender_kind='user' then p_message.operator_read_at else p_message.user_read_at end);
$$;
create or replace function snote_support_private.own_conversation(p_conversation snote_support_private.conversations)
returns jsonb language sql stable set search_path='' as $$
 select pg_catalog.jsonb_build_object('id',p_conversation.id,'companyId',p_conversation.company_id,'userId',p_conversation.user_id,'updatedAt',p_conversation.updated_at);
$$;
create or replace function snote_support_private.unread_total()
returns bigint language sql stable set search_path='' as $$
 select pg_catalog.count(*) from snote_support_private.messages where sender_kind='user' and operator_read_at is null;
$$;
create or replace function snote_support_private.unread_for(p_conversation uuid,p_for_operator boolean)
returns bigint language sql stable set search_path='' as $$
 select pg_catalog.count(*) from snote_support_private.messages where conversation_id=p_conversation
 and case when p_for_operator then sender_kind='user' and operator_read_at is null else sender_kind='operator' and user_read_at is null end;
$$;
create or replace function snote_support_private.thread_json(p_conversation uuid)
returns jsonb language sql stable set search_path='' as $$
 select pg_catalog.jsonb_build_object('id',c.id,'companyId',c.company_id,'companyName',co.name,'userId',c.user_id,
 'userName',coalesce(nullif(m.display_name,''),u.raw_user_meta_data->>'display_name',u.email,''),'email',coalesce(u.email,''),
 'updatedAt',c.updated_at,'lastMessage',last_message.body,'lastMessageAt',last_message.created_at,
 'unreadCount',snote_support_private.unread_for(c.id,true))
 from snote_support_private.conversations c join public.zc_companies co on co.id=c.company_id join auth.users u on u.id=c.user_id
 left join public.zc_members m on m.company_id=c.company_id and m.user_id=c.user_id
 left join lateral(select body,created_at from snote_support_private.messages where conversation_id=c.id order by seq desc limit 1)last_message on true
 where c.id=p_conversation;
$$;
create or replace function snote_support_private.messages_page(p_conversation uuid,p_limit integer,p_before bigint)
returns jsonb language plpgsql set search_path='' as $$
declare v_result jsonb;
begin
 if p_limit is null or p_limit not between 1 and 100 or(p_before is not null and p_before not between 1 and 9007199254740991) then raise exception 'SUPPORT_INVALID_PAGE' using errcode='22023';end if;
 with selected as materialized(
  select * from snote_support_private.messages where conversation_id=p_conversation and(p_before is null or seq<p_before) order by seq desc limit p_limit+1
 ),page as materialized(select * from selected order by seq desc limit p_limit)
 select pg_catalog.jsonb_build_object('messages',coalesce(pg_catalog.jsonb_agg(snote_support_private.message_json(p::snote_support_private.messages) order by p.seq),'[]'::jsonb),
 'hasMore',(select pg_catalog.count(*) from selected)>p_limit,'nextBefore',case when(select pg_catalog.count(*) from selected)>p_limit then pg_catalog.min(p.seq) else null end)
 into v_result from page p;
 return v_result;
end$$;
create or replace function snote_support_private.send_message(p_conversation uuid,p_actor uuid,p_kind text,p_text text,p_request uuid)
returns jsonb language plpgsql set search_path='' as $$
declare v_row snote_support_private.messages;v_text text:=snote_support_private.validate_text(p_text);v_now timestamptz:=pg_catalog.clock_timestamp();v_inserted boolean;
begin
 if p_request is null then raise exception 'SUPPORT_REQUEST_REQUIRED' using errcode='22023';end if;
 insert into snote_support_private.messages(conversation_id,sender_id,sender_kind,client_request_id,body,created_at,operator_read_at,operator_read_by,user_read_at)
 values(p_conversation,p_actor,p_kind,p_request,v_text,v_now,case when p_kind='operator' then v_now end,case when p_kind='operator' then p_actor end,case when p_kind='user' then v_now end)
 on conflict(sender_id,client_request_id) do nothing returning * into v_row;
 v_inserted:=found;
 if not v_inserted then
  select * into v_row from snote_support_private.messages where sender_id=p_actor and client_request_id=p_request;
  if not found or v_row.conversation_id is distinct from p_conversation or v_row.sender_kind is distinct from p_kind or v_row.body is distinct from v_text then
   raise exception 'SUPPORT_REQUEST_REUSED' using errcode='22023';
  end if;
 else
  update snote_support_private.conversations set updated_at=greatest(updated_at,v_now) where id=p_conversation;
 end if;
 return pg_catalog.jsonb_build_object('message',snote_support_private.message_json(v_row),'duplicate',not v_inserted);
end$$;
create or replace function snote_support_private.validate_read_ids(p_conversation uuid,p_message_ids uuid[])
returns void language plpgsql set search_path='' as $$
begin
 if p_message_ids is null or pg_catalog.cardinality(p_message_ids)>100
  or exists(select 1 from pg_catalog.unnest(p_message_ids) requested(id) where requested.id is null)
  or pg_catalog.cardinality(p_message_ids)<>(select pg_catalog.count(distinct requested.id) from pg_catalog.unnest(p_message_ids)requested(id)) then raise exception 'SUPPORT_INVALID_READ_IDS' using errcode='22023';end if;
 if exists(select 1 from pg_catalog.unnest(p_message_ids)requested(id) where not exists(select 1 from snote_support_private.messages m where m.id=requested.id and m.conversation_id=p_conversation)) then
  raise exception 'SUPPORT_MESSAGE_SCOPE' using errcode='42501';
 end if;
end$$;

create or replace function snote_support_private.user_messages(p_expected_company_id uuid,p_expected_user_id uuid,p_limit integer,p_before bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record;v_conversation snote_support_private.conversations;v_page jsonb;
begin
 select * into v_member from snote_support_private.member(p_expected_company_id,p_expected_user_id);
 select * into v_conversation from snote_support_private.conversations where company_id=v_member.company_id and user_id=v_member.user_id;
 v_page:=snote_support_private.messages_page(v_conversation.id,p_limit,p_before);
 return v_page||pg_catalog.jsonb_build_object('conversation',case when v_conversation.id is null then pg_catalog.jsonb_build_object('id',null,'companyId',v_member.company_id,'userId',v_member.user_id) else snote_support_private.own_conversation(v_conversation) end,
 'unreadCount',snote_support_private.unread_for(v_conversation.id,false));
end$$;
create or replace function snote_support_private.user_send(p_expected_company_id uuid,p_expected_user_id uuid,p_text text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record;v_conversation snote_support_private.conversations;v_result jsonb;
begin
 select * into v_member from snote_support_private.member(p_expected_company_id,p_expected_user_id);
 perform snote_support_private.validate_text(p_text);
 if p_request_id is null then raise exception 'SUPPORT_REQUEST_REQUIRED' using errcode='22023';end if;
 insert into snote_support_private.conversations(company_id,user_id) values(v_member.company_id,v_member.user_id) on conflict(company_id,user_id) do nothing;
 select * into v_conversation from snote_support_private.conversations where company_id=v_member.company_id and user_id=v_member.user_id for update;
 v_result:=snote_support_private.send_message(v_conversation.id,v_member.user_id,'user',p_text,p_request_id);
 select * into v_conversation from snote_support_private.conversations where id=v_conversation.id;
 return v_result||pg_catalog.jsonb_build_object('conversation',snote_support_private.own_conversation(v_conversation),'unreadCount',snote_support_private.unread_for(v_conversation.id,false));
end$$;
create or replace function snote_support_private.user_read(p_expected_company_id uuid,p_expected_user_id uuid,p_message_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_member record;v_conversation uuid;v_count integer;
begin
 select * into v_member from snote_support_private.member(p_expected_company_id,p_expected_user_id);
 select id into v_conversation from snote_support_private.conversations where company_id=v_member.company_id and user_id=v_member.user_id;
 perform snote_support_private.validate_read_ids(v_conversation,p_message_ids);
 update snote_support_private.messages set user_read_at=pg_catalog.clock_timestamp()
 where conversation_id=v_conversation and id=any(p_message_ids) and sender_kind='operator' and user_read_at is null;
 get diagnostics v_count=row_count;
 return pg_catalog.jsonb_build_object('readCount',v_count,'unreadCount',snote_support_private.unread_for(v_conversation,false));
end$$;

create or replace function snote_support_private.operator_threads(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_operator_private.actor();v_query jsonb:=coalesce(p_query,'{}'::jsonb);v_search text;v_status text;v_page integer;v_company uuid;v_rows jsonb;v_total bigint;
begin
 if pg_catalog.jsonb_typeof(v_query)<>'object' or pg_catalog.octet_length(v_query::text)>2000
 or exists(select 1 from pg_catalog.jsonb_object_keys(v_query)key where key not in('query','page','status','companyId')) then raise exception 'SUPPORT_INVALID_QUERY' using errcode='22023';end if;
 if coalesce(v_query->>'page','1')!~'^[1-9][0-9]{0,6}$' then raise exception 'SUPPORT_INVALID_PAGE' using errcode='22023';end if;
 v_page:=(coalesce(v_query->>'page','1'))::integer;v_search:=pg_catalog.btrim(coalesce(v_query->>'query',''));v_status:=coalesce(v_query->>'status','all');
 if v_page>1000000 or pg_catalog.char_length(v_search)>120 or v_status not in('all','unread') then raise exception 'SUPPORT_INVALID_QUERY' using errcode='22023';end if;
 begin v_company:=nullif(v_query->>'companyId','')::uuid;exception when invalid_text_representation then raise exception 'SUPPORT_INVALID_COMPANY' using errcode='22023';end;
 with filtered as materialized(
  select c.id,c.updated_at from snote_support_private.conversations c join public.zc_companies co on co.id=c.company_id join auth.users u on u.id=c.user_id
  left join public.zc_members m on m.company_id=c.company_id and m.user_id=c.user_id
  where(v_company is null or c.company_id=v_company)
  and(v_status='all' or exists(select 1 from snote_support_private.messages where conversation_id=c.id and sender_kind='user' and operator_read_at is null))
  and(v_search='' or pg_catalog.lower(co.name||' '||coalesce(m.display_name,'')||' '||coalesce(u.email,'')) like '%'||pg_catalog.lower(v_search)||'%'
   or exists(select 1 from snote_support_private.messages where conversation_id=c.id and pg_catalog.lower(body) like '%'||pg_catalog.lower(v_search)||'%'))
 ),page as(select * from filtered order by updated_at desc,id desc limit 20 offset(v_page-1)*20)
 select coalesce((select pg_catalog.jsonb_agg(snote_support_private.thread_json(p.id) order by p.updated_at desc,p.id desc) from page p),'[]'::jsonb),(select pg_catalog.count(*) from filtered)
 into v_rows,v_total;
 return pg_catalog.jsonb_build_object('items',v_rows,'total',v_total,'page',v_page,'pageSize',20,'unreadTotal',snote_support_private.unread_total());
end$$;
create or replace function snote_support_private.operator_messages(p_conversation_id uuid,p_limit integer,p_before bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_operator_private.actor();v_thread jsonb;v_page jsonb;
begin
 v_thread:=snote_support_private.thread_json(p_conversation_id);
 if v_thread is null then raise exception 'SUPPORT_THREAD_NOT_FOUND' using errcode='22023';end if;
 v_page:=snote_support_private.messages_page(p_conversation_id,p_limit,p_before);
 return v_page||pg_catalog.jsonb_build_object('conversation',v_thread,'unreadCount',snote_support_private.unread_for(p_conversation_id,true),'unreadTotal',snote_support_private.unread_total());
end$$;
create or replace function snote_support_private.operator_unread()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_operator_private.actor();
begin return pg_catalog.jsonb_build_object('unreadTotal',snote_support_private.unread_total());end$$;
create or replace function snote_support_private.operator_read(p_conversation_id uuid,p_message_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_operator_private.actor();v_count integer;v_marked jsonb;
begin
 if not exists(select 1 from snote_support_private.conversations where id=p_conversation_id) then raise exception 'SUPPORT_THREAD_NOT_FOUND' using errcode='22023';end if;
 perform snote_support_private.validate_read_ids(p_conversation_id,p_message_ids);
 with marked as(
  update snote_support_private.messages set operator_read_at=pg_catalog.clock_timestamp(),operator_read_by=v_actor
  where conversation_id=p_conversation_id and id=any(p_message_ids) and sender_kind='user' and operator_read_at is null returning id
 )select pg_catalog.count(*)::integer,coalesce(pg_catalog.jsonb_agg(id),'[]'::jsonb) into v_count,v_marked from marked;
 if v_count>0 then perform snote_operator_private.log(v_actor,snote_operator_private.claim_session(),'support_read',p_conversation_id::text,null,null,null,pg_catalog.jsonb_build_object('messageIds',v_marked));end if;
 return pg_catalog.jsonb_build_object('readCount',v_count,'unreadCount',snote_support_private.unread_for(p_conversation_id,true),'unreadTotal',snote_support_private.unread_total());
end$$;
create or replace function snote_support_private.operator_reply(p_conversation_id uuid,p_text text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_operator_private.actor();v_conversation snote_support_private.conversations;v_result jsonb;
begin
 select * into v_conversation from snote_support_private.conversations where id=p_conversation_id for update;
 if not found then raise exception 'SUPPORT_THREAD_NOT_FOUND' using errcode='22023';end if;
 v_result:=snote_support_private.send_message(p_conversation_id,v_actor,'operator',p_text,p_request_id);
 if v_result->>'duplicate'='false' then perform snote_operator_private.log(v_actor,snote_operator_private.claim_session(),'support_reply',v_result->'message'->>'id',v_conversation.company_id,p_request_id,null,pg_catalog.jsonb_build_object('conversationId',p_conversation_id,'messageId',v_result->'message'->'id'));end if;
 return v_result||pg_catalog.jsonb_build_object('conversation',snote_support_private.thread_json(p_conversation_id),'unreadCount',snote_support_private.unread_for(p_conversation_id,true),'unreadTotal',snote_support_private.unread_total());
end$$;

-- Message content and identity cannot be edited through a read-receipt update.
create or replace function snote_support_private.message_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.id,new.seq,new.conversation_id,new.sender_id,new.sender_kind,new.client_request_id,new.body,new.created_at)
 is distinct from row(old.id,old.seq,old.conversation_id,old.sender_id,old.sender_kind,old.client_request_id,old.body,old.created_at)
 or(old.operator_read_at is not null and row(new.operator_read_at,new.operator_read_by) is distinct from row(old.operator_read_at,old.operator_read_by))
 or(old.user_read_at is not null and new.user_read_at is distinct from old.user_read_at) then raise exception 'SUPPORT_MESSAGE_IMMUTABLE' using errcode='55000';end if;
 return new;
end$$;
drop trigger if exists support_message_immutable on snote_support_private.messages;
create trigger support_message_immutable before update on snote_support_private.messages for each row execute function snote_support_private.message_immutable();

create or replace function public.snote_support_messages(p_expected_company_id uuid,p_expected_user_id uuid,p_limit integer default 50,p_before bigint default null)
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.user_messages(p_expected_company_id,p_expected_user_id,p_limit,p_before);$$;
create or replace function public.snote_support_send(p_expected_company_id uuid,p_expected_user_id uuid,p_text text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.user_send(p_expected_company_id,p_expected_user_id,p_text,p_request_id);$$;
create or replace function public.snote_support_read(p_expected_company_id uuid,p_expected_user_id uuid,p_message_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.user_read(p_expected_company_id,p_expected_user_id,p_message_ids);$$;
create or replace function public.snote_operator_support_threads(p_query jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.operator_threads(p_query);$$;
create or replace function public.snote_operator_support_messages(p_conversation_id uuid,p_limit integer default 50,p_before bigint default null)
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.operator_messages(p_conversation_id,p_limit,p_before);$$;
create or replace function public.snote_operator_support_read(p_conversation_id uuid,p_message_ids uuid[])
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.operator_read(p_conversation_id,p_message_ids);$$;
create or replace function public.snote_operator_support_reply(p_conversation_id uuid,p_text text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.operator_reply(p_conversation_id,p_text,p_request_id);$$;
create or replace function public.snote_operator_support_unread()
returns jsonb language sql security invoker set search_path='' as $$select snote_support_private.operator_unread();$$;

revoke all on all functions in schema snote_support_private from public,anon,authenticated,service_role;
revoke all on function public.snote_support_messages(uuid,uuid,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function public.snote_support_send(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.snote_support_read(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_support_threads(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_support_messages(uuid,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_support_read(uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_support_reply(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_support_unread() from public,anon,authenticated,service_role;
grant usage on schema snote_support_private to authenticated;
grant execute on function snote_support_private.user_messages(uuid,uuid,integer,bigint),snote_support_private.user_send(uuid,uuid,text,uuid),snote_support_private.user_read(uuid,uuid,uuid[]),snote_support_private.operator_threads(jsonb),snote_support_private.operator_messages(uuid,integer,bigint),snote_support_private.operator_read(uuid,uuid[]),snote_support_private.operator_reply(uuid,text,uuid),snote_support_private.operator_unread() to authenticated;
grant execute on function public.snote_support_messages(uuid,uuid,integer,bigint),public.snote_support_send(uuid,uuid,text,uuid),public.snote_support_read(uuid,uuid,uuid[]),public.snote_operator_support_threads(jsonb),public.snote_operator_support_messages(uuid,integer,bigint),public.snote_operator_support_read(uuid,uuid[]),public.snote_operator_support_reply(uuid,text,uuid),public.snote_operator_support_unread() to authenticated;
notify pgrst,'reload schema';
commit;
