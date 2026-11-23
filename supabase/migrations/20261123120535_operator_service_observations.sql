-- Operational metadata only. No passwords, customer payloads, OCR text, plates,
-- raw URLs, tokens or IP addresses are copied into the observation store.
begin;

alter table snote_operator_private.access_sessions add column if not exists logout_at timestamptz;

create table if not exists snote_operator_private.service_events (
 service text not null check(service in('encar','vision','http')),
 request_id uuid not null,
 user_id uuid,
 company_id uuid,
 started_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 elapsed_ms integer not null check(elapsed_ms between 0 and 86400000),
 ok boolean not null,
 http_status integer not null check(http_status between 100 and 599),
 stage text not null check(stage in('request','validation','auth','membership','lookup','verification','not_found','complete','upload','provider','parse','response','blocked','exception')),
 ad_id text check(ad_id is null or ad_id ~ '^[0-9]{1,12}$'),
 request_bytes bigint check(request_bytes between 0 and 9007199254740991),
 response_bytes bigint check(response_bytes between 0 and 9007199254740991),
 endpoint text,
 method text,
 payload_hash text not null,
 primary key(service,request_id),
 check(service='http' or user_id is not null),
 check(service='encar' or ad_id is null),
 check(service='http' or (endpoint is null and method is null))
);
create index if not exists operator_service_event_time on snote_operator_private.service_events(service,started_at desc,request_id);
create index if not exists operator_service_event_recorded on snote_operator_private.service_events(recorded_at,service,request_id);
create index if not exists operator_service_event_user_time on snote_operator_private.service_events(user_id,started_at desc);
alter table snote_operator_private.service_events enable row level security;
revoke all on table snote_operator_private.service_events from public,anon,authenticated,service_role;
drop trigger if exists operator_service_event_immutable on snote_operator_private.service_events;
create trigger operator_service_event_immutable before update on snote_operator_private.service_events for each statement execute function snote_operator_private.immutable_audit();

-- A post-sign-out receipt is accepted only for an already observed session owned
-- by the signed JWT's subject, after Auth has removed that exact session. This
-- deliberately cannot use verified_session(), which requires a live session.
create or replace function snote_operator_private.access_logout_confirm()
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();s uuid;r snote_operator_private.access_sessions;
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' or a is null then raise exception 'SIGNED_SESSION_REQUIRED' using errcode='42501';end if;
 s:=snote_operator_private.claim_session();
 if not exists(select 1 from auth.users u where u.id=a and not coalesce(u.is_anonymous,false) and u.deleted_at is null) then raise exception 'SIGNED_SESSION_REQUIRED' using errcode='42501';end if;
 select * into r from snote_operator_private.access_sessions where session_id=s and user_id=a for update;
 if not found or exists(select 1 from auth.sessions where id=s) then raise exception 'SIGNED_OUT_SESSION_REQUIRED' using errcode='42501';end if;
 update snote_operator_private.access_sessions set logout_at=coalesce(logout_at,clock_timestamp()) where session_id=s and user_id=a returning * into r;
 return jsonb_build_object('ok',true,'sessionId',s,'logoutAt',r.logout_at);
end$$;

-- Bound this new metadata store without touching existing customer/Auth logs.
-- Cleanup is opportunistic, in batches, by trusted receipt time (not input time).
-- There is no cron or broad table grant; only ingestion's owner calls this helper.
create or replace function snote_operator_private.prune_service_events()
returns integer language plpgsql set search_path='' as $$
declare n integer:=0;
begin
 if pg_try_advisory_xact_lock(hashtextextended('snote-service-event-retention',0)) then
  with expired as(select service,request_id from snote_operator_private.service_events where recorded_at<clock_timestamp()-interval'90 days' order by recorded_at,service,request_id limit 100 for update skip locked)
  delete from snote_operator_private.service_events e using expired x where e.service=x.service and e.request_id=x.request_id;
  get diagnostics n=row_count;
 end if;
 return n;
end$$;

