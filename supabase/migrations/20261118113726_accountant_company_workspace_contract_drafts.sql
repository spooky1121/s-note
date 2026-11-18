-- Accounting can read its existing company inventory RLS scope, including sold
-- and former-dealer vehicles. This grants no writes to cars or customer data.
-- Contract-office drafts are separate company documents with no RRN/signatures.
begin;

create or replace function public.snote_company_purchase_rows(p_company uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null
     or coalesce(auth.jwt()->>'role', '') <> 'authenticated'
     or coalesce(auth.jwt()->>'is_anonymous', 'false') <> 'false'
     or not exists (
       select 1 from public.zc_members m
       where m.user_id = v_actor and m.company_id = p_company
         and m.active and m.role in ('admin','accountant')
     ) then
    raise exception using errcode = '42501', message = 'COMPANY_PURCHASE_FORBIDDEN';
  end if;

  with eligible as (
    select d.company_id, d.dataset, d.owner_id, d.payload, d.revision
    from public.zc_datasets d
    where d.company_id = p_company
      and d.dataset in ('cars', 'covers')
      and d.owner_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ), owner_ids as (
    select distinct e.owner_id from eligible e
  )
  select jsonb_build_object(
    'companyId', p_company,
    'datasets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dataset', e.dataset, 'ownerId', e.owner_id,
        'payload', e.payload, 'revision', e.revision
      ) order by e.dataset, e.owner_id)
      from eligible e
    ), '[]'::jsonb),
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.owner_id,
        'name', coalesce(nullif(btrim(m.display_name), ''), '이전 직원'),
        'active', coalesce(m.active, false),
        'memberExists', m.user_id is not null
      ) order by o.owner_id)
      from owner_ids o
      left join public.zc_members m
        on m.user_id = o.owner_id and m.company_id = p_company
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

-- This existing function is replaced without changing its existing ACL.

create schema if not exists snote_transfer_private;
revoke all on schema snote_transfer_private from public,anon,authenticated,service_role;
grant usage on schema snote_transfer_private to authenticated;

