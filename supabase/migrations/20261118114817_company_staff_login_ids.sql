-- A dealership administrator may see staff login IDs beside their names.
-- auth.users stays private: only this guarded helper reads the email column.
begin;

create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;

create or replace function snote_private.company_staff_login_ids(p_expected_company_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
 v_actor uuid:=auth.uid();
 v_result jsonb;
begin
 if v_actor is null or p_expected_company_id is null
  or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')<>'false'
  or not exists(
   select 1 from public.zc_members m
   join auth.users u on u.id=m.user_id
   where m.user_id=v_actor and m.company_id=p_expected_company_id
    and m.active is true and m.role='admin'
    and u.deleted_at is null and u.email_confirmed_at is not null
    and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=now())
  ) then
  raise exception 'STAFF_LOGIN_IDS_FORBIDDEN' using errcode='42501';
 end if;

 select coalesce(jsonb_agg(jsonb_build_object(
  'userId',m.user_id,'loginId',nullif(btrim(u.email),'')
 ) order by m.user_id),'[]'::jsonb)
 into v_result
 from public.zc_members m
 left join auth.users u on u.id=m.user_id
 where m.company_id=p_expected_company_id;
 return v_result;
end;
$$;

revoke all on function snote_private.company_staff_login_ids(uuid) from public,anon,authenticated,service_role;
grant execute on function snote_private.company_staff_login_ids(uuid) to authenticated;

create or replace function public.snote_company_staff_logins(p_expected_company_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
 select snote_private.company_staff_login_ids(p_expected_company_id);
$$;

revoke all on function public.snote_company_staff_logins(uuid) from public,anon,authenticated,service_role;
grant execute on function public.snote_company_staff_logins(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
