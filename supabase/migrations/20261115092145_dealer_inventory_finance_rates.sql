-- Annual inventory rates belong to the authenticated dealer, not a company's
-- shared borrowing limit. No vehicle, shared finance dataset or past snapshot
-- is rewritten by this migration.
begin;
create schema if not exists snote_dealer_rate_private;
revoke all on schema snote_dealer_rate_private from public,anon,authenticated,service_role;

create table if not exists snote_dealer_rate_private.profiles(
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 -- Keep the financial terms of former/deleted dealers while their vehicles
 -- remain in the company. Only an authenticated active member may write self.
 user_id uuid not null,
 schema_version integer not null default 1 check(schema_version=1),
 rates jsonb not null default '{}'::jsonb check(jsonb_typeof(rates)='object' and octet_length(rates::text)<=20000),
 revision integer not null default 0 check(revision between 0 and 2147483647),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,user_id)
);
alter table snote_dealer_rate_private.profiles enable row level security;
revoke all on table snote_dealer_rate_private.profiles from public,anon,authenticated,service_role;

create or replace function snote_dealer_rate_private.validate_rates(p_rates jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare item record;rate numeric;
begin
 if p_rates is null or jsonb_typeof(p_rates)<>'object' or octet_length(p_rates::text)>20000 then raise exception 'DEALER_RATES_INVALID' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_rates))>100 then raise exception 'DEALER_RATES_LIMIT' using errcode='22023';end if;
 for item in select key,value from jsonb_each(p_rates) loop
  if char_length(item.key) not between 1 and 45 or item.key<>btrim(item.key) or item.key~'[[:cntrl:]]' or jsonb_typeof(item.value) is distinct from 'number' then raise exception 'DEALER_RATES_INVALID' using errcode='22023';end if;
  rate:=(item.value#>>'{}')::numeric;
  if rate<0 or rate>100 or rate<>round(rate,4) then raise exception 'DEALER_RATES_INVALID' using errcode='22023';end if;
 end loop;
 return p_rates;
end$$;

create or replace function snote_dealer_rate_private.company_fallback(p_company uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare payload jsonb;item jsonb;name text;limit_text text;rate_text text;names text[]:='{}';rates jsonb:='{}';limit_value numeric;rate numeric;
begin
 select d.payload into payload from public.zc_datasets d where d.company_id=p_company and d.dataset='finance_limits' and d.owner_id='00000000-0000-0000-0000-000000000000'::uuid;
 if not found then return jsonb_build_object('lenderNames',jsonb_build_array('KB캐피탈','JB우리금융','메리츠','현대캐피탈'),'rates','{}'::jsonb);end if;
 if jsonb_typeof(payload) is distinct from 'array' then return jsonb_build_object('lenderNames','[]'::jsonb,'rates',rates);end if;
 for item in select value from jsonb_array_elements(payload) loop
  if jsonb_typeof(item) is distinct from 'array' or jsonb_typeof(item->0) is distinct from 'string' then continue;end if;
  name:=item->>0;limit_text:=item->>1;
  if char_length(name) not between 1 and 45 or name<>btrim(name) or name~'[[:cntrl:]]' or name=any(names) or array_length(names,1)>=100 then continue;end if;
  -- Legacy finance_limits tuples store limit amounts in ten-thousand won.
  -- Validate them for compatibility, but never return limits to a rate reader.
  if jsonb_typeof(item->1) not in('number','string') or limit_text is null or char_length(limit_text)>50 or limit_text!~'^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then continue;end if;
  begin limit_value:=limit_text::numeric;exception when numeric_value_out_of_range or invalid_text_representation then continue;end;
  if limit_value<0 or limit_value>100000000 then continue;end if;
  names:=array_append(names,name);rate_text:=item->>2;
  if jsonb_typeof(item->2) not in('number','string') or rate_text is null or char_length(rate_text)>50 or rate_text!~'^[+]?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$' then continue;end if;
  begin rate:=rate_text::numeric;exception when numeric_value_out_of_range or invalid_text_representation then continue;end;
  -- The existing calculator rounds the rate to four fractional places before
  -- integer arithmetic; preserve that effective legacy rate without inventing it.
  if rate>=0 and rate<=100 then rates:=rates||jsonb_build_object(name,round(rate,4));end if;
 end loop;
 return jsonb_build_object('lenderNames',to_jsonb(names),'rates',rates);
end$$;

create or replace function snote_dealer_rate_private.read_self()
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor record;row snote_dealer_rate_private.profiles;
begin
 perform snote_private.share_actor();
 select * into actor from snote_taxonomy_private.member(false);
 select * into row from snote_dealer_rate_private.profiles p where p.company_id=actor.company_id and p.user_id=actor.actor_id;
 return jsonb_build_object('companyId',actor.company_id,'userId',actor.actor_id,'rates',case when found then row.rates else '{}'::jsonb end,'revision',case when found then row.revision else 0 end);
end$$;

create or replace function snote_dealer_rate_private.save_self(p_expected_company_id uuid,p_expected_user_id uuid,p_rates jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor record;row snote_dealer_rate_private.profiles;valid jsonb;
begin
 perform snote_private.share_actor();
 select * into actor from snote_taxonomy_private.member(true);
 if p_expected_company_id is distinct from actor.company_id or p_expected_user_id is distinct from actor.actor_id then raise exception 'DEALER_RATES_CONTEXT_CHANGED' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'DEALER_RATES_INVALID_REVISION' using errcode='22023';end if;
 valid:=snote_dealer_rate_private.validate_rates(p_rates);
 insert into snote_dealer_rate_private.profiles(company_id,user_id) values(actor.company_id,actor.actor_id) on conflict do nothing;
 select * into row from snote_dealer_rate_private.profiles p where p.company_id=actor.company_id and p.user_id=actor.actor_id for update;
 if row.revision<>p_expected_revision then raise exception 'DEALER_RATES_CONFLICT' using errcode='40001';end if;
 if row.rates is distinct from valid then
  if row.revision=2147483647 then raise exception 'DEALER_RATES_REVISION_LIMIT' using errcode='22023';end if;
  update snote_dealer_rate_private.profiles p set rates=valid,revision=p.revision+1,updated_at=clock_timestamp() where p.company_id=actor.company_id and p.user_id=actor.actor_id returning * into row;
 end if;
 return jsonb_build_object('companyId',actor.company_id,'userId',actor.actor_id,'rates',row.rates,'revision',row.revision);
end$$;

create or replace function snote_dealer_rate_private.list_visible(p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor record;actor_role text;entry record;profile snote_dealer_rate_private.profiles;company_config jsonb;company_cache jsonb:='{}';rates jsonb;fallback jsonb;names jsonb;result jsonb:='[]';count_profiles integer:=0;
begin
 perform snote_private.share_actor();
 select * into actor from snote_taxonomy_private.member(false);
 if p_expected_company_id is distinct from actor.company_id then raise exception 'DEALER_RATES_CONTEXT_CHANGED' using errcode='42501';end if;
 select m.role into actor_role from public.zc_members m where m.user_id=actor.actor_id and m.company_id=actor.company_id and m.active;
 for entry in
  with full_scope as (
   select actor.company_id as company_id,actor.actor_id as owner_id
   union
   select d.company_id,d.owner_id from public.zc_datasets d where actor_role in('admin','accountant') and d.company_id=actor.company_id and d.dataset='cars'
    and d.owner_id<>'00000000-0000-0000-0000-000000000000'::uuid and jsonb_array_length(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)>0
  ), shared_scope as (
   select distinct s.company_id,s.owner_id,c->>'inventoryLender' as lender
   from snote_private.vehicle_shares s join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
   where actor_role in('admin','dealer') and s.recipient_id=actor.actor_id and s.recipient_company_id=actor.company_id and s.state='accepted'
    and snote_private.share_member(s.recipient_id,s.recipient_company_id) and snote_private.share_member(s.owner_id,s.company_id)
    and snote_private.share_vehicle_owner(s.company_id,s.car_id)=s.owner_id and c->>'id'=s.car_id
  ), scope as (
   select f.company_id,f.owner_id,true as full_access,null::text as lender from full_scope f
   union all select s.company_id,s.owner_id,false,s.lender from shared_scope s
  )
  select company_id,owner_id,bool_or(full_access) as full_access,array_agg(distinct lender) filter(where lender is not null) as lenders from scope group by company_id,owner_id order by company_id,owner_id
 loop
  count_profiles:=count_profiles+1;if count_profiles>2000 then raise exception 'DEALER_RATES_PROFILE_LIMIT' using errcode='54000';end if;
  select * into profile from snote_dealer_rate_private.profiles p where p.company_id=entry.company_id and p.user_id=entry.owner_id;
  rates:=case when found then profile.rates else '{}'::jsonb end;
  if not company_cache?entry.company_id::text then company_cache:=company_cache||jsonb_build_object(entry.company_id::text,snote_dealer_rate_private.company_fallback(entry.company_id));end if;
  company_config:=company_cache->entry.company_id::text;fallback:=company_config->'rates';names:=company_config->'lenderNames';
  if not entry.full_access then
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into rates from jsonb_each(rates) where key=any(entry.lenders);
   select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into fallback from jsonb_each(fallback) where key=any(entry.lenders);
   select coalesce(jsonb_agg(value),'[]'::jsonb) into names from jsonb_array_elements(names) where value#>>'{}'=any(entry.lenders);
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('companyId',entry.company_id,'ownerId',entry.owner_id,'rates',rates,'fallbackRates',fallback,'lenderNames',names,'revision',coalesce(profile.revision,0),'sharedOnly',not entry.full_access));
 end loop;
 return jsonb_build_object('companyId',actor.company_id,'userId',actor.actor_id,'profiles',result);
end$$;

create or replace function public.snote_dealer_finance_rates_get()
returns jsonb language sql security invoker set search_path='' as $$select snote_dealer_rate_private.read_self();$$;
create or replace function public.snote_dealer_finance_rates_save(p_expected_company_id uuid,p_expected_user_id uuid,p_rates jsonb,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_dealer_rate_private.save_self(p_expected_company_id,p_expected_user_id,p_rates,p_expected_revision);$$;
create or replace function public.snote_dealer_finance_rates_list(p_expected_company_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_dealer_rate_private.list_visible(p_expected_company_id);$$;

revoke all on all functions in schema snote_dealer_rate_private from public,anon,authenticated,service_role;
revoke all on function public.snote_dealer_finance_rates_get() from public,anon,authenticated,service_role;
revoke all on function public.snote_dealer_finance_rates_save(uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function public.snote_dealer_finance_rates_list(uuid) from public,anon,authenticated,service_role;
grant usage on schema snote_dealer_rate_private to authenticated;
grant execute on function snote_dealer_rate_private.read_self() to authenticated;
grant execute on function snote_dealer_rate_private.save_self(uuid,uuid,jsonb,integer) to authenticated;
grant execute on function snote_dealer_rate_private.list_visible(uuid) to authenticated;
grant execute on function public.snote_dealer_finance_rates_get() to authenticated;
grant execute on function public.snote_dealer_finance_rates_save(uuid,uuid,jsonb,integer) to authenticated;
grant execute on function public.snote_dealer_finance_rates_list(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
