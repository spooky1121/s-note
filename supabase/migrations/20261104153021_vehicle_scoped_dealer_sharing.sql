-- Only this vehicle may cross the normal company/owner boundary. Customer datasets never do.
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;
create table if not exists snote_private.vehicle_shares (
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 car_id text not null check(length(car_id) between 1 and 200),
 recipient_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 primary key(company_id,owner_id,car_id,recipient_id),check(owner_id<>recipient_id)
);
alter table snote_private.vehicle_shares enable row level security;
revoke all on snote_private.vehicle_shares from public,anon,authenticated;
create index if not exists vehicle_shares_recipient on snote_private.vehicle_shares(recipient_id);
create or replace function snote_private.vehicle_share(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_member public.zc_members;v_owner boolean;v_target uuid;v_row public.zc_datasets;v_car jsonb;v_result jsonb;v_key text;v_value jsonb;v_safe jsonb;v_patch jsonb;
 v_fields text[]:=array['id','model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','costs','repairItems','fuel','transmission','category','moneyUnit'];
 v_edit text[]:=array['model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt'];
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 select * into v_member from public.zc_members where user_id=v_actor and active and role in ('dealer','admin');
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action='incoming' then
  select coalesce(jsonb_agg(item order by item->>'sharedAt' desc),'[]') into v_result from (
   select jsonb_build_object('companyId',s.company_id,'ownerId',s.owner_id,'carId',s.car_id,'ownerName',m.display_name,'sharedAt',s.created_at,'model',c->>'model','plate',c->>'plate') item
   from snote_private.vehicle_shares s join public.zc_members m on m.user_id=s.owner_id and m.company_id=s.company_id and m.active
   join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
   where s.recipient_id=v_actor and c->>'id'=s.car_id limit 1000
  )x;return v_result;
 end if;
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_owner:=v_member.company_id=p_company and (v_actor=p_owner or v_member.role='admin');
 if not exists(select 1 from public.zc_members where user_id=p_owner and company_id=p_company and active and role in ('dealer','admin')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action in ('grant','revoke','outgoing') and not v_owner then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Serialize a shared edit with the existing owner CAS write, never replace an unrelated car.
 select * into v_row from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if not found or jsonb_typeof(v_row.payload)<>'array' then raise exception 'CAR_NOT_FOUND';end if;
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select c into v_car from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car;
 if v_car is null or (select count(*) from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car)<>1 then raise exception 'CAR_NOT_FOUND';end if;
 if p_action='grant' then
  if p_email is null or length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL' using errcode='22023';end if;
  select u.id into v_target from auth.users u join public.zc_members m on m.user_id=u.id and m.active and m.role in ('dealer','admin') where lower(u.email)=lower(btrim(p_email)) and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<now()) limit 1;
  if v_target is null then raise exception 'DEALER_NOT_FOUND';end if;
  if v_target=p_owner then raise exception 'SELF_SHARE' using errcode='22023';end if;
  if (select count(*) from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car)>=30 and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_target) then raise exception 'SHARE_LIMIT';end if;
  insert into snote_private.vehicle_shares(company_id,owner_id,car_id,recipient_id,created_by) values(p_company,p_owner,p_car,v_target,v_actor) on conflict do nothing;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'grant:'||v_target);
  return jsonb_build_object('ok',true);
 elsif p_action='revoke' then
  delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=p_target;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'revoke:'||p_target);
  return jsonb_build_object('ok',true);
 elsif p_action='outgoing' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.recipient_id,'email',u.email,'name',m.display_name,'createdAt',s.created_at) order by s.created_at),'[]') into v_result from snote_private.vehicle_shares s join auth.users u on u.id=s.recipient_id join public.zc_members m on m.user_id=s.recipient_id where s.company_id=p_company and s.owner_id=p_owner and s.car_id=p_car;return v_result;
 elsif p_action='update' then
  if p_expected is null or v_row.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
  if jsonb_typeof(p_patch)<>'object' or p_patch is null or octet_length(p_patch::text)>10000 then raise exception 'INVALID_PATCH' using errcode='22023';end if;
  for v_key,v_value in select * from jsonb_each(p_patch) loop
   if not(v_key=any(v_edit)) then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
   if v_key in ('buy','sell','mileage') then
    if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric<0 or (v_value#>>'{}')::numeric>900000000000 then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key='mileage' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key in ('buy','sell') and ((v_car->>'moneyUnit'='KRW' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)) or (coalesce(v_car->>'moneyUnit','')<>'KRW' and (v_value#>>'{}')::numeric*10000<>trunc((v_value#>>'{}')::numeric*10000))) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
   elsif jsonb_typeof(v_value)<>'string' or length(v_value#>>'{}')>200 then raise exception 'INVALID_TEXT' using errcode='22023';end if;
  end loop;
  v_car:=v_car||p_patch;
  if octet_length((v_car)::text)>1000000 then raise exception 'INVALID_PATCH';end if;
  update public.zc_datasets set payload=(select jsonb_agg(case when c->>'id'=p_car then v_car else c end order by ord) from jsonb_array_elements(v_row.payload) with ordinality as a(c,ord)),revision=revision+1,updated_at=now(),updated_by=v_actor where company_id=p_company and owner_id=p_owner and dataset='cars' returning * into v_row;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'edit');
 elsif p_action not in ('read','media') then raise exception 'INVALID_ACTION' using errcode='22023';
 end if;
 if p_action='media' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',file_path,'group',group_name,'name',original_name)),'[]') into v_result from public.zc_media where company_id=p_company and owner_id=p_owner and car_id=p_car and group_name in ('photos','registration','inspection1','inspection2');return v_result;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into v_safe from jsonb_each(v_car) where key=any(v_fields);
 return jsonb_build_object('car',v_safe,'revision',v_row.revision);
end;$$;
revoke all on function snote_private.vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) from public,anon;
grant execute on function snote_private.vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) to authenticated;
create or replace function public.snote_vehicle_share(p_action text,p_company uuid default null,p_owner uuid default null,p_car text default null,p_email text default null,p_target uuid default null,p_expected integer default null,p_patch jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$ select snote_private.vehicle_share(p_action,p_company,p_owner,p_car,p_email,p_target,p_expected,p_patch); $$;
revoke all on function public.snote_vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) from public,anon;
grant execute on function public.snote_vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) to authenticated;
-- Private bucket remains private. Cross-company reads require this exact live vehicle grant.
create or replace function snote_private.shared_vehicle_file(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from public.zc_media f join snote_private.vehicle_shares s on s.company_id=f.company_id and s.owner_id=f.owner_id and s.car_id=f.car_id
  join public.zc_members r on r.user_id=s.recipient_id and r.active and r.role in ('dealer','admin')
  join public.zc_members o on o.user_id=s.owner_id and o.company_id=s.company_id and o.active
  join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
  where s.recipient_id=auth.uid() and f.file_path=p_path and f.group_name in ('photos','registration','inspection1','inspection2') and exists(select 1 from jsonb_array_elements(d.payload)c where c->>'id'=s.car_id)
 ); $$;
revoke all on function snote_private.shared_vehicle_file(text) from public,anon;
grant execute on function snote_private.shared_vehicle_file(text) to authenticated;
drop policy if exists snote_shared_vehicle_file_read on storage.objects;
create policy snote_shared_vehicle_file_read on storage.objects for select to authenticated using(bucket_id='zc-vehicle-private' and snote_private.shared_vehicle_file(name));
notify pgrst,'reload schema';
