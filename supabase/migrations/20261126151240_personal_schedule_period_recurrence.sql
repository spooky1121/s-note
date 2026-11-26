-- Extend personal schedules with inclusive periods and recurring source series.
-- No Auth/session helper, company/owner permission, RLS or existing grant changes.
begin;
alter table snote_schedule_private.events add column if not exists end_date date;
alter table snote_schedule_private.events add column if not exists recurrence text not null default 'none';
do $constraints$ begin
 if not exists(select 1 from pg_constraint where conrelid='snote_schedule_private.events'::regclass and conname='schedule_period_valid') then
  alter table snote_schedule_private.events add constraint schedule_period_valid check(end_date is null or end_date between event_date and date'9999-12-31');
 end if;
 if not exists(select 1 from pg_constraint where conrelid='snote_schedule_private.events'::regclass and conname='schedule_recurrence_valid') then
  alter table snote_schedule_private.events add constraint schedule_recurrence_valid check(recurrence in('none','daily','weekly','monthly','yearly') and (recurrence='none' or coalesce(end_date,event_date)-event_date<=365));
 end if;
end $constraints$;
create index if not exists schedule_events_recurring_owner_idx on snote_schedule_private.events(company_id,owner_id,event_date) where deleted_at is null and recurrence<>'none';

create or replace function snote_schedule_private.event_value(p_row snote_schedule_private.events)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'title',p_row.title,'notes',p_row.notes,
  'eventDate',to_char(p_row.event_date,'YYYY-MM-DD'),'endDate',to_char(coalesce(p_row.end_date,p_row.event_date),'YYYY-MM-DD'),'recurrence',p_row.recurrence,
  'time',case when p_row.event_time is not null then to_char(date'2000-01-01'+p_row.event_time,'HH24:MI') end,
  'completed',p_row.completed,'revision',p_row.revision,
  'createdAt',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(p_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;

create or replace function snote_schedule_private.repeat_date(p_start date,p_kind text,p_index integer)
returns date language plpgsql immutable strict set search_path='' as $$
declare y integer;m integer;d integer;idx integer;target date;result date;
begin
 if p_index<0 then return null;end if;
 if p_kind='none' then return case when p_index=0 then p_start else null end;end if;
 if p_kind in('daily','weekly') then
  begin result:=p_start+p_index*case when p_kind='weekly' then 7 else 1 end;exception when datetime_field_overflow or numeric_value_out_of_range then return null;end;
  return case when result between date'0001-01-01' and date'9999-12-31' then result end;
 end if;
 y:=extract(year from p_start)::integer;m:=extract(month from p_start)::integer;d:=extract(day from p_start)::integer;
 if p_kind='monthly' then idx:=(y-1)*12+m-1+p_index;y:=idx/12+1;m:=idx%12+1;
 elsif p_kind='yearly' then y:=y+p_index;else return null;end if;
 if y not between 1 and 9999 then return null;end if;
 target:=make_date(y,m,1);return make_date(y,m,least(d,extract(day from target+interval'1 month'-interval'1 day')::integer));
end$$;

create or replace function snote_schedule_private.occurrences(p_row snote_schedule_private.events,p_from date,p_to date)
returns table(occurrence_start date,occurrence_end date) language plpgsql immutable strict set search_path='' as $$
declare duration integer:=coalesce(p_row.end_date,p_row.event_date)-p_row.event_date;
 earliest date;first_index integer:=0;last_index integer:=0;step integer;i integer;candidate date;ending date;
begin
 if p_from>p_to then return;end if;
 if p_row.recurrence='none' then
  if p_row.event_date<=p_to and coalesce(p_row.end_date,p_row.event_date)>=p_from then occurrence_start:=p_row.event_date;occurrence_end:=coalesce(p_row.end_date,p_row.event_date);return next;end if;return;
 end if;
 earliest:=greatest(date'0001-01-01',p_from-duration);
 if p_row.recurrence in('daily','weekly') then
  step:=case when p_row.recurrence='weekly' then 7 else 1 end;
  first_index:=greatest(0,ceil((earliest-p_row.event_date)::numeric/step)::integer);last_index:=floor((p_to-p_row.event_date)::numeric/step)::integer;
 elsif p_row.recurrence='monthly' then
  first_index:=greatest(0,(extract(year from earliest)::integer-extract(year from p_row.event_date)::integer)*12+extract(month from earliest)::integer-extract(month from p_row.event_date)::integer);
  last_index:=(extract(year from p_to)::integer-extract(year from p_row.event_date)::integer)*12+extract(month from p_to)::integer-extract(month from p_row.event_date)::integer;
 elsif p_row.recurrence='yearly' then
  first_index:=greatest(0,extract(year from earliest)::integer-extract(year from p_row.event_date)::integer);last_index:=extract(year from p_to)::integer-extract(year from p_row.event_date)::integer;
 else return;end if;
 if last_index<first_index then return;end if;
 for i in first_index..last_index loop
  candidate:=snote_schedule_private.repeat_date(p_row.event_date,p_row.recurrence,i);
  if candidate is null or candidate>date'9999-12-31'-duration then continue;end if;
  ending:=candidate+duration;
  if candidate<=p_to and ending>=p_from then occurrence_start:=candidate;occurrence_end:=ending;return next;end if;
 end loop;
end$$;

create or replace function snote_schedule_private.occurrence_value(p_row snote_schedule_private.events,p_start date,p_end date)
returns jsonb language sql immutable strict set search_path='' as $$
 select snote_schedule_private.event_value(p_row)||jsonb_build_object('seriesId',p_row.id,'occurrenceId',p_row.id::text||'@'||to_char(p_start,'YYYY-MM-DD'),'occurrenceStartDate',to_char(p_start,'YYYY-MM-DD'),'occurrenceEndDate',to_char(p_end,'YYYY-MM-DD'));
$$;

create or replace function snote_schedule_private.validate_event(p_event jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;t text;n text;d date;ed date;i uuid;tm text;rc text;end_text text;
begin
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>16384
  or not(p_event ?& array['id','title','notes','eventDate','time','completed']) then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_event) loop
  if k not in('id','title','notes','eventDate','endDate','recurrence','time','completed') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_event->'id') is distinct from 'string' or (p_event->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(p_event->'title') is distinct from 'string' or jsonb_typeof(p_event->'notes') is distinct from 'string'
  or jsonb_typeof(p_event->'eventDate') is distinct from 'string' or (p_event->>'eventDate')!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  or left(p_event->>'eventDate',4)='0000' or jsonb_typeof(p_event->'completed') is distinct from 'boolean'
  or jsonb_typeof(p_event->'time') not in('null','string') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 t:=btrim(p_event->>'title');n:=p_event->>'notes';tm:=p_event->>'time';
 if p_event ? 'endDate' and jsonb_typeof(p_event->'endDate') not in('null','string') or p_event ? 'recurrence' and jsonb_typeof(p_event->'recurrence') is distinct from 'string' then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 end_text:=coalesce(p_event->>'endDate',p_event->>'eventDate');rc:=coalesce(p_event->>'recurrence','none');
 if end_text!~'^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' or left(end_text,4)='0000' or rc not in('none','daily','weekly','monthly','yearly') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 if char_length(t) not between 1 and 100 or t~'[[:cntrl:]]' or char_length(n)>2000 or regexp_replace(n,E'[\t\n\r]','','g')~'[[:cntrl:]]'
  or (tm is not null and tm!~'^([01][0-9]|2[0-3]):[0-5][0-9]$') then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 begin d:=(p_event->>'eventDate')::date;ed:=end_text::date;i:=(p_event->>'id')::uuid;
 exception when others then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end;
 if d not between date'0001-01-01' and date'9999-12-31' or ed not between d and date'9999-12-31' or rc<>'none' and ed-d>365 then raise exception 'SCHEDULE_INVALID_EVENT' using errcode='22023';end if;
 return jsonb_build_object('id',i,'title',t,'notes',n,'eventDate',to_char(d,'YYYY-MM-DD'),'endDate',to_char(ed,'YYYY-MM-DD'),'recurrence',rc,'time',tm,'completed',(p_event->>'completed')::boolean);
end$$;


create or replace function snote_schedule_private.list_events_v2(p_expected_company_id uuid,p_month text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_schedule_private.actor(p_expected_company_id);first_day date;grid_start date;range_start date;range_end date;grid_size integer;
 today_date date:=(clock_timestamp() at time zone 'Asia/Seoul')::date;r jsonb;
begin
 if p_month is null or p_month!~'^[0-9]{4}-(0[1-9]|1[0-2])$' or left(p_month,4)='0000' then raise exception 'SCHEDULE_INVALID_MONTH' using errcode='22023';end if;
 first_day:=make_date(left(p_month,4)::integer,right(p_month,2)::integer,1);grid_start:=first_day-extract(dow from first_day)::integer;
 grid_size:=greatest(35,ceil((extract(dow from first_day)+extract(day from first_day+interval'1 month'-interval'1 day'))/7)::integer*7);
 range_start:=greatest(grid_start,date'0001-01-01');range_end:=least(grid_start+grid_size-1,date'9999-12-31');
 with eligible as materialized (
  select e.* from snote_schedule_private.events e where e.company_id=p_expected_company_id and e.owner_id=a and e.deleted_at is null
 ), calendar_rows as materialized (
  select row(e.*)::snote_schedule_private.events as source,o.* from eligible e cross join lateral snote_schedule_private.occurrences(row(e.*)::snote_schedule_private.events,range_start,range_end) o
 ), today_rows as materialized (
  select row(e.*)::snote_schedule_private.events as source,o.* from eligible e cross join lateral snote_schedule_private.occurrences(row(e.*)::snote_schedule_private.events,today_date,today_date) o
 ), upcoming_rows as materialized (
  select row(e.*)::snote_schedule_private.events as source,e.event_date occurrence_start,coalesce(e.end_date,e.event_date) occurrence_end from eligible e where not e.completed and e.recurrence='none' and e.event_date>today_date
  union all
  select row(e.*)::snote_schedule_private.events as source,o.* from eligible e cross join lateral (
   select x.occurrence_start,x.occurrence_start+(coalesce(e.end_date,e.event_date)-e.event_date) occurrence_end from snote_schedule_private.occurrences(jsonb_populate_record(row(e.*)::snote_schedule_private.events,jsonb_build_object('end_date',e.event_date)),greatest(e.event_date,today_date+1),least(date'9999-12-31'-(coalesce(e.end_date,e.event_date)-e.event_date),greatest(e.event_date,today_date+case e.recurrence when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 31 else 366 end))) x where x.occurrence_start>today_date order by x.occurrence_start limit 1
  ) o where not e.completed and e.recurrence<>'none'
 ), overdue_rows as materialized (
  select row(e.*)::snote_schedule_private.events as source,e.event_date occurrence_start,coalesce(e.end_date,e.event_date) occurrence_end from eligible e where not e.completed and e.recurrence='none' and coalesce(e.end_date,e.event_date)<today_date
  union all
  select row(e.*)::snote_schedule_private.events as source,o.* from eligible e cross join lateral (
   select x.occurrence_start,x.occurrence_start+(coalesce(e.end_date,e.event_date)-e.event_date) occurrence_end from snote_schedule_private.occurrences(jsonb_populate_record(row(e.*)::snote_schedule_private.events,jsonb_build_object('end_date',e.event_date)),greatest(e.event_date,today_date-1-(coalesce(e.end_date,e.event_date)-e.event_date)-case e.recurrence when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 31 else 366 end),least(date'9999-12-31'-(coalesce(e.end_date,e.event_date)-e.event_date),today_date-1-(coalesce(e.end_date,e.event_date)-e.event_date))) x order by x.occurrence_start desc limit 1
  ) o where not e.completed and e.recurrence<>'none'
 ), totals as (
  select (select count(*) from calendar_rows) calendar,(select count(*) from today_rows) today,(select count(*) from upcoming_rows) upcoming,(select count(*) from overdue_rows) overdue
 ), days as (
  select d::date calendar_day from generate_series(range_start::timestamp,range_end::timestamp,interval'1 day') d
 ), day_counts as (
  select d.calendar_day,(select count(*) from calendar_rows c where c.occurrence_start<=d.calendar_day and c.occurrence_end>=d.calendar_day) amount from days d
 )
 select jsonb_build_object('ok',true,'schemaVersion',2,'companyId',p_expected_company_id,'ownerId',a,'month',p_month,'today',to_char(today_date,'YYYY-MM-DD'),
  'rangeStart',to_char(range_start,'YYYY-MM-DD'),'rangeEnd',to_char(range_end,'YYYY-MM-DD'),
  'events',coalesce((select jsonb_agg(snote_schedule_private.occurrence_value(v.source,v.occurrence_start,v.occurrence_end) order by v.occurrence_start,(v.source).event_time nulls last,(v.source).id) from(select * from calendar_rows order by occurrence_start,(source).event_time nulls last,(source).id limit 500)v),'[]'::jsonb),
  'todayEvents',coalesce((select jsonb_agg(snote_schedule_private.occurrence_value(v.source,v.occurrence_start,v.occurrence_end) order by v.occurrence_start,(v.source).event_time nulls last,(v.source).id) from(select * from today_rows order by occurrence_start,(source).event_time nulls last,(source).id limit 50)v),'[]'::jsonb),
  'upcomingEvents',coalesce((select jsonb_agg(snote_schedule_private.occurrence_value(v.source,v.occurrence_start,v.occurrence_end) order by v.occurrence_start,(v.source).event_time nulls last,(v.source).id) from(select * from upcoming_rows order by occurrence_start,(source).event_time nulls last,(source).id limit 50)v),'[]'::jsonb),
  'overdueEvents',coalesce((select jsonb_agg(snote_schedule_private.occurrence_value(v.source,v.occurrence_start,v.occurrence_end) order by v.occurrence_end desc,v.occurrence_start desc,(v.source).id) from(select * from overdue_rows order by occurrence_end desc,occurrence_start desc,(source).id limit 50)v),'[]'::jsonb),
  'counts',jsonb_build_object('calendar',t.calendar,'today',t.today,'upcoming',t.upcoming,'overdue',t.overdue),
  'truncated',jsonb_build_object('calendar',t.calendar>500,'today',t.today>50,'upcoming',t.upcoming>50,'overdue',t.overdue>50),
  'dayCounts',(select jsonb_object_agg(to_char(calendar_day,'YYYY-MM-DD'),amount order by calendar_day) from day_counts)
 ) into r from totals t;return r;
end$$;

create or replace function snote_schedule_private.save_event(p_expected_company_id uuid,p_event jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_schedule_private.actor(p_expected_company_id);v jsonb;r snote_schedule_private.events;duplicate boolean:=false;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception 'SCHEDULE_INVALID_REVISION' using errcode='22023';end if;
 v:=snote_schedule_private.validate_event(p_event);
 if v->>'recurrence'<>'none' then
  perform pg_advisory_xact_lock(hashtextextended('snote-schedule-recurring:'||p_expected_company_id::text||':'||a::text,0));
  if not exists(select 1 from snote_schedule_private.events e where e.id=(v->>'id')::uuid and e.company_id=p_expected_company_id and e.owner_id=a and e.deleted_at is null and e.recurrence<>'none') and (select count(*) from snote_schedule_private.events e where e.company_id=p_expected_company_id and e.owner_id=a and e.deleted_at is null and e.recurrence<>'none')>=500 then raise exception 'SCHEDULE_LIMIT' using errcode='22023';end if;
 end if;
 if p_expected_revision=0 then
  insert into snote_schedule_private.events(id,company_id,owner_id,title,notes,event_date,end_date,recurrence,event_time,completed,revision)
   values((v->>'id')::uuid,p_expected_company_id,a,v->>'title',v->>'notes',(v->>'eventDate')::date,(v->>'endDate')::date,v->>'recurrence',(v->>'time')::time,(v->>'completed')::boolean,1)
   on conflict(id) do nothing returning * into r;
  if found then return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'event',snote_schedule_private.event_value(r),'duplicate',false);end if;
 end if;
 select * into r from snote_schedule_private.events e where e.id=(v->>'id')::uuid and e.company_id=p_expected_company_id and e.owner_id=a for update;
 -- Foreign and absent identifiers deliberately produce the same error.
 if not found then raise exception 'SCHEDULE_EVENT_UNAVAILABLE' using errcode='42501';end if;
 if r.deleted_at is not null then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 if (r.recurrence<>'none' or coalesce(r.end_date,r.event_date)<>r.event_date) and (not(p_event ? 'endDate') or not(p_event ? 'recurrence')) then raise exception 'SCHEDULE_CLIENT_UPDATE_REQUIRED' using errcode='22023';end if;
 if r.revision=p_expected_revision+1 and (snote_schedule_private.event_value(r)-array['revision','createdAt','updatedAt'])=v then duplicate:=true;
 elsif p_expected_revision>0 and r.revision=p_expected_revision then
  update snote_schedule_private.events e set title=v->>'title',notes=v->>'notes',event_date=(v->>'eventDate')::date,end_date=(v->>'endDate')::date,recurrence=v->>'recurrence',event_time=(v->>'time')::time,
   completed=(v->>'completed')::boolean,revision=e.revision+1,updated_at=clock_timestamp()
   where e.id=r.id and e.company_id=p_expected_company_id and e.owner_id=a and e.revision=p_expected_revision and e.deleted_at is null returning * into r;
  if not found then raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 else raise exception 'SCHEDULE_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'ownerId',a,'event',snote_schedule_private.event_value(r),'duplicate',duplicate);
end$$;


create or replace function public.snote_schedule_list_v2(p_expected_company_id uuid,p_month text)
returns jsonb language sql security invoker set search_path='' as $$select snote_schedule_private.list_events_v2(p_expected_company_id,p_month);$$;
revoke all on function snote_schedule_private.repeat_date(date,text,integer),snote_schedule_private.occurrences(snote_schedule_private.events,date,date),snote_schedule_private.occurrence_value(snote_schedule_private.events,date,date),snote_schedule_private.list_events_v2(uuid,text),public.snote_schedule_list_v2(uuid,text) from public,anon,authenticated,service_role;
grant execute on function snote_schedule_private.list_events_v2(uuid,text),public.snote_schedule_list_v2(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
