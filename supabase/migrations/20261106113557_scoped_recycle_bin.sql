-- Recoverable vehicle/customer/media deletion. No stored customer or vehicle is rewritten here.
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;
alter table public.zc_customers add column if not exists restore_generation uuid not null default '00000000-0000-0000-0000-000000000000';

create table snote_private.recycle_bin(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.zc_companies(id) on delete cascade,
 owner_id uuid not null,car_id text not null,kind text not null check(kind in ('vehicle','customer','media')),
 source_id text not null,summary jsonb not null default '{}',snapshot jsonb not null,
 deleted_by uuid not null references auth.users(id),deleted_at timestamptz not null default clock_timestamp(),
 request_id uuid not null,request_hash text not null,request_ordinal integer not null default 0,
 restored_by uuid references auth.users(id),restored_at timestamptz,
 check(length(car_id) between 1 and 200),check(jsonb_typeof(summary)='object'),check(jsonb_typeof(snapshot)='object')
);
alter table snote_private.recycle_bin enable row level security;
revoke all on snote_private.recycle_bin from public,anon,authenticated;
create index recycle_bin_active_scope on snote_private.recycle_bin(company_id,owner_id,deleted_at desc) where restored_at is null;
create index recycle_bin_car on snote_private.recycle_bin(company_id,car_id,kind,owner_id) where restored_at is null;
create index recycle_bin_request on snote_private.recycle_bin(company_id,deleted_by,request_id);
create table snote_private.recycle_files(
 entry_id uuid not null references snote_private.recycle_bin(id) on delete cascade,company_id uuid not null,
 bucket_id text not null default 'zc-vehicle-private',file_path text not null,primary key(entry_id,file_path)
);
alter table snote_private.recycle_files enable row level security;
revoke all on snote_private.recycle_files from public,anon,authenticated;
create index recycle_files_path on snote_private.recycle_files(company_id,bucket_id,file_path);
create table snote_private.recycle_requests(
 company_id uuid not null references public.zc_companies(id) on delete cascade,actor_id uuid not null references auth.users(id),request_id uuid not null,
 request_hash text not null,owner_id uuid not null,car_id text not null,kind text not null,entry_ids jsonb not null,created_at timestamptz not null default clock_timestamp(),
 primary key(company_id,actor_id,request_id)
);
alter table snote_private.recycle_requests enable row level security;
revoke all on snote_private.recycle_requests from public,anon,authenticated;

create function snote_private.recycle_member(p_company uuid,p_owner uuid default null,p_accountant boolean default false)
returns public.zc_members language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 select * into m from public.zc_members where user_id=auth.uid() and company_id=p_company and active and role in ('dealer','admin','accountant');
 if not found or (m.role='accountant' and not p_accountant) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_owner is not null then
  if m.role='dealer' and p_owner<>m.user_id then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if not exists(select 1 from public.zc_members where user_id=p_owner and company_id=p_company) and not(m.role in ('admin','accountant') and(exists(select 1 from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset in ('cars','covers')) or(m.role='admin' and(exists(select 1 from public.zc_customers where company_id=p_company and owner_id=p_owner) or exists(select 1 from snote_private.recycle_bin where company_id=p_company and owner_id=p_owner))))) then raise exception 'OWNER_NOT_FOUND' using errcode='42501';end if;
 end if;
 return m;
end $f$;
create function snote_private.recycle_lock(p_company uuid) returns void language sql volatile set search_path='' as $f$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-recycle:'||p_company::text,0));
$f$;
create function snote_private.recycle_blocked(p_company uuid,p_owner uuid,p_car text) returns boolean language sql stable security definer set search_path='' as $f$
 select
 (exists(select 1 from snote_private.recycle_bin where company_id=p_company and car_id=p_car and restored_at is null and kind='vehicle')
  and not exists(select 1 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c where d.company_id=p_company and d.dataset='cars' and c->>'id'=p_car))
 or(exists(select 1 from snote_private.recycle_bin where company_id=p_company and owner_id=p_owner and car_id=p_car and restored_at is null and kind='customer')
  and not exists(select 1 from public.zc_customers where company_id=p_company and owner_id=p_owner and car_id=p_car));
