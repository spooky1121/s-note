-- Admin-only company purchase read. Existing finance RLS and dealer sharing are unchanged.
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
         and m.active and m.role = 'admin'
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

revoke all on function public.snote_company_purchase_rows(uuid) from public;
revoke all on function public.snote_company_purchase_rows(uuid) from anon;
grant execute on function public.snote_company_purchase_rows(uuid) to authenticated;
