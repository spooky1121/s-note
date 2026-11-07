-- Auth session observations are independent of tenant/operator authorization.
-- No browser-supplied IP, user ID or session ID is accepted by the ping RPC.
-- Historical observations deliberately have no auth.users/session foreign key:
-- revocation must not erase the operator's connection history.
begin;

create table if not exists snote_operator_private.access_sessions (
 session_id uuid primary key,
 user_id uuid not null,
 email text not null,
 display_name text not null default '',
 company_id uuid,
 company_name text not null default '',
 login_at timestamptz not null,
 login_ip inet,
 user_agent text,
 first_seen timestamptz not null,
 last_seen timestamptz not null,
 check(first_seen<=last_seen),
 check(char_length(email)<=320),
 check(user_agent is null or char_length(user_agent)<=1000)
);
create index if not exists operator_access_time on snote_operator_private.access_sessions(last_seen desc,session_id);
create index if not exists operator_access_login on snote_operator_private.access_sessions(login_at desc,session_id);
create index if not exists operator_access_user on snote_operator_private.access_sessions(user_id,last_seen desc);
create index if not exists operator_access_company on snote_operator_private.access_sessions(company_id,login_at desc);
alter table snote_operator_private.access_sessions enable row level security;
revoke all on table snote_operator_private.access_sessions from public,anon,authenticated,service_role;

create or replace function snote_operator_private.access_ip(p_value text)
returns text language plpgsql immutable set search_path='' as $$
begin
 if p_value is null or char_length(p_value)>80 then return null;end if;
 return host(p_value::inet);
exception when invalid_text_representation then return null;
end$$;

create or replace function snote_operator_private.access_ping()
returns jsonb language plpgsql security definer set search_path='' as $$
declare s record;m record;t timestamptz:=clock_timestamp();v snote_operator_private.access_sessions;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' then
  raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';
 end if;
 select * into s from snote_operator_private.verified_session(auth.uid(),snote_operator_private.claim_session());
 select member.display_name,member.company_id,company.name company_name into m
 from public.zc_members member join public.zc_companies company on company.id=member.company_id
 where member.user_id=s.user_id order by member.active desc,member.joined_at,member.company_id limit 1;
 insert into snote_operator_private.access_sessions(session_id,user_id,email,display_name,company_id,company_name,login_at,login_ip,user_agent,first_seen,last_seen)
 values(s.session_id,s.user_id,coalesce(s.email,''),coalesce(m.display_name,''),m.company_id,coalesce(m.company_name,''),s.login_at,s.login_ip,left(s.user_agent,1000),t,t)
 on conflict(session_id) do update set last_seen=greatest(access_sessions.last_seen,excluded.last_seen)
 where access_sessions.user_id=excluded.user_id
 returning * into v;
 if not found then raise exception 'SESSION_OBSERVATION_CONFLICT' using errcode='42501';end if;
 return jsonb_build_object('ok',true,'sessionId',v.session_id,'firstSeen',v.first_seen,'lastSeen',v.last_seen);
end$$;