$f$;
create function snote_private.recycle_car(p_company uuid,p_owner uuid,p_car text,p_strict boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare n integer;v jsonb;
begin
 select count(*),jsonb_agg(jsonb_build_object('ownerId',d.owner_id,'car',c))->0 into n,v
 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
 where d.company_id=p_company and d.dataset='cars' and c->>'id'=p_car;
 if n>1 then if p_strict then raise exception 'AMBIGUOUS_CAR' using errcode='22023';else return null;end if;end if;
 if n=0 then if p_strict then raise exception 'CAR_NOT_FOUND';else return null;end if;end if;
 if p_owner is not null and v->>'ownerId'<>p_owner::text then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return v;
end $f$;
create function snote_private.recycle_ack(p_company uuid,p_owner uuid,p_car text,p_data boolean default true) returns jsonb language sql stable security definer set search_path='' as $f$
 select jsonb_build_object('ok',true,'ownerId',p_owner,'carId',p_car,
 'cars',case when p_data then coalesce((select jsonb_build_object('payload',payload,'revision',revision) from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars'),jsonb_build_object('payload','[]'::jsonb,'revision',0)) end,
 'covers',case when p_data then coalesce((select jsonb_build_object('payload',payload,'revision',revision) from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers'),jsonb_build_object('payload','{}'::jsonb,'revision',0)) end);
$f$;
create function snote_private.recycle_replay(p_company uuid,p_request uuid,p_hash text) returns jsonb language plpgsql security definer set search_path='' as $f$
declare e snote_private.recycle_requests;
begin
 select * into e from snote_private.recycle_requests where company_id=p_company and actor_id=auth.uid() and request_id=p_request;
 if not found then return null;end if;
 if e.request_hash<>p_hash then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
 return snote_private.recycle_ack(p_company,e.owner_id,e.car_id,e.kind<>'customer')||jsonb_build_object('id',e.entry_ids->0,'ids',e.entry_ids,'kind',e.kind,'customerChanged',e.kind in ('vehicle','customer'),'mediaChanged',e.kind in ('vehicle','media'),'alreadyProcessed',true);
end $f$;
create function snote_private.recycle_receipt(p_company uuid,p_owner uuid,p_car text,p_kind text,p_request uuid,p_hash text,p_ids jsonb)
returns void language sql security definer set search_path='' as $f$
 insert into snote_private.recycle_requests(company_id,actor_id,request_id,request_hash,owner_id,car_id,kind,entry_ids) values(p_company,auth.uid(),p_request,p_hash,p_owner,p_car,p_kind,p_ids);
$f$;

create function snote_private.recycle_list(p_company uuid,p_kind text,p_query text,p_page integer,p_page_size integer,p_sort text,p_direction text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;v_result jsonb;
begin
 m:=snote_private.recycle_member(p_company);
 if p_kind is null or p_sort is null or p_direction is null or p_page_size is null or p_kind not in ('all','vehicle','customer','media') or p_page is null or p_page<1 or p_page_size not between 1 and 20 or p_sort not in ('deletedAt','label','kind') or p_direction not in ('asc','desc') or length(coalesce(p_query,''))>200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 with filtered as(
  select e.*,left(coalesce(mm.display_name,'이전 직원'),120) owner_name from snote_private.recycle_bin e left join public.zc_members mm on mm.user_id=e.owner_id and mm.company_id=e.company_id
  where e.company_id=p_company and e.restored_at is null and (m.role='admin' or e.owner_id=m.user_id) and(p_kind='all' or e.kind=p_kind)
  and(coalesce(p_query,'')='' or strpos(lower(concat_ws(' ',e.summary->>'label',e.summary->>'model',e.summary->>'plate',e.summary->>'name',e.summary->>'filename')),lower(p_query))>0)
 ),ordered as(
  select * from filtered order by
  case when p_sort='deletedAt' and p_direction='asc' then deleted_at end asc,
  case when p_sort='deletedAt' and p_direction='desc' then deleted_at end desc,
  case when p_sort='label' and p_direction='asc' then summary->>'label' end asc,
  case when p_sort='label' and p_direction='desc' then summary->>'label' end desc,
  case when p_sort='kind' and p_direction='asc' then kind end asc,
  case when p_sort='kind' and p_direction='desc' then kind end desc,deleted_at desc,id
  offset (p_page::bigint-1)*p_page_size limit p_page_size
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'deletedAt',deleted_at,'ownerId',owner_id,'ownerName',owner_name,'sourceId',source_id,'carId',car_id,'label',summary->>'label','model',summary->>'model','plate',summary->>'plate','name',summary->>'name','group',summary->>'group','filename',summary->>'filename')) from ordered),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'pageSize',p_page_size) into v_result;
 return v_result;
end $f$;

create function snote_private.customer_save(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_payload jsonb,p_has_rrn boolean)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;c public.zc_customers;v_time timestamptz;v_gen uuid;v_flag text;
begin
 m:=snote_private.recycle_member(p_company,p_owner);if p_owner is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;perform snote_private.recycle_lock(p_company);
 if p_car_id is null or length(p_car_id) not between 1 and 200 or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>1000000 or p_expected_generation is null or p_has_rrn is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if snote_private.recycle_blocked(p_company,p_owner,p_car_id) then raise exception 'CUSTOMER_IN_TRASH';end if;
 select * into c from public.zc_customers where company_id=p_company and owner_id=p_owner and car_id=p_car_id for update;
 if found then
  if c.updated_at is distinct from p_expected_updated_at or c.restore_generation is distinct from p_expected_generation then raise exception 'CONFLICT' using errcode='40001';end if;
  v_gen:=c.restore_generation;v_time:=greatest(clock_timestamp(),c.updated_at+interval '1 microsecond');
 else
  if p_expected_updated_at is not null or p_expected_generation<>'00000000-0000-0000-0000-000000000000'::uuid then raise exception 'CONFLICT' using errcode='40001';end if;
  v_gen:='00000000-0000-0000-0000-000000000000';v_time:=clock_timestamp();
 end if;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by,updated_at,restore_generation) values(p_company,p_owner,p_car_id,p_payload,p_has_rrn,auth.uid(),v_time,v_gen)
 on conflict(company_id,owner_id,car_id) do update set payload=excluded.payload,has_rrn=excluded.has_rrn,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return jsonb_build_object('ok',true,'updatedAt',v_time,'restoreGeneration',v_gen);
end $f$;

create function snote_private.recycle_trash_customer(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;c public.zc_customers;v_car jsonb;v_rrn jsonb;v_id uuid;v_hash text;v_replay jsonb;v_flag text;
begin
 m:=snote_private.recycle_member(p_company,p_owner);if p_owner is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;perform snote_private.recycle_lock(p_company);
 if p_request_id is null or p_car_id is null or length(p_car_id) not between 1 and 200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_hash:=md5(jsonb_build_array('customer',p_owner,p_car_id,p_expected_updated_at,p_expected_generation)::text);v_replay:=snote_private.recycle_replay(p_company,p_request_id,v_hash);if v_replay is not null then return v_replay;end if;
 perform 1 from public.snote_customer_intake where company_id=p_company and owner_id=p_owner and car_id=p_car_id order by id for update;
 select to_jsonb(r) into v_rrn from zc_private.rrn_secrets r where company_id=p_company and owner_id=p_owner and car_id=p_car_id for update;
 select * into c from public.zc_customers where company_id=p_company and owner_id=p_owner and car_id=p_car_id for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND';end if;
 if c.updated_at is distinct from p_expected_updated_at or c.restore_generation is distinct from p_expected_generation then raise exception 'CONFLICT' using errcode='40001';end if;
 v_car:=snote_private.recycle_car(p_company,null,p_car_id,false);
 insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,summary,snapshot,deleted_by,request_id,request_hash)
 values(p_company,p_owner,p_car_id,'customer',p_car_id,jsonb_build_object('label',left(coalesce(c.payload->>'name','고객'),200),'name',left(c.payload->>'name',200),'model',left(v_car#>>'{car,model}',200),'plate',left(v_car#>>'{car,plate}',40)),jsonb_build_object('customer',to_jsonb(c),'rrn',v_rrn),auth.uid(),p_request_id,v_hash) returning id into v_id;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 update public.snote_customer_intake set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
 delete from public.zc_customers where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
 delete from zc_private.rrn_secrets where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,auth.uid(),'recycle',v_id::text,'trash_customer');
 perform snote_private.recycle_receipt(p_company,p_owner,p_car_id,'customer',p_request_id,v_hash,jsonb_build_array(v_id));
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,p_owner,p_car_id,false)||jsonb_build_object('id',v_id,'kind','customer','customerChanged',true,'mediaChanged',false,'alreadyProcessed',false);
end $f$;

create function snote_private.recycle_trash_vehicle(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_expected_covers integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;d public.zc_datasets;cd public.zc_datasets;car jsonb;customers jsonb;rrns jsonb;files jsonb;v_id uuid;v_hash text;v_replay jsonb;v_flag text;v_cover boolean;
begin
 m:=snote_private.recycle_member(p_company,p_owner);if p_owner is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;perform snote_private.recycle_lock(p_company);
 if p_request_id is null or p_car_id is null or length(p_car_id) not between 1 and 200 or p_expected is null or p_expected<1 or p_expected_covers is null or p_expected_covers<0 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_hash:=md5(jsonb_build_array('vehicle',p_owner,p_car_id,p_expected,p_expected_covers)::text);v_replay:=snote_private.recycle_replay(p_company,p_request_id,v_hash);if v_replay is not null then return v_replay;end if;
 perform 1 from public.snote_customer_intake where company_id=p_company and car_id=p_car_id order by id for update;
 car:=snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car';
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if d.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers' for update;
 if coalesce(cd.revision,0)<>p_expected_covers then raise exception 'CONFLICT' using errcode='40001';end if;
 if cd.payload is not null and jsonb_typeof(cd.payload)<>'object' then raise exception 'INVALID_COVERS';end if;
 perform 1 from zc_private.rrn_secrets where company_id=p_company and car_id=p_car_id order by owner_id for update;
 perform 1 from public.zc_customers where company_id=p_company and car_id=p_car_id order by owner_id for update;
 perform 1 from public.zc_media where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2') order by owner_id,id for update;
 select coalesce(jsonb_agg(to_jsonb(c) order by owner_id),'[]') into customers from public.zc_customers c where company_id=p_company and car_id=p_car_id;
 select coalesce(jsonb_agg(to_jsonb(r) order by owner_id),'[]') into rrns from zc_private.rrn_secrets r where company_id=p_company and car_id=p_car_id;
 select coalesce(jsonb_agg(to_jsonb(f) order by owner_id,id),'[]') into files from public.zc_media f where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2');
 v_cover:=coalesce(cd.payload?p_car_id,false);
 insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,summary,snapshot,deleted_by,request_id,request_hash)
 values(p_company,p_owner,p_car_id,'vehicle',p_car_id,jsonb_build_object('label',left(concat_ws(' · ',car->>'model',car->>'plate'),300),'model',left(car->>'model',200),'plate',left(car->>'plate',40)),jsonb_build_object('car',car,'coverExists',v_cover,'cover',cd.payload->p_car_id,'customers',customers,'rrn',rrns,'media',files),auth.uid(),p_request_id,v_hash) returning id into v_id;
 insert into snote_private.recycle_files(entry_id,company_id,file_path) select v_id,p_company,value->>'file_path' from jsonb_array_elements(files);
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 update public.snote_customer_intake set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and car_id=p_car_id;
 delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
 delete from public.zc_media where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2');
 delete from public.zc_customers where company_id=p_company and car_id=p_car_id;
 delete from zc_private.rrn_secrets where company_id=p_company and car_id=p_car_id;
 update public.zc_datasets set payload=(select coalesce(jsonb_agg(c order by ord),'[]') from jsonb_array_elements(d.payload) with ordinality a(c,ord) where c->>'id'<>p_car_id),revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company and owner_id=p_owner and dataset='cars';
 if v_cover then update public.zc_datasets set payload=payload-p_car_id,revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company and owner_id=p_owner and dataset='covers';end if;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,auth.uid(),'recycle',v_id::text,'trash_vehicle');
 perform snote_private.recycle_receipt(p_company,p_owner,p_car_id,'vehicle',p_request_id,v_hash,jsonb_build_array(v_id));
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,p_owner,p_car_id)||jsonb_build_object('id',v_id,'kind','vehicle','customerChanged',true,'mediaChanged',true,'alreadyProcessed',false);
end $f$;

create function snote_private.recycle_uri_component(p_value text) returns text language sql immutable strict set search_path='' as $f$
 select coalesce(string_agg(case when get_byte(b,i) between 48 and 57 or get_byte(b,i) between 65 and 90 or get_byte(b,i) between 97 and 122 or get_byte(b,i) in (45,95,46,33,126,42,39,40,41) then chr(get_byte(b,i)) else '%'||upper(lpad(to_hex(get_byte(b,i)),2,'0')) end,'' order by i),'') from (select convert_to(p_value,'UTF8') b)x cross join lateral generate_series(0,length(b)-1)i;
$f$;
create function snote_private.recycle_validate_media(p_company uuid,p_car_id text,p_records jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare f jsonb;v_path text;v_ext text;v_object storage.objects;v_id text;v_size numeric;
begin
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>6 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 for f in select value from jsonb_array_elements(p_records) loop
  v_id:=f->>'id';
  if jsonb_typeof(f)<>'object' or v_id is null or length(v_id) not between 1 and 200 or f->>'company_id' is distinct from p_company::text or f->>'owner_id' is distinct from auth.uid()::text or f->>'car_id' is distinct from p_car_id or coalesce(f->>'group_name','') not in ('photos','registration','inspection1','inspection2') or coalesce(f->>'mime_type','') not in ('image/jpeg','image/png','image/webp') or jsonb_typeof(f->'file_size') is distinct from 'number' then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  v_size:=(f->>'file_size')::numeric;if v_size<>trunc(v_size) or v_size not between 1 and 10485760 then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  v_ext:=case f->>'mime_type' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  v_path:=p_company::text||'/'||auth.uid()::text||'/'||snote_private.recycle_uri_component(p_car_id)||'/'||snote_private.recycle_uri_component(v_id)||'.'||v_ext;
  if f->>'file_path' is distinct from v_path or length(coalesce(f->>'original_name','')) not between 1 and 180 then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  select * into v_object from storage.objects where bucket_id='zc-vehicle-private' and name=v_path;
  if not found then raise exception 'MEDIA_UPLOAD_NOT_FOUND';end if;
  if v_object.metadata->>'mimetype' is not null and v_object.metadata->>'mimetype'<>f->>'mime_type' then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  if jsonb_typeof(v_object.metadata->'size')='number' and (v_object.metadata->>'size')::numeric<>v_size then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  if exists(select 1 from public.zc_media where file_path=v_path or(company_id=p_company and owner_id=auth.uid() and id=v_id)) or exists(select 1 from snote_private.recycle_files where company_id=p_company and file_path=v_path) or exists(select 1 from snote_private.recycle_bin where company_id=p_company and kind='media' and restored_at is null and snapshot#>>'{media,owner_id}'=auth.uid()::text and snapshot#>>'{media,id}'=v_id) then raise exception 'MEDIA_CONFLICT' using errcode='40001';end if;
 end loop;
 if (select count(*) from jsonb_array_elements(p_records))<>(select count(distinct value->>'id') from jsonb_array_elements(p_records)) then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
end $f$;

create function snote_private.recycle_media(p_company uuid,p_owner uuid,p_car_id text,p_remove jsonb,p_records jsonb,p_expected integer,p_expected_covers integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;d public.zc_datasets;cd public.zc_datasets;car jsonb;f jsonb;r public.zc_media;old_rows jsonb:='[]';v_id uuid;v_ids jsonb:='[]';v_hash text;v_replay jsonb;v_flag text;v_i integer:=0;v_hascover boolean;v_remove_cover boolean:=false;v_n integer;v_group text;
begin
 m:=snote_private.recycle_member(p_company,p_owner,true);if p_owner is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;perform snote_private.recycle_lock(p_company);
 if p_request_id is null or p_expected is null or p_expected<1 or p_expected_covers is null or p_expected_covers<0 or jsonb_typeof(p_remove) is distinct from 'array' or jsonb_array_length(p_remove)>6 or jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>6 or jsonb_array_length(p_remove)+jsonb_array_length(p_records)=0 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_hash:=md5(jsonb_build_array('media',p_owner,p_car_id,p_remove,p_records,p_expected,p_expected_covers)::text);v_replay:=snote_private.recycle_replay(p_company,p_request_id,v_hash);if v_replay is not null then return v_replay;end if;
 car:=snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car';
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers' for update;
 if d.revision<>p_expected or coalesce(cd.revision,0)<>p_expected_covers then raise exception 'CONFLICT' using errcode='40001';end if;
 for f in select value from jsonb_array_elements(p_remove) loop
  if jsonb_typeof(f)<>'object' or f->>'id' is null or coalesce(f->>'ownerId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or f->>'filePath' is null then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  select * into r from public.zc_media where company_id=p_company and owner_id=(f->>'ownerId')::uuid and id=f->>'id' and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2') for update;
  if not found or r.file_path is distinct from f->>'filePath' then raise exception 'MEDIA_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from jsonb_array_elements(old_rows) x where x->>'owner_id'=r.owner_id::text and x->>'id'=r.id) then raise exception 'INVALID_MEDIA' using errcode='22023';end if;
  old_rows:=old_rows||jsonb_build_array(to_jsonb(r));
 end loop;
 if m.role='accountant' and(jsonb_array_length(p_records)=0 or exists(select 1 from jsonb_array_elements(p_records) x where x->>'group_name' is distinct from 'registration') or exists(select 1 from jsonb_array_elements(old_rows) x where x->>'group_name' is distinct from 'registration')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform snote_private.recycle_validate_media(p_company,p_car_id,p_records);
 foreach v_group in array array['photos','registration','inspection1','inspection2'] loop
  select count(*) into v_n from public.zc_media a where company_id=p_company and car_id=p_car_id and group_name=v_group and not exists(select 1 from jsonb_array_elements(old_rows) o where o->>'owner_id'=a.owner_id::text and o->>'id'=a.id);
  v_n:=v_n+(select count(*) from jsonb_array_elements(p_records) x where x->>'group_name'=v_group);
  if v_group='photos' and v_n>5 then raise exception 'PHOTO_LIMIT' using errcode='40001';elsif v_group<>'photos' and v_n>1 then raise exception 'DOCUMENT_EXISTS' using errcode='40001';end if;
 end loop;
 for f in select value from jsonb_array_elements(old_rows) loop
  v_hascover:=coalesce(cd.payload->p_car_id=to_jsonb(f->>'id'),false);v_remove_cover:=v_remove_cover or v_hascover;
  insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,summary,snapshot,deleted_by,request_id,request_hash,request_ordinal)
  values(p_company,p_owner,p_car_id,'media',f->>'id',jsonb_build_object('label',left(f->>'original_name',200),'filename',left(f->>'original_name',180),'group',left(f->>'group_name',32),'model',left(car->>'model',200),'plate',left(car->>'plate',40)),jsonb_build_object('media',f,'coverExists',v_hascover,'cover',case when v_hascover then cd.payload->p_car_id else null end),auth.uid(),p_request_id,v_hash,v_i) returning id into v_id;
  v_i:=v_i+1;v_ids:=v_ids||jsonb_build_array(v_id);insert into snote_private.recycle_files(entry_id,company_id,file_path) values(v_id,p_company,f->>'file_path');
 end loop;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 for f in select value from jsonb_array_elements(old_rows) loop delete from public.zc_media where company_id=p_company and owner_id=(f->>'owner_id')::uuid and id=f->>'id';end loop;
 for f in select value from jsonb_array_elements(p_records) loop
  insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name,meta) values(p_company,auth.uid(),f->>'id',p_car_id,f->>'file_path',f->>'original_name',f->>'mime_type',(f->>'file_size')::bigint,f->>'group_name',coalesce(f->'meta','{}'::jsonb));
 end loop;
 if v_remove_cover then update public.zc_datasets set payload=payload-p_car_id,revision=revision+1,updated_at=clock_timestamp(),updated_by=auth.uid() where company_id=p_company and owner_id=p_owner and dataset='covers';end if;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,auth.uid(),'recycle',p_request_id::text,'media_change');
 perform snote_private.recycle_receipt(p_company,p_owner,p_car_id,'media',p_request_id,v_hash,v_ids);
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,p_owner,p_car_id)||jsonb_build_object('ids',v_ids,'kind','media','customerChanged',false,'mediaChanged',true,'alreadyProcessed',false);
end $f$;

create function snote_private.recycle_restore(p_company uuid,p_entry uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;e snote_private.recycle_bin;d public.zc_datasets;cd public.zc_datasets;
 s jsonb;f jsonb;c public.zc_customers;mr public.zc_media;v_flag text;v_cover boolean;v_n integer;v_customers jsonb;v_rrns jsonb;v_media jsonb;
begin
 m:=snote_private.recycle_member(p_company);perform snote_private.recycle_lock(p_company);
 select * into e from snote_private.recycle_bin where company_id=p_company and id=p_entry for update;
 if not found then raise exception 'ENTRY_NOT_FOUND';end if;
 perform snote_private.recycle_member(p_company,e.owner_id);
 if e.restored_at is not null then return snote_private.recycle_ack(p_company,e.owner_id,e.car_id,e.kind<>'customer')||jsonb_build_object('id',e.id,'kind',e.kind,'customerChanged',e.kind in ('vehicle','customer'),'mediaChanged',e.kind in ('vehicle','media'),'alreadyProcessed',true);end if;
 s:=e.snapshot;
 if e.kind='vehicle' then
  if exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from public.zc_media where company_id=p_company and car_id=e.car_id and group_name in ('photos','registration','inspection1','inspection2')) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  v_customers:=coalesce(s->'customers','[]');v_rrns:=coalesce(s->'rrn','[]');v_media:=coalesce(s->'media','[]');
 elsif e.kind='customer' then
  if exists(select 1 from snote_private.recycle_bin where company_id=p_company and car_id=e.car_id and kind='vehicle' and restored_at is null) and not exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
  v_customers:=jsonb_build_array(s->'customer');v_rrns:=case when jsonb_typeof(s->'rrn')='object' then jsonb_build_array(s->'rrn') else '[]'::jsonb end;v_media:='[]';
 else
  if exists(select 1 from snote_private.recycle_bin where company_id=p_company and car_id=e.car_id and kind='vehicle' and restored_at is null) and not exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
  perform snote_private.recycle_car(p_company,e.owner_id,e.car_id,true);
  mr:=jsonb_populate_record(null::public.zc_media,s->'media');
  select count(*) into v_n from public.zc_media where company_id=p_company and car_id=e.car_id and group_name=mr.group_name;
  if mr.group_name='photos' and v_n>=5 then raise exception 'PHOTO_LIMIT' using errcode='40001';elsif mr.group_name<>'photos' and v_n>0 then raise exception 'DOCUMENT_EXISTS' using errcode='40001';end if;
  v_customers:='[]';v_rrns:='[]';v_media:=jsonb_build_array(s->'media');
 end if;
 -- Check every collision before changing active data. Restore never upserts over a newer row.
 for f in select value from jsonb_array_elements(v_customers) loop
  if exists(select 1 from public.zc_customers where company_id=p_company and owner_id=(f->>'owner_id')::uuid and car_id=e.car_id) or not exists(select 1 from auth.users where id=(f->>'owner_id')::uuid) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 end loop;
 for f in select value from jsonb_array_elements(v_rrns) loop
  if exists(select 1 from zc_private.rrn_secrets where company_id=p_company and owner_id=(f->>'owner_id')::uuid and car_id=e.car_id) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 end loop;
 for f in select value from jsonb_array_elements(v_media) loop
  if exists(select 1 from public.zc_media where file_path=f->>'file_path' or(company_id=p_company and owner_id=(f->>'owner_id')::uuid and id=f->>'id')) or exists(select 1 from snote_private.recycle_files where company_id=p_company and file_path=f->>'file_path' and entry_id<>e.id) or not exists(select 1 from auth.users where id=(f->>'owner_id')::uuid) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  if not exists(select 1 from storage.objects where bucket_id='zc-vehicle-private' and name=f->>'file_path') then raise exception 'MEDIA_FILE_MISSING' using errcode='40001';end if;
 end loop;
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=e.owner_id and dataset='covers' for update;
 v_cover:=coalesce((s->>'coverExists')::boolean,false);
 if e.kind='vehicle' and coalesce(cd.payload?e.car_id,false) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 if e.kind='vehicle' then
  insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values(p_company,e.owner_id,'cars','[]',0,auth.uid()) on conflict(company_id,dataset,owner_id) do nothing;
  select * into d from public.zc_datasets where company_id=p_company and owner_id=e.owner_id and dataset='cars' for update;
  if jsonb_typeof(d.payload)<>'array' then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  update public.zc_datasets set payload=payload||jsonb_build_array(s->'car'),revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company and owner_id=e.owner_id and dataset='cars';
 end if;
 for f in select value from jsonb_array_elements(v_customers) loop
  c:=jsonb_populate_record(null::public.zc_customers,f);
  insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by,updated_at,restore_generation) values(p_company,c.owner_id,e.car_id,c.payload,c.has_rrn,auth.uid(),greatest(clock_timestamp(),c.updated_at+interval '1 microsecond'),gen_random_uuid());
 end loop;
 for f in select value from jsonb_array_elements(v_rrns) loop
  insert into zc_private.rrn_secrets select (jsonb_populate_record(null::zc_private.rrn_secrets,f)).*;
 end loop;
 for f in select value from jsonb_array_elements(v_media) loop
  insert into public.zc_media select (jsonb_populate_record(null::public.zc_media,f)).*;
 end loop;
 -- A restored individual photo must not replace a newly chosen cover.
 if e.kind in ('vehicle','media') and v_cover and not coalesce(cd.payload?e.car_id,false) then
  insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values(p_company,e.owner_id,'covers','{}',0,auth.uid()) on conflict(company_id,dataset,owner_id) do nothing;
  update public.zc_datasets set payload=jsonb_set(payload,array[e.car_id],s->'cover',true),revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where company_id=p_company and owner_id=e.owner_id and dataset='covers';
 end if;
 delete from snote_private.recycle_files where entry_id=e.id;
 update snote_private.recycle_bin set restored_at=clock_timestamp(),restored_by=auth.uid(),snapshot='{}',summary='{}' where id=e.id;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,auth.uid(),'recycle',e.id::text,'restore_'||e.kind);
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,e.owner_id,e.car_id,e.kind<>'customer')||jsonb_build_object('id',e.id,'kind',e.kind,'customerChanged',e.kind in ('vehicle','customer'),'mediaChanged',e.kind in ('vehicle','media'),'alreadyProcessed',false);
end $f$;

