-- Accountant-only minimum customer projection; no identity, signature or address data.
begin;
create or replace function snote_information_private.sold_customers(p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id); result jsonb;
begin
 perform 1 from public.zc_members m where m.user_id=a and m.company_id=p_expected_company_id and m.active and m.role='accountant' for share;
 if not found then raise exception 'INFORMATION_CONTEXT_CHANGED' using errcode='42501';end if;
 with sold as (
  select d.owner_id,c->>'id' as car_id
  from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
  where d.company_id=p_expected_company_id and d.dataset='cars' and jsonb_typeof(c)='object'
   and jsonb_typeof(c->'id') in('string','number') and char_length(c->>'id') between 1 and 200
  group by d.owner_id,c->>'id' having count(*)=1 and bool_and(c->>'status'='판매완료')
 ), matches as (
  select u.owner_id,u.car_id,u.payload
  from public.zc_customers u join sold s on s.owner_id=u.owner_id and s.car_id=u.car_id
  where u.company_id=p_expected_company_id
   and not exists(select 1 from snote_private.recycle_bin r where r.company_id=u.company_id and r.owner_id=u.owner_id and r.car_id=u.car_id and r.restored_at is null and r.kind='vehicle')
   and not exists(select 1 from snote_private.recycle_bin r where r.company_id=u.company_id and r.owner_id=u.owner_id and r.car_id=u.car_id and r.restored_at is null and r.kind='customer' and u.updated_at<=r.deleted_at)
   and jsonb_typeof(u.payload)='object' and coalesce(jsonb_typeof(u.payload->'name'),'null') in('null','string')
   and coalesce(jsonb_typeof(u.payload->'phone'),'null') in('null','string')
 ) select coalesce(jsonb_agg(jsonb_build_object('id',owner_id::text||':'||car_id,
    'carOwnerId',owner_id,'carId',car_id,'name',left(coalesce(payload->>'name',''),120),
    'phone',left(coalesce(payload->>'phone',''),40)) order by owner_id,car_id),'[]'::jsonb) into result from matches;
 if jsonb_array_length(result)>5000 then raise exception 'CUSTOMER_LIST_LIMIT' using errcode='54000';end if;
 return jsonb_build_object('companyId',p_expected_company_id,'ownerId',a,'complete',true,'customers',result);
end$$;
create or replace function public.snote_accountant_sold_customers(p_expected_company_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select snote_information_private.sold_customers(p_expected_company_id);
$$;
revoke all on function snote_information_private.sold_customers(uuid),public.snote_accountant_sold_customers(uuid) from public,anon,authenticated,service_role;
grant execute on function snote_information_private.sold_customers(uuid),public.snote_accountant_sold_customers(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
