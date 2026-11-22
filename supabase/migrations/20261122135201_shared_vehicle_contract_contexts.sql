-- Shared contracts belong to the acting dealer; source inventory and owner PII
-- remain separate. Contexts are immutable per accepted invitation version.
begin;

create table if not exists snote_private.shared_contract_contexts(
 id uuid primary key default gen_random_uuid(),
 recipient_company_id uuid not null references public.zc_companies(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 source_company_id uuid not null references public.zc_companies(id) on delete cascade,
 source_owner_id uuid not null references auth.users(id) on delete cascade,
 source_car_id text not null check(length(source_car_id) between 1 and 200),
 invitation_id uuid not null, invitation_version integer not null check(invitation_version>0),
 created_at timestamptz not null default clock_timestamp(),
 unique(recipient_company_id,recipient_id,invitation_id,invitation_version)
);
alter table snote_private.shared_contract_contexts enable row level security;
revoke all on snote_private.shared_contract_contexts from public,anon,authenticated,service_role;

-- Both namespaces are acquired in one global order before any existing
-- recipient recycle/intake locks. Revocation continues to lock only its source.
create or replace function snote_private.shared_contract_company_locks(p_recipient uuid,p_source uuid)
returns void language plpgsql security definer set search_path='' as $f$
begin
 if p_recipient is null or p_source is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_recipient::text<=p_source::text then
  perform snote_private.recycle_lock(p_recipient);
  if p_source<>p_recipient then perform snote_private.recycle_lock(p_source);end if;
 else
  perform snote_private.recycle_lock(p_source);perform snote_private.recycle_lock(p_recipient);
 end if;
end$f$;

-- No customer tables or customer/recycle helper are read here. The same
-- read-only predicate can therefore be used by the recipient customer RLS gate.
create or replace function snote_private.shared_contract_lookup(p_company uuid,p_owner uuid,p_car text,p_allow_sold boolean default true)
returns jsonb language plpgsql stable security definer set search_path='' as $f$
declare c snote_private.shared_contract_contexts;s snote_private.vehicle_shares;d public.zc_datasets;
 raw jsonb;safe jsonb;company public.zc_companies;legal jsonb;
begin
 if p_car is null or p_car !~ '^sc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 select * into c from snote_private.shared_contract_contexts where id=substring(p_car from 4)::uuid
  and recipient_company_id=p_company and recipient_id=p_owner;
 if not found or not snote_private.share_member(p_owner,p_company)
  or (select count(*) from public.zc_members where user_id=p_owner and active and role in('dealer','admin'))<>1
  or not snote_private.share_member(c.source_owner_id,c.source_company_id) then return null;end if;
 select * into s from snote_private.vehicle_shares where invitation_id=c.invitation_id and version=c.invitation_version
  and company_id=c.source_company_id and owner_id=c.source_owner_id and car_id=c.source_car_id
  and recipient_id=p_owner and recipient_company_id=p_company and state='accepted' and permission in('edit','all');
 if not found then return null;end if;
 select * into d from public.zc_datasets where company_id=c.source_company_id and owner_id=c.source_owner_id and dataset='cars';
 if not found or jsonb_typeof(d.payload) is distinct from 'array'
  or snote_private.share_vehicle_owner(c.source_company_id,c.source_car_id) is distinct from c.source_owner_id
  or (select count(*) from jsonb_array_elements(d.payload)x where jsonb_typeof(x)='object' and x->>'id'=c.source_car_id)<>1 then return null;end if;
 select x into raw from jsonb_array_elements(d.payload)x where x->>'id'=c.source_car_id;
 if jsonb_typeof(raw->'model') is distinct from 'string' or length(btrim(raw->>'model')) not between 1 and 200
  or (not p_allow_sold and coalesce(raw->>'status','') not in('판매중','계약중','매입진행','수리중')) then return null;end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe from jsonb_each(raw)
 where key=any(array['model','make','group','generation','grade','subgrade','extra','plate','vin','year','km','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','fuel','transmission','category','moneyUnit'])
  and jsonb_typeof(value) in('string','number') and length(value#>>'{}')<=200;
 safe:=safe||jsonb_build_object('id',p_car,'model',btrim(raw->>'model'));
 select * into company from public.zc_companies where id=c.source_company_id;
 if not found then return null;end if;
 select coalesce(jsonb_object_agg(key,to_jsonb(left(value#>>'{}',case when key in('business_address','business_address_detail') then 500 else 200 end))),'{}'::jsonb)
  into legal from jsonb_each(to_jsonb(company))
  where key=any(array['business_number','representative_name','business_postcode','business_address','business_address_detail','business_phone','corporate_number']) and jsonb_typeof(value)='string';
 legal:=legal||jsonb_build_object('id',company.id,'name',left(company.name,200));
 return jsonb_build_object('ok',true,'carId',p_car,'companyId',p_company,'ownerId',p_owner,
  'source',jsonb_build_object('companyId',c.source_company_id,'ownerId',c.source_owner_id,'carId',c.source_car_id),
  'access',jsonb_build_object('invitationId',c.invitation_id,'version',c.invitation_version),
  'car',safe,'sourceCompany',legal);
end$f$;

create or replace function snote_private.shared_contract_lock(p_company uuid,p_owner uuid,p_car text,p_allow_sold boolean default true)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare c snote_private.shared_contract_contexts;result jsonb;
begin
 if p_car is null or p_car !~ '^sc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 select * into c from snote_private.shared_contract_contexts where id=substring(p_car from 4)::uuid
  and recipient_company_id=p_company and recipient_id=p_owner;
 if not found then return null;end if;
 perform snote_private.shared_contract_company_locks(p_company,c.source_company_id);
 -- Match sharing's dataset-before-share row order and recheck after waiting.
 perform 1 from public.zc_datasets where company_id=c.source_company_id and owner_id=c.source_owner_id and dataset='cars' for share;
 perform 1 from snote_private.vehicle_shares where invitation_id=c.invitation_id for share;
 perform 1 from snote_private.shared_contract_contexts where id=c.id for share;
 result:=snote_private.shared_contract_lookup(p_company,p_owner,p_car,p_allow_sold);
 return result;
end$f$;

create or replace function snote_private.shared_contract_bind(p_company uuid,p_owner uuid,p_car text,p_access jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare actor uuid:=snote_private.share_actor();recipient uuid;s snote_private.vehicle_shares;
 context_id uuid;virtual_id text;result jsonb;
begin
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 perform snote_private.vehicle_share_assert_access_shape(p_access);
 select min(company_id::text)::uuid into recipient from public.zc_members where user_id=actor and active and role in('dealer','admin') having count(*)=1;
 if recipient is null or not snote_private.share_member(actor,recipient) or not snote_private.share_member(p_owner,p_company) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform snote_private.shared_contract_company_locks(recipient,p_company);
 perform 1 from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for share;
 select * into s from snote_private.vehicle_shares where invitation_id=(p_access->>'invitationId')::uuid
  and version=(p_access->>'version')::integer and company_id=p_company and owner_id=p_owner and car_id=p_car
  and recipient_id=actor and recipient_company_id=recipient and state='accepted' and permission in('edit','all') for share;
 if not found then raise exception 'SHARE_ACCESS_CHANGED' using errcode='42501';end if;
 select id into context_id from snote_private.shared_contract_contexts where recipient_company_id=recipient
  and recipient_id=actor and invitation_id=s.invitation_id and invitation_version=s.version;
 if not found then
  context_id:=gen_random_uuid();virtual_id:='sc:'||context_id::text;
  if exists(select 1 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)x where d.company_id=recipient and d.dataset='cars' and x->>'id'=virtual_id)
   or exists(select 1 from public.zc_customers where company_id=recipient and owner_id=actor and car_id=virtual_id) then raise exception 'CONTEXT_ID_COLLISION' using errcode='40001';end if;
  insert into snote_private.shared_contract_contexts(id,recipient_company_id,recipient_id,source_company_id,source_owner_id,source_car_id,invitation_id,invitation_version)
   values(context_id,recipient,actor,p_company,p_owner,p_car,s.invitation_id,s.version);
 end if;
 result:=snote_private.shared_contract_lock(recipient,actor,'sc:'||context_id::text,false);
 if result is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return result;
end$f$;

create or replace function snote_private.shared_contract_access(p_car_id text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare actor uuid:=snote_private.share_actor();recipient uuid;result jsonb;
begin
 select min(company_id::text)::uuid into recipient from public.zc_members where user_id=actor and active and role in('dealer','admin') having count(*)=1;
 if recipient is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 result:=snote_private.shared_contract_lock(recipient,actor,p_car_id,true);
 if result is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return result;
end$f$;

create or replace function snote_private.shared_contract_access_many(p_car_ids text[])
returns jsonb language plpgsql security definer set search_path='' as $f$
declare actor uuid:=snote_private.share_actor();recipient uuid;company uuid;car text;result jsonb;items jsonb:='[]'::jsonb;n integer;
begin
 if p_car_ids is null or array_ndims(p_car_ids) is distinct from 1 or array_lower(p_car_ids,1) is distinct from 1
  or cardinality(p_car_ids) not between 1 and 100
  or (select count(distinct value) from unnest(p_car_ids)value)<>cardinality(p_car_ids)
  or exists(select 1 from unnest(p_car_ids)value where value is null or value !~ '^sc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select min(company_id::text)::uuid into recipient from public.zc_members where user_id=actor and active and role in('dealer','admin') having count(*)=1;
 if recipient is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select count(*) into n from snote_private.shared_contract_contexts where recipient_id=actor and recipient_company_id=recipient and 'sc:'||id::text=any(p_car_ids);
 if n<>cardinality(p_car_ids) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- A batch acquires the full union first; per-item pair ordering alone would
 -- otherwise permit A→C then A→B lock inversions between concurrent batches.
 for company in select id from (
  select recipient as id union select source_company_id from snote_private.shared_contract_contexts
  where recipient_id=actor and recipient_company_id=recipient and 'sc:'||id::text=any(p_car_ids)
 ) companies order by id::text loop perform snote_private.recycle_lock(company);end loop;
 foreach car in array p_car_ids loop
  result:=snote_private.shared_contract_lock(recipient,actor,car,true);
  if result is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
  items:=items||jsonb_build_array(result);
 end loop;
 return items;
end$f$;

create or replace function snote_private.shared_contract_customer_allowed(p_company uuid,p_owner uuid,p_car text)
returns boolean language plpgsql stable security definer set search_path='' as $f$
begin
 if auth.uid() is distinct from p_owner or auth.jwt()->>'role' is distinct from 'authenticated'
  or auth.jwt()->>'is_anonymous'='true' then return false;end if;
 return snote_private.shared_contract_lookup(p_company,p_owner,p_car,true) is not null;
end$f$;

-- Copy the precise installed owned implementations without moving their OIDs or
-- leaking the copied definer entry points. Reapplying never copies our wrappers.
do $copy$
declare source text;before_name text;after_name text;signature text;
begin
 for before_name,after_name,signature in values
  ('snote_intake_private.lock_actor_car','snote_intake_private.lock_actor_car_owned_v2188','uuid,uuid,text,boolean'),
  ('snote_private.customer_save','snote_private.customer_save_owned_v2188','uuid,uuid,text,timestamp with time zone,uuid,jsonb,boolean'),
  ('snote_private.recycle_trash_customer','snote_private.recycle_trash_customer_owned_v2188','uuid,uuid,text,timestamp with time zone,uuid,uuid'),
  ('snote_private.recycle_restore','snote_private.recycle_restore_owned_v2188','uuid,uuid')
 loop
  if to_regprocedure(after_name||'('||signature||')') is null then
   source:=pg_get_functiondef(to_regprocedure(before_name||'('||signature||')'));
   if source is null or strpos(source,after_name)>0 or strpos(source,'shared_contract_lock')>0 then raise exception 'Unexpected contract function baseline';end if;
   execute replace(source,'FUNCTION '||before_name||'(','FUNCTION '||after_name||'(');
  end if;
 end loop;
end$copy$;

create or replace function snote_intake_private.lock_actor_car(p_owner uuid,p_company uuid,p_car_id text,p_allow_sold boolean default false)
returns jsonb language plpgsql set search_path='' as $f$
declare result jsonb;
begin
 if left(lower(coalesce(p_car_id,'')),3)='sc:' then
  result:=snote_private.shared_contract_lock(p_company,p_owner,p_car_id,p_allow_sold);
  if result is null then return null;end if;
  if snote_private.recycle_blocked(p_company,p_owner,p_car_id) then return null;end if;
  -- Public customer links receive the same display-only snapshot as owned
  -- intake links. Cost/loan/source metadata stay in authenticated bind/access.
  return jsonb_build_object(
   'model',result#>>'{car,model}',
   'plate',left(coalesce(result#>>'{car,plate}',''),30),
   'year',case when result#>>'{car,year}' ~ '^[0-9]{4}$' then result#>'{car,year}' else 'null'::jsonb end,
   'km',left(coalesce(result#>>'{car,km}',result#>>'{car,mileage}',''),30),
   'color',left(coalesce(result#>>'{car,color}',''),50),
   'sell',case when result#>>'{car,sell}' ~ '^[0-9]{1,9}([.][0-9]{1,4})?$' then (result#>>'{car,sell}')::numeric end,
   'moneyUnit',case when result#>>'{car,moneyUnit}'='KRW' then 'KRW' else '' end
  );
 end if;
 return snote_intake_private.lock_actor_car_owned_v2188(p_owner,p_company,p_car_id,p_allow_sold);
end$f$;

create or replace function snote_intake_private.lock_link(p_token_hash text)
returns public.snote_customer_intake language plpgsql set search_path='' as $f$
declare r public.snote_customer_intake;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 select * into r from public.snote_customer_intake where token_hash=p_token_hash;
 if not found then return null;end if;
 -- Shared contexts acquire both companies before the original recipient lock.
 if left(lower(r.car_id),3)='sc:' and snote_private.shared_contract_lock(r.company_id,r.owner_id,r.car_id,false) is null then return null;end if;
 perform snote_private.recycle_lock(r.company_id);
 if snote_intake_private.lock_actor_car(r.owner_id,r.company_id,r.car_id,false) is null then return null;end if;
 select * into r from public.snote_customer_intake where id=r.id and token_hash=p_token_hash for update;
 if not found then return null;end if;
 return r;
end$f$;

-- The acting dealer stores the request, but the displayed seller company for
-- a shared contract is the source company named in the accepted vehicle share.
do $company_name$
declare source text;old_block text;new_block text;
begin
 -- Installed functions can retain CRLF bodies. Normalize line endings only;
 -- require the same complete semantic block exactly once before patching.
 source:=replace(pg_get_functiondef('public.snote_intake_create(text,text,text)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,'shared_contract_lookup')=0 then
  old_block:=$old$  select company.name into v_name from public.zc_companies as company where company.id = v_company;
  if not found then return snote_intake_private.failure('FORBIDDEN', '소속 상사 정보를 확인할 수 없습니다.'); end if;$old$;
  new_block:=$new$  if left(lower(p_car_id),3)='sc:' then
    v_name:=snote_private.shared_contract_lookup(v_company,v_user,p_car_id,false)#>>'{sourceCompany,name}';
    if v_name is null then return snote_intake_private.failure('FORBIDDEN', '소속 상사 정보를 확인할 수 없습니다.');end if;
  else
    select company.name into v_name from public.zc_companies as company where company.id = v_company;
    if not found then return snote_intake_private.failure('FORBIDDEN', '소속 상사 정보를 확인할 수 없습니다.'); end if;
  end if;$new$;
  if strpos(source,old_block)=0 or (length(source)-length(replace(source,old_block,'')))/length(old_block)<>1 then raise exception 'Unexpected customer intake company baseline';end if;
  execute replace(source,old_block,new_block);
 end if;
end$company_name$;

-- Shared requests serialize through their recipient company instead of the
-- legacy actor lock. Retaining actor -> company here would conflict with owned
-- public links' company -> actor order; prepending company -> actor would in
-- turn conflict with owned authenticated create. Owned bodies stay unchanged.
do $actor_order$
declare signature text;source text;old_lock text;new_lock text;
begin
 old_lock:=$old$perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));$old$;
 foreach signature in array array['public.snote_intake_create(text,text,text)','public.snote_intake_list(text)','public.snote_intake_details_v3(uuid)','public.snote_intake_rrn_access(uuid)','public.snote_intake_revoke(uuid)'] loop
  source:=replace(pg_get_functiondef(to_regprocedure(signature)),E'\r\n',E'\n');
  -- Legacy RRN retrieval was never installed on some deployments. The wizard
  -- uses details_v3; secure this old endpoint when present without creating it.
  if source is null and signature='public.snote_intake_rrn_access(uuid)' then continue;end if;
  if source is null then raise exception 'Missing intake lock baseline';end if;
  if strpos(source,'shared_contract_actor_order')>0 then continue;end if;
  if strpos(source,old_lock)=0 or (length(source)-length(replace(source,old_lock,'')))/length(old_lock)<>1 then raise exception 'Unexpected intake lock baseline';end if;
  if signature in('public.snote_intake_create(text,text,text)','public.snote_intake_list(text)') then
   new_lock:=$new$-- shared_contract_actor_order: shared company lock replaces actor lock.
  if left(lower(coalesce(p_car_id,'')),3)<>'sc:' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  else
    perform snote_private.share_actor();
  end if;$new$;
  else
   new_lock:=$new$-- shared_contract_actor_order: shared company lock replaces actor lock.
  if not exists(select 1 from public.snote_customer_intake intake where intake.id=p_id and intake.owner_id=v_user and left(lower(intake.car_id),3)='sc:') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  else
    perform snote_private.share_actor();
  end if;$new$;
  end if;
  execute replace(source,old_lock,new_lock);
 end loop;
end$actor_order$;

create or replace function snote_private.customer_save(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_payload jsonb,p_has_rrn boolean)
returns jsonb language plpgsql security definer set search_path='' as $f$
begin
 if left(lower(coalesce(p_car_id,'')),3)='sc:' then
  if auth.uid() is distinct from p_owner or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true'
   or snote_private.shared_contract_lock(p_company,p_owner,p_car_id,true) is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 end if;
 return snote_private.customer_save_owned_v2188(p_company,p_owner,p_car_id,p_expected_updated_at,p_expected_generation,p_payload,p_has_rrn);
end$f$;

-- Existing recycle definers bypass table RLS, so apply the same virtual
-- recipient/grant scope before their unchanged CAS, generation and restore code.
create or replace function snote_private.recycle_trash_customer(p_company uuid,p_owner uuid,p_car_id text,p_expected_updated_at timestamptz,p_expected_generation uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
begin
 if left(lower(coalesce(p_car_id,'')),3)='sc:' then
  if not snote_private.shared_contract_customer_allowed(p_company,p_owner,p_car_id)
   or snote_private.shared_contract_lock(p_company,p_owner,p_car_id,true) is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 end if;
 return snote_private.recycle_trash_customer_owned_v2188(p_company,p_owner,p_car_id,p_expected_updated_at,p_expected_generation,p_request_id);
end$f$;

create or replace function snote_private.recycle_restore(p_company uuid,p_entry uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare entry snote_private.recycle_bin;
begin
 select * into entry from snote_private.recycle_bin where company_id=p_company and id=p_entry;
 if found and left(lower(entry.car_id),3)='sc:' then
  if not snote_private.shared_contract_customer_allowed(p_company,entry.owner_id,entry.car_id)
   or snote_private.shared_contract_lock(p_company,entry.owner_id,entry.car_id,true) is null then raise exception 'FORBIDDEN' using errcode='42501';end if;
 end if;
 return snote_private.recycle_restore_owned_v2188(p_company,p_entry);
end$f$;

do $recycle_list$
declare source text;old_filter text;new_filter text;
begin
 source:=replace(pg_get_functiondef('snote_private.recycle_list(uuid,text,text,integer,integer,text,text)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,'shared_contract_customer_allowed')=0 then
  old_filter:='where e.company_id=p_company and e.restored_at is null';
  new_filter:=old_filter||E'\n  and(left(lower(e.car_id),3)<>''sc:'' or snote_private.shared_contract_customer_allowed(e.company_id,e.owner_id,e.car_id))';
  if strpos(source,old_filter)=0 or (length(source)-length(replace(source,old_filter,'')))/length(old_filter)<>1 then raise exception 'Unexpected recycle list baseline';end if;
  execute replace(source,old_filter,new_filter);
 end if;
end$recycle_list$;

-- Signed wizard completion keeps the exact owned path, but virtual contracts
-- use their already-authorized storage id instead of looking in actor inventory.
do $patch$
declare source text;old_block text;new_block text;
begin
 source:=replace(pg_get_functiondef('public.snote_intake_submit_v3(text,text,jsonb,text,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,'shared_contract_lookup')=0 then
  old_block:=$old$  select item.value into v_car from public.zc_datasets as dataset
    cross join lateral pg_catalog.jsonb_array_elements(dataset.payload) as item(value)
    where dataset.company_id = v_row.company_id and dataset.owner_id = v_row.owner_id
      and dataset.dataset = 'cars' and item.value ->> 'id' = v_row.car_id;
  if not found then raise exception '담당 차량 정보를 확인하지 못했습니다.' using errcode = 'P0001'; end if;
  v_car_id := v_car -> 'id';$old$;
  new_block:=$new$  if left(lower(v_row.car_id),3)='sc:' then
    v_car:=snote_private.shared_contract_lookup(v_row.company_id,v_row.owner_id,v_row.car_id,false)->'car';
    if v_car is null then raise exception '공유 차량 이용 권한이 변경되었습니다.' using errcode='42501';end if;
    v_car_id:=to_jsonb(v_row.car_id);
  else
    select item.value into v_car from public.zc_datasets as dataset
      cross join lateral pg_catalog.jsonb_array_elements(dataset.payload) as item(value)
      where dataset.company_id = v_row.company_id and dataset.owner_id = v_row.owner_id
        and dataset.dataset = 'cars' and item.value ->> 'id' = v_row.car_id;
    if not found then raise exception '담당 차량 정보를 확인하지 못했습니다.' using errcode = 'P0001'; end if;
    v_car_id := v_car -> 'id';
  end if;$new$;
  if strpos(source,old_block)=0 or (length(source)-length(replace(source,old_block,'')))/length(old_block)<>1 then raise exception 'Unexpected signed customer intake baseline';end if;
  execute replace(source,old_block,new_block);
 end if;
end$patch$;

-- Legacy numbered-secret endpoints are not used by the new shared workflow.
-- Reject reserved ids there rather than letting an older definer bypass the
-- current invitation gate or create a second encryption path.
do $legacy$
declare signature text;source text;patched text;
begin
 foreach signature in array array['public.zc_read_rrn(uuid,uuid,text)','public.zc_save_rrn(uuid,uuid,text,text)'] loop
  if to_regprocedure(signature) is null then continue;end if;
  source:=replace(pg_get_functiondef(to_regprocedure(signature)),E'\r\n',E'\n');
  if strpos(source,'shared_contract_reserved')=0 then
   patched:=regexp_replace(source,'\mbegin\M',E'begin\n -- shared_contract_reserved: use the server identity API for scoped contracts.\n if left(lower(coalesce(p_car_id,\'\')),3)=\'sc:\' then raise exception \'FORBIDDEN\' using errcode=\'42501\';end if;','i');
   if patched=source then raise exception 'Unexpected legacy identity baseline';end if;
   execute patched;
  end if;
 end loop;
end$legacy$;

drop policy if exists snote_shared_contract_customer_guard on public.zc_customers;
create policy snote_shared_contract_customer_guard on public.zc_customers as restrictive for all to authenticated
 using(left(lower(car_id),3)<>'sc:' or snote_private.shared_contract_customer_allowed(company_id,owner_id,car_id))
 with check(left(lower(car_id),3)<>'sc:' or snote_private.shared_contract_customer_allowed(company_id,owner_id,car_id));
-- All virtual customer writes use the locked CAS RPC. Raw generation-zero
-- updates must not race a share downgrade or bypass restore-generation checks.
drop policy if exists snote_shared_contract_customer_insert on public.zc_customers;
create policy snote_shared_contract_customer_insert on public.zc_customers as restrictive for insert to authenticated
 with check(left(lower(car_id),3)<>'sc:');
drop policy if exists snote_shared_contract_customer_update on public.zc_customers;
create policy snote_shared_contract_customer_update on public.zc_customers as restrictive for update to authenticated
 using(left(lower(car_id),3)<>'sc:') with check(left(lower(car_id),3)<>'sc:');
drop policy if exists snote_shared_contract_customer_delete on public.zc_customers;
create policy snote_shared_contract_customer_delete on public.zc_customers as restrictive for delete to authenticated
 using(left(lower(car_id),3)<>'sc:');

create or replace function public.snote_shared_contract_bind(p_company uuid,p_owner uuid,p_car text,p_access jsonb)
returns jsonb language sql security invoker set search_path='' as $f$select snote_private.shared_contract_bind(p_company,p_owner,p_car,p_access);$f$;
create or replace function public.snote_shared_contract_access(p_car_id text)
returns jsonb language sql security invoker set search_path='' as $f$select snote_private.shared_contract_access(p_car_id);$f$;
create or replace function public.snote_shared_contract_access_many(p_car_ids text[])
returns jsonb language sql security invoker set search_path='' as $f$select snote_private.shared_contract_access_many(p_car_ids);$f$;

revoke all on function snote_private.shared_contract_company_locks(uuid,uuid),snote_private.shared_contract_lookup(uuid,uuid,text,boolean),snote_private.shared_contract_lock(uuid,uuid,text,boolean),snote_private.shared_contract_bind(uuid,uuid,text,jsonb),snote_private.shared_contract_access(text),snote_private.shared_contract_access_many(text[]),snote_private.shared_contract_customer_allowed(uuid,uuid,text),snote_intake_private.lock_actor_car_owned_v2188(uuid,uuid,text,boolean),snote_private.customer_save_owned_v2188(uuid,uuid,text,timestamptz,uuid,jsonb,boolean),snote_private.recycle_trash_customer_owned_v2188(uuid,uuid,text,timestamptz,uuid,uuid),snote_private.recycle_restore_owned_v2188(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.snote_shared_contract_bind(uuid,uuid,text,jsonb),public.snote_shared_contract_access(text),public.snote_shared_contract_access_many(text[]) from public,anon,authenticated,service_role;
grant execute on function snote_private.shared_contract_bind(uuid,uuid,text,jsonb),snote_private.shared_contract_access(text),snote_private.shared_contract_access_many(text[]),snote_private.shared_contract_customer_allowed(uuid,uuid,text) to authenticated;
grant execute on function public.snote_shared_contract_bind(uuid,uuid,text,jsonb),public.snote_shared_contract_access(text),public.snote_shared_contract_access_many(text[]) to authenticated;

commit;