create or replace function snote_transfer_private.can_access_company(p_company uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select p_company is not null and (select auth.uid()) is not null
  and coalesce(auth.jwt()->>'role','')='authenticated'
  and coalesce(auth.jwt()->>'is_anonymous','false')='false'
  and exists(select 1 from public.zc_members m where m.user_id=(select auth.uid())
   and m.company_id=p_company and m.active is true and m.role in('admin','accountant'));
$$;

create or replace function snote_transfer_private.assert_company(p_company uuid)
returns uuid language plpgsql stable security invoker set search_path='' as $$
begin
 if not coalesce(snote_transfer_private.can_access_company(p_company),false) then
  raise exception 'TRANSFER_CONTRACT_FORBIDDEN' using errcode='42501';
 end if;
 return auth.uid();
end$$;

create or replace function snote_transfer_private.valid_payload(p_payload jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
 strings text[]:=array['presentationNumber','sellerName','sellerPhone','sellerAddress','buyerName','buyerPhone','buyerAddress',
  'dealer1Registration','dealer1Company','dealer1Representative','dealer1Handler',
  'dealer2Registration','dealer2Company','dealer2Representative','dealer2Handler',
  'plate','vehicleType','model','vin','encumbrance','specialTerms','certSellerName','certBuyerName'];
 dates text[]:=array['contractDate','depositDate','interimDate','balanceDate','deliveryDate','copyDate','transferDate'];
 numbers text[]:=array['mileage','depositAmount','interimAmount','balanceAmount','saleAmount','registrationCost','agencyFee','brokerageFee','managementCost'];
 key text;value jsonb;text_value text;units bigint;controls boolean;maximum integer;number_value numeric;date_value date;
begin
 if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object'
  or octet_length(p_payload::text)>24576
  or (select count(*) from jsonb_object_keys(p_payload))<>39
  or exists(select 1 from jsonb_object_keys(p_payload) k where not(k=any(strings||dates||numbers))) then
  raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';
 end if;
 foreach key in array strings loop
  value:=p_payload->key;
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
  text_value:=value#>>'{}';
  maximum:=case when key='specialTerms' then 2000 when key='model' then 120
   when key in('sellerName','buyerName','certSellerName','certBuyerName','dealer1Company','dealer2Company',
    'dealer1Representative','dealer2Representative','dealer1Handler','dealer2Handler') then 100
   when key in('sellerPhone','buyerPhone','plate') then 30 when key='vin' then 40 else 220 end;
  -- Match browser maxlength/String.length, including supplementary characters.
  select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0),
    coalesce(bool_or(ascii(ch) between 1 and 8 or ascii(ch) in(11,12,127) or ascii(ch) between 14 and 31
     or (key<>'specialTerms' and ascii(ch) in(9,10,13))),false)
   into units,controls from regexp_split_to_table(text_value,'') chars(ch) where ch<>'';
  if units>maximum or controls then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
 end loop;
 foreach key in array dates loop
  value:=p_payload->key;
  if jsonb_typeof(value) is distinct from 'string' then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
  text_value:=value#>>'{}';if text_value='' then continue;end if;
  if text_value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
  begin date_value:=text_value::date;
  exception when invalid_datetime_format or datetime_field_overflow then
   raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end;
  if to_char(date_value,'YYYY-MM-DD')<>text_value then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
 end loop;
 foreach key in array numbers loop
  value:=p_payload->key;
  if jsonb_typeof(value)='null' then continue;end if;
  if jsonb_typeof(value) is distinct from 'number' then raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';end if;
  number_value:=(value#>>'{}')::numeric;
  if number_value<0 or number_value<>trunc(number_value)
   or number_value>(case when key='mileage' then 999999999 else 999999999999 end) then
   raise exception 'TRANSFER_CONTRACT_INVALID_PAYLOAD' using errcode='22023';
  end if;
 end loop;
 return true;
end$$;

create table if not exists snote_transfer_private.drafts(
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 id uuid not null,
 car_owner_id uuid,
 car_id text,
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 payload jsonb not null check(snote_transfer_private.valid_payload(payload)),
 -- Historical authors remain identifiable if a staff account is later removed.
 -- Values are captured from verified auth.uid(), never client user metadata.
 created_by uuid not null default auth.uid(),
 updated_by uuid not null default auth.uid(),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,id),
 check((car_owner_id is null)=(car_id is null))
);
create index if not exists transfer_contract_drafts_recent_idx on snote_transfer_private.drafts(company_id,updated_at desc,id);
alter table snote_transfer_private.drafts enable row level security;
revoke all on table snote_transfer_private.drafts from public,anon,authenticated,service_role;
grant select on table snote_transfer_private.drafts to authenticated;
grant insert(id,company_id,car_owner_id,car_id,payload,revision) on snote_transfer_private.drafts to authenticated;
grant update(car_owner_id,car_id,payload,revision) on snote_transfer_private.drafts to authenticated;

drop policy if exists transfer_contract_read on snote_transfer_private.drafts;
create policy transfer_contract_read on snote_transfer_private.drafts for select to authenticated
 using(snote_transfer_private.can_access_company(company_id));
drop policy if exists transfer_contract_insert on snote_transfer_private.drafts;
create policy transfer_contract_insert on snote_transfer_private.drafts for insert to authenticated
 with check(snote_transfer_private.can_access_company(company_id) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists transfer_contract_update on snote_transfer_private.drafts;
create policy transfer_contract_update on snote_transfer_private.drafts for update to authenticated
 using(snote_transfer_private.can_access_company(company_id))
 with check(snote_transfer_private.can_access_company(company_id) and updated_by=(select auth.uid()));

create or replace function snote_transfer_private.guard_draft()
returns trigger language plpgsql security invoker set search_path='' as $$
declare actor uuid;stamp timestamptz;
begin
 actor:=snote_transfer_private.assert_company(new.company_id);
 if tg_op='UPDATE' then
  if new.company_id is distinct from old.company_id or new.id is distinct from old.id
   or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
   raise exception 'TRANSFER_CONTRACT_IMMUTABLE_IDENTITY' using errcode='42501';
  end if;
  if old.revision=9007199254740991 or new.revision is distinct from old.revision+1 then
   raise exception 'TRANSFER_CONTRACT_CONFLICT' using errcode='40001';
  end if;
 elsif new.revision is distinct from 1::bigint then
  raise exception 'TRANSFER_CONTRACT_INVALID_REVISION' using errcode='22023';
 end if;
 if (new.car_owner_id is null) is distinct from (new.car_id is null) then
  raise exception 'TRANSFER_CONTRACT_INVALID_CAR' using errcode='22023';
 end if;
 if new.car_id is not null then
  if new.car_owner_id='00000000-0000-0000-0000-000000000000'::uuid
   or char_length(new.car_id) not between 1 and 200 or btrim(new.car_id)<>new.car_id or new.car_id~'[[:cntrl:]]' then
   raise exception 'TRANSFER_CONTRACT_INVALID_CAR' using errcode='22023';
  end if;
  -- Share the existing company-car archival serialization without granting any
  -- UPDATE privilege on zc_datasets to the accounting reader.
  perform pg_advisory_xact_lock(hashtextextended('snote-recycle:'||new.company_id::text,0));
  if (select count(*) from public.zc_datasets d
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end) c
   where d.company_id=new.company_id and d.dataset='cars' and d.owner_id=new.car_owner_id and c->>'id'=new.car_id)<>1 then
   raise exception 'TRANSFER_CONTRACT_CAR_NOT_FOUND' using errcode='22023';
  end if;
 end if;
 stamp:=clock_timestamp();
 if tg_op='INSERT' then new.created_by:=actor;new.created_at:=stamp;end if;
 new.updated_by:=actor;new.updated_at:=stamp;
 return new;
end$$;
drop trigger if exists transfer_contract_guard on snote_transfer_private.drafts;
create trigger transfer_contract_guard before insert or update on snote_transfer_private.drafts
 for each row execute function snote_transfer_private.guard_draft();

create or replace function snote_transfer_private.record_json(p_row snote_transfer_private.drafts)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'carOwnerId',p_row.car_owner_id,'carId',p_row.car_id,
  'revision',p_row.revision,'payload',p_row.payload,'updatedAt',p_row.updated_at);
