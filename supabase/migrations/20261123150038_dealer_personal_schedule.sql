-- Personal dealer schedules only. No company-wide/admin read exception, Auth
-- configuration, financial dataset, public realtime publication or SMS change.
begin;
create schema if not exists snote_schedule_private;
revoke all on schema snote_schedule_private from public,anon,authenticated,service_role;

create table if not exists snote_schedule_private.events (
 id uuid primary key,
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 100 and title=btrim(title) and title!~'[[:cntrl:]]'),
 notes text not null default '' check(char_length(notes)<=2000 and regexp_replace(notes,E'[\t\n\r]','','g')!~'[[:cntrl:]]'),
 event_date date not null check(event_date between date'0001-01-01' and date'9999-12-31'),
 event_time time without time zone check(event_time<time'24:00' and extract(second from event_time)=0),
 completed boolean not null default false,
 revision integer not null check(revision between 1 and 2147483647),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz
);
create index if not exists schedule_events_company_idx on snote_schedule_private.events(company_id);
create index if not exists schedule_events_owner_idx on snote_schedule_private.events(owner_id);
create index if not exists schedule_events_live_date_idx on snote_schedule_private.events(company_id,owner_id,event_date,event_time,id) where deleted_at is null;
alter table snote_schedule_private.events enable row level security;
revoke all on table snote_schedule_private.events from public,anon,authenticated,service_role;