-- Every ingestion call is already authenticated by the Worker. Only the trusted
-- service role may invoke this entry point; browser claims cannot select actors.
create or replace function snote_operator_private.service_event(p_event jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k text;svc text;rid uuid;uid uuid;co uuid;at_time timestamptz;elapsed integer;status integer;
 rb bigint;sb bigint;ad text;ep text;meth text;h text;existing_hash text;members integer;
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'SERVER_ONLY' using errcode='42501';end if;
 if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>4096 then raise exception 'INVALID_EVENT' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_event) loop
  if k not in('userId','requestId','service','startedAt','elapsedMs','ok','httpStatus','stage','adId','requestBytes','responseBytes','endpoint','method') then raise exception 'INVALID_EVENT_FIELD' using errcode='22023';end if;
 end loop;
 if not(p_event ?& array['userId','requestId','service','startedAt','elapsedMs','ok','httpStatus','stage','adId','requestBytes','responseBytes']) then raise exception 'INCOMPLETE_EVENT' using errcode='22023';end if;
 svc:=p_event->>'service';
 if svc is null or svc not in('encar','vision','http') or jsonb_typeof(p_event->'ok') is distinct from 'boolean' then raise exception 'INVALID_EVENT' using errcode='22023';end if;
 if jsonb_typeof(p_event->'requestId') is distinct from 'string' or (p_event->>'requestId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_REQUEST_ID' using errcode='22023';end if;
 rid:=(p_event->>'requestId')::uuid;
 if p_event->>'userId' is not null then
  if jsonb_typeof(p_event->'userId') is distinct from 'string' or (p_event->>'userId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_ACTOR' using errcode='22023';end if;
  uid:=(p_event->>'userId')::uuid;
  if not exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=clock_timestamp()) and not exists(select 1 from snote_operator_private.account_state s where s.user_id=u.id and s.archived)) then raise exception 'ACTIVE_ACTOR_REQUIRED' using errcode='42501';end if;
  select count(*),min(m.company_id::text)::uuid into members,co from public.zc_members m where m.user_id=uid and m.active and m.role in('admin','dealer','accountant') and not exists(select 1 from snote_operator_private.company_state c where c.company_id=m.company_id and c.archived);
  if svc<>'http' and members=0 then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
  -- Multiple memberships cannot be attributed to a company without a verified
  -- request company. Never guess or accept a browser-supplied company identifier.
  if members<>1 then co:=null;end if;
 elsif svc<>'http' then raise exception 'ACTIVE_ACTOR_REQUIRED' using errcode='42501';end if;
 if jsonb_typeof(p_event->'startedAt') is distinct from 'string' or (p_event->>'startedAt')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID_EVENT_TIME' using errcode='22023';end if;
 begin at_time:=(p_event->>'startedAt')::timestamptz;exception when others then raise exception 'INVALID_EVENT_TIME' using errcode='22023';end;
 if not isfinite(at_time) or at_time>clock_timestamp()+interval'5 minutes' then raise exception 'INVALID_EVENT_TIME' using errcode='22023';end if;
 foreach k in array array['elapsedMs','httpStatus','requestBytes','responseBytes'] loop
  if p_event->>k is null then
   if k in('elapsedMs','httpStatus') then raise exception 'INVALID_EVENT_NUMBER' using errcode='22023';end if;
  elsif jsonb_typeof(p_event->k) is distinct from 'number' or (p_event->>k)!~'^[0-9]{1,16}$' or (p_event->>k)::numeric>9007199254740991 then raise exception 'INVALID_EVENT_NUMBER' using errcode='22023';end if;
 end loop;
 if (p_event->>'elapsedMs')::numeric>86400000 or (p_event->>'httpStatus')::numeric not between 100 and 599 then raise exception 'INVALID_EVENT_NUMBER' using errcode='22023';end if;
 elapsed:=(p_event->>'elapsedMs')::integer;status:=(p_event->>'httpStatus')::integer;rb:=(p_event->>'requestBytes')::bigint;sb:=(p_event->>'responseBytes')::bigint;
 if jsonb_typeof(p_event->'stage') is distinct from 'string' or p_event->>'stage' not in('request','validation','auth','membership','lookup','verification','not_found','complete','upload','provider','parse','response','blocked','exception') then raise exception 'INVALID_EVENT_STAGE' using errcode='22023';end if;
 ad:=p_event->>'adId';
 if ad is not null and (svc<>'encar' or p_event->>'ok'<>'true' or jsonb_typeof(p_event->'adId') is distinct from 'string' or ad!~'^[0-9]{1,12}$') then raise exception 'INVALID_AD_ID' using errcode='22023';end if;
 if svc='http' then
  ep:=p_event->>'endpoint';meth:=p_event->>'method';
  if ep is null or ep not in('/api/weather','/api/ocr','/api/encar','/api/encar-id','/api/encar-ad-price','/api/encar-auto-price','/api/customer-intake','/api/customer-identity','/api/registration','/api/income-settlement','/api/profile-phone','/api/document-mms','/api/operator','/api/vehicle-taxonomy-probe') or meth is null or meth not in('GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS') or p_event->>'stage' not in('response','exception') then raise exception 'INVALID_HTTP_EVENT' using errcode='22023';end if;
 elsif p_event ? 'endpoint' or p_event ? 'method' then raise exception 'INVALID_EVENT_FIELD' using errcode='22023';end if;
 h:=snote_operator_private.digest_json(p_event);
 insert into snote_operator_private.service_events(service,request_id,user_id,company_id,started_at,elapsed_ms,ok,http_status,stage,ad_id,request_bytes,response_bytes,endpoint,method,payload_hash)
 values(svc,rid,uid,co,at_time,elapsed,(p_event->>'ok')::boolean,status,p_event->>'stage',ad,rb,sb,ep,meth,h) on conflict(service,request_id) do nothing;
 select payload_hash into existing_hash from snote_operator_private.service_events where service=svc and request_id=rid;
 if existing_hash is distinct from h then raise exception 'EVENT_REQUEST_REUSED' using errcode='22023';end if;
 perform snote_operator_private.prune_service_events();
 return jsonb_build_object('ok',true,'requestId',rid);