$$;

create or replace function public.snote_transfer_contract_list(p_expected_company_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 select coalesce(jsonb_agg(snote_transfer_private.record_json(d) order by d.updated_at desc,d.id desc),'[]'::jsonb)
  into result from snote_transfer_private.drafts d where d.company_id=p_expected_company_id;
 return result;
end$$;

create or replace function public.snote_transfer_contract_read(p_id uuid,p_expected_company_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare row snote_transfer_private.drafts;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 select * into row from snote_transfer_private.drafts d where d.company_id=p_expected_company_id and d.id=p_id;
 if not found then return null;end if;
 return snote_transfer_private.record_json(row);
end$$;

create or replace function public.snote_transfer_contract_save(
 p_expected_company_id uuid,p_id uuid,p_car_owner_id uuid,p_car_id text,p_expected_revision bigint,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row snote_transfer_private.drafts;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then
  raise exception 'TRANSFER_CONTRACT_INVALID_REVISION' using errcode='22023';
 end if;
 perform snote_transfer_private.valid_payload(p_payload);
 if p_expected_revision=0 then
  insert into snote_transfer_private.drafts(company_id,id,car_owner_id,car_id,payload,revision)
   values(p_expected_company_id,p_id,p_car_owner_id,p_car_id,p_payload,1)
   on conflict(company_id,id) do nothing returning * into row;
 else
  update snote_transfer_private.drafts d set car_owner_id=p_car_owner_id,car_id=p_car_id,payload=p_payload,revision=d.revision+1
   where d.company_id=p_expected_company_id and d.id=p_id and d.revision=p_expected_revision
   returning * into row;
 end if;
 if not found then raise exception 'TRANSFER_CONTRACT_CONFLICT' using errcode='40001';end if;
 return snote_transfer_private.record_json(row);
end$$;

revoke all on function snote_transfer_private.can_access_company(uuid),snote_transfer_private.assert_company(uuid),
 snote_transfer_private.valid_payload(jsonb),snote_transfer_private.guard_draft(),
 snote_transfer_private.record_json(snote_transfer_private.drafts),
 public.snote_transfer_contract_list(uuid),public.snote_transfer_contract_read(uuid,uuid),
 public.snote_transfer_contract_save(uuid,uuid,uuid,text,bigint,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function snote_transfer_private.can_access_company(uuid),snote_transfer_private.assert_company(uuid),
 snote_transfer_private.valid_payload(jsonb),snote_transfer_private.record_json(snote_transfer_private.drafts),
 public.snote_transfer_contract_list(uuid),public.snote_transfer_contract_read(uuid,uuid),
 public.snote_transfer_contract_save(uuid,uuid,uuid,text,bigint,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