create or replace function snote_operator_private.access_list(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;v_sort text;v_direction text;v_sql text;v_result jsonb;v_now timestamptz:=clock_timestamp();
begin
 q:=snote_operator_private.query_options(p_query,
  array['loginAt','lastSeen','durationSeconds','email','displayName'],
  array['all','active','ended','archived'],'loginAt');
 v_sort:=case q->>'sort' when 'lastSeen' then 'last_seen' when 'durationSeconds' then 'duration_seconds'
  when 'email' then 'email' when 'displayName' then 'display_name' else 'login_at' end;
 v_direction:=case when q->>'direction'='asc' then 'asc' else 'desc' end;
 -- All sort identifiers/directions are mapped allowlists. Query values remain
 -- bound SQL parameters. Pagination occurs before JSON serialization.
 v_sql:=format($query$
 with session_rows as (
  select 'session:'||h.session_id::text record_id,h.session_id,h.user_id,h.email,h.display_name,h.company_id,h.company_name,
   h.login_at,host(h.login_ip) login_ip,h.user_agent,h.first_seen,h.last_seen,
   greatest(0,floor(extract(epoch from(h.last_seen-h.first_seen))))::bigint duration_seconds,
   exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=h.session_id and s.user_id=h.user_id and u.email_confirmed_at is not null
     and u.deleted_at is null and not coalesce(u.is_anonymous,false)
     and (u.banned_until is null or u.banned_until<=$2)
     and (s.not_after is null or s.not_after>$2)
     and not exists(select 1 from snote_operator_private.account_state ast where ast.user_id=u.id and ast.archived)) as session_valid,
   h.last_seen>$2-interval '120 seconds' as recently_seen,
   'heartbeat'::text duration_type,'session'::text event_type
  from snote_operator_private.access_sessions h
  union all
  select 'session:'||s.id::text,s.id,s.user_id,coalesce(u.email,''),coalesce(m.display_name,''),m.company_id,coalesce(c.name,''),
   coalesce(s.created_at,$2),host(s.ip),left(s.user_agent,1000),null::timestamptz,null::timestamptz,null::bigint,
   u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    and (u.banned_until is null or u.banned_until<=$2) and (s.not_after is null or s.not_after>$2)
    and not exists(select 1 from snote_operator_private.account_state ast where ast.user_id=u.id and ast.archived),false,
   'auth_session','session'
  from auth.sessions s join auth.users u on u.id=s.user_id
  left join lateral(select * from public.zc_members where user_id=s.user_id order by active desc,joined_at,company_id limit 1)m on true
  left join public.zc_companies c on c.id=m.company_id
  where not exists(select 1 from snote_operator_private.access_sessions h where h.session_id=s.id)
 ), audit_source as (
  select e.id,e.created_at,e.ip_address,e.payload::jsonb payload,
   case when e.payload->>'actor_id'~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    then (e.payload->>'actor_id')::uuid end user_id,
   lower(coalesce(e.payload->>'action','')) action
  from auth.audit_log_entries e
  where lower(coalesce(e.payload->>'action','')) in('login','user_signed_in','sign_in','logout','user_signed_out','sign_out')
 ), audit_rows as (
  select 'audit:'||e.id::text,null::uuid,e.user_id,coalesce(nullif(e.payload->>'actor_username',''),u.email,''),
   coalesce(m.display_name,''),m.company_id,coalesce(c.name,''),e.created_at,
   snote_operator_private.access_ip(e.ip_address),null::text,null::timestamptz,null::timestamptz,null::bigint,false,false,
   'audit_event'::text,case when e.action in('logout','user_signed_out','sign_out') then 'logout' else 'login' end
  from audit_source e left join auth.users u on u.id=e.user_id
  left join lateral(select * from public.zc_members where user_id=e.user_id order by active desc,joined_at,company_id limit 1)m on true
  left join public.zc_companies c on c.id=m.company_id
  where e.user_id is not null and e.created_at is not null
   and (e.action in('logout','user_signed_out','sign_out') or not exists(
    select 1 from session_rows s where s.user_id=e.user_id
     and s.login_at between e.created_at-interval '5 seconds' and e.created_at+interval '5 seconds'))
 ), all_rows as (
  select * from session_rows union all select * from audit_rows
 ), activity_rows as (
  select b.*,b.session_valid and b.recently_seen active from all_rows b
 ), filtered as (
  select b.* from activity_rows b
  where ($1->>'status'='all' or $1->>'status'='active' and b.active
   or $1->>'status' in('ended','archived') and b.duration_type='heartbeat' and not b.session_valid)
   and (nullif($1->>'companyId','') is null or b.company_id::text=$1->>'companyId')
   and (nullif($1->>'ownerId','') is null or b.user_id::text=$1->>'ownerId')
   and ($1->>'query'='' or lower(concat_ws(' ',b.email,b.display_name,b.company_name,b.login_ip,b.user_agent))
    like '%%'||lower($1->>'query')||'%%')
 ), page_rows as (
  select * from filtered order by %I %s nulls last,record_id %s
  limit 20 offset (($1->>'page')::integer-1)*20
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
  'recordId',r.record_id,'sessionId',r.session_id,'userId',r.user_id,'email',r.email,
  'displayName',r.display_name,'companyId',r.company_id,'companyName',r.company_name,
  'loginAt',r.login_at,'loginIp',r.login_ip,'firstSeen',r.first_seen,'lastSeen',r.last_seen,
  'durationSeconds',r.duration_seconds,'active',r.active,'sessionValid',r.session_valid,'durationType',r.duration_type,'eventType',r.event_type,
  'userAgent',r.user_agent,'device',case when r.user_agent is null then 'unknown'
   when r.user_agent~*'mobile|android|iphone|ipad' then 'mobile' else 'desktop' end,
  'status',case when r.active then 'active' when r.duration_type='heartbeat' and r.session_valid then 'idle'
   when r.duration_type='heartbeat' then 'ended' else 'unknown' end
 ) order by r.%I %s nulls last,r.record_id %s) from page_rows r),'[]'::jsonb),
 'total',(select count(*) from filtered),'page',($1->>'page')::integer,'pageSize',20,
 'observedDurationOnly',true,'activityWindowSeconds',120)
 $query$,v_sort,v_direction,v_direction,v_sort,v_direction,v_direction);
 execute v_sql into v_result using q,v_now;
 return v_result;
end$$;

create or replace function public.snote_access_ping()
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.access_ping()$$;
create or replace function public.snote_operator_access_list(p_query jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.access_list(p_query)$$;

revoke all on function snote_operator_private.access_ip(text) from public,anon,authenticated,service_role;
revoke all on function snote_operator_private.access_ping() from public,anon,authenticated,service_role;
revoke all on function snote_operator_private.access_list(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.snote_access_ping() from public,anon,authenticated,service_role;
revoke all on function public.snote_operator_access_list(jsonb) from public,anon,authenticated,service_role;
grant usage on schema snote_operator_private to authenticated;
grant execute on function snote_operator_private.access_ping(),snote_operator_private.access_list(jsonb) to authenticated;
grant execute on function public.snote_access_ping(),public.snote_operator_access_list(jsonb) to authenticated;

comment on table snote_operator_private.access_sessions is 'Private observed page activity snapshots. IP and agent originate only from Supabase Auth sessions. Duration measures first-to-last heartbeat; missing historical duration stays null.';
notify pgrst,'reload schema';
commit;
