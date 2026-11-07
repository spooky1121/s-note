-- Personal presentation preferences only; hiding a field never deletes vehicle costs.
begin;
create schema if not exists snote_cost_private;
revoke all on schema snote_cost_private from public, anon, authenticated, service_role;
create table if not exists snote_cost_private.preferences(
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 config jsonb not null,
 revision integer not null default 0 check(revision>=0),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,user_id)
);
alter table snote_cost_private.preferences enable row level security;
revoke all on table snote_cost_private.preferences from public,anon,authenticated,service_role;

create or replace function snote_cost_private.defaults()
returns jsonb language sql immutable set search_path=''
as $$select jsonb_build_object('schemaVersion',1,'visible',jsonb_build_array(
 'inventoryLoan','inventoryInterest','inventoryLender','bodywork','polish',
 'performanceInspection','advertising','purchaseFee','purchaseOther','acquisitionTax','incomeTax','repair'
),'customFields','[]'::jsonb);$$;

create or replace function snote_cost_private.validate(p_config jsonb)
returns jsonb language plpgsql immutable set search_path=''
as $$
declare item jsonb;key text;label text;allowed text[]:=array[
 'inventoryLoan','inventoryInterest','inventoryLender','bodywork','polish',
 'performanceInspection','advertising','purchaseFee','purchaseOther','acquisitionTax','incomeTax','repair'];
 ids text[]:='{}';labels text[]:=array['재고대출금','재고이자','재고금융사','차량판금비용','차량광택비용','성능점검비','광고비용','매입수수료','매입비','취득세','소득세','수리비용상세내역'];visible text[]:='{}';
begin
 if p_config is null or jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>20000
  or (select count(*) from jsonb_object_keys(p_config))<>3
  or exists(select 1 from jsonb_object_keys(p_config) k where k not in('schemaVersion','visible','customFields'))
  or p_config->'schemaVersion' is distinct from '1'::jsonb
  or jsonb_typeof(p_config->'visible') is distinct from 'array'
  or jsonb_typeof(p_config->'customFields') is distinct from 'array' then
  raise exception 'COST_CONFIG_INVALID' using errcode='22023';
 end if;
 if jsonb_array_length(p_config->'customFields')>32 or jsonb_array_length(p_config->'visible')>44 then
  raise exception 'COST_CONFIG_LIMIT' using errcode='22023';
 end if;
 for item in select value from jsonb_array_elements(p_config->'customFields') loop
  if jsonb_typeof(item)<>'object' or (select count(*) from jsonb_object_keys(item))<>2
   or exists(select 1 from jsonb_object_keys(item) k where k not in('id','label'))
   or jsonb_typeof(item->'id') is distinct from 'string'
   or jsonb_typeof(item->'label') is distinct from 'string' then
   raise exception 'COST_CONFIG_INVALID_FIELD' using errcode='22023';
  end if;
  key:=item->>'id';label:=item->>'label';
  if key !~ '^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or key=any(ids) or char_length(label) not between 1 and 24 or label<>btrim(label)
   or label~'[[:cntrl:]]' or regexp_replace(lower(normalize(label,NFKC)),'[[:space:]]','','g')=any(labels) then
   raise exception 'COST_CONFIG_INVALID_FIELD' using errcode='22023';
  end if;
  ids:=array_append(ids,key);labels:=array_append(labels,regexp_replace(lower(normalize(label,NFKC)),'[[:space:]]','','g'));
 end loop;
 allowed:=allowed||ids;
 for item in select value from jsonb_array_elements(p_config->'visible') loop
  if jsonb_typeof(item)<>'string' then raise exception 'COST_CONFIG_INVALID_VISIBLE' using errcode='22023';end if;
  key:=item#>>'{}';
  if not key=any(allowed) or key=any(visible) then raise exception 'COST_CONFIG_INVALID_VISIBLE' using errcode='22023';end if;
  visible:=array_append(visible,key);
 end loop;
 return p_config;
end;$$;

create or replace function snote_cost_private.read_preferences()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor record;row snote_cost_private.preferences;
begin
 select * into actor from snote_taxonomy_private.member(false);
 select * into row from snote_cost_private.preferences p where p.company_id=actor.company_id and p.user_id=actor.actor_id;
 return jsonb_build_object('config',case when found then row.config else snote_cost_private.defaults() end,
  'revision',case when found then row.revision else 0 end);
end;$$;

create or replace function snote_cost_private.save_preferences(p_expected_company_id uuid,p_expected_user_id uuid,p_config jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor record;row snote_cost_private.preferences;valid jsonb;
begin
 select * into actor from snote_taxonomy_private.member(true);
 if p_expected_company_id is distinct from actor.company_id or p_expected_user_id is distinct from actor.actor_id then raise exception 'COST_CONFIG_CONTEXT_CHANGED' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision<0 then raise exception 'COST_CONFIG_INVALID_REVISION' using errcode='22023';end if;
 valid:=snote_cost_private.validate(p_config);
 insert into snote_cost_private.preferences(company_id,user_id,config)
  values(actor.company_id,actor.actor_id,snote_cost_private.defaults()) on conflict do nothing;
 select * into row from snote_cost_private.preferences p where p.company_id=actor.company_id and p.user_id=actor.actor_id for update;
 if row.revision<>p_expected_revision then raise exception 'COST_CONFIG_CONFLICT' using errcode='40001';end if;
 if row.config is distinct from valid then
  update snote_cost_private.preferences p set config=valid,revision=p.revision+1,updated_at=clock_timestamp()
   where p.company_id=actor.company_id and p.user_id=actor.actor_id returning * into row;
 end if;
 return jsonb_build_object('config',row.config,'revision',row.revision);
end;$$;

create or replace function public.snote_vehicle_cost_config_get()
returns jsonb language sql security invoker set search_path=''
as $$select snote_cost_private.read_preferences();$$;
create or replace function public.snote_vehicle_cost_config_save(p_expected_company_id uuid,p_expected_user_id uuid,p_config jsonb,p_expected_revision integer)
returns jsonb language sql security invoker set search_path=''
as $$select snote_cost_private.save_preferences(p_expected_company_id,p_expected_user_id,p_config,p_expected_revision);$$;
revoke all on all functions in schema snote_cost_private from public,anon,authenticated,service_role;
revoke all on function public.snote_vehicle_cost_config_get() from public,anon,authenticated,service_role;
revoke all on function public.snote_vehicle_cost_config_save(uuid,uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant usage on schema snote_cost_private to authenticated;
grant execute on function snote_cost_private.read_preferences() to authenticated;
grant execute on function snote_cost_private.save_preferences(uuid,uuid,jsonb,integer) to authenticated;
grant execute on function public.snote_vehicle_cost_config_get() to authenticated;
grant execute on function public.snote_vehicle_cost_config_save(uuid,uuid,jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