-- Reuse the existing strict live-session verifier unchanged. It verifies the
-- signed subject/exact auth.sessions row and locks the user/session for this
-- transaction, without selecting a single winning login.
create or replace function snote_schedule_private.actor(p_expected_company_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare a uuid:=auth.uid();
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' or a is null or p_expected_company_id is null then
  raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end if;
 begin
  perform 1 from snote_operator_private.verified_session(a,snote_operator_private.claim_session());
 exception when insufficient_privilege then raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end;
 perform 1 from public.zc_members m where m.user_id=a and m.company_id=p_expected_company_id and m.active and m.role in('admin','dealer') for share;
 if not found then raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';end if;
 perform 1 from public.zc_companies c where c.id=p_expected_company_id
  and not exists(select 1 from snote_operator_private.company_state s where s.company_id=c.id and s.archived) for share;
 if not found or exists(select 1 from snote_operator_private.operators o where o.user_id=a) then
  raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end if;
 return a;
end$$;

create or replace function snote_schedule_private.event_value(p_row snote_schedule_private.events)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'title',p_row.title,'notes',p_row.notes,
  'eventDate',to_char(p_row.event_date,'YYYY-MM-DD'),'time',case when p_row.event_time is not null then to_char(date'2000-01-01'+p_row.event_time,'HH24:MI') end,
  'completed',p_row.completed,'revision',p_row.revision,
  'createdAt',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(p_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create or replace function snote_schedule_private.validate_event(p_event jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;t text;n text;d date;i uuid;tm text;
begin
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>16384
  or not(p_event ?& array['id','title','notes','eventDate','time','completed']) then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_event) loop
  if k not in('id','title','notes','eventDate','time','completed') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_event->'id') is distinct from 'string' or (p_event->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_event->'title') is distinct from 'string' or jsonb_typeof(p_event->'notes') is distinct from 'string'
  or jsonb_typeof(p_event->'eventDate') is distinct from 'string' or (p_event->>'eventDate')!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  or left(p_event->>'eventDate',4)='0000' or jsonb_typeof(p_event->'completed') is distinct from 'boolean'
  or jsonb_typeof(p_event->'time') not in('null','string') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 t:=btrim(p_event->>'title');n:=p_event->>'notes';tm:=p_event->>'time';
 if char_length(t) not between 1 and 100 or t~'[[:cntrl:]]' or char_length(n)>2000 or regexp_replace(n,E'[\t\n\r]','','g')~'[[:cntrl:]]'
  or (tm is not null and tm!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 begin d:=(p_event->>'eventDate')::date;i:=(p_event->>'id')::uuid;
 exception when others then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end;
 if d not between date'0001-01-01' and date'9999-12-31' then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 return jsonb_build_object('id',i,'title',t,'notes',n,'eventDate',to_char(d,'YYYY-MM-DD'),'time',tm,'completed',(p_event->>'completed')::boolean);
end$$;

create or replace function snote_schedule_private.list_events(p_expected_company_id uuid,p_month text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_schedule_private.actor(p_expected_company_id);first_day date;grid_start date;range_start date;range_end date;
 today_date date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;r jsonb;
begin
 if p_month is null or p_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month,4)='0000' then raise exception 'SCHEDULE_INVALID_MONTH' using errcode='22023';end if;
 first_day:=make_date(left(p_month,4)::integer,right(p_month,2)::integer,1);
 grid_start:=first_day-extract(dow from first_day)::integer;
 range_start:=greatest(grid_start,date'0001-01-01');range_end:=least(grid_start+41,date'9999-12-31');
 -- One SQL snapshot keeps counts, bounded arrays and dayCounts consistent.
 with eligible as not materialized (
  select e.* from snote_schedule_private.events e where e.company_id=p_expected_company_id and e.owner_id=a and e.deleted_at is null
 ), totals as (
  select count(*) filter(where event_date between range_start and range_end) calendar,
   count(*) filter(where event_date=today_date) today,
   count(*) filter(where not completed and event_date>today_date) upcoming,
   count(*) filter(where not completed and event_date<today_date) overdue from eligible
 ), day_counts as (
  select event_date,count(*) amount from eligible where event_date between range_start and range_end group by event_date
 )
 select jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'month',p_month,'today',to_char(today_date,'YYYY-MM-DD'),
  'rangeStart',to_char(range_start,'YYYY-MM-DD'),'rangeEnd',to_char(range_end,'YYYY-MM-DD'),
  'events',coalesce((select jsonb_agg(snote_schedule_private.event_value(c::snote_schedule_private.events) order by c.event_date,c.event_time nulls first,c.id) from
   (select * from eligible where event_date between range_start and range_end order by event_date,event_time nulls first,id limit 500)c),'[]'::jsonb),
  'todayEvents',coalesce((select jsonb_agg(snote_schedule_private.event_value(c::snote_schedule_private.events) order by c.event_time nulls first,c.id) from
   (select * from eligible where event_date=today_date order by event_time nulls first,id limit 50)c),'[]'::jsonb),
  'upcomingEvents',coalesce((select jsonb_agg(snote_schedule_private.event_value(c::snote_schedule_private.events) order by c.event_date,c.event_time nulls first,c.id) from
   (select * from eligible where not completed and event_date>today_date order by event_date,event_time nulls first,id limit 50)c),'[]'::jsonb),
  'overdueEvents',coalesce((select jsonb_agg(snote_schedule_private.event_value(c::snote_schedule_private.events) order by c.event_date,c.event_time nulls first,c.id) from
   (select * from eligible where not completed and event_date<today_date order by event_date,event_time nulls first,id limit 50)c),'[]'::jsonb),
  'counts',jsonb_build_object('calendar',totals.calendar,'today',totals.today,'upcoming',totals.upcoming,'overdue',totals.overdue),
  'truncated',jsonb_build_object('calendar',totals.calendar>500,'today',totals.today>50,'upcoming',totals.upcoming>50,'overdue',totals.overdue>50),
  'dayCounts',(select jsonb_object_agg(to_char(range_start+d.n,'YYYY-MM-DD'),coalesce(c.amount,0)) from generate_series(0,range_end-range_start)d(n) left join day_counts c on c.event_date=range_start+d.n))
 into r from totals;
 return r;
end$$;

create or replace function snote_schedule_private.save_event(p_expected_company_id uuid,p_event jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_schedule_private.actor(p_expected_company_id);v jsonb;r snote_schedule_private.events;duplicate boolean:=false;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception 'SCHEDULE_INVALID_REVISION' using errcode='22023';end if;
 v:=snote_schedule_private.validate_event(p_event);
 if p_expected_revision=0 then
  insert into snote_schedule_private.events(id,company_id,owner_id,title,notes,event_date,event_time,completed,revision)
   values((v->>'id')::uuid,p_expected_company_id,a,v->>'title',v->>'notes',(v->>'eventDate')::date,(v->>'time')::time,(v->>'completed')::boolean,1)
   on conflict(id) do nothing returning * into r;
  if found then return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'event',snote_schedule_private.event_value(r),'duplicate',false);end if;
 end if;
 select * into r from snote_schedule_private.events e where e.id=(v->>'id')::uuid and e.company_id=p_expected_company_id and e.owner_id=a for update;
 -- Foreign and absent identifiers deliberately produce the same error.
 if not found then raise exception 'SCHEDULE_EVENT_UNAVAILABLE' using errcode='42501';end if;
 if r.deleted_at is not null then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 if r.revision=p_expected_revision+1 and (snote_schedule_private.event_value(r)-array['revision','createdAt','updatedAt'])=v then duplicate:=true;
 elsif p_expected_revision>0 and r.revision=p_expected_revision then
  update snote_schedule_private.events e set title=v->>'title',notes=v->>'notes',event_date=(v->>'eventDate')::date,event_time=(v->>'time')::time,
   completed=(v->>'completed')::boolean,revision=e.revision+1,updated_at=clock_timestamp()
   where e.id=r.id and e.company_id=p_expected_company_id and e.owner_id=a and e.revision=p_expected_revision and e.deleted_at is null returning * into r;
  if not found then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 else raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'event',snote_schedule_private.event_value(r),'duplicate',duplicate);