end$$;

create or replace function snote_operator_private.safe_observed_bytes(p_value text)
returns bigint language sql immutable set search_path='' as $$
 select case when p_value ~ '^[0-9]{1,16}$' then case when p_value::numeric<=9007199254740991 then p_value::bigint end end;
$$;

-- No arbitrary user_metadata URL is used. Only a published private avatar for
-- the account's existing primary membership and its matching Storage object.
create or replace function snote_operator_private.account_avatar_metadata(p_user uuid)
returns jsonb language sql stable set search_path='' as $$
 select coalesce((select jsonb_build_object('userId',p_user,'companyId',a.company_id,'bucket','snote-profile-photos','path',a.file_path,'mimeType',o.metadata->>'mimetype','size',snote_operator_private.safe_observed_bytes(o.metadata->>'size'))
 from snote_private.profile_avatars a join storage.objects o on o.bucket_id='snote-profile-photos' and o.name=a.file_path
 where a.user_id=p_user and a.company_id=(select company_id from public.zc_members where user_id=p_user order by active desc,joined_at,company_id limit 1)
 and length(a.file_path)<=140 and a.file_path ~ ('^'||a.company_id::text||'/'||p_user::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
 and o.metadata->>'mimetype' in('image/jpeg','image/png','image/webp')
 and (snote_operator_private.safe_observed_bytes(o.metadata->>'size') is null or snote_operator_private.safe_observed_bytes(o.metadata->>'size')<=5242880)
 limit 1),jsonb_build_object('userId',p_user,'bucket',null,'path',null));
$$;
create or replace function snote_operator_private.account_avatar(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$begin
 perform snote_operator_private.actor();
 return snote_operator_private.account_avatar_metadata(p_user_id);
end$$;
create or replace function snote_operator_private.account_last_logout(p_user uuid)
returns timestamptz language sql stable set search_path='' as $$
 select max(at_time) from (
  select logout_at at_time from snote_operator_private.access_sessions where user_id=p_user and logout_at is not null
  union all select e.created_at from auth.audit_log_entries e where lower(coalesce(e.payload->>'action','')) in('logout','user_signed_out','sign_out') and lower(e.payload->>'actor_id')=p_user::text
 ) x;
$$;

-- Preserve account_snapshot/account_version and every CAS input unchanged.
-- Transient operator-only additions are attached after pagination/versioning.
create or replace function snote_operator_private.accounts_list(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;items jsonb;result jsonb;
begin
 q:=snote_operator_private.query_options(p_query,array['displayName','email','createdAt','lastSignInAt'],array['all','active','archived'],'displayName');
 select coalesce(jsonb_agg(s||jsonb_build_object('version',snote_operator_private.account_version((s->>'userId')::uuid))),'[]') into items from (select snote_operator_private.account_snapshot(id) s from auth.users) x
 where (q->>'status'='all' or q->>'status'='archived' and (s->>'archived')::boolean or q->>'status'='active' and (s->>'active')::boolean)
 and (nullif(q->>'companyId','') is null or exists(select 1 from jsonb_array_elements(s->'memberships') m where m->>'companyId'=q->>'companyId'))
 and (q->>'query'='' or lower(concat_ws(' ',s->>'email',s->>'displayName',s->>'phone',s->>'address',s->'memberships'::text)) like '%'||lower(q->>'query')||'%');
 result:=snote_operator_private.paginate(snote_operator_private.sort_items(items,q->>'sort',q->>'direction'),q);
 select coalesce(jsonb_agg(e.value||jsonb_build_object('passwordConfigured',coalesce(length(u.encrypted_password)>0,false),'lastSignOutAt',snote_operator_private.account_last_logout(u.id),'avatarAvailable',snote_operator_private.account_avatar_metadata(u.id)->>'path' is not null) order by e.n),'[]') into items
 from jsonb_array_elements(result->'items') with ordinality e(value,n) join auth.users u on u.id=(e.value->>'userId')::uuid;
 return jsonb_set(result,'{items}',items);
end$$;

create or replace function snote_operator_private.service_metric(p_key text,p_label text,p_value numeric,p_unit text,p_source text,p_at timestamptz,p_reason text default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('key',p_key,'label',p_label,'value',case when p_value between 0 and 9007199254740991 then p_value end,'unit',p_unit,'source',p_source,'asOf',p_at,'unavailableReason',case when p_value>9007199254740991 then '정확한 숫자 표시 범위를 초과했습니다.' else p_reason end);
$$;
create or replace function snote_operator_private.services(p_service text,p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;pg integer;term text;items jsonb;total bigint;metrics jsonb:='[]';notes jsonb:='[]';at_time timestamptz:=clock_timestamp();
 from_time timestamptz:=clock_timestamp()-interval'30 days';cnt bigint;fails bigint;submitted bigint;rb numeric;sb numeric;known_rb bigint;known_sb bigint;image_count bigint;image_known bigint;image_bytes numeric;k text;
begin
 if p_service is null or p_service not in('sms','encar','vision','server') then raise exception 'INVALID_SERVICE' using errcode='22023';end if;
 if p_query is null then p_query:='{}';end if;
 if jsonb_typeof(p_query)<>'object' or octet_length(p_query::text)>1000 then raise exception 'INVALID_QUERY' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_query) loop if k not in('page','query') then raise exception 'INVALID_QUERY_FIELD' using errcode='22023';end if;end loop;
 q:=snote_operator_private.query_options(p_query,array['createdAt'],array['all'],'createdAt');pg:=(q->>'page')::integer;term:=lower(q->>'query');
 if p_service='sms' then
  select count(*),count(*) filter(where delivery_status='sent'),count(*) filter(where submitted_at is not null) into cnt,known_rb,submitted from public.snote_customer_intake;
  metrics:=jsonb_build_array(snote_operator_private.service_metric('requests','보관 중인 고객 입력 문자 요청',cnt,'건','snote_customer_intake',at_time),snote_operator_private.service_metric('accepted','발송 제공자 접수',known_rb,'건','snote_customer_intake.delivery_status',at_time),snote_operator_private.service_metric('submitted','고객 제출 완료',submitted,'건','snote_customer_intake.submitted_at',at_time));
  with rows as (select i.id,i.created_at,i.owner_id user_id,i.company_id,i.car_snapshot->>'model' model,i.phone destination,i.delivery_status,i.submitted_at,i.expires_at,i.revoked_at,
   coalesce((select display_name from public.zc_members where user_id=i.owner_id and company_id=i.company_id limit 1),'') display_name,coalesce(u.email,'') email,coalesce(c.name,i.company_name,'') company_name
   from public.snote_customer_intake i left join auth.users u on u.id=i.owner_id left join public.zc_companies c on c.id=i.company_id), filtered as(select * from rows where term='' or lower(concat_ws(' ',display_name,email,company_name,model,destination,delivery_status)) like '%'||term||'%')
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'at',r.created_at,'userId',r.user_id,'displayName',r.display_name,'email',r.email,'companyId',r.company_id,'companyName',r.company_name,'model',r.model,'destination',r.destination,'type','customer_input','status',r.delivery_status,'success',r.delivery_status='sent','customerSubmittedAt',r.submitted_at,'expiresAt',r.expires_at,'revokedAt',r.revoked_at) order by r.created_at desc,r.id) from (select * from filtered order by created_at desc,id offset (pg-1)*20 limit 20) r),'[]') into total,items;
  notes:=jsonb_build_array('보관 중인 고객 입력 요청만 표시합니다. 삭제·만료 정리된 과거 기록과 다른 종류의 문자는 포함되지 않습니다.','발송 상태 sent는 문자 제공자의 접수 결과이며 통신사 최종 수신 확인이 아닙니다.');
 elsif p_service in('encar','vision') then
  select count(*),count(*) filter(where not ok),sum(request_bytes),count(request_bytes) into cnt,fails,rb,known_rb from snote_operator_private.service_events where service=p_service and started_at>=from_time;
  metrics:=jsonb_build_array(snote_operator_private.service_metric('requests','최근 30일 실제 API 실행',cnt,'건','service_events',at_time),snote_operator_private.service_metric('errors','최근 30일 실패',fails,'건','service_events',at_time));
  with rows as(select e.*,coalesce((select display_name from public.zc_members m where m.user_id=e.user_id and (e.company_id is null or m.company_id=e.company_id) order by active desc,joined_at,company_id limit 1),'') display_name,coalesce(u.email,'') email,coalesce(c.name,'') company_name from snote_operator_private.service_events e left join auth.users u on u.id=e.user_id left join public.zc_companies c on c.id=e.company_id where e.service=p_service and e.started_at>=from_time),filtered as(select * from rows where term='' or lower(concat_ws(' ',display_name,email,company_name,stage,ad_id)) like '%'||term||'%')
  select (select count(*) from filtered),coalesce((select jsonb_agg(jsonb_build_object('requestId',r.request_id,'at',r.started_at,'userId',r.user_id,'displayName',r.display_name,'email',r.email,'companyId',r.company_id,'companyName',r.company_name,'success',r.ok,'httpStatus',r.http_status,'elapsedMs',r.elapsed_ms,'stage',r.stage)||case when p_service='encar' then jsonb_build_object('adId',r.ad_id,'link',case when r.ad_id is not null then 'https://fem.encar.com/cars/detail/'||r.ad_id||'?listAdvType=share&adnm=mo_detail_url' end) else jsonb_build_object('imageBytes',r.request_bytes) end order by r.started_at desc,r.request_id) from (select * from filtered order by started_at desc,request_id offset (pg-1)*20 limit 20) r),'[]') into total,items;
  notes:=jsonb_build_array('최근 30일 서버에서 실제 관측한 실행만 표시합니다. 수집 적용 이전 사용량은 알 수 없습니다.','차량번호·차대번호·OCR 원문·검색 원본 주소는 수집하지 않습니다.');
 else
  select count(*),count(*) filter(where not ok),sum(request_bytes),sum(response_bytes),count(request_bytes),count(response_bytes) into cnt,fails,rb,sb,known_rb,known_sb from snote_operator_private.service_events where service='http' and started_at>=from_time;
  metrics:=jsonb_build_array(snote_operator_private.service_metric('requests','최근 30일 관측 API 요청',cnt,'건','service_events.http',at_time),snote_operator_private.service_metric('errors','최근 30일 API 오류',fails,'건','service_events.http',at_time),snote_operator_private.service_metric('response_bytes','확인된 API 응답 전송량',sb,'byte','service_events.http.response_bytes',at_time,case when known_sb=0 then '전송량 관측 기록이 없습니다.' end),snote_operator_private.service_metric('request_bytes','확인된 API 요청 전송량',rb,'byte','service_events.http.request_bytes',at_time,case when known_rb=0 then '요청 크기를 확인한 기록이 없습니다.' end));
  select count(*),count(snote_operator_private.safe_observed_bytes(metadata->>'size')),sum(snote_operator_private.safe_observed_bytes(metadata->>'size')) into image_count,image_known,image_bytes from storage.objects where metadata->>'mimetype' like 'image/%';
  metrics:=metrics||jsonb_build_array(snote_operator_private.service_metric('image_count','Storage 등록 이미지',image_count,'개','storage.objects.metadata',at_time),snote_operator_private.service_metric('image_bytes','Storage 이미지 크기',case when image_count=image_known then coalesce(image_bytes,0) end,'byte','storage.objects.metadata.size',at_time,case when image_count<>image_known then '일부 이미지의 서버 크기 메타데이터가 없어 전체 크기를 확정할 수 없습니다.' end));
  with groups as(select date_trunc('hour',started_at at time zone 'UTC') at time zone 'UTC' as hour_bucket,endpoint,method,count(*) count,count(*) filter(where not ok) errors,sum(response_bytes) bytes,sum(request_bytes) request_bytes,count(request_bytes) known_request_count,count(response_bytes) known_response_count from snote_operator_private.service_events where service='http' and started_at>=from_time and (term='' or lower(concat_ws(' ',endpoint,method)) like '%'||term||'%') group by 1,2,3)
  select (select count(*) from groups),coalesce((select jsonb_agg(jsonb_build_object('hour',r.hour_bucket,'endpoint',r.endpoint,'method',r.method,'count',r.count,'errors',r.errors,'bytes',case when r.bytes<=9007199254740991 then r.bytes end,'knownRequestBytes',case when r.request_bytes<=9007199254740991 then r.request_bytes end,'knownRequestCount',r.known_request_count,'knownResponseCount',r.known_response_count) order by r.hour_bucket desc,r.endpoint,r.method) from(select * from groups order by hour_bucket desc,endpoint,method offset (pg-1)*20 limit 20)r),'[]') into total,items;
  notes:=jsonb_build_array('최근 30일 이 앱의 지정 API 경로에서 관측한 요청만 집계합니다. 정적 파일·CDN·Cloudflare 전체 트래픽 또는 청구량이 아닙니다.','API 관측 기록은 서버 보호를 위해 수집량이 제한되거나 기록 실패로 일부 누락될 수 있습니다.','크기를 확인한 요청·응답만 합산합니다. 미확인 크기는 0으로 추정하지 않습니다. 새 관측 기록은 서버 수집 시점 기준 90일간 보관하며 새 기록 수집 시 오래된 기록을 최대 100개씩 정리합니다.','이미지 수·크기는 프로젝트 전체 Storage 객체의 image MIME 메타데이터 기준이며 실제 청구 사용량과 다를 수 있습니다.');
 end if;
 return jsonb_build_object('service',p_service,'checkedAt',at_time,'metrics',metrics,'items',items,'total',total,'page',pg,'pageSize',20,'notes',notes);
