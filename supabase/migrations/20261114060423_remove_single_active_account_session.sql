-- Remove only the v2.114 single-primary-session feature. Existing Auth sessions,
-- business rows, original RLS, Storage permissions and operator authorization
-- remain intact. Captured pre-rollout metadata had no db_pre_request hook.
begin;

do $precondition$
declare v_setting record;v_authenticator oid;
begin
 select oid into v_authenticator from pg_catalog.pg_roles where rolname='authenticator';
 for v_setting in
  select s.setrole,s.setdatabase,c.setting
  from pg_catalog.pg_db_role_setting s
  cross join lateral pg_catalog.unnest(s.setconfig) as c(setting)
  where s.setdatabase in(0,(select oid from pg_catalog.pg_database where datname=pg_catalog.current_database()))
   and c.setting like 'pgrst.db_pre_request=%'
 loop
  if pg_catalog.substr(v_setting.setting,pg_catalog.length('pgrst.db_pre_request=')+1)
      not in('','snote_session_private.guard_request') then
   raise exception 'SESSION_REMOVAL_HOOK_CHANGED_REVIEW_REQUIRED' using errcode='55000';
  end if;
  if v_setting.setting='pgrst.db_pre_request=snote_session_private.guard_request'
     and (v_setting.setrole is distinct from v_authenticator or v_setting.setdatabase<>0) then
   raise exception 'SESSION_REMOVAL_HOOK_SCOPE_CHANGED_REVIEW_REQUIRED' using errcode='55000';
  end if;
 end loop;
 if v_authenticator is not null then
  alter role authenticator reset pgrst.db_pre_request;
 end if;
end;
$precondition$;

do $policies$
declare v_table text;
begin
 foreach v_table in array array['zc_audit','zc_companies','zc_customers','zc_data_sets','zc_datasets',
  'zc_invites','zc_media','zc_members','zc_vehicle_taxonomy','snote_customer_intake',
  'snote_customer_intake_otp_sends','snote_document_mms']
 loop
  if pg_catalog.to_regclass('public.'||v_table) is not null then
   execute pg_catalog.format('drop policy if exists snote_primary_session_guard on public.%I',v_table);
  end if;
 end loop;
 if pg_catalog.to_regclass('storage.objects') is not null then
  drop policy if exists snote_primary_session_storage on storage.objects;
 end if;
end;
$policies$;

-- Exact pre-v2.114 operator helper from the captured production definition.
-- It still verifies the given live Auth session, confirmed active user and
-- non-archived operator account; it no longer selects one winning login.
create or replace function snote_operator_private.verified_session(p_actor uuid,p_session uuid)
returns table(user_id uuid,session_id uuid,email text,login_at timestamptz,login_ip inet,user_agent text)
language plpgsql set search_path='' as $$
begin
 if p_actor is null or p_session is null then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 return query select u.id,s.id,u.email::text,coalesce(s.created_at,clock_timestamp()),s.ip,s.user_agent
 from auth.users u join auth.sessions s on s.user_id=u.id
 where u.id=p_actor and s.id=p_session and u.email_confirmed_at is not null
 and u.deleted_at is null and not coalesce(u.is_anonymous,false)
 and (u.banned_until is null or u.banned_until<=clock_timestamp())
 and (s.not_after is null or s.not_after>clock_timestamp())
 and not exists(select 1 from snote_operator_private.account_state a where a.user_id=u.id and a.archived)
 for share of u,s;
 if not found then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
end$$;

do $publication$
begin
 if exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename='snote_session_signals') then
  alter publication supabase_realtime drop table public.snote_session_signals;
 end if;
end;
$publication$;

-- Explicit feature-only cleanup. RESTRICT is deliberate: an unexpected
-- dependency aborts this transaction instead of deleting unrelated objects.
drop function if exists public.snote_session_claim();
drop function if exists public.snote_session_claim(boolean,bigint);
drop function if exists public.snote_session_status();
drop function if exists snote_session_private.claim();
drop function if exists snote_session_private.claim(boolean,bigint);
drop function if exists snote_session_private.guard_request();
drop function if exists snote_session_private.is_current();
drop function if exists snote_session_private.status();
drop function if exists snote_session_private.status_for(uuid,uuid);
drop function if exists snote_session_private.jwt_session();
drop function if exists snote_session_private.result(uuid,uuid,bigint,boolean,text);
drop table if exists public.snote_session_signals;
drop table if exists snote_session_private.pending_claims;
drop table if exists snote_session_private.primary_sessions;
drop schema if exists snote_session_private;

notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