-- Guard old clients as well: their physical-delete/overwrite calls must fail safely.
create function snote_private.recycle_dataset_guard() returns trigger language plpgsql security definer set search_path='' as $f$
declare x jsonb;k text;v jsonb;
begin
 if current_setting('snote.recycle_internal',true)='1' or auth.uid() is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then if old.dataset in ('cars','covers') then raise exception 'RPC_REQUIRED' using errcode='42501';end if;return old;end if;
 if new.dataset not in ('cars','covers') then return new;end if;
 if tg_op='UPDATE' and(new.company_id is distinct from old.company_id or new.owner_id is distinct from old.owner_id or new.dataset is distinct from old.dataset) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if new.dataset='cars' then
  if jsonb_typeof(new.payload) is distinct from 'array' then raise exception 'INVALID_CARS' using errcode='22023';end if;
  if tg_op='UPDATE' and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(old.payload)='array' then old.payload else '[]'::jsonb end)o where o->>'id' is not null and not exists(select 1 from jsonb_array_elements(new.payload)n where n->>'id'=o->>'id')) then raise exception 'RPC_REQUIRED' using errcode='42501';end if;
  if (select count(*) from jsonb_array_elements(new.payload) a where a->>'id' is not null)<>(select count(distinct a->>'id') from jsonb_array_elements(new.payload)a where a->>'id' is not null) then raise exception 'AMBIGUOUS_CAR' using errcode='22023';end if;
  for x in select value from jsonb_array_elements(new.payload) loop
   if tg_op='INSERT' or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(old.payload)='array' then old.payload else '[]'::jsonb end)o where o->>'id'=x->>'id') then
    if exists(select 1 from snote_private.recycle_bin where company_id=new.company_id and car_id=x->>'id' and kind='vehicle' and restored_at is null) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
    if exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)c where a.company_id=new.company_id and a.owner_id<>new.owner_id and a.dataset='cars' and c->>'id'=x->>'id') then raise exception 'AMBIGUOUS_CAR' using errcode='22023';end if;
   end if;
  end loop;
 else
  if jsonb_typeof(new.payload) is distinct from 'object' then raise exception 'INVALID_COVERS' using errcode='22023';end if;
  for k,v in select * from jsonb_each(new.payload) loop
   if tg_op='INSERT' or old.payload->k is distinct from v then
    if exists(select 1 from snote_private.recycle_bin where company_id=new.company_id and car_id=k and kind='vehicle' and restored_at is null) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
    if v<>'null'::jsonb then
     perform snote_private.recycle_car(new.company_id,new.owner_id,k,true);
     if not exists(select 1 from public.zc_media where company_id=new.company_id and car_id=k and group_name='photos' and id=v#>>'{}') then raise exception 'INVALID_COVER' using errcode='22023';end if;
    end if;
   end if;
  end loop;
 end if;
 return new;
end $f$;
create trigger snote_recycle_dataset_guard before insert or update or delete on public.zc_datasets for each row execute function snote_private.recycle_dataset_guard();

create function snote_private.recycle_customer_guard() returns trigger language plpgsql security definer set search_path='' as $f$
begin
 if current_setting('snote.recycle_internal',true)='1' then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then if auth.uid() is not null then raise exception 'RPC_REQUIRED' using errcode='42501';end if;return old;end if;
 if tg_op='INSERT' and auth.uid() is not null then perform snote_private.recycle_lock(new.company_id);end if;
 if snote_private.recycle_blocked(new.company_id,new.owner_id,new.car_id) then raise exception 'CUSTOMER_IN_TRASH' using errcode='40001';end if;
 if tg_op='UPDATE' then
  if new.company_id is distinct from old.company_id or new.owner_id is distinct from old.owner_id or new.car_id is distinct from old.car_id or new.restore_generation is distinct from old.restore_generation then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if auth.uid() is not null and old.restore_generation<>'00000000-0000-0000-0000-000000000000'::uuid and new.payload is distinct from old.payload then raise exception 'RPC_REQUIRED' using errcode='42501';end if;
 elsif new.restore_generation<>'00000000-0000-0000-0000-000000000000'::uuid then raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 return new;
end $f$;
create trigger snote_recycle_customer_guard before insert or update or delete on public.zc_customers for each row execute function snote_private.recycle_customer_guard();

create function snote_private.recycle_media_guard() returns trigger language plpgsql security definer set search_path='' as $f$
declare p jsonb;m public.zc_members;n integer;
begin
 if current_setting('snote.recycle_internal',true)='1' or auth.uid() is null then if tg_op='DELETE' then return old;else return new;end if;end if;
 if tg_op='DELETE' then if old.group_name in ('photos','registration','inspection1','inspection2') then raise exception 'RPC_REQUIRED' using errcode='42501';end if;return old;end if;
 if new.group_name not in ('photos','registration','inspection1','inspection2') and(tg_op='INSERT' or old.group_name not in ('photos','registration','inspection1','inspection2')) then return new;end if;
 if tg_op='UPDATE' then
  if new.company_id is distinct from old.company_id or new.owner_id is distinct from old.owner_id or new.id is distinct from old.id or new.car_id is distinct from old.car_id or new.file_path is distinct from old.file_path or new.group_name is distinct from old.group_name then raise exception 'RPC_REQUIRED' using errcode='42501';end if;
  return new;
 end if;
 perform snote_private.recycle_lock(new.company_id);
 p:=snote_private.recycle_car(new.company_id,null,new.car_id,true);m:=snote_private.recycle_member(new.company_id,(p->>'ownerId')::uuid,true);
 if m.role='accountant' and new.group_name<>'registration' then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if snote_private.recycle_blocked(new.company_id,(p->>'ownerId')::uuid,new.car_id) and exists(select 1 from snote_private.recycle_bin where company_id=new.company_id and car_id=new.car_id and kind='vehicle' and restored_at is null) then raise exception 'CAR_IN_TRASH';end if;
 perform snote_private.recycle_validate_media(new.company_id,new.car_id,jsonb_build_array(to_jsonb(new)));
 select count(*) into n from public.zc_media where company_id=new.company_id and car_id=new.car_id and group_name=new.group_name;
 if new.group_name='photos' and n>=5 then raise exception 'PHOTO_LIMIT' using errcode='40001';elsif new.group_name<>'photos' and n>0 then raise exception 'DOCUMENT_EXISTS' using errcode='40001';end if;
 return new;
end $f$;
create trigger snote_recycle_media_guard before insert or update or delete on public.zc_media for each row execute function snote_private.recycle_media_guard();

create function snote_private.recycle_storage_allow(p_bucket text,p_path text,p_write boolean default false)
returns boolean language plpgsql volatile security definer set search_path='' as $f$
declare c uuid;
begin
 if p_bucket<>'zc-vehicle-private' then return true;end if;
 select company_id into c from public.zc_members where user_id=auth.uid() and active;
 -- Do not reveal another company's archive membership through this predicate.
 if c is null then return true;end if;
 if p_write then perform snote_private.recycle_lock(c);end if;
 if exists(select 1 from snote_private.recycle_files where company_id=c and bucket_id=p_bucket and file_path=p_path) then return false;end if;
 if p_write and exists(select 1 from public.zc_media where company_id=c and file_path=p_path and group_name in ('photos','registration','inspection1','inspection2')) then return false;end if;
 return true;
end $f$;
create policy snote_recycle_storage_read on storage.objects as restrictive for select to authenticated using(snote_private.recycle_storage_allow(bucket_id,name,false));
create policy snote_recycle_storage_insert on storage.objects as restrictive for insert to authenticated with check(snote_private.recycle_storage_allow(bucket_id,name,false));
create policy snote_recycle_storage_update on storage.objects as restrictive for update to authenticated using(snote_private.recycle_storage_allow(bucket_id,name,true)) with check(snote_private.recycle_storage_allow(bucket_id,name,true));
create policy snote_recycle_storage_delete on storage.objects as restrictive for delete to authenticated using(snote_private.recycle_storage_allow(bucket_id,name,true));

-- Keep original function bodies/ACL intact while establishing one company lock order.
do $patch$
declare src text;patched text;
begin
 src:=pg_get_functiondef('public.zc_write_dataset(uuid,text,uuid,integer,jsonb)'::regprocedure);
 if strpos(src,'snote_private.recycle_lock')=0 then
  patched:=replace(src,' if p_expected=0 then',E' if p_dataset in (''cars'',''covers'') then perform snote_private.recycle_lock(p_company);end if;\n if p_expected=0 then');
  if patched=src then raise exception 'Unexpected zc_write_dataset baseline';end if;execute patched;
 end if;
 src:=pg_get_functiondef('snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'::regprocedure);
 if strpos(src,'snote_private.recycle_lock')=0 then
  patched:=regexp_replace(src,'\mbegin\M',E'begin\n  perform snote_private.recycle_lock(p_company);\n  if snote_private.recycle_blocked(p_company,p_owner,p_car_id) then return null;end if;','i');
  if patched=src then raise exception 'Unexpected intake actor baseline';end if;execute patched;
 end if;
 src:=pg_get_functiondef('snote_intake_private.lock_link(text)'::regprocedure);
 if strpos(src,'snote_private.recycle_lock')=0 then
  patched:=regexp_replace(src,'\mdeclare\M',E'declare\n v_recycle_company uuid;','i');
  patched:=regexp_replace(patched,'\mbegin\M',E'begin\n select company_id into v_recycle_company from public.snote_customer_intake where token_hash=p_token_hash;\n if v_recycle_company is not null then perform snote_private.recycle_lock(v_recycle_company);end if;','i');
  if patched=src then raise exception 'Unexpected intake link baseline';end if;execute patched;
 end if;
 src:=pg_get_functiondef('public.zc_save_rrn(uuid,uuid,text,text)'::regprocedure);
 if strpos(src,'snote_private.recycle_lock')=0 then
  patched:=replace(src,' if not exists(select 1 from public.zc_customers',E' perform snote_private.recycle_lock(p_company);\n if snote_private.recycle_blocked(p_company,p_owner,p_car_id) then raise exception ''CUSTOMER_IN_TRASH'';end if;\n if exists(select 1 from public.zc_customers where company_id=p_company and owner_id=p_owner and car_id=p_car_id and restore_generation<>''00000000-0000-0000-0000-000000000000''::uuid) then raise exception ''RPC_REQUIRED'' using errcode=''42501'';end if;\n if not exists(select 1 from public.zc_customers');
  if patched=src then raise exception 'Unexpected RRN save baseline';end if;execute patched;
 end if;
end $patch$;

create function public.snote_recycle_list(p_company uuid,p_kind text default 'all',p_query text default '',p_page integer default 1,p_page_size integer default 20,p_sort text default 'deletedAt',p_direction text default 'desc') returns jsonb language sql security invoker set search_path='' as $f$select snote_private.recycle_list(p_company,p_kind,p_query,p_page,p_page_size,p_sort,p_direction);$f$;
create function public.snote_recycle_trash_vehicle(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_expected_covers integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.recycle_trash_vehicle(p_company,p_owner,p_car_id,p_expected,p_expected_covers,p_request_id);$f$;
create function public.snote_recycle_trash_customer(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.recycle_trash_customer(p_company,p_owner,p_car_id,p_expected_updated_at,p_expected_generation,p_request_id);$f$;
create function public.snote_recycle_media(p_company uuid,p_owner uuid,p_car_id text,p_remove jsonb,p_records jsonb,p_expected integer,p_expected_covers integer,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.recycle_media(p_company,p_owner,p_car_id,p_remove,p_records,p_expected,p_expected_covers,p_request_id);$f$;
create function public.snote_recycle_restore(p_company uuid,p_entry uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.recycle_restore(p_company,p_entry);$f$;
create function public.snote_customer_save(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_payload jsonb,p_has_rrn boolean) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.customer_save(p_company,p_owner,p_car_id,p_expected_updated_at,p_expected_generation,p_payload,p_has_rrn);$f$;

do $acl$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_private' and(p.proname like 'recycle_%' or p.proname='customer_save') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where(n.nspname='public' and(p.proname like 'snote_recycle_%' or p.proname='snote_customer_save')) or(n.nspname='snote_private' and p.proname in ('recycle_list','recycle_trash_vehicle','recycle_trash_customer','recycle_media','recycle_restore','customer_save','recycle_storage_allow')) loop
  execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $acl$;
notify pgrst,'reload schema';
