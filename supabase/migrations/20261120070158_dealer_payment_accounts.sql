-- Receiving accounts belong to the signed-in dealer in their current company.
-- Never inherit the company-wide zc_members/profile read scope for these details.
begin;
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;

create or replace function snote_private.payment_accounts_normalize(p_accounts jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $f$
declare v_kind text;v_key text;v_account jsonb;v_bank text;v_number text;v_holder text;
 v_result jsonb:='{"vehicle":null,"transfer":null}'::jsonb;
begin
 if p_accounts is null or jsonb_typeof(p_accounts)<>'object'
  or octet_length(p_accounts::text)>4000
  or not p_accounts ?& array['vehicle','transfer'] then
  raise exception 'INVALID_PAYMENT_ACCOUNTS' using errcode='22023';
 end if;
 for v_key in select jsonb_object_keys(p_accounts) loop
  if v_key not in('vehicle','transfer') then raise exception 'INVALID_PAYMENT_ACCOUNTS' using errcode='22023';end if;
 end loop;
 foreach v_kind in array array['vehicle','transfer'] loop
  v_account:=p_accounts->v_kind;
  if v_account='null'::jsonb then continue;end if;
  if jsonb_typeof(v_account)<>'object' or not v_account ?& array['bank','number','holder'] then
   raise exception 'INVALID_PAYMENT_ACCOUNT' using errcode='22023';
  end if;
  for v_key in select jsonb_object_keys(v_account) loop
   if v_key not in('bank','number','holder') then raise exception 'INVALID_PAYMENT_ACCOUNT' using errcode='22023';end if;
  end loop;
  foreach v_key in array array['bank','number','holder'] loop
   if jsonb_typeof(v_account->v_key) is distinct from 'string' or (v_account->>v_key) ~ '[[:cntrl:]]' then
    raise exception 'INVALID_PAYMENT_ACCOUNT' using errcode='22023';
   end if;
  end loop;
  v_bank:=btrim(v_account->>'bank');v_holder:=btrim(v_account->>'holder');
  v_number:=regexp_replace(v_account->>'number','[[:space:]]','','g');
  if char_length(v_bank) not between 1 and 35 or char_length(v_holder) not between 1 and 60
   or v_number!~'^[0-9-]{6,32}$' or char_length(regexp_replace(v_number,'[^0-9]','','g'))<6 then
   raise exception 'INVALID_PAYMENT_ACCOUNT' using errcode='22023';
  end if;
  v_result:=jsonb_set(v_result,array[v_kind],jsonb_build_object('bank',v_bank,'number',v_number,'holder',v_holder));
 end loop;
 return v_result;
end;$f$;
revoke all on function snote_private.payment_accounts_normalize(jsonb) from public,anon,authenticated,service_role;

create table if not exists snote_private.member_payment_accounts (
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 accounts jsonb not null default '{"vehicle":null,"transfer":null}'::jsonb
  check(accounts=snote_private.payment_accounts_normalize(accounts)),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,user_id)
);
create index if not exists member_payment_accounts_user_idx on snote_private.member_payment_accounts(user_id);
alter table snote_private.member_payment_accounts enable row level security;
revoke all on table snote_private.member_payment_accounts from public,anon,authenticated,service_role;

create or replace function snote_private.payment_accounts_read(p_company uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 -- Pin membership while reading; a concurrent company/role change must wait.
 perform 1 from public.zc_members m join public.zc_companies c on c.id=m.company_id
  join auth.users u on u.id=m.user_id
  where m.user_id=v_actor and m.company_id=p_company and m.active is true
   and m.role in('dealer','admin') and (u.banned_until is null or u.banned_until<=now()) for share of m;
 if not found then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 select jsonb_build_object('user_id',v_actor,'company_id',p_company,'revision',a.revision,'accounts',a.accounts)
  into v_result from snote_private.member_payment_accounts a where a.company_id=p_company and a.user_id=v_actor;
 return coalesce(v_result,jsonb_build_object('user_id',v_actor,'company_id',p_company,'revision',0,
  'accounts',jsonb_build_object('vehicle',null,'transfer',null)));
end;$f$;

create or replace function snote_private.payment_accounts_save(p_company uuid,p_expected_revision bigint,p_accounts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare v_actor uuid:=auth.uid();v_revision bigint;v_accounts jsonb;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 -- This exact actor lock also serializes the first insert before any account row exists.
 perform 1 from public.zc_members m join public.zc_companies c on c.id=m.company_id
  join auth.users u on u.id=m.user_id
  where m.user_id=v_actor and m.company_id=p_company and m.active is true
   and m.role in('dealer','admin') and (u.banned_until is null or u.banned_until<=now()) for update of m;
 if not found then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 then
  raise exception 'INVALID_PAYMENT_ACCOUNTS_REVISION' using errcode='22023';
 end if;
 v_accounts:=snote_private.payment_accounts_normalize(p_accounts);
 select a.revision into v_revision from snote_private.member_payment_accounts a
  where a.company_id=p_company and a.user_id=v_actor for update;
 if coalesce(v_revision,0)<>p_expected_revision then
  raise exception 'PAYMENT_ACCOUNTS_CONFLICT' using errcode='40001';
 end if;
 insert into snote_private.member_payment_accounts(company_id,user_id,accounts,revision)
  values(p_company,v_actor,v_accounts,1)
 on conflict(company_id,user_id) do update set accounts=excluded.accounts,
  revision=member_payment_accounts.revision+1,updated_at=clock_timestamp();
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action)
  values(p_company,v_actor,'member_payment_accounts',v_actor::text,'self_payment_accounts_update');
 return snote_private.payment_accounts_read(p_company);
end;$f$;
revoke all on function snote_private.payment_accounts_read(uuid) from public,anon,authenticated,service_role;
revoke all on function snote_private.payment_accounts_save(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function snote_private.payment_accounts_read(uuid) to authenticated;
grant execute on function snote_private.payment_accounts_save(uuid,bigint,jsonb) to authenticated;

create or replace function public.snote_payment_accounts_read(p_company uuid)
returns jsonb language sql security invoker set search_path='' as $f$
 select snote_private.payment_accounts_read(p_company);
$f$;
create or replace function public.snote_payment_accounts_save(p_company uuid,p_expected_revision bigint,p_accounts jsonb)
returns jsonb language sql security invoker set search_path='' as $f$
 select snote_private.payment_accounts_save(p_company,p_expected_revision,p_accounts);
$f$;
revoke all on function public.snote_payment_accounts_read(uuid) from public,anon,authenticated,service_role;
revoke all on function public.snote_payment_accounts_save(uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.snote_payment_accounts_read(uuid) to authenticated;
grant execute on function public.snote_payment_accounts_save(uuid,bigint,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