end$$;

create or replace function snote_schedule_private.delete_event(p_expected_company_id uuid,p_event_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_schedule_private.actor(p_expected_company_id);r snote_schedule_private.events;duplicate boolean:=false;
begin
 if p_event_id is null or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647 then raise exception 'SCHEDULE_INVALID_REVISION' using errcode='22023';end if;
 select * into r from snote_schedule_private.events e where e.id=p_event_id and e.company_id=p_expected_company_id and e.owner_id=a for update;
 if not found then raise exception 'SCHEDULE_EVENT_UNAVAILABLE' using errcode='42501';end if;
 if r.deleted_at is not null and r.revision=p_expected_revision+1 then duplicate:=true;
 elsif r.deleted_at is null and r.revision=p_expected_revision then
  update snote_schedule_private.events e set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),revision=e.revision+1
   where e.id=p_event_id and e.company_id=p_expected_company_id and e.owner_id=a and e.revision=p_expected_revision and e.deleted_at is null returning * into r;
  if not found then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 else raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'id',r.id,'revision',r.revision,'deleted',true,'duplicate',duplicate);
end$$;

create or replace function public.snote_schedule_list(p_expected_company_id uuid,p_month text)
returns jsonb language sql security invoker set search_path='' as $$select snote_schedule_private.list_events(p_expected_company_id,p_month);$$;
create or replace function public.snote_schedule_save(p_expected_company_id uuid,p_event jsonb,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_schedule_private.save_event(p_expected_company_id,p_event,p_expected_revision);$$;
create or replace function public.snote_schedule_delete(p_expected_company_id uuid,p_event_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_schedule_private.delete_event(p_expected_company_id,p_event_id,p_expected_revision);$$;

revoke all on function snote_schedule_private.actor(uuid),snote_schedule_private.event_value(snote_schedule_private.events),snote_schedule_private.validate_event(jsonb),snote_schedule_private.list_events(uuid,text),snote_schedule_private.save_event(uuid,jsonb,integer),snote_schedule_private.delete_event(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.snote_schedule_list(uuid,text),public.snote_schedule_save(uuid,jsonb,integer),public.snote_schedule_delete(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant usage on schema snote_schedule_private to authenticated;
grant execute on function snote_schedule_private.list_events(uuid,text),snote_schedule_private.save_event(uuid,jsonb,integer),snote_schedule_private.delete_event(uuid,uuid,integer) to authenticated;
grant execute on function public.snote_schedule_list(uuid,text),public.snote_schedule_save(uuid,jsonb,integer),public.snote_schedule_delete(uuid,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
