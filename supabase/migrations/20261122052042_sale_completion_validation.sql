-- Review-only migration: no historical rows are updated and no grants or policies change.
-- The guard applies at the dataset write boundary, including non-browser clients.
begin;
create or replace function snote_private.validate_sale_completion()
returns trigger language plpgsql security invoker set search_path='' as $$
declare car jsonb;previous jsonb;previous_rows jsonb:='[]'::jsonb;sale_day date;purchase_day date;amount numeric;unit_multiplier numeric;
begin
 if new.dataset<>'cars' or pg_catalog.jsonb_typeof(new.payload)<>'array' then return new;end if;
 if tg_op='UPDATE' and pg_catalog.jsonb_typeof(old.payload)='array' then previous_rows:=old.payload;end if;
 for car in select value from pg_catalog.jsonb_array_elements(new.payload) loop
  if car->>'status' is distinct from '판매완료' then continue;end if;
  select value into previous from pg_catalog.jsonb_array_elements(previous_rows) where value->>'id'=car->>'id' limit 1;
  if previous is not null and previous->>'status'='판매완료' and
    pg_catalog.jsonb_build_array(previous->'soldAt',previous->'soldPrice',previous->'purchaseAt')=
    pg_catalog.jsonb_build_array(car->'soldAt',car->'soldPrice',car->'purchaseAt') then continue;end if;
  -- The existing authorized restore RPC may restore an exact historical snapshot.
  -- A caller-supplied value or a changed snapshot cannot use this exception.
  if previous is null and pg_catalog.current_setting('snote.recycle_internal',true)='1' and exists(
   select 1 from snote_private.recycle_bin archived where archived.company_id=new.company_id and archived.owner_id=new.owner_id
    and archived.car_id=car->>'id' and archived.kind='vehicle' and archived.restored_at is null and archived.snapshot->'car'=car
  ) then continue;end if;
  sale_day:=null;
  if coalesce(car->>'soldAt','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   begin sale_day:=pg_catalog.make_date(pg_catalog.substr(car->>'soldAt',1,4)::integer,pg_catalog.substr(car->>'soldAt',6,2)::integer,pg_catalog.substr(car->>'soldAt',9,2)::integer);
   exception when datetime_field_overflow or invalid_datetime_format then sale_day:=null;end;
  end if;
  if sale_day is null then raise exception using errcode='22023',message='SALE_DATE_INVALID';end if;
  purchase_day:=null;
  if coalesce(car->>'purchaseAt','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
   begin purchase_day:=pg_catalog.make_date(pg_catalog.substr(car->>'purchaseAt',1,4)::integer,pg_catalog.substr(car->>'purchaseAt',6,2)::integer,pg_catalog.substr(car->>'purchaseAt',9,2)::integer);
   exception when datetime_field_overflow or invalid_datetime_format then purchase_day:=null;end;
  end if;
  if purchase_day is not null and sale_day<purchase_day then raise exception using errcode='22023',message='SALE_DATE_BEFORE_PURCHASE';end if;
  if pg_catalog.jsonb_typeof(car->'soldPrice') is distinct from 'number' then raise exception using errcode='22023',message='SALE_PRICE_REQUIRED';end if;
  unit_multiplier:=case when car->>'moneyUnit'='KRW' then 1 else 10000 end;
  amount:=(car->>'soldPrice')::numeric*unit_multiplier;
  if amount<=0 or amount>1000000000000 or amount<>pg_catalog.trunc(amount) then raise exception using errcode='22023',message='SALE_PRICE_INVALID';end if;
 end loop;
 return new;
end;$$;
revoke all on function snote_private.validate_sale_completion() from public,anon,authenticated;
drop trigger if exists snote_validate_sale_completion on public.zc_datasets;
create trigger snote_validate_sale_completion before insert or update of payload on public.zc_datasets
for each row execute function snote_private.validate_sale_completion();
commit;
