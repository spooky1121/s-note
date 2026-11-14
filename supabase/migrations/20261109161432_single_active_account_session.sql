-- One primary application session per Auth user. Auth-only password checks do
-- not claim this lease. GET/HEAD and RLS checks never mutate session state.
begin;

-- Do not silently replace an independently configured project request hook.
do $precondition$
declare v_setting text;
begin
 for v_setting in
  select setting from pg_catalog.pg_db_role_setting s
  cross join lateral pg_catalog.unnest(s.setconfig) as setting
  where s.setdatabase in (0,(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database()))
   and setting like 'pgrst.db_pre_request=%'
 loop
  if pg_catalog.substr(v_setting,pg_catalog.length('pgrst.db_pre_request=')+1) not in ('','snote_session_private.guard_request') then
   raise exception 'SESSION_PRE_REQUEST_ALREADY_CONFIGURED' using errcode='55000';
  end if;
 end loop;
 if not exists(select 1 from pg_catalog.pg_roles where rolname='authenticator') then
  raise exception 'SESSION_AUTHENTICATOR_ROLE_MISSING' using errcode='55000';
 end if;
 if not exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
  raise exception 'SESSION_REALTIME_PUBLICATION_MISSING' using errcode='55000';
 end if;
end;
$precondition$;

create schema if not exists snote_session_private;
revoke all on schema snote_session_private from public,anon,authenticated,service_role;

