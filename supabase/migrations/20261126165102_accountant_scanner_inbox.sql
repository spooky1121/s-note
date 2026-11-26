-- A separate private scanner inbox; existing office slots and evidence stay unchanged.
begin;
create schema if not exists snote_scanner_private;
revoke all on schema snote_scanner_private from public,anon,authenticated;
grant usage on schema snote_scanner_private to service_role;
create table if not exists snote_scanner_private.requests(
 id uuid primary key,company_id uuid not null references public.zc_companies(id),actor_id uuid not null references auth.users(id),session_id uuid not null,
 action text not null check(action in('upload','delete')),fingerprint jsonb not null,result jsonb,created_at timestamptz not null default clock_timestamp()
);
create table if not exists snote_scanner_private.scans(
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references snote_scanner_private.requests(id),company_id uuid not null references public.zc_companies(id),
 file_path text not null unique,mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),file_size integer not null check(file_size between 1 and 5242880),
 filename text not null check(char_length(filename) between 1 and 180),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),width integer not null check(width>0),height integer not null check(height>0),
 revision integer not null default 0 check(revision between 0 and 2147483647),stage text not null default 'pending' check(stage in('pending','verified','active','orphan','deleting','deleted')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),deleted_at timestamptz,
 expires_at timestamptz not null default clock_timestamp()+interval'30 minutes',cleanup_token uuid,
 check(width::bigint*height<=40000000),check(stage<>'active' or revision>=1 and deleted_at is null),check(deleted_at is null or revision>=2),
 check(file_path=company_id::text||'/inbox/'||id::text||case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create index if not exists scanner_active_page on snote_scanner_private.scans(company_id,created_at desc,id desc) where stage='active' and deleted_at is null;
create index if not exists scanner_cleanup on snote_scanner_private.scans(company_id,expires_at) where stage in('pending','verified','orphan','deleting','deleted');
alter table snote_scanner_private.requests enable row level security;
alter table snote_scanner_private.scans enable row level security;
revoke all on snote_scanner_private.requests,snote_scanner_private.scans from public,anon,authenticated,service_role;
drop policy if exists scanner_requests_direct_deny on snote_scanner_private.requests;
create policy scanner_requests_direct_deny on snote_scanner_private.requests for all to anon,authenticated,service_role using(false) with check(false);
drop policy if exists scanner_scans_direct_deny on snote_scanner_private.scans;
create policy scanner_scans_direct_deny on snote_scanner_private.scans for all to anon,authenticated,service_role using(false) with check(false);
do $bucket$ begin
 if exists(select 1 from storage.buckets where id='snote-scanner-inbox' and (public or file_size_limit is distinct from 5242880 or allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp'])) then raise exception 'SCANNER_BUCKET_CONFLICT' using errcode='55000';end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('snote-scanner-inbox','snote-scanner-inbox',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
end $bucket$;
drop policy if exists snote_scanner_storage_guard on storage.objects;
create policy snote_scanner_storage_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'snote-scanner-inbox') with check(bucket_id<>'snote-scanner-inbox');
create or replace function snote_scanner_private.item_value(p_row snote_scanner_private.scans)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'revision',p_row.revision,'filename',p_row.filename,'mimeType',p_row.mime_type,'size',p_row.file_size,
 'createdAt',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updatedAt',to_char(p_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
$$;
create or replace function snote_scanner_private.retry_result(p_request snote_scanner_private.requests)
returns jsonb language plpgsql stable set search_path='' as $$
declare s snote_scanner_private.scans;
begin
 if p_request.result is null then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 if p_request.action='upload' then
  select * into s from snote_scanner_private.scans where request_id=p_request.id and company_id=p_request.company_id;
  if not found or s.stage<>'active' or s.deleted_at is not null or p_request.result->'item' is distinct from snote_scanner_private.item_value(s) then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 else
  select * into s from snote_scanner_private.scans where id=(p_request.result->>'id')::uuid and company_id=p_request.company_id;
  if not found or s.deleted_at is null or s.revision::text is distinct from p_request.result->>'revision' then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 end if;
 return p_request.result||jsonb_build_object('duplicate',true);
end$$;
create or replace function snote_scanner_private.action(p_actor uuid,p_session uuid,p_company uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r snote_scanner_private.requests;s snote_scanner_private.scans;o storage.objects;rid uuid;sid uuid;token uuid;key text;expected integer;
 cursor_date timestamptz;cursor_id uuid;answer jsonb;items jsonb:='[]'::jsonb;next_cursor jsonb;stamp timestamptz;ext text;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'SCANNER_FORBIDDEN' using errcode='42501';end if;
 perform snote_office_private.actor(p_actor,p_session,p_company);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192 then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
 if p_action='list' then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload?'cursor') then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  if p_payload->'cursor'<>'null'::jsonb then
   if jsonb_typeof(p_payload->'cursor')<>'object' or (select count(*) from jsonb_object_keys(p_payload->'cursor'))<>2 or not(p_payload->'cursor'?&array['createdAt','id']) or jsonb_typeof(p_payload#>'{cursor,createdAt}') is distinct from 'string' or jsonb_typeof(p_payload#>'{cursor,id}') is distinct from 'string' or coalesce(p_payload#>>'{cursor,createdAt}','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
   begin cursor_date:=(p_payload#>>'{cursor,createdAt}')::timestamptz;cursor_id:=(p_payload#>>'{cursor,id}')::uuid;exception when others then raise exception 'SCANNER_INVALID' using errcode='22023';end;
   if cursor_id is null then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  end if;
  with selected as materialized(select x.* from snote_scanner_private.scans x where x.company_id=p_company and x.stage='active' and x.deleted_at is null and (cursor_date is null or (x.created_at,x.id)<(cursor_date,cursor_id)) order by x.created_at desc,x.id desc limit 31),page as materialized(select * from selected order by created_at desc,id desc limit 30)
  select coalesce((select jsonb_agg(snote_scanner_private.item_value(row(p.*)::snote_scanner_private.scans) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),case when (select count(*) from selected)>30 then (select jsonb_build_object('createdAt',to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'id',p.id) from page p order by p.created_at,p.id limit 1) end into items,next_cursor;
  return jsonb_build_object('ok',true,'companyId',p_company,'items',items,'nextCursor',next_cursor);
 end if;
 if p_action='cleanup_claim' then
  if p_payload<>'{}'::jsonb then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  for s in select * from snote_scanner_private.scans x where x.company_id=p_company and x.stage in('pending','verified','orphan','deleting','deleted') and x.expires_at<=clock_timestamp() and (x.stage<>'deleted' or exists(select 1 from storage.objects obj where obj.bucket_id='snote-scanner-inbox' and obj.name=x.file_path)) order by x.expires_at,x.id limit 5 for update skip locked loop
   token:=gen_random_uuid();update snote_scanner_private.scans set stage='deleting',cleanup_token=token,expires_at=clock_timestamp()+interval'5 minutes' where id=s.id;
   items:=items||jsonb_build_array(jsonb_build_object('id',s.id,'path',s.file_path,'token',token));
  end loop;return jsonb_build_object('ok',true,'companyId',p_company,'files',items);
 end if;
 if p_action='cleanup_finish' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['id','token','success']) or jsonb_typeof(p_payload->'success') is distinct from 'boolean' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  begin sid:=(p_payload->>'id')::uuid;token:=(p_payload->>'token')::uuid;exception when others then raise exception 'SCANNER_INVALID' using errcode='22023';end;
  update snote_scanner_private.scans x set stage=case when (p_payload->>'success')::boolean then 'deleted' else 'orphan' end,cleanup_token=null,expires_at=clock_timestamp()+interval'5 minutes' where x.id=sid and x.company_id=p_company and x.stage='deleting' and x.cleanup_token=token;
  return jsonb_build_object('ok',true,'companyId',p_company);
 end if;
 if p_action='read' then
  if (select count(*) from jsonb_object_keys(p_payload))<>2 or not(p_payload?&array['id','revision']) or jsonb_typeof(p_payload->'revision') is distinct from 'number' or coalesce(p_payload->>'revision','')!~'^[0-9]{1,10}$' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  begin sid:=(p_payload->>'id')::uuid;exception when others then raise exception 'SCANNER_INVALID' using errcode='22023';end;
  select * into s from snote_scanner_private.scans x where x.id=sid and x.company_id=p_company and x.stage='active' and x.deleted_at is null for share;
  if not found or s.revision::text is distinct from p_payload->>'revision' then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('ok',true,'companyId',p_company,'item',snote_scanner_private.item_value(s),'path',s.file_path,'sha256',s.sha256);
 end if;
 if p_action not in('prepare','verify','publish','status','discard','delete') or jsonb_typeof(p_payload->'requestId') is distinct from 'string' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
 begin rid:=(p_payload->>'requestId')::uuid;exception when others then raise exception 'SCANNER_INVALID' using errcode='22023';end;
 if p_action in('prepare','delete') then
  if p_action='prepare' then
   if (select count(*) from jsonb_object_keys(p_payload))<>8 or not(p_payload?&array['requestId','filename','mimeType','size','sha256','width','height','formatVersion']) or p_payload->'formatVersion' is distinct from '1'::jsonb then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
   if jsonb_typeof(p_payload->'filename') is distinct from 'string' or char_length(p_payload->>'filename') not between 1 and 180 or (p_payload->>'filename')~'[[:cntrl:]/\\]' or (p_payload->>'filename')~'^[[:space:]]*$' or coalesce(p_payload->>'mimeType','') not in('image/jpeg','image/png','image/webp') or coalesce(p_payload->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
   for key in select unnest(array['size','width','height']) loop if jsonb_typeof(p_payload->key) is distinct from 'number' or coalesce(p_payload->>key,'')!~'^[0-9]{1,8}$' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;end loop;
   if (p_payload->>'size')::integer not between 1 and 5242880 or (p_payload->>'width')::integer<1 or (p_payload->>'height')::integer<1 or (p_payload->>'width')::bigint*(p_payload->>'height')::bigint>40000000 then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  else
   if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['requestId','id','expectedRevision']) or jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number' or coalesce(p_payload->>'expectedRevision','')!~'^[0-9]{1,10}$' then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
   begin sid:=(p_payload->>'id')::uuid;expected:=(p_payload->>'expectedRevision')::integer;exception when others then raise exception 'SCANNER_INVALID' using errcode='22023';end;
   if sid is null or expected<1 or expected>=2147483647 then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
  end if;
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>1 then raise exception 'SCANNER_INVALID' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-scanner-request:'||rid::text,0));
 select * into r from snote_scanner_private.requests x where x.id=rid for update;
 if found then
  if r.company_id<>p_company or r.actor_id<>p_actor or r.session_id<>p_session or (p_action in('prepare','delete') and (r.action<>(case when p_action='prepare' then 'upload' else 'delete' end) or r.fingerprint<>p_payload)) then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
  if r.result is not null then return snote_scanner_private.retry_result(r);end if;
 elsif p_action in('prepare','delete') then
  if p_action='prepare' then
   perform pg_advisory_xact_lock(hashtextextended('snote-scanner-pending:'||p_company::text,0));
   if (select count(*) from snote_scanner_private.scans x where x.company_id=p_company and x.stage in('pending','verified') and x.expires_at>clock_timestamp())>=20 then raise exception 'SCANNER_BUSY' using errcode='54000';end if;
  end if;
  insert into snote_scanner_private.requests(id,company_id,actor_id,session_id,action,fingerprint) values(rid,p_company,p_actor,p_session,case when p_action='prepare' then 'upload' else 'delete' end,p_payload) returning * into r;
  if p_action='prepare' then
   sid:=gen_random_uuid();ext:=case p_payload->>'mimeType' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
   insert into snote_scanner_private.scans(id,request_id,company_id,file_path,mime_type,file_size,filename,sha256,width,height) values(sid,rid,p_company,p_company::text||'/inbox/'||sid::text||ext,p_payload->>'mimeType',(p_payload->>'size')::integer,p_payload->>'filename',p_payload->>'sha256',(p_payload->>'width')::integer,(p_payload->>'height')::integer);
  end if;
 else raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 if p_action='delete' then
  select * into s from snote_scanner_private.scans x where x.id=sid and x.company_id=p_company for update;
  if not found or s.stage<>'active' or s.deleted_at is not null or s.revision<>expected then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
  stamp:=clock_timestamp();update snote_scanner_private.scans set revision=revision+1,deleted_at=stamp,updated_at=stamp,stage='orphan',expires_at=stamp where id=s.id returning * into s;
  answer:=jsonb_build_object('ok',true,'companyId',p_company,'deleted',true,'id',s.id,'revision',s.revision,'duplicate',false);update snote_scanner_private.requests set result=answer where id=rid;return answer;
 end if;
 if r.action<>'upload' then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 select * into s from snote_scanner_private.scans x where x.request_id=rid for update;
 if p_action='discard' then update snote_scanner_private.scans set stage='orphan',expires_at=clock_timestamp() where id=s.id and stage in('pending','verified');return jsonb_build_object('ok',true,'companyId',p_company);end if;
 if s.stage not in('pending','verified') or s.expires_at<=clock_timestamp() then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
 if p_action='prepare' then update snote_scanner_private.scans set expires_at=greatest(expires_at,clock_timestamp()+interval'30 minutes') where id=s.id;end if;
 if p_action='verify' then
  select * into o from storage.objects x where x.bucket_id='snote-scanner-inbox' and x.name=s.file_path for share;
  if not found or o.metadata->>'mimetype' is distinct from s.mime_type or jsonb_typeof(o.metadata->'size') is distinct from 'number' or o.metadata->>'size' is distinct from s.file_size::text then raise exception 'SCANNER_FILE_MISSING' using errcode='40001';end if;
  update snote_scanner_private.scans set stage='verified' where id=s.id;s.stage:='verified';
 elsif p_action='publish' then
  if s.stage<>'verified' then raise exception 'SCANNER_CONFLICT' using errcode='40001';end if;
  stamp:=clock_timestamp();update snote_scanner_private.scans set stage='active',revision=1,created_at=stamp,updated_at=stamp where id=s.id returning * into s;
  answer:=jsonb_build_object('ok',true,'companyId',p_company,'item',snote_scanner_private.item_value(s),'duplicate',false);update snote_scanner_private.requests set result=answer where id=rid;return answer;
 end if;
 return jsonb_build_object('ok',true,'companyId',p_company,'requestId',rid,'id',s.id,'path',s.file_path,'stage',s.stage);
end$$;
create or replace function public.snote_scanner_action(p_actor uuid,p_session uuid,p_company uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select snote_scanner_private.action(p_actor,p_session,p_company,p_action,p_payload);$$;
revoke all on function snote_scanner_private.item_value(snote_scanner_private.scans),snote_scanner_private.retry_result(snote_scanner_private.requests),snote_scanner_private.action(uuid,uuid,uuid,text,jsonb),public.snote_scanner_action(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function snote_scanner_private.action(uuid,uuid,uuid,text,jsonb),public.snote_scanner_action(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
