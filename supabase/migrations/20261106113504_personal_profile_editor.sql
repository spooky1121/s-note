-- Private contact information must never inherit zc_members' company-wide reads.
-- Existing staff administration and the registered SMS sender remain unchanged.
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;

create table if not exists snote_private.member_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text not null check(phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$'),
 address text not null default '' check(char_length(address)<=300),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default now()
);
alter table snote_private.member_profiles enable row level security;
revoke all on snote_private.member_profiles from public,anon,authenticated;
drop policy if exists member_profiles_own on snote_private.member_profiles;
create policy member_profiles_own on snote_private.member_profiles
 for all to authenticated using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()));

create or replace function snote_private.profile_read()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 select jsonb_build_object('user_id',m.user_id,'company_id',m.company_id,
  'role',m.role,'display_name',m.display_name,'company_name',c.name,
  'phone',coalesce(p.phone,nullif(m.phone,''),nullif(u.raw_user_meta_data->'snote_registration'->>'phone',''),''),
  'address',coalesce(p.address,''),'revision',coalesce(p.revision,0))
 into v_result
 from public.zc_members m join public.zc_companies c on c.id=m.company_id
 join auth.users u on u.id=m.user_id
 left join snote_private.member_profiles p on p.user_id=m.user_id
 where m.user_id=v_actor and m.active is true and m.role in('admin','dealer','accountant')
  and (u.banned_until is null or u.banned_until<=now());
 if v_result is null then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 return v_result;
end;$$;

create or replace function snote_private.profile_save(p_expected jsonb,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_member public.zc_members;v_company public.zc_companies;
 v_previous jsonb;v_key text;v_name text;v_phone text;v_address text;v_company_name text;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 -- Lock the exact caller before inspecting their current server-owned role.
 select * into v_member from public.zc_members
  where user_id=v_actor and active is true and role in('admin','dealer','accountant') for update;
 if not found then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from auth.users where id=v_actor and (banned_until is null or banned_until<=now())) then
  raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501';
 end if;
 select * into v_company from public.zc_companies where id=v_member.company_id for update;
 if not found then raise exception 'COMPANY_UNAVAILABLE' using errcode='42501';end if;
 perform 1 from snote_private.member_profiles where user_id=v_actor for update;

 if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>5000
  or p_expected is null or jsonb_typeof(p_expected)<>'object' or octet_length(p_expected::text)>1000 then
  raise exception 'INVALID_PROFILE' using errcode='22023';
 end if;
 for v_key in select jsonb_object_keys(p_profile) loop
  if v_key not in('display_name','company_name','phone','address') then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
 end loop;
 for v_key in select jsonb_object_keys(p_expected) loop
  if v_key not in('user_id','company_id','display_name','company_name','revision') then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
 end loop;
 foreach v_key in array array['display_name','company_name','phone','address'] loop
  if jsonb_typeof(p_profile->v_key) is distinct from 'string' then raise exception 'INVALID_PROFILE_FIELD' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_expected->'user_id') is distinct from 'string'
  or jsonb_typeof(p_expected->'company_id') is distinct from 'string'
  or jsonb_typeof(p_expected->'display_name') is distinct from 'string'
  or jsonb_typeof(p_expected->'company_name') is distinct from 'string'
  or jsonb_typeof(p_expected->'revision') is distinct from 'number' then
  raise exception 'INVALID_EXPECTED_PROFILE' using errcode='22023';
 end if;
 if p_expected->>'user_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_expected->>'company_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'INVALID_EXPECTED_COMPANY' using errcode='22023';
 end if;

 v_previous:=snote_private.profile_read();
 if (p_expected->>'user_id')::uuid is distinct from v_actor
  or (p_expected->>'company_id')::uuid is distinct from v_member.company_id
  or p_expected->'display_name' is distinct from v_previous->'display_name'
  or p_expected->'company_name' is distinct from v_previous->'company_name'
  or p_expected->'revision' is distinct from v_previous->'revision' then
  raise exception 'PROFILE_CONFLICT' using errcode='40001';
 end if;
 v_name:=btrim(p_profile->>'display_name');v_company_name:=btrim(p_profile->>'company_name');
 v_phone:=btrim(p_profile->>'phone');v_address:=btrim(p_profile->>'address');
 if char_length(v_name) not between 1 and 40 or char_length(v_company_name) not between 2 and 100
  or v_phone!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' or char_length(v_address)>300 then
  raise exception 'INVALID_PROFILE_VALUE' using errcode='22023';
 end if;
 if v_company_name is distinct from v_company.name and v_member.role<>'admin' then
  raise exception 'COMPANY_ADMIN_REQUIRED' using errcode='42501';
 end if;
 update public.zc_members set display_name=v_name where user_id=v_actor and company_id=v_member.company_id;
 if v_company_name is distinct from v_company.name then
  update public.zc_companies set name=v_company_name where id=v_member.company_id;
 end if;
 insert into snote_private.member_profiles(user_id,phone,address,revision)
 values(v_actor,v_phone,v_address,1)
 on conflict(user_id) do update set phone=excluded.phone,address=excluded.address,
  revision=member_profiles.revision+1,updated_at=now();
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action)
 values(v_member.company_id,v_actor,'member_profile',v_actor::text,'self_profile_update');
 return snote_private.profile_read();
end;$$;

revoke all on function snote_private.profile_read() from public,anon;
revoke all on function snote_private.profile_save(jsonb,jsonb) from public,anon;
grant execute on function snote_private.profile_read() to authenticated;
grant execute on function snote_private.profile_save(jsonb,jsonb) to authenticated;

create or replace function public.snote_profile_read()
returns jsonb language sql security invoker set search_path='' as $$
 select snote_private.profile_read();
$$;
create or replace function public.snote_profile_save(p_expected jsonb,p_profile jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select snote_private.profile_save(p_expected,p_profile);
$$;
revoke all on function public.snote_profile_read() from public,anon;
revoke all on function public.snote_profile_save(jsonb,jsonb) from public,anon;
grant execute on function public.snote_profile_read() to authenticated;
grant execute on function public.snote_profile_save(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