create table if not exists snote_session_private.primary_sessions(
 user_id uuid primary key references auth.users(id) on delete cascade,
 session_id uuid not null,
 session_created_at timestamptz not null,
 generation bigint not null check(generation between 1 and 9007199254740991),
 changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
-- No FK to auth.sessions: the immutable ordering fence survives logout and
-- removal of that Auth session. A removed winner never revives an older SID.
alter table snote_session_private.primary_sessions enable row level security;
revoke all on table snote_session_private.primary_sessions from public,anon,authenticated,service_role;

-- A rollout-era candidate must remain outside the application while its
-- confirmation is open, without disturbing any preexisting LEGACY workspace.
create table if not exists snote_session_private.pending_claims(
 session_id uuid primary key references auth.sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade
);
create index if not exists snote_pending_claims_user_id_idx on snote_session_private.pending_claims(user_id);
alter table snote_session_private.pending_claims enable row level security;
revoke all on table snote_session_private.pending_claims from public,anon,authenticated,service_role;

create table if not exists public.snote_session_signals(
 user_id uuid primary key references auth.users(id) on delete cascade,
 generation bigint not null check(generation between 1 and 9007199254740991),
 changed_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.snote_session_signals enable row level security;
revoke all on table public.snote_session_signals from public,anon,authenticated,service_role;
grant select on table public.snote_session_signals to authenticated;
drop policy if exists snote_session_signal_own on public.snote_session_signals;
-- Losers must still receive their own non-sensitive recheck notification.
-- The signal never contains a token, winner SID, IP, user agent or account data.
create policy snote_session_signal_own on public.snote_session_signals for select to authenticated
 using(user_id=(select auth.uid()));

create or replace function snote_session_private.result(
 p_user uuid,p_session uuid,p_generation bigint,p_active boolean,p_reason text
) returns jsonb language sql immutable set search_path='' as $$
 select pg_catalog.jsonb_build_object('ok',true,'active',p_active,'userId',p_user,
  'sessionId',p_session,'generation',p_generation,'reason',p_reason);
$$;

create or replace function snote_session_private.jwt_session()
returns uuid language plpgsql stable set search_path='' as $$
declare v text:=auth.jwt()->>'session_id';
begin
 if v is null or v!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null;end if;
 return v::uuid;
end;
$$;

-- VOLATILE is deliberate even though this function never writes rows. After
-- waiting for the shared transaction lock, the following SELECT must use a
-- fresh READ COMMITTED snapshot, rather than a pre-lock STABLE query snapshot.
create or replace function snote_session_private.status_for(p_user uuid,p_session uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v snote_session_private.primary_sessions;v_live boolean;v_generation bigint:=0;
begin
 if p_user is null or p_session is null then
  return snote_session_private.result(p_user,p_session,0,false,'SESSION_MISSING');
 end if;
 perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('snote-primary-session/'||p_user::text,0));
 -- Keep this as a separate statement AFTER the shared advisory lock.
 select * into v from snote_session_private.primary_sessions where user_id=p_user;
 if found then
  v_generation:=v.generation;
  if v.session_id<>p_session then
   return snote_session_private.result(p_user,p_session,v_generation,false,'REPLACED');
  end if;
 end if;
 select exists(
  select 1 from auth.users u join auth.sessions s on s.user_id=u.id
  where u.id=p_user and s.id=p_session and s.created_at is not null
   and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
   and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
   and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
   and not exists(select 1 from snote_operator_private.account_state a where a.user_id=u.id and a.archived)
 ) into v_live;
 if not v_live then return snote_session_private.result(p_user,p_session,v_generation,false,'SESSION_MISSING');end if;
 if v_generation=0 then
  if exists(select 1 from snote_session_private.pending_claims p where p.session_id=p_session and p.user_id=p_user) then
   return snote_session_private.result(p_user,p_session,0,false,'SESSION_MISSING');
  end if;
  return snote_session_private.result(p_user,p_session,0,true,'LEGACY');
 end if;
 return snote_session_private.result(p_user,p_session,v_generation,true,'ACTIVE');
end;
$$;

create or replace function snote_session_private.status()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_session uuid:=snote_session_private.jwt_session();
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or coalesce(auth.jwt()->>'is_anonymous','false')<>'false' then
  return snote_session_private.result(v_user,v_session,0,false,'SESSION_MISSING');
 end if;
 return snote_session_private.status_for(v_user,v_session);
end;
$$;

create or replace function snote_session_private.is_current()
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v jsonb;
begin
 v:=snote_session_private.status();return coalesce((v->>'active')::boolean,false);
end;
$$;

-- Remove the previous unconfirmed no-argument overload on upgrade/replay.
-- PostgREST must resolve every claim through the consent-aware signature.
drop function if exists public.snote_session_claim();
drop function if exists snote_session_private.claim();
create or replace function snote_session_private.claim(
 p_confirm_replace boolean default false,p_expected_generation bigint default null
)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_session uuid:=snote_session_private.jwt_session();
 v snote_session_private.primary_sessions;v_created timestamptz;v_generation bigint:=0;v_changed timestamptz;v_conflict boolean:=false;
begin
 if nullif(pg_catalog.current_setting('request.method',true),'') is distinct from 'POST' then
  raise exception 'SESSION_POST_REQUIRED' using errcode='PT405';
 end if;
 if auth.jwt()->>'role' is distinct from 'authenticated' or coalesce(auth.jwt()->>'is_anonymous','false')<>'false'
  or v_user is null or v_session is null then
  return snote_session_private.result(v_user,v_session,0,false,'SESSION_MISSING');
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-primary-session/'||v_user::text,0));
 select * into v from snote_session_private.primary_sessions where user_id=v_user;
 if found then v_generation:=v.generation;end if;
 -- Re-read the live Auth session AFTER waiting for the exclusive lock. An
 -- intervening newer claim may already have removed this older Auth session.
 select s.created_at into v_created
 from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=v_user and s.id=v_session and s.created_at is not null
  and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
  and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
  and not exists(select 1 from snote_operator_private.account_state a where a.user_id=u.id and a.archived);
 if not found then
  return snote_session_private.result(v_user,v_session,v_generation,false,
   case when v_generation>0 and v.session_id<>v_session then 'REPLACED' else 'SESSION_MISSING' end);
 end if;
 if v_generation>0 then
  if v.session_id=v_session then
   return snote_session_private.result(v_user,v_session,v_generation,true,'ACTIVE');
  end if;
  -- created_at is the immutable Auth login time; refreshing an old token does
  -- not advance this fence. UUID order breaks exact timestamp ties consistently.
  if (v_created,v_session)<=(v.session_created_at,v.session_id) then
   return snote_session_private.result(v_user,v_session,v_generation,false,'REPLACED');
  end if;
 end if;
 -- A confirmation only authorizes the generation the user actually saw. Keep
 -- this check after same-SID idempotence and immutable older-SID rejection.
 -- Re-prompt even if that winner disappeared while the dialog was open: a
 -- stale acknowledgement must never silently authorize another generation.
 if coalesce(p_confirm_replace,false) and p_expected_generation is distinct from v_generation then
  insert into snote_session_private.pending_claims(session_id,user_id) values(v_session,v_user)
   on conflict(session_id) do nothing;
  return snote_session_private.result(v_user,v_session,v_generation,false,'CONFIRMATION_REQUIRED')
   || pg_catalog.jsonb_build_object('requiresConfirmation',true);
 end if;
 if v_generation>0 then
  select exists(select 1 from auth.sessions s
   where s.user_id=v_user and s.id=v.session_id and s.created_at is not null
    and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())) into v_conflict;
 else
  -- Before the first application fence, conservatively treat any older live
  -- Auth login as a possible existing workspace. Never choose or disclose its
  -- SID. Newer unclaimed logins are retained and require their own later claim.
  select exists(select 1 from auth.sessions s
   where s.user_id=v_user and s.id<>v_session and s.created_at is not null
    and (s.created_at,s.id)<(v_created,v_session)
    and not exists(select 1 from snote_session_private.pending_claims p where p.session_id=s.id)
    and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())) into v_conflict;
 end if;
 if v_conflict and not coalesce(p_confirm_replace,false) then
  -- Record only this verified candidate. No primary fence, Auth row, refresh
  -- token, signal or changed_at is touched until the caller confirms.
  insert into snote_session_private.pending_claims(session_id,user_id) values(v_session,v_user)
   on conflict(session_id) do nothing;
  return snote_session_private.result(v_user,v_session,v_generation,false,'CONFIRMATION_REQUIRED')
   || pg_catalog.jsonb_build_object('requiresConfirmation',true);
 end if;
 delete from snote_session_private.pending_claims where session_id=v_session and user_id=v_user;
 v_generation:=v_generation+1;v_changed:=pg_catalog.clock_timestamp();
 insert into snote_session_private.primary_sessions(user_id,session_id,session_created_at,generation,changed_at)
 values(v_user,v_session,v_created,v_generation,v_changed)
 on conflict(user_id) do update set session_id=excluded.session_id,session_created_at=excluded.session_created_at,
  generation=excluded.generation,changed_at=excluded.changed_at;
 -- Only strictly older same-user sessions are removed. This revokes their
 -- refresh tokens through Supabase's existing ON DELETE CASCADE foreign keys;
 -- a newer, not-yet-claimed login is never removed by an older request.
 delete from auth.sessions s where s.user_id=v_user and s.id<>v_session
  and (s.created_at,s.id)<(v_created,v_session);
 insert into public.snote_session_signals(user_id,generation,changed_at) values(v_user,v_generation,v_changed)
 on conflict(user_id) do update set generation=excluded.generation,changed_at=excluded.changed_at;
 return snote_session_private.result(v_user,v_session,v_generation,true,'ACTIVE');