end$$;

create or replace function public.snote_operator_services(p_service text,p_query jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.services(p_service,p_query);$$;
create or replace function public.snote_service_event(p_event jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.service_event(p_event);$$;
create or replace function public.snote_operator_account_avatar(p_user_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.account_avatar(p_user_id);$$;
create or replace function public.snote_access_logout_confirm()
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.access_logout_confirm();$$;

-- Public wrappers are invokers. The few private definers are justified by their
-- access to Auth/private metadata and each performs an explicit context check.
revoke all on function snote_operator_private.prune_service_events(),snote_operator_private.safe_observed_bytes(text),snote_operator_private.account_avatar_metadata(uuid),snote_operator_private.account_last_logout(uuid),snote_operator_private.service_metric(text,text,numeric,text,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function snote_operator_private.service_event(jsonb),snote_operator_private.services(text,jsonb),snote_operator_private.account_avatar(uuid),snote_operator_private.access_logout_confirm() from public,anon,authenticated,service_role;
revoke all on function public.snote_service_event(jsonb),public.snote_operator_services(text,jsonb),public.snote_operator_account_avatar(uuid),public.snote_access_logout_confirm() from public,anon,authenticated,service_role;
grant execute on function snote_operator_private.service_event(jsonb),public.snote_service_event(jsonb) to service_role;
grant execute on function snote_operator_private.services(text,jsonb),public.snote_operator_services(text,jsonb),snote_operator_private.account_avatar(uuid),public.snote_operator_account_avatar(uuid),snote_operator_private.access_logout_confirm(),public.snote_access_logout_confirm() to authenticated;
notify pgrst,'reload schema';
commit;
