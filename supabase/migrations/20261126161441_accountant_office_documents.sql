-- Company operational evidence is independent of signup/branding/vehicle files.
-- Only the authenticated Pages service publishes validated immutable images.
begin;
create schema if not exists snote_office_private;
revoke all on schema snote_office_private from public,anon;
grant usage on schema snote_office_private to authenticated,service_role;
create table if not exists snote_office_private.requests(
 id uuid primary key,company_id uuid not null references public.zc_companies(id),kind text not null check(kind in('businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId')),
 actor_id uuid not null references auth.users(id),session_id uuid not null,action text not null check(action in('upload','delete')),fingerprint jsonb not null,result jsonb,created_at timestamptz not null default clock_timestamp()
);
create table if not exists snote_office_private.files(
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique references snote_office_private.requests(id),company_id uuid not null references public.zc_companies(id),
 kind text not null check(kind in('businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId')),
 file_path text not null unique,mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),file_size integer not null check(file_size between 1 and 5242880),
 filename text not null check(char_length(filename) between 1 and 180),sha256 text not null check(sha256~'^[a-f0-9]{64}$'),width integer not null check(width>0),height integer not null check(height>0),
 stage text not null default 'pending' check(stage in('pending','verified','active','orphan','deleting','deleted')),expires_at timestamptz not null default clock_timestamp()+interval'30 minutes',cleanup_token uuid,
 created_at timestamptz not null default clock_timestamp(),unique(company_id,kind,id),check(width::bigint*height<=40000000),
 check(file_path=company_id::text||'/'||kind||'/'||id::text||case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end)
);
create table if not exists snote_office_private.slots(
 company_id uuid not null references public.zc_companies(id),kind text not null check(kind in('businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId')),
 active_file_id uuid,revision integer not null check(revision between 1 and 2147483647),updated_at timestamptz not null default clock_timestamp(),updated_by uuid not null references auth.users(id),deleted_at timestamptz,
 primary key(company_id,kind),foreign key(company_id,kind,active_file_id) references snote_office_private.files(company_id,kind,id)
);
create index if not exists office_files_cleanup on snote_office_private.files(company_id,expires_at) where stage in('pending','verified','orphan','deleting');
create index if not exists office_requests_company on snote_office_private.requests(company_id,created_at);
alter table snote_office_private.requests enable row level security;
alter table snote_office_private.files enable row level security;
alter table snote_office_private.slots enable row level security;
revoke all on snote_office_private.requests,snote_office_private.files,snote_office_private.slots from public,anon,authenticated,service_role;
do $bucket$ begin
 if exists(select 1 from storage.buckets where id='snote-office-documents' and (public or file_size_limit is distinct from 5242880 or allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp'])) then raise exception 'OFFICE_BUCKET_CONFLICT' using errcode='55000';end if;
 insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('snote-office-documents','snote-office-documents',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
end $bucket$;
drop policy if exists snote_office_storage_guard on storage.objects;
create policy snote_office_storage_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'snote-office-documents') with check(bucket_id<>'snote-office-documents');
create or replace function snote_office_private.actor(p_actor uuid,p_session uuid,p_company uuid)
returns void language plpgsql set search_path='' as $$
begin
 if p_company is null then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end if;
 begin perform 1 from snote_operator_private.verified_session(p_actor,p_session);exception when insufficient_privilege then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end;
 perform 1 from public.zc_members m where m.user_id=p_actor and m.company_id=p_company and m.active and m.role in('admin','accountant') for share;
 if not found or exists(select 1 from snote_operator_private.operators where user_id=p_actor) then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end if;
 perform 1 from public.zc_companies c where c.id=p_company and not exists(select 1 from snote_operator_private.company_state s where s.company_id=c.id and s.archived) for share;
 if not found then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end if;
end$$;
create or replace function snote_office_private.context(p_company uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();s uuid;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' or a is null then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end if;
 s:=snote_operator_private.claim_session();perform snote_office_private.actor(a,s,p_company);
 return jsonb_build_object('ok',true,'companyId',p_company,'actorId',a,'sessionId',s);
end$$;
create or replace function snote_office_private.slot_value(p_company uuid,p_kind text)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('kind',p_kind,'revision',coalesce(s.revision,0),'fileId',s.active_file_id,'status',case when s.active_file_id is null then 'missing' else 'ready' end,
 'filename',coalesce(f.filename,''),'mimeType',f.mime_type,'size',coalesce(f.file_size,0),'updatedAt',case when s.updated_at is null then null else to_char(s.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end)
 from (select 1)x left join snote_office_private.slots s on s.company_id=p_company and s.kind=p_kind left join snote_office_private.files f on f.id=s.active_file_id;
$$;
create or replace function snote_office_private.retry_result(p_request snote_office_private.requests)
returns jsonb language plpgsql stable set search_path='' as $$
begin
 if p_request.result is null or p_request.result->'document' is distinct from snote_office_private.slot_value(p_request.company_id,p_request.kind) then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
 return p_request.result||jsonb_build_object('duplicate',true);
end$$;
create or replace function snote_office_private.action(p_actor uuid,p_session uuid,p_company uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;key text;rid uuid;fid uuid;expected integer;r snote_office_private.requests;f snote_office_private.files;s snote_office_private.slots;o storage.objects;
 answer jsonb;fingerprint jsonb;revision_now integer;ext text;token uuid;rows jsonb:='[]'::jsonb;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'OFFICE_FORBIDDEN' using errcode='42501';end if;
 perform snote_office_private.actor(p_actor,p_session,p_company);
 if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>8192 then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
 if p_action='list' then
  if p_payload<>'{}'::jsonb then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  select jsonb_agg(snote_office_private.slot_value(p_company,v.kind) order by v.ord) into rows from (values('businessRegistration',1),('vehicleBusinessRegistration',2),('shareholders',3),('corporatePassbook',4),('representativeId',5))v(kind,ord);
  return jsonb_build_object('ok',true,'companyId',p_company,'documents',rows);
 end if;
 if p_action='cleanup_claim' then
  if p_payload<>'{}'::jsonb then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  for f in select * from snote_office_private.files x where x.company_id=p_company and x.stage in('pending','verified','orphan','deleting') and x.expires_at<=clock_timestamp() and not exists(select 1 from snote_office_private.slots z where z.active_file_id=x.id) order by x.expires_at,x.id limit 5 for update skip locked loop
   token:=gen_random_uuid();update snote_office_private.files set stage='deleting',cleanup_token=token,expires_at=clock_timestamp()+interval'5 minutes' where id=f.id;
   rows:=rows||jsonb_build_array(jsonb_build_object('fileId',f.id,'path',f.file_path,'token',token));
  end loop;
  return jsonb_build_object('ok',true,'companyId',p_company,'files',rows);
 end if;
 if p_action='cleanup_finish' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['fileId','token','success']) or jsonb_typeof(p_payload->'success')<>'boolean' then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  begin fid:=(p_payload->>'fileId')::uuid;token:=(p_payload->>'token')::uuid;exception when others then raise exception 'OFFICE_INVALID' using errcode='22023';end;
  update snote_office_private.files x set stage=case when (p_payload->>'success')::boolean then 'deleted' else 'orphan' end,cleanup_token=null,expires_at=clock_timestamp()+interval'5 minutes' where x.id=fid and x.company_id=p_company and x.stage='deleting' and x.cleanup_token=token and not exists(select 1 from snote_office_private.slots z where z.active_file_id=x.id);
  return jsonb_build_object('ok',true,'companyId',p_company);
 end if;
 if p_action in('verify','publish','status','discard') then
  if (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload?'requestId') then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  begin rid:=(p_payload->>'requestId')::uuid;exception when others then raise exception 'OFFICE_INVALID' using errcode='22023';end;
  select * into r from snote_office_private.requests x where x.id=rid and x.company_id=p_company and x.actor_id=p_actor and x.session_id=p_session;
  if not found then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;k:=r.kind;
 else
  k:=p_payload->>'kind';if k is null or k not in('businessRegistration','vehicleBusinessRegistration','shareholders','corporatePassbook','representativeId') then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-office:'||p_company::text||':'||k,0));
 select * into s from snote_office_private.slots x where x.company_id=p_company and x.kind=k for update;revision_now:=coalesce(s.revision,0);
 if p_action='read' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['kind','fileId','revision']) or jsonb_typeof(p_payload->'revision') is distinct from 'number' or (p_payload->>'revision')!~'^[0-9]{1,10}$' then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  begin fid:=(p_payload->>'fileId')::uuid;exception when others then raise exception 'OFFICE_INVALID' using errcode='22023';end;
  if s.active_file_id is distinct from fid or fid is null or s.revision::text is distinct from p_payload->>'revision' then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
  select * into f from snote_office_private.files x where x.id=fid and x.company_id=p_company and x.kind=k and x.stage='active';
  if not found then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('ok',true,'companyId',p_company,'document',snote_office_private.slot_value(p_company,k),'path',f.file_path,'sha256',f.sha256);
 end if;
 if p_action in('prepare','delete') then
  begin
   if jsonb_typeof(p_payload->'requestId') is distinct from 'string' or jsonb_typeof(p_payload->'expectedRevision') is distinct from 'number' or (p_payload->>'expectedRevision')!~'^[0-9]{1,10}$' then raise exception 'invalid';end if;
   rid:=(p_payload->>'requestId')::uuid;expected:=(p_payload->>'expectedRevision')::integer;
  exception when others then raise exception 'OFFICE_INVALID' using errcode='22023';end;
  if expected<0 or expected>=2147483647 then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  if p_action='prepare' then
   if (select count(*) from jsonb_object_keys(p_payload))<>10 or not(p_payload?&array['requestId','kind','expectedRevision','filename','mimeType','size','sha256','width','height','formatVersion']) or p_payload->'formatVersion' is distinct from '1'::jsonb then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
   if jsonb_typeof(p_payload->'filename') is distinct from 'string' or char_length(p_payload->>'filename') not between 1 and 180 or (p_payload->>'filename')~'[[:cntrl:]/\\]' or (p_payload->>'filename')~'^[[:space:]]*$' or p_payload->>'mimeType' not in('image/jpeg','image/png','image/webp') or coalesce(p_payload->>'sha256','')!~'^[a-f0-9]{64}$' then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
   for key in select unnest(array['size','width','height']) loop if jsonb_typeof(p_payload->key) is distinct from 'number' or coalesce(p_payload->>key,'')!~'^[0-9]{1,8}$' then raise exception 'OFFICE_INVALID' using errcode='22023';end if;end loop;
   if (p_payload->>'size')::integer not between 1 and 5242880 or (p_payload->>'width')::integer<1 or (p_payload->>'height')::integer<1 or (p_payload->>'width')::bigint*(p_payload->>'height')::bigint>40000000 then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  else
   if (select count(*) from jsonb_object_keys(p_payload))<>4 or not(p_payload?&array['requestId','kind','fileId','expectedRevision']) then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
   begin fid:=(p_payload->>'fileId')::uuid;exception when others then raise exception 'OFFICE_INVALID' using errcode='22023';end;
   if fid is null then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
  end if;
  fingerprint:=p_payload;
  select * into r from snote_office_private.requests x where x.id=rid for update;
  if found then
   if r.company_id<>p_company or r.kind<>k or r.actor_id<>p_actor or r.session_id<>p_session or r.action<>(case when p_action='prepare' then 'upload' else 'delete' end) or r.fingerprint<>fingerprint then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
   if r.result is not null then return snote_office_private.retry_result(r);end if;
  else
   if revision_now<>expected then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
   if p_action='prepare' and (select count(*) from snote_office_private.files x where x.company_id=p_company and x.stage in('pending','verified') and x.expires_at>clock_timestamp())>=20 then raise exception 'OFFICE_BUSY' using errcode='54000';end if;
   insert into snote_office_private.requests(id,company_id,kind,actor_id,session_id,action,fingerprint) values(rid,p_company,k,p_actor,p_session,case when p_action='prepare' then 'upload' else 'delete' end,fingerprint) returning * into r;
   if p_action='prepare' then
    fid:=gen_random_uuid();ext:=case p_payload->>'mimeType' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
    insert into snote_office_private.files(id,request_id,company_id,kind,file_path,mime_type,file_size,filename,sha256,width,height) values(fid,rid,p_company,k,p_company::text||'/'||k||'/'||fid::text||ext,p_payload->>'mimeType',(p_payload->>'size')::integer,p_payload->>'filename',p_payload->>'sha256',(p_payload->>'width')::integer,(p_payload->>'height')::integer);
   end if;
  end if;
  if p_action='delete' then
   if revision_now<>expected or s.active_file_id is distinct from fid then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
   update snote_office_private.slots set active_file_id=null,revision=revision+1,updated_at=clock_timestamp(),updated_by=p_actor,deleted_at=clock_timestamp() where company_id=p_company and kind=k;
   update snote_office_private.files set stage='orphan',expires_at=clock_timestamp() where id=fid and stage='active';
   answer:=jsonb_build_object('ok',true,'companyId',p_company,'document',snote_office_private.slot_value(p_company,k),'duplicate',false);
   update snote_office_private.requests set result=answer where id=rid;return answer;
  end if;
 end if;
 select * into r from snote_office_private.requests x where x.id=rid for update;
 if r.result is not null then return snote_office_private.retry_result(r);end if;
 if r.action<>'upload' then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
 select * into f from snote_office_private.files x where x.request_id=rid for update;
 if p_action='discard' then
  update snote_office_private.files set stage='orphan',expires_at=clock_timestamp() where id=f.id and stage in('pending','verified');return jsonb_build_object('ok',true,'companyId',p_company);
 end if;
 if f.stage not in('pending','verified') or f.expires_at<=clock_timestamp() then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
 if p_action='verify' then
  select * into o from storage.objects x where x.bucket_id='snote-office-documents' and x.name=f.file_path for share;
  if not found or o.metadata->>'mimetype' is distinct from f.mime_type or jsonb_typeof(o.metadata->'size') is distinct from 'number' or o.metadata->>'size' is distinct from f.file_size::text then raise exception 'OFFICE_FILE_MISSING' using errcode='40001';end if;
  update snote_office_private.files set stage='verified' where id=f.id;f.stage:='verified';
 elsif p_action='publish' then
  if f.stage<>'verified' or revision_now<>(r.fingerprint->>'expectedRevision')::integer then raise exception 'OFFICE_CONFLICT' using errcode='40001';end if;
  if s.active_file_id is not null then update snote_office_private.files set stage='orphan',expires_at=clock_timestamp() where id=s.active_file_id and stage='active';end if;
  insert into snote_office_private.slots(company_id,kind,active_file_id,revision,updated_by) values(p_company,k,f.id,revision_now+1,p_actor) on conflict(company_id,kind) do update set active_file_id=excluded.active_file_id,revision=excluded.revision,updated_at=clock_timestamp(),updated_by=p_actor,deleted_at=null;
  update snote_office_private.files set stage='active' where id=f.id;
  answer:=jsonb_build_object('ok',true,'companyId',p_company,'document',snote_office_private.slot_value(p_company,k),'duplicate',false);
  update snote_office_private.requests x set result=answer where x.id=rid;return answer;
 elsif p_action not in('status','prepare','verify') then raise exception 'OFFICE_INVALID' using errcode='22023';end if;
 return jsonb_build_object('ok',true,'companyId',p_company,'requestId',rid,'fileId',f.id,'path',f.file_path,'stage',f.stage);
end$$;
create or replace function public.snote_office_context(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$select snote_office_private.context(p_company);$$;
create or replace function public.snote_office_action(p_actor uuid,p_session uuid,p_company uuid,p_action text,p_payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select snote_office_private.action(p_actor,p_session,p_company,p_action,p_payload);$$;
revoke all on function snote_office_private.actor(uuid,uuid,uuid),snote_office_private.context(uuid),snote_office_private.slot_value(uuid,text),snote_office_private.retry_result(snote_office_private.requests),snote_office_private.action(uuid,uuid,uuid,text,jsonb),public.snote_office_context(uuid),public.snote_office_action(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function snote_office_private.context(uuid),public.snote_office_context(uuid) to authenticated;
grant execute on function snote_office_private.action(uuid,uuid,uuid,text,jsonb),public.snote_office_action(uuid,uuid,uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