end;
$$;

create or replace function public.snote_session_claim(
 p_confirm_replace boolean default false,p_expected_generation bigint default null
)
returns jsonb language sql volatile set search_path='' as $$
 select snote_session_private.claim(p_confirm_replace,p_expected_generation);
$$;
create or replace function public.snote_session_status()
returns jsonb language sql volatile set search_path='' as $$select snote_session_private.status();$$;

create or replace function snote_session_private.guard_request()
returns void language plpgsql volatile security definer set search_path='' as $$
declare v_path text:=pg_catalog.current_setting('request.path',true);
 v_method text:=pg_catalog.current_setting('request.method',true);
begin
 -- Customer link/OTP requests use anon/service_role and keep their independent
 -- authorization. Only app Auth-user Data API requests use this primary lease.
 if auth.jwt()->>'role' is distinct from 'authenticated' then return;end if;
 if v_method='POST' and v_path in('/rpc/snote_session_claim','/rpc/snote_session_status') then return;end if;
 if v_method in('GET','HEAD') and v_path='/snote_session_signals' then return;end if;
 if not snote_session_private.is_current() then
  raise exception 'SESSION_REPLACED' using errcode='PT401';
 end if;
end;
$$;

-- Keep the operator's existing live-session and account-state checks. Acquire
-- the primary advisory lock BEFORE its auth.users/auth.sessions row locks, so
-- a concurrent claim never deadlocks with the service-role operator pathway.
create or replace function snote_operator_private.verified_session(p_actor uuid,p_session uuid)
returns table(user_id uuid,session_id uuid,email text,login_at timestamptz,login_ip inet,user_agent text)
language plpgsql volatile set search_path='' as $$
begin
 if p_actor is null or p_session is null then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 if not coalesce((snote_session_private.status_for(p_actor,p_session)->>'active')::boolean,false) then
  raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';
 end if;
 return query select u.id,s.id,u.email::text,coalesce(s.created_at,pg_catalog.clock_timestamp()),s.ip,s.user_agent
 from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=p_actor and s.id=p_session and u.email_confirmed_at is not null
 and u.deleted_at is null and not coalesce(u.is_anonymous,false)
 and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
 and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
 and not exists(select 1 from snote_operator_private.account_state a where a.user_id=u.id and a.archived)
 for share of u,s;
 if not found then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
end;
$$;

do $policies$
declare v_table text;
begin
 foreach v_table in array array['zc_audit','zc_companies','zc_customers','zc_data_sets','zc_datasets',
  'zc_invites','zc_media','zc_members','zc_vehicle_taxonomy','snote_customer_intake',
  'snote_customer_intake_otp_sends','snote_document_mms']
 loop
  if pg_catalog.to_regclass('public.'||v_table) is not null then
   execute pg_catalog.format('drop policy if exists snote_primary_session_guard on public.%I',v_table);
   execute pg_catalog.format('create policy snote_primary_session_guard on public.%I as restrictive for all to authenticated using((select snote_session_private.is_current())) with check((select snote_session_private.is_current()))',v_table);
  end if;
 end loop;
end;
$policies$;
drop policy if exists snote_primary_session_storage on storage.objects;
create policy snote_primary_session_storage on storage.objects as restrictive for all to authenticated
 using((select snote_session_private.is_current())) with check((select snote_session_private.is_current()));

-- Private helpers are not Data API resources. Only own-session wrappers and
-- the policy/hook entrypoints receive the minimum required EXECUTE grants.
revoke all on all functions in schema snote_session_private from public,anon,authenticated,service_role;
revoke all on function public.snote_session_claim(boolean,bigint),public.snote_session_status() from public,anon,authenticated,service_role;
grant usage on schema snote_session_private to anon,authenticated,service_role;
grant execute on function snote_session_private.guard_request() to anon,authenticated,service_role;
grant execute on function snote_session_private.claim(boolean,bigint),snote_session_private.status(),snote_session_private.is_current() to authenticated;
grant execute on function public.snote_session_claim(boolean,bigint),public.snote_session_status() to authenticated;

do $publication$
begin
 if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='snote_session_signals') then
  alter publication supabase_realtime add table public.snote_session_signals;
 end if;
end;
$publication$;
alter role authenticator set pgrst.db_pre_request='snote_session_private.guard_request';
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
