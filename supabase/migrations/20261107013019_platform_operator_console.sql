-- S-NOTE platform operators are explicit account allowlist entries, never tenant admins.
-- This migration intentionally grants no operator account. Provision only the user
-- explicitly authorized by the owner after validating their confirmed Auth identity.
begin;
create schema if not exists snote_operator_private;
revoke all on schema snote_operator_private from public,anon,authenticated,service_role;
create table if not exists snote_operator_private.operators(
 user_id uuid primary key references auth.users(id),active boolean not null default false,
 granted_at timestamptz not null default clock_timestamp(),granted_by uuid,reason text not null default ''
);
create table if not exists snote_operator_private.account_state(
 user_id uuid primary key references auth.users(id),archived boolean not null default false,
 previous_members jsonb not null default '[]',previous_operator boolean not null default false,
 archived_at timestamptz,archived_by uuid,revision bigint not null default 0
);
create table if not exists snote_operator_private.company_state(
 company_id uuid primary key references public.zc_companies(id),archived boolean not null default false,
 previous_members jsonb not null default '[]',archived_at timestamptz,archived_by uuid,revision bigint not null default 0
);
create table if not exists snote_operator_private.membership_archive_intent(
 user_id uuid not null,company_id uuid not null,was_active boolean not null,primary key(user_id,company_id)
);
create table if not exists snote_operator_private.requests(
 actor_id uuid not null,request_id uuid not null,action text not null,request_hash text not null,
 status text not null default 'prepared' check(status in('prepared','committed','aborted')),
 result jsonb,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists snote_operator_private.audit_log(
 id uuid primary key default gen_random_uuid(),actor_id uuid not null,session_id uuid not null,
 action text not null,subject text not null,company_id uuid,request_id uuid,
 before_data jsonb,after_data jsonb,created_at timestamptz not null default clock_timestamp()
);
create index if not exists operator_audit_actor_time on snote_operator_private.audit_log(actor_id,created_at desc);
create table if not exists snote_operator_private.transfer_jobs(
 actor_id uuid not null,request_id uuid not null,session_id uuid not null,mode text not null check(mode in('copy','move')),
 source jsonb not null,target jsonb not null,snapshot jsonb not null,media_plan jsonb not null,
 blockers jsonb not null default '[]',status text not null default 'prepared' check(status in('prepared','committed','aborted')),
 result jsonb,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists snote_operator_private.transfer_files(
 actor_id uuid not null,request_id uuid not null,file_path text primary key,source_path text not null,
 foreign key(actor_id,request_id) references snote_operator_private.transfer_jobs(actor_id,request_id)
);
create table if not exists snote_operator_private.auth_jobs(
 actor_id uuid not null,request_id uuid not null,session_id uuid not null,user_id uuid not null,
 fingerprint text not null,expected_version text not null,fields text[] not null,email text,status text not null default 'prepared'
 check(status in('prepared','committed','failed')),result jsonb,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);

create or replace function snote_operator_private.digest_json(p_value jsonb)
returns text language sql immutable strict set search_path='' as $$select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')$$;
create or replace function snote_operator_private.claim_session()
returns uuid language plpgsql stable set search_path='' as $$
declare v text:=auth.jwt()->>'session_id';
begin
 if v is null or v!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'ACTIVE_SESSION_REQUIRED' using errcode='42501';end if;
 return v::uuid;
end$$;
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
create or replace function snote_operator_private.require_operator(p_actor uuid,p_session uuid)
returns uuid language plpgsql set search_path='' as $$
begin
 perform 1 from snote_operator_private.verified_session(p_actor,p_session);
 perform 1 from snote_operator_private.operators where user_id=p_actor and active for share;
 if not found then raise exception 'PLATFORM_OPERATOR_REQUIRED' using errcode='42501';end if;
 return p_actor;
end$$;
create or replace function snote_operator_private.actor()
returns uuid language plpgsql set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' then raise exception 'PLATFORM_OPERATOR_REQUIRED' using errcode='42501';end if;
 return snote_operator_private.require_operator(auth.uid(),snote_operator_private.claim_session());
end$$;
create or replace function snote_operator_private.server_actor(p_actor uuid,p_session uuid)
returns uuid language plpgsql set search_path='' as $$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'SERVER_ONLY' using errcode='42501';end if;
 return snote_operator_private.require_operator(p_actor,p_session);
end$$;
create or replace function snote_operator_private.context()
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid;s uuid;e text;
begin
 a:=snote_operator_private.actor();s:=snote_operator_private.claim_session();select email into e from auth.users where id=a;
 return jsonb_build_object('allowed',true,'actorId',a,'sessionId',s,'email',e);
exception when insufficient_privilege then return jsonb_build_object('allowed',false);
end$$;
create or replace function snote_operator_private.immutable_audit()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'AUDIT_IS_IMMUTABLE' using errcode='55000';end$$;
drop trigger if exists operator_audit_immutable on snote_operator_private.audit_log;
create trigger operator_audit_immutable before update or delete or truncate on snote_operator_private.audit_log for each statement execute function snote_operator_private.immutable_audit();
create or replace function snote_operator_private.log(p_actor uuid,p_session uuid,p_action text,p_subject text,p_company uuid,p_request uuid,p_before jsonb,p_after jsonb)
returns void language sql set search_path='' as $$insert into snote_operator_private.audit_log(actor_id,session_id,action,subject,company_id,request_id,before_data,after_data) values(p_actor,p_session,p_action,p_subject,p_company,p_request,p_before,p_after)$$;
create or replace function snote_operator_private.begin_request(p_actor uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r snote_operator_private.requests;h text:=snote_operator_private.digest_json(p_payload);
begin
 if p_request is null then raise exception 'REQUEST_ID_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-operator-request:'||p_actor::text||':'||p_request::text,0));
 select * into r from snote_operator_private.requests where actor_id=p_actor and request_id=p_request for update;
 if found then
  if r.action<>p_action or r.request_hash<>h then raise exception 'REQUEST_ID_REUSED' using errcode='22023';end if;
  if r.status='aborted' then raise exception 'REQUEST_ABORTED' using errcode='22023';end if;
  if r.status='committed' then return r.result;end if;
 else insert into snote_operator_private.requests(actor_id,request_id,action,request_hash) values(p_actor,p_request,p_action,h);end if;
 return null;
end$$;
create or replace function snote_operator_private.complete_request(p_actor uuid,p_request uuid,p_result jsonb)
returns jsonb language plpgsql set search_path='' as $$begin
 update snote_operator_private.requests set status='committed',result=p_result where actor_id=p_actor and request_id=p_request and status='prepared';
 if not found then raise exception 'REQUEST_NOT_PREPARED' using errcode='55000';end if;return p_result;
end$$;
create or replace function snote_operator_private.block_archived_member()
returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.active and (exists(select 1 from snote_operator_private.account_state where user_id=new.user_id and archived) or exists(select 1 from snote_operator_private.company_state where company_id=new.company_id and archived)) then raise exception 'ARCHIVED_ACCOUNT_OR_COMPANY' using errcode='42501';end if;
 return new;
end$$;
drop trigger if exists snote_operator_archived_member_guard on public.zc_members;
create trigger snote_operator_archived_member_guard before insert or update on public.zc_members for each row execute function snote_operator_private.block_archived_member();
create or replace function snote_operator_private.alias(p_user uuid)
returns text language sql immutable strict set search_path='' as $$select 'cld_'||left(replace(p_user::text,'-',''),18)$$;
create or replace function snote_operator_private.safe_vehicle(p_car jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(p_car)
 where key=any(array['id','ownerId','model','make','group','generation','grade','subgrade','taxonomyCatalogRef','plate','year','vin','buy','sell','soldPrice','soldAt','inventoryLoan','inventoryLender','inventoryInterest','color','km','purchaseAt','status','moneyUnit','costs','customCosts','customCostLabels','repairItems','emoji','extra']);
$$;
create or replace function snote_operator_private.query_options(p_query jsonb,p_sorts text[],p_statuses text[],p_default_sort text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb:=coalesce(p_query,'{}');k text;pg integer;st text;dr text;sortkey text;
begin
 if jsonb_typeof(v)<>'object' or octet_length(v::text)>4000 then raise exception 'INVALID_QUERY' using errcode='22023';end if;
 for k in select jsonb_object_keys(v) loop if k not in('query','page','sort','direction','status','companyId','ownerId') then raise exception 'INVALID_QUERY_FIELD' using errcode='22023';end if;end loop;
 if coalesce(v->>'page','1')!~'^[1-9][0-9]{0,5}$' then raise exception 'INVALID_PAGE' using errcode='22023';end if;pg:=(coalesce(v->>'page','1'))::integer;
 st:=coalesce(v->>'status','all');dr:=coalesce(v->>'direction','desc');sortkey:=coalesce(v->>'sort',p_default_sort);
 if not(st=any(p_statuses)) or not(sortkey=any(p_sorts)) or dr not in('asc','desc') or length(coalesce(v->>'query',''))>120 then raise exception 'INVALID_QUERY' using errcode='22023';end if;
 foreach k in array array['companyId','ownerId'] loop if v->>k is not null and v->>k<>'' and v->>k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_QUERY_SCOPE' using errcode='22023';end if;end loop;
 return v||jsonb_build_object('page',pg,'status',st,'sort',sortkey,'direction',dr,'query',btrim(coalesce(v->>'query','')));
end$$;
create or replace function snote_operator_private.paginate(p_items jsonb,p_query jsonb)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('items',coalesce((select jsonb_agg(value order by ordinal) from jsonb_array_elements(p_items) with ordinality e(value,ordinal) where ordinal>((p_query->>'page')::integer-1)*20 and ordinal<=(p_query->>'page')::integer*20),'[]'::jsonb),'total',jsonb_array_length(p_items),'page',(p_query->>'page')::integer,'pageSize',20);
$$;
create or replace function snote_operator_private.sort_items(p_items jsonb,p_sort text,p_direction text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb;d text:=case when p_direction='asc' then 'asc' else 'desc' end;
begin
 execute format($q$select coalesce(jsonb_agg(value order by
 case when $2 in('buy','sell') and coalesce(value#>>array['vehicle',$2],'')~'^-?[0-9]+([.][0-9]+)?$' then (value#>>array['vehicle',$2])::numeric*case when value#>>'{vehicle,moneyUnit}'='KRW' then 1 else 10000 end
 when jsonb_typeof(value->$2)='number' then (value->>$2)::numeric end %s nulls last,
 coalesce(value->>$2,value#>>array['vehicle',$2],'') %s,
 coalesce(value->>'carId',value->>'userId',value->>'companyId',value->>'sessionId','')),'[]') from jsonb_array_elements($1) e(value)$q$,d,d) into r using p_items,p_sort;
 return r;
end$$;
create or replace function snote_operator_private.account_snapshot(p_user uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('userId',u.id,'email',coalesce(u.email,''),'displayName',coalesce((select display_name from public.zc_members where user_id=u.id order by active desc,joined_at,company_id limit 1),u.raw_user_meta_data->>'display_name',u.raw_user_meta_data->>'name',''),
 'phone',coalesce(p.phone,(select phone from public.zc_members where user_id=u.id order by active desc,joined_at limit 1),''),'address',coalesce(p.address,''),
 'memberships',coalesce((select jsonb_agg(jsonb_build_object('companyId',m.company_id,'companyName',c.name,'role',m.role,'active',m.active) order by m.company_id) from public.zc_members m join public.zc_companies c on c.id=m.company_id where m.user_id=u.id),'[]'),
 'active',u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()) and not coalesce(a.archived,false),
 'archived',coalesce(a.archived,false),'authUpdatedAt',u.updated_at,'bannedUntil',u.banned_until,'deletedAt',u.deleted_at,'createdAt',u.created_at,'lastSignInAt',u.last_sign_in_at,'profileRevision',coalesce(p.revision,0),'stateRevision',coalesce(a.revision,0))
 from auth.users u left join snote_private.member_profiles p on p.user_id=u.id left join snote_operator_private.account_state a on a.user_id=u.id where u.id=p_user;
$$;
create or replace function snote_operator_private.account_version(p_user uuid)
returns text language sql stable set search_path='' as $$select snote_operator_private.digest_json(snote_operator_private.account_snapshot(p_user)-'lastSignInAt')$$;
create or replace function snote_operator_private.company_snapshot(p_company uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('companyId',c.id,'name',c.name,'businessNumber',c.business_number,'representativeName',c.representative_name,'businessPhone',c.business_phone,'postcode',c.business_postcode,'address',c.business_address,'addressDetail',c.business_address_detail,'active',not coalesce(s.archived,false),'archived',coalesce(s.archived,false),'createdAt',c.created_at,'stateRevision',coalesce(s.revision,0),
 'memberCount',(select count(*) from public.zc_members m where m.company_id=c.id),'vehicleCount',(select coalesce(sum(jsonb_array_length(case when jsonb_typeof(d.payload)='array' then d.payload else '[]' end)),0) from public.zc_datasets d where d.company_id=c.id and d.dataset='cars'))
 from public.zc_companies c left join snote_operator_private.company_state s on s.company_id=c.id where c.id=p_company;
$$;
create or replace function snote_operator_private.company_version(p_company uuid)
returns text language sql stable set search_path='' as $$select snote_operator_private.digest_json(snote_operator_private.company_snapshot(p_company)-'memberCount'-'vehicleCount')$$;
create or replace function snote_operator_private.accounts_list(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;items jsonb;
begin
 q:=snote_operator_private.query_options(p_query,array['displayName','email','createdAt','lastSignInAt'],array['all','active','archived'],'displayName');
 select coalesce(jsonb_agg(s||jsonb_build_object('version',snote_operator_private.account_version((s->>'userId')::uuid))),'[]') into items from (select snote_operator_private.account_snapshot(id) s from auth.users) x
 where (q->>'status'='all' or q->>'status'='archived' and (s->>'archived')::boolean or q->>'status'='active' and (s->>'active')::boolean)
 and (nullif(q->>'companyId','') is null or exists(select 1 from jsonb_array_elements(s->'memberships') m where m->>'companyId'=q->>'companyId'))
 and (q->>'query'='' or lower(concat_ws(' ',s->>'email',s->>'displayName',s->>'phone',s->>'address',s->'memberships'::text)) like '%'||lower(q->>'query')||'%');
 return snote_operator_private.paginate(snote_operator_private.sort_items(items,q->>'sort',q->>'direction'),q);
end$$;
create or replace function snote_operator_private.companies_list(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;items jsonb;
begin
 q:=snote_operator_private.query_options(p_query,array['name','memberCount','vehicleCount','createdAt'],array['all','active','archived'],'name');
 select coalesce(jsonb_agg(s||jsonb_build_object('version',snote_operator_private.company_version((s->>'companyId')::uuid))),'[]') into items from (select snote_operator_private.company_snapshot(id) s from public.zc_companies) x
 where (q->>'status'='all' or q->>'status'='archived' and (s->>'archived')::boolean or q->>'status'='active' and (s->>'active')::boolean)
 and (q->>'query'='' or lower(concat_ws(' ',s->>'name',s->>'businessNumber',s->>'representativeName',s->>'businessPhone',s->>'address')) like '%'||lower(q->>'query')||'%');
 return snote_operator_private.paginate(snote_operator_private.sort_items(items,q->>'sort',q->>'direction'),q);
end$$;
create or replace function snote_operator_private.vehicles_list(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();q jsonb;items jsonb;
begin
 q:=snote_operator_private.query_options(p_query,array['model','plate','companyName','ownerName','status','buy','sell','updatedAt'],array['all','inventory','sold','archived'],'model');
 with rows as (
 select d.company_id,d.owner_id,c.car,d.revision,coalesce(cd.revision,0) covers_revision,d.updated_at,null::uuid recycle_id
 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]' end)c(car)
 left join public.zc_datasets cd on cd.company_id=d.company_id and cd.owner_id=d.owner_id and cd.dataset='covers'
 where d.dataset='cars' and q->>'status'<>'archived'
 union all
 select r.company_id,r.owner_id,r.snapshot->'car',coalesce(d.revision,0),coalesce(cd.revision,0),r.deleted_at,r.id
 from snote_private.recycle_bin r left join public.zc_datasets d on d.company_id=r.company_id and d.owner_id=r.owner_id and d.dataset='cars'
 left join public.zc_datasets cd on cd.company_id=r.company_id and cd.owner_id=r.owner_id and cd.dataset='covers'
 where r.kind='vehicle' and r.restored_at is null and q->>'status'='archived'
 ) select coalesce(jsonb_agg(jsonb_build_object('companyId',r.company_id,'companyName',coalesce(co.name,''),'ownerId',r.owner_id,'ownerName',coalesce(m.display_name,u.email,''),'carId',r.car->>'id','vehicle',snote_operator_private.safe_vehicle(r.car),'revision',r.revision,'coversRevision',r.covers_revision,'updatedAt',r.updated_at,'recycleId',r.recycle_id,'mediaCount',(select count(*) from public.zc_media where company_id=r.company_id and car_id=r.car->>'id'),'hasCustomer',exists(select 1 from public.zc_customers where company_id=r.company_id and car_id=r.car->>'id'))),'[]') into items
 from rows r left join public.zc_companies co on co.id=r.company_id left join public.zc_members m on m.user_id=r.owner_id and m.company_id=r.company_id left join auth.users u on u.id=r.owner_id
 where (q->>'status' in('all','archived') or q->>'status'='sold' and r.car->>'status'='판매완료' or q->>'status'='inventory' and coalesce(r.car->>'status','')<>'판매완료')
 and (nullif(q->>'companyId','') is null or r.company_id::text=q->>'companyId') and(nullif(q->>'ownerId','') is null or r.owner_id::text=q->>'ownerId')
 and (q->>'query'='' or lower(concat_ws(' ',r.car->>'model',r.car->>'make',r.car->>'plate',r.car->>'vin',co.name,m.display_name,u.email)) like '%'||lower(q->>'query')||'%');
 return snote_operator_private.paginate(snote_operator_private.sort_items(items,q->>'sort',q->>'direction'),q);
end$$;
create or replace function snote_operator_private.account_save(p_user uuid,p_expected text,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();b jsonb;r jsonb;k text;v text;cid uuid;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'account_save',jsonb_build_array(p_user,p_expected,p_patch));if r is not null then return r;end if;
 perform 1 from auth.users where id=p_user for update;if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='22023';end if;
 perform 1 from public.zc_members where user_id=p_user order by company_id for update;
 perform 1 from snote_private.member_profiles where user_id=p_user for update;
 b:=snote_operator_private.account_snapshot(p_user);if p_expected is distinct from snote_operator_private.account_version(p_user) then raise exception 'CONFLICT' using errcode='40001';end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>4000 then raise exception 'INVALID_PATCH' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_patch) loop if k not in('displayName','phone','address','companyId','role') or jsonb_typeof(p_patch->k)<>'string' then raise exception 'INVALID_PATCH_FIELD' using errcode='22023';end if;end loop;
 if p_patch?'companyId' then
  begin cid:=nullif(p_patch->>'companyId','')::uuid;exception when invalid_text_representation then raise exception 'INVALID_COMPANY' using errcode='22023';end;
  if cid is not null and not exists(select 1 from public.zc_members where user_id=p_user and company_id=cid) then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode='22023';end if;
 end if;
 if p_patch?'role' then
  if cid is null or p_patch->>'role' not in('admin','dealer','accountant') then raise exception 'INVALID_ROLE' using errcode='22023';end if;
  update public.zc_members set role=p_patch->>'role' where user_id=p_user and company_id=cid;
 end if;
 if p_patch?'displayName' then
  v:=btrim(p_patch->>'displayName');if length(v) not between 1 and 40 then raise exception 'INVALID_NAME' using errcode='22023';end if;
  update public.zc_members set display_name=v where user_id=p_user and (cid is null or company_id=cid);
  -- Auth metadata is not authorization. Preserve unassigned accounts' display
  -- name until they receive a membership; no password/email/auth state changes.
  if not found then update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||jsonb_build_object('display_name',v) where id=p_user;end if;
 end if;
 if p_patch?'phone' then
  v:=regexp_replace(p_patch->>'phone','[^0-9]','','g');if v!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' then raise exception 'INVALID_PHONE' using errcode='22023';end if;
  insert into snote_private.member_profiles(user_id,phone,address,revision) values(p_user,v,coalesce(p_patch->>'address',b->>'address',''),1)
  on conflict(user_id) do update set phone=excluded.phone,revision=member_profiles.revision+1,updated_at=clock_timestamp();
  update public.zc_members set phone=v where user_id=p_user;
 end if;
 if p_patch?'address' then
  v:=btrim(p_patch->>'address');if length(v)>300 then raise exception 'INVALID_ADDRESS' using errcode='22023';end if;
  if exists(select 1 from snote_private.member_profiles where user_id=p_user) then update snote_private.member_profiles set address=v,revision=revision+1,updated_at=clock_timestamp() where user_id=p_user;
  else
   if coalesce(b->>'phone','')!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' then raise exception 'PHONE_REQUIRED' using errcode='22023';end if;
   insert into snote_private.member_profiles(user_id,phone,address) values(p_user,b->>'phone',v);
  end if;
 end if;
 r:=snote_operator_private.account_snapshot(p_user)||jsonb_build_object('version',snote_operator_private.account_version(p_user));
 perform snote_operator_private.log(a,s,'account_save',p_user::text,cid,p_request_id,b,r);
 return snote_operator_private.complete_request(a,p_request_id,jsonb_build_object('ok',true,'account',r));
end$$;
create or replace function snote_operator_private.account_state(p_user uuid,p_expected text,p_active boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();b jsonb;r jsonb;st snote_operator_private.account_state;n integer;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'account_state',jsonb_build_array(p_user,p_expected,p_active));if r is not null then return r;end if;
 if p_active is null then raise exception 'INVALID_STATE' using errcode='22023';end if;
 perform pg_advisory_xact_lock(20261107,8401);
 perform 1 from auth.users where id=p_user for update;if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='22023';end if;
 perform 1 from public.zc_members where user_id=p_user order by company_id for update;
 b:=snote_operator_private.account_snapshot(p_user);if p_expected is distinct from snote_operator_private.account_version(p_user) then raise exception 'CONFLICT' using errcode='40001';end if;
 insert into snote_operator_private.account_state(user_id) values(p_user) on conflict do nothing;
 select * into st from snote_operator_private.account_state where user_id=p_user for update;
 if not p_active and not st.archived then
  if p_user=a then raise exception 'CANNOT_ARCHIVE_SELF' using errcode='42501';end if;
  if exists(select 1 from snote_operator_private.operators where user_id=p_user and active) and(select count(*) from snote_operator_private.operators o join auth.users u on u.id=o.user_id where o.active and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and not exists(select 1 from snote_operator_private.account_state x where x.user_id=o.user_id and x.archived))<=1 then raise exception 'LAST_OPERATOR_REQUIRED' using errcode='42501';end if;
  update snote_operator_private.account_state set archived=true,archived_at=clock_timestamp(),archived_by=a,revision=revision+1,
   previous_members=coalesce((select jsonb_agg(jsonb_build_object('companyId',company_id,'active',active)) from public.zc_members where user_id=p_user),'[]'),previous_operator=exists(select 1 from snote_operator_private.operators where user_id=p_user and active) where user_id=p_user;
  insert into snote_operator_private.membership_archive_intent(user_id,company_id,was_active) select user_id,company_id,active from public.zc_members where user_id=p_user on conflict do nothing;
  update public.zc_members set active=false where user_id=p_user;
  update snote_operator_private.operators set active=false where user_id=p_user;
  delete from auth.sessions where user_id=p_user;get diagnostics n=row_count;
 elsif p_active and st.archived then
  update snote_operator_private.account_state set archived=false,revision=revision+1 where user_id=p_user;
  update public.zc_members m set active=i.was_active from snote_operator_private.membership_archive_intent i where m.user_id=p_user and i.user_id=m.user_id and i.company_id=m.company_id and not exists(select 1 from snote_operator_private.company_state where company_id=m.company_id and archived);
  delete from snote_operator_private.membership_archive_intent i where i.user_id=p_user and not exists(select 1 from snote_operator_private.company_state where company_id=i.company_id and archived);
  if st.previous_operator then update snote_operator_private.operators set active=true where user_id=p_user;end if;
 end if;
 r:=snote_operator_private.account_snapshot(p_user)||jsonb_build_object('version',snote_operator_private.account_version(p_user));
 perform snote_operator_private.log(a,s,case when p_active then 'account_restore' else 'account_archive' end,p_user::text,null,p_request_id,b,r);
 return snote_operator_private.complete_request(a,p_request_id,jsonb_build_object('ok',true,'account',r,'revokedSessions',coalesce(n,0)));
end$$;
create or replace function snote_operator_private.company_save(p_company uuid,p_expected text,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();b jsonb;r jsonb;k text;v text;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'company_save',jsonb_build_array(p_company,p_expected,p_patch));if r is not null then return r;end if;
 perform 1 from public.zc_companies where id=p_company for update;if not found then raise exception 'COMPANY_NOT_FOUND' using errcode='22023';end if;
 b:=snote_operator_private.company_snapshot(p_company);if p_expected is distinct from snote_operator_private.company_version(p_company) then raise exception 'CONFLICT' using errcode='40001';end if;
 if p_patch is null or jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>4000 then raise exception 'INVALID_PATCH' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_patch) loop
  if k not in('name','businessNumber','representativeName','businessPhone','postcode','address','addressDetail') or jsonb_typeof(p_patch->k)<>'string' then raise exception 'INVALID_PATCH_FIELD' using errcode='22023';end if;
  v:=btrim(p_patch->>k);if length(v)>(case when k in('address','addressDetail') then 200 when k='name' then 100 else 50 end) or k='name' and length(v)<2 or k='postcode' and v<>'' and v!~'^[0-9]{5}$' then raise exception 'INVALID_COMPANY_FIELD' using errcode='22023';end if;
 end loop;
 update public.zc_companies set name=coalesce(p_patch->>'name',name),business_number=coalesce(p_patch->>'businessNumber',business_number),representative_name=coalesce(p_patch->>'representativeName',representative_name),business_phone=coalesce(p_patch->>'businessPhone',business_phone),business_postcode=coalesce(p_patch->>'postcode',business_postcode),business_address=coalesce(p_patch->>'address',business_address),business_address_detail=coalesce(p_patch->>'addressDetail',business_address_detail) where id=p_company;
 r:=snote_operator_private.company_snapshot(p_company)||jsonb_build_object('version',snote_operator_private.company_version(p_company));
 perform snote_operator_private.log(a,s,'company_save',p_company::text,p_company,p_request_id,b,r);
 return snote_operator_private.complete_request(a,p_request_id,jsonb_build_object('ok',true,'company',r));
end$$;
create or replace function snote_operator_private.company_state(p_company uuid,p_expected text,p_active boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();b jsonb;r jsonb;st snote_operator_private.company_state;n integer;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'company_state',jsonb_build_array(p_company,p_expected,p_active));if r is not null then return r;end if;
 if p_active is null then raise exception 'INVALID_STATE' using errcode='22023';end if;
 perform 1 from public.zc_companies where id=p_company for update;if not found then raise exception 'COMPANY_NOT_FOUND' using errcode='22023';end if;
 perform 1 from public.zc_members where company_id=p_company order by user_id for update;
 b:=snote_operator_private.company_snapshot(p_company);if p_expected is distinct from snote_operator_private.company_version(p_company) then raise exception 'CONFLICT' using errcode='40001';end if;
 insert into snote_operator_private.company_state(company_id) values(p_company) on conflict do nothing;
 select * into st from snote_operator_private.company_state where company_id=p_company for update;
 if not p_active and not st.archived then
  update snote_operator_private.company_state set archived=true,archived_at=clock_timestamp(),archived_by=a,revision=revision+1,previous_members=coalesce((select jsonb_agg(jsonb_build_object('userId',user_id,'active',active)) from public.zc_members where company_id=p_company),'[]') where company_id=p_company;
  insert into snote_operator_private.membership_archive_intent(user_id,company_id,was_active) select user_id,company_id,active from public.zc_members where company_id=p_company on conflict do nothing;
  update public.zc_members set active=false where company_id=p_company;
  delete from auth.sessions where user_id in(select user_id from public.zc_members where company_id=p_company);get diagnostics n=row_count;
 elsif p_active and st.archived then
  update snote_operator_private.company_state set archived=false,revision=revision+1 where company_id=p_company;
  update public.zc_members m set active=i.was_active from snote_operator_private.membership_archive_intent i where m.company_id=p_company and i.user_id=m.user_id and i.company_id=m.company_id and not exists(select 1 from snote_operator_private.account_state where user_id=m.user_id and archived);
  delete from snote_operator_private.membership_archive_intent i where i.company_id=p_company and not exists(select 1 from snote_operator_private.account_state where user_id=i.user_id and archived);
 end if;
 r:=snote_operator_private.company_snapshot(p_company)||jsonb_build_object('version',snote_operator_private.company_version(p_company));
 perform snote_operator_private.log(a,s,case when p_active then 'company_restore' else 'company_archive' end,p_company::text,p_company,p_request_id,b,r);
 return snote_operator_private.complete_request(a,p_request_id,jsonb_build_object('ok',true,'company',r,'revokedSessions',coalesce(n,0)));
end$$;
create or replace function snote_operator_private.vehicle_read(p_actor uuid,p_session uuid,p_company uuid,p_owner uuid,p_car_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);c jsonb;d public.zc_datasets;cd public.zc_datasets;files jsonb;
begin
 c:=snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car';
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars';
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers';
 select coalesce(jsonb_agg(to_jsonb(m) order by m.owner_id,m.id),'[]') into files from public.zc_media m where company_id=p_company and car_id=p_car_id and group_name in('photos','registration','inspection1','inspection2');
 return jsonb_build_object('companyId',p_company,'ownerId',p_owner,'carId',p_car_id,'vehicle',c,'revision',d.revision,'coversRevision',coalesce(cd.revision,0),'media',files);
end$$;
create or replace function snote_operator_private.cipher_map(p_value jsonb,p_path text default '')
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb:='{}';e record;i integer:=0;
begin
 if jsonb_typeof(p_value)='string' and (p_value#>>'{}')~'^(smi1|isi1)[.]' then return jsonb_build_object(p_path,p_value);end if;
 if jsonb_typeof(p_value)='object' then for e in select * from jsonb_each(p_value) loop r:=r||snote_operator_private.cipher_map(e.value,p_path||'/'||replace(replace(e.key,'~','~0'),'/','~1'));end loop;
 elsif jsonb_typeof(p_value)='array' then for e in select value from jsonb_array_elements(p_value) loop r:=r||snote_operator_private.cipher_map(e.value,p_path||'/'||i::text);i:=i+1;end loop;end if;
 return r;
end$$;
create or replace function snote_operator_private.validate_custom_costs(p_vehicle jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare k text;e record;n numeric;
begin
 foreach k in array array['customCosts','customCostLabels'] loop
  if not(p_vehicle?k) then continue;end if;
  if jsonb_typeof(p_vehicle->k)<>'object' or (select count(*) from jsonb_object_keys(p_vehicle->k))>128 then raise exception 'INVALID_CUSTOM_COSTS' using errcode='22023';end if;
  for e in select * from jsonb_each(p_vehicle->k) loop
   if e.key!~*'^custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_CUSTOM_COST_KEY' using errcode='22023';end if;
   if k='customCosts' then
    if jsonb_typeof(e.value)<>'number' then raise exception 'INVALID_CUSTOM_COST_AMOUNT' using errcode='22023';end if;
    n:=(e.value#>>'{}')::numeric;if n<>trunc(n) or n not between 0 and 1000000000000 then raise exception 'INVALID_CUSTOM_COST_AMOUNT' using errcode='22023';end if;
   elsif jsonb_typeof(e.value)<>'string' or length(btrim(e.value#>>'{}')) not between 1 and 24 then raise exception 'INVALID_CUSTOM_COST_LABEL' using errcode='22023';end if;
  end loop;
 end loop;
end$$;
create or replace function snote_operator_private.vehicle_save(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_vehicle jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();d public.zc_datasets;c jsonb;r jsonb;k text;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'vehicle_save',jsonb_build_array(p_company,p_owner,p_car_id,p_expected,p_vehicle));if r is not null then return r;end if;
 perform snote_private.recycle_lock(p_company);
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if not found or p_expected is distinct from d.revision then raise exception 'CONFLICT' using errcode='40001';end if;
 c:=snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car';
 if p_vehicle is null or jsonb_typeof(p_vehicle)<>'object' or octet_length(p_vehicle::text)>500000 or p_vehicle->>'id' is distinct from c->>'id' or p_vehicle->'ownerId' is distinct from c->'ownerId' or p_vehicle->>'moneyUnit' is distinct from 'KRW' then raise exception 'INVALID_VEHICLE' using errcode='22023';end if;
 perform snote_operator_private.validate_custom_costs(p_vehicle);
 if exists(select 1 from jsonb_object_keys(c) key where not(p_vehicle?key)) or snote_operator_private.cipher_map(c) is distinct from snote_operator_private.cipher_map(p_vehicle) then raise exception 'PRESERVE_PRIVATE_VEHICLE_FIELDS' using errcode='22023';end if;
 foreach k in array array['buy','sell','soldPrice','inventoryLoan'] loop if p_vehicle?k and (jsonb_typeof(p_vehicle->k)<>'number' or(p_vehicle->>k)::numeric not between 0 and 9007199254740991) then raise exception 'INVALID_MONEY' using errcode='22023';end if;end loop;
 update public.zc_datasets set payload=(select jsonb_agg(case when x->>'id'=p_car_id then p_vehicle else x end order by ordinal) from jsonb_array_elements(d.payload) with ordinality e(x,ordinal)),revision=revision+1,updated_by=a,updated_at=clock_timestamp() where company_id=p_company and owner_id=p_owner and dataset='cars' returning revision into p_expected;
 perform snote_operator_private.log(a,s,'vehicle_save',p_car_id,p_company,p_request_id,snote_operator_private.safe_vehicle(c),snote_operator_private.safe_vehicle(p_vehicle));
 return snote_operator_private.complete_request(a,p_request_id,jsonb_build_object('ok',true,'vehicle',snote_operator_private.safe_vehicle(p_vehicle),'revision',p_expected));
end$$;

-- Same archival/restore collision and byte-retention logic, entered only after
-- a platform capability check; original tenant RPC membership guards stay intact.
create or replace function snote_operator_private.recycle_trash_vehicle(p_actor uuid,p_session uuid,p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_expected_covers integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;d public.zc_datasets;cd public.zc_datasets;car jsonb;customers jsonb;rrns jsonb;files jsonb;v_id uuid;v_hash text;v_replay jsonb;v_flag text;v_cover boolean;
begin
 perform snote_operator_private.require_operator(p_actor,p_session);m.user_id:=p_actor;m.role:='admin';m.company_id:=p_company;if p_owner is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;perform snote_private.recycle_lock(p_company);
 if p_request_id is null or p_car_id is null or length(p_car_id) not between 1 and 200 or p_expected is null or p_expected<1 or p_expected_covers is null or p_expected_covers<0 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_hash:=md5(jsonb_build_array('vehicle',p_owner,p_car_id,p_expected,p_expected_covers)::text);
 perform 1 from public.snote_customer_intake where company_id=p_company and car_id=p_car_id order by id for update;
 car:=snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car';
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if d.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers' for update;
 if coalesce(cd.revision,0)<>p_expected_covers then raise exception 'CONFLICT' using errcode='40001';end if;
 if cd.payload is not null and jsonb_typeof(cd.payload)<>'object' then raise exception 'INVALID_COVERS';end if;
 perform 1 from zc_private.rrn_secrets where company_id=p_company and car_id=p_car_id order by owner_id for update;
 perform 1 from public.zc_customers where company_id=p_company and car_id=p_car_id order by owner_id for update;
 perform 1 from public.zc_media where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2') order by owner_id,id for update;
 select coalesce(jsonb_agg(to_jsonb(c) order by owner_id),'[]') into customers from public.zc_customers c where company_id=p_company and car_id=p_car_id;
 select coalesce(jsonb_agg(to_jsonb(r) order by owner_id),'[]') into rrns from zc_private.rrn_secrets r where company_id=p_company and car_id=p_car_id;
 select coalesce(jsonb_agg(to_jsonb(f) order by owner_id,id),'[]') into files from public.zc_media f where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2');
 v_cover:=coalesce(cd.payload?p_car_id,false);
 insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,summary,snapshot,deleted_by,request_id,request_hash)
 values(p_company,p_owner,p_car_id,'vehicle',p_car_id,jsonb_build_object('label',left(concat_ws(' · ',car->>'model',car->>'plate'),300),'model',left(car->>'model',200),'plate',left(car->>'plate',40)),jsonb_build_object('car',car,'coverExists',v_cover,'cover',cd.payload->p_car_id,'customers',customers,'rrn',rrns,'media',files),p_actor,p_request_id,v_hash) returning id into v_id;
 insert into snote_private.recycle_files(entry_id,company_id,file_path) select v_id,p_company,value->>'file_path' from jsonb_array_elements(files);
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 update public.snote_customer_intake set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and car_id=p_car_id;
 delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
 delete from public.zc_media where company_id=p_company and car_id=p_car_id and group_name in ('photos','registration','inspection1','inspection2');
 delete from public.zc_customers where company_id=p_company and car_id=p_car_id;
 delete from zc_private.rrn_secrets where company_id=p_company and car_id=p_car_id;
 update public.zc_datasets set payload=(select coalesce(jsonb_agg(c order by ord),'[]') from jsonb_array_elements(d.payload) with ordinality a(c,ord) where c->>'id'<>p_car_id),revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where company_id=p_company and owner_id=p_owner and dataset='cars';
 if v_cover then update public.zc_datasets set payload=payload-p_car_id,revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where company_id=p_company and owner_id=p_owner and dataset='covers';end if;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,p_actor,'recycle',v_id::text,'trash_vehicle');

 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,p_owner,p_car_id)||jsonb_build_object('id',v_id,'kind','vehicle','customerChanged',true,'mediaChanged',true,'alreadyProcessed',false);
end $f$;

-- Same archival/restore collision and byte-retention logic, entered only after
-- a platform capability check; original tenant RPC membership guards stay intact.
create or replace function snote_operator_private.recycle_restore(p_actor uuid,p_session uuid,p_company uuid,p_entry uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare m public.zc_members;e snote_private.recycle_bin;d public.zc_datasets;cd public.zc_datasets;
 s jsonb;f jsonb;c public.zc_customers;mr public.zc_media;v_flag text;v_cover boolean;v_n integer;v_customers jsonb;v_rrns jsonb;v_media jsonb;
begin
 perform snote_operator_private.require_operator(p_actor,p_session);m.user_id:=p_actor;m.role:='admin';m.company_id:=p_company;perform snote_private.recycle_lock(p_company);
 select * into e from snote_private.recycle_bin where company_id=p_company and id=p_entry for update;
 if not found then raise exception 'ENTRY_NOT_FOUND';end if;

 if e.restored_at is not null then return snote_private.recycle_ack(p_company,e.owner_id,e.car_id,e.kind<>'customer')||jsonb_build_object('id',e.id,'kind',e.kind,'customerChanged',e.kind in ('vehicle','customer'),'mediaChanged',e.kind in ('vehicle','media'),'alreadyProcessed',true);end if;
 s:=e.snapshot;
 if e.kind='vehicle' then
  if exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  if exists(select 1 from public.zc_media where company_id=p_company and car_id=e.car_id and group_name in ('photos','registration','inspection1','inspection2')) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  v_customers:=coalesce(s->'customers','[]');v_rrns:=coalesce(s->'rrn','[]');v_media:=coalesce(s->'media','[]');
 elsif e.kind='customer' then
  if exists(select 1 from snote_private.recycle_bin where company_id=p_company and car_id=e.car_id and kind='vehicle' and restored_at is null) and not exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
  v_customers:=jsonb_build_array(s->'customer');v_rrns:=case when jsonb_typeof(s->'rrn')='object' then jsonb_build_array(s->'rrn') else '[]'::jsonb end;v_media:='[]';
 else
  if exists(select 1 from snote_private.recycle_bin where company_id=p_company and car_id=e.car_id and kind='vehicle' and restored_at is null) and not exists(select 1 from public.zc_datasets a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.payload)='array' then a.payload else '[]'::jsonb end)x where a.company_id=p_company and a.dataset='cars' and x->>'id'=e.car_id) then raise exception 'CAR_IN_TRASH' using errcode='40001';end if;
  perform snote_private.recycle_car(p_company,e.owner_id,e.car_id,true);
  mr:=jsonb_populate_record(null::public.zc_media,s->'media');
  select count(*) into v_n from public.zc_media where company_id=p_company and car_id=e.car_id and group_name=mr.group_name;
  if mr.group_name='photos' and v_n>=5 then raise exception 'PHOTO_LIMIT' using errcode='40001';elsif mr.group_name<>'photos' and v_n>0 then raise exception 'DOCUMENT_EXISTS' using errcode='40001';end if;
  v_customers:='[]';v_rrns:='[]';v_media:=jsonb_build_array(s->'media');
 end if;
 -- Check every collision before changing active data. Restore never upserts over a newer row.
 for f in select value from jsonb_array_elements(v_customers) loop
  if exists(select 1 from public.zc_customers where company_id=p_company and owner_id=(f->>'owner_id')::uuid and car_id=e.car_id) or not exists(select 1 from auth.users where id=(f->>'owner_id')::uuid) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 end loop;
 for f in select value from jsonb_array_elements(v_rrns) loop
  if exists(select 1 from zc_private.rrn_secrets where company_id=p_company and owner_id=(f->>'owner_id')::uuid and car_id=e.car_id) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 end loop;
 for f in select value from jsonb_array_elements(v_media) loop
  if exists(select 1 from public.zc_media where file_path=f->>'file_path' or(company_id=p_company and owner_id=(f->>'owner_id')::uuid and id=f->>'id')) or exists(select 1 from snote_private.recycle_files where company_id=p_company and file_path=f->>'file_path' and entry_id<>e.id) or not exists(select 1 from auth.users where id=(f->>'owner_id')::uuid) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  if not exists(select 1 from storage.objects where bucket_id='zc-vehicle-private' and name=f->>'file_path') then raise exception 'MEDIA_FILE_MISSING' using errcode='40001';end if;
 end loop;
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=e.owner_id and dataset='covers' for update;
 v_cover:=coalesce((s->>'coverExists')::boolean,false);
 if e.kind='vehicle' and coalesce(cd.payload?e.car_id,false) then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 if e.kind='vehicle' then
  insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values(p_company,e.owner_id,'cars','[]',0,p_actor) on conflict(company_id,dataset,owner_id) do nothing;
  select * into d from public.zc_datasets where company_id=p_company and owner_id=e.owner_id and dataset='cars' for update;
  if jsonb_typeof(d.payload)<>'array' then raise exception 'RESTORE_CONFLICT' using errcode='40001';end if;
  update public.zc_datasets set payload=payload||jsonb_build_array(s->'car'),revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where company_id=p_company and owner_id=e.owner_id and dataset='cars';
 end if;
 for f in select value from jsonb_array_elements(v_customers) loop
  c:=jsonb_populate_record(null::public.zc_customers,f);
  insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by,updated_at,restore_generation) values(p_company,c.owner_id,e.car_id,c.payload,c.has_rrn,p_actor,greatest(clock_timestamp(),c.updated_at+interval '1 microsecond'),gen_random_uuid());
 end loop;
 for f in select value from jsonb_array_elements(v_rrns) loop
  insert into zc_private.rrn_secrets select (jsonb_populate_record(null::zc_private.rrn_secrets,f)).*;
 end loop;
 for f in select value from jsonb_array_elements(v_media) loop
  insert into public.zc_media select (jsonb_populate_record(null::public.zc_media,f)).*;
 end loop;
 -- A restored individual photo must not replace a newly chosen cover.
 if e.kind in ('vehicle','media') and v_cover and not coalesce(cd.payload?e.car_id,false) then
  insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision,updated_by) values(p_company,e.owner_id,'covers','{}',0,p_actor) on conflict(company_id,dataset,owner_id) do nothing;
  update public.zc_datasets set payload=jsonb_set(payload,array[e.car_id],s->'cover',true),revision=revision+1,updated_by=p_actor,updated_at=clock_timestamp() where company_id=p_company and owner_id=e.owner_id and dataset='covers';
 end if;
 delete from snote_private.recycle_files where entry_id=e.id;
 update snote_private.recycle_bin set restored_at=clock_timestamp(),restored_by=p_actor,snapshot='{}',summary='{}' where id=e.id;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,p_actor,'recycle',e.id::text,'restore_'||e.kind);
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return snote_private.recycle_ack(p_company,e.owner_id,e.car_id,e.kind<>'customer')||jsonb_build_object('id',e.id,'kind',e.kind,'customerChanged',e.kind in ('vehicle','customer'),'mediaChanged',e.kind in ('vehicle','media'),'alreadyProcessed',false);
end $f$;
create or replace function snote_operator_private.vehicle_archive(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_expected_covers integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();r jsonb;b jsonb;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'vehicle_archive',jsonb_build_array(p_company,p_owner,p_car_id,p_expected,p_expected_covers));if r is not null then return r;end if;
 b:=snote_operator_private.safe_vehicle(snote_private.recycle_car(p_company,p_owner,p_car_id,true)->'car');
 r:=snote_operator_private.recycle_trash_vehicle(a,s,p_company,p_owner,p_car_id,p_expected,p_expected_covers,p_request_id);
 perform snote_operator_private.log(a,s,'vehicle_archive',p_car_id,p_company,p_request_id,b,jsonb_build_object('recycleId',r->'id'));
 return snote_operator_private.complete_request(a,p_request_id,r-'cars'-'covers');
end$$;
create or replace function snote_operator_private.vehicle_restore(p_company uuid,p_entry uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.actor();s uuid:=snote_operator_private.claim_session();r jsonb;
begin
 r:=snote_operator_private.begin_request(a,p_request_id,'vehicle_restore',jsonb_build_array(p_company,p_entry));if r is not null then return r;end if;
 r:=snote_operator_private.recycle_restore(a,s,p_company,p_entry);
 perform snote_operator_private.log(a,s,'vehicle_restore',p_entry::text,p_company,p_request_id,null,jsonb_build_object('recycleId',p_entry));
 return snote_operator_private.complete_request(a,p_request_id,r-'cars'-'covers');
end$$;
create or replace function snote_operator_private.transfer_snapshot(p_source jsonb,p_target jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare c uuid:=(p_source->>'companyId')::uuid;o uuid:=(p_source->>'ownerId')::uuid;v_car_id text:=p_source->>'carId';tc uuid:=(p_target->>'companyId')::uuid;tu uuid:=(p_target->>'ownerId')::uuid;car jsonb;customers jsonb;files jsonb;rrn jsonb;objects jsonb;d public.zc_datasets;cd public.zc_datasets;td public.zc_datasets;tcd public.zc_datasets;
begin
 car:=snote_private.recycle_car(c,o,v_car_id,true)->'car';
 select * into d from public.zc_datasets where company_id=c and owner_id=o and dataset='cars' for update;
 select * into cd from public.zc_datasets where company_id=c and owner_id=o and dataset='covers' for update;
 select * into td from public.zc_datasets where company_id=tc and owner_id=tu and dataset='cars' for update;
 select * into tcd from public.zc_datasets where company_id=tc and owner_id=tu and dataset='covers' for update;
 perform 1 from public.zc_customers where company_id=c and car_id=v_car_id order by owner_id for update;
 perform 1 from public.zc_media m where m.company_id=c and m.car_id=v_car_id and m.group_name in('photos','registration','inspection1','inspection2') order by m.owner_id,m.id for update;
 perform 1 from zc_private.rrn_secrets where company_id=c and car_id=v_car_id order by owner_id for update;
 select coalesce(jsonb_agg(to_jsonb(x) order by owner_id),'[]') into customers from public.zc_customers x where company_id=c and car_id=v_car_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by owner_id,id),'[]') into files from public.zc_media x where company_id=c and car_id=v_car_id and group_name in('photos','registration','inspection1','inspection2');
 select coalesce(jsonb_agg(to_jsonb(x) order by owner_id),'[]') into rrn from zc_private.rrn_secrets x where company_id=c and car_id=v_car_id;
 perform 1 from storage.objects where bucket_id='zc-vehicle-private' and name in(select x->>'file_path' from jsonb_array_elements(files)x) order by name for share;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'metadata',o.metadata,'updatedAt',o.updated_at) order by o.name),'[]') into objects from storage.objects o where o.bucket_id='zc-vehicle-private' and o.name in(select x->>'file_path' from jsonb_array_elements(files)x);
 return jsonb_build_object('objects',objects,'vehicle',car,'customers',customers,'media',files,'rrn',rrn,'cover',cd.payload->v_car_id,'sourceRevision',d.revision,'sourceCoversRevision',coalesce(cd.revision,0),'targetRevision',coalesce(td.revision,0),'targetCoversRevision',coalesce(tcd.revision,0));
end$$;
create or replace function snote_operator_private.transfer_result(p_job snote_operator_private.transfer_jobs)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('jobId',p_job.request_id,'status',p_job.status,'mode',p_job.mode,'source',p_job.source,'target',p_job.target,'vehicle',p_job.snapshot->'vehicle','customer',p_job.snapshot->'customers'->0,'media',(select coalesce(jsonb_agg(x||jsonb_build_object('copied',exists(select 1 from storage.objects o where o.bucket_id='zc-vehicle-private' and o.name=x->'target'->>'file_path' and o.metadata->>'mimetype'=x->'target'->>'mime_type' and o.metadata->>'size'=x->'target'->>'file_size'))),'[]') from jsonb_array_elements(p_job.media_plan)x),'cover',(select x->'target'->'id' from jsonb_array_elements(p_job.media_plan)x where x->'source'->>'group_name'='photos' and x->'source'->>'id'=p_job.snapshot->>'cover' limit 1),'legacyRrnCount',jsonb_array_length(p_job.snapshot->'rrn'),'blockers',p_job.blockers,'result',p_job.result);
$$;
create or replace function snote_operator_private.unknown_cipher(p_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare e record;
begin
 if jsonb_typeof(p_value)='object' then
  for e in select * from jsonb_each(p_value) loop
   if e.key~*'(cipher|encrypted)$' and e.value not in('null'::jsonb,'""'::jsonb) and not(jsonb_typeof(e.value)='string' and (e.value#>>'{}')~'^(smi1|isi1)[.]') then return true;end if;
   if snote_operator_private.unknown_cipher(e.value) then return true;end if;
  end loop;
 elsif jsonb_typeof(p_value)='array' then for e in select value from jsonb_array_elements(p_value) loop if snote_operator_private.unknown_cipher(e.value) then return true;end if;end loop;end if;
 return false;
end$$;
create or replace function snote_operator_private.transfer_prepare(p_actor uuid,p_session uuid,p_request_id uuid,p_source jsonb,p_target jsonb,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.transfer_jobs;snap jsonb;r jsonb;target jsonb;files jsonb:='[]';blockers jsonb:='[]';x jsonb;t jsonb;v_media_id text;ext text;co uuid;sc uuid;so uuid;tc uuid;tu uuid;cover_matches integer;
begin
 if p_source is null or p_target is null or jsonb_typeof(p_source)<>'object' or jsonb_typeof(p_target)<>'object' or p_mode not in('copy','move') then raise exception 'INVALID_TRANSFER' using errcode='22023';end if;
 begin sc:=(p_source->>'companyId')::uuid;so:=(p_source->>'ownerId')::uuid;tc:=(p_target->>'companyId')::uuid;tu:=(p_target->>'ownerId')::uuid;exception when invalid_text_representation then raise exception 'INVALID_TRANSFER_SCOPE' using errcode='22023';end;
 if sc is null or so is null or tc is null or tu is null or coalesce(length(p_source->>'carId'),0) not between 1 and 200 then raise exception 'INVALID_TRANSFER_SCOPE' using errcode='22023';end if;
 r:=snote_operator_private.begin_request(a,p_request_id,'transfer',jsonb_build_array(p_source,p_target,p_mode));
 select * into j from snote_operator_private.transfer_jobs where actor_id=a and request_id=p_request_id for update;
 if found then return snote_operator_private.transfer_result(j);end if;
 for co in select distinct c from unnest(array[sc,tc])c order by c loop perform snote_private.recycle_lock(co);end loop;
 perform 1 from public.zc_members m join auth.users u on u.id=m.user_id where m.company_id=tc and m.user_id=tu and m.active and m.role in('admin','dealer') and u.deleted_at is null and(u.banned_until is null or u.banned_until<=clock_timestamp()) and not exists(select 1 from snote_operator_private.company_state where company_id=tc and archived) and not exists(select 1 from snote_operator_private.account_state where user_id=tu and archived) for share of m,u;
 if not found then raise exception 'ACTIVE_DESTINATION_OWNER_REQUIRED' using errcode='22023';end if;
 target:=jsonb_build_object('companyId',tc,'ownerId',tu,'carId',gen_random_uuid()::text);
 snap:=snote_operator_private.transfer_snapshot(p_source,target);
 if p_source->>'revision' is distinct from snap->>'sourceRevision' or p_source->>'coversRevision' is distinct from snap->>'sourceCoversRevision' then raise exception 'CONFLICT' using errcode='40001';end if;
 if jsonb_array_length(snap->'objects')<>jsonb_array_length(snap->'media') then blockers:=blockers||'"SOURCE_FILE_MISSING"'::jsonb;end if;
 if jsonb_array_length(snap->'media')>1000 then blockers:=blockers||'"MEDIA_TRANSFER_LIMIT"'::jsonb;end if;
 if jsonb_array_length(snap->'customers')>1 or jsonb_array_length(snap->'rrn')>1 then blockers:=blockers||'"AMBIGUOUS_CUSTOMER"'::jsonb;end if;
 if jsonb_array_length(snap->'customers')=1 and snap->'customers'->0->>'has_rrn'='true' and coalesce(snap->'customers'->0->'payload'->>'identityCipher','')!~'^smi1[.]' and jsonb_array_length(snap->'rrn')=0 then blockers:=blockers||'"LEGACY_INTAKE_IDENTITY_UNAVAILABLE"'::jsonb;end if;
 if jsonb_array_length(snap->'rrn')>0 then
  if not exists(select 1 from public.zc_companies where id=tc and rrn_enabled) then blockers:=blockers||'"LEGACY_RRN_TARGET_DISABLED"'::jsonb;end if;
  if sc<>tc and(not exists(select 1 from zc_private.rrn_keys where company_id=sc) or not exists(select 1 from zc_private.rrn_keys where company_id=tc)) then blockers:=blockers||'"LEGACY_RRN_KEY_UNAVAILABLE"'::jsonb;end if;
 end if;
 for x in select value from jsonb_array_elements(snap->'media') loop
  if x->>'mime_type' not in('image/jpeg','image/png','image/webp') or coalesce((x->>'file_size')::bigint,0) not between 1 and 10485760 then blockers:=blockers||'"UNSUPPORTED_MEDIA"'::jsonb;continue;end if;
  if left(x->>'file_path',length(sc::text||'/'||(x->>'owner_id')||'/'||snote_private.recycle_uri_component(p_source->>'carId')||'/')) is distinct from sc::text||'/'||(x->>'owner_id')||'/'||snote_private.recycle_uri_component(p_source->>'carId')||'/' then blockers:=blockers||'"SOURCE_MEDIA_PATH_MISMATCH"'::jsonb;end if;
  v_media_id:=gen_random_uuid()::text;ext:=case x->>'mime_type' when 'image/png' then 'png' when 'image/webp' then 'webp' else 'jpg' end;
  t:=x||jsonb_build_object('company_id',tc,'owner_id',tu,'car_id',target->>'carId','id',v_media_id,'file_path',tc::text||'/'||tu::text||'/'||(target->>'carId')||'/'||v_media_id||'.'||ext,'meta',coalesce(x->'meta','{}')||jsonb_build_object('transferSource',jsonb_build_object('companyId',sc,'ownerId',x->>'owner_id','carId',p_source->>'carId','mediaId',x->>'id')));
  files:=files||jsonb_build_array(jsonb_build_object('source',x,'target',t));
 end loop;
 if snap->'cover' is not null and snap->'cover'<>'null'::jsonb then
  select count(*)::integer into cover_matches from jsonb_array_elements(files)fp where fp->'source'->>'group_name'='photos' and fp->'source'->>'id'=snap->>'cover';
  if cover_matches>1 then blockers:=blockers||'"AMBIGUOUS_COVER"'::jsonb;elsif cover_matches=0 then blockers:=blockers||'"COVER_MEDIA_MISSING"'::jsonb;end if;
 end if;
 if snote_operator_private.unknown_cipher(snap->'vehicle') or exists(select 1 from jsonb_array_elements(snap->'customers') cp where snote_operator_private.unknown_cipher(cp->'payload')) then blockers:=blockers||'"UNSUPPORTED_IDENTITY_CIPHER"'::jsonb;end if;
 insert into snote_operator_private.transfer_jobs(actor_id,request_id,session_id,mode,source,target,snapshot,media_plan,blockers) values(a,p_request_id,p_session,p_mode,p_source,target,snap,files,blockers) returning * into j;
 insert into snote_operator_private.transfer_files(actor_id,request_id,file_path,source_path) select a,p_request_id,plan_entry.payload->'target'->>'file_path',plan_entry.payload->'source'->>'file_path' from jsonb_array_elements(files)plan_entry(payload);
 perform snote_operator_private.log(a,p_session,'transfer_prepare',p_request_id::text,sc,p_request_id,jsonb_build_object('source',p_source),jsonb_build_object('target',target,'mode',p_mode,'blockers',blockers));
 return snote_operator_private.transfer_result(j);
end$$;
create or replace function snote_operator_private.transfer_get(p_actor uuid,p_session uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.transfer_jobs;
begin select * into j from snote_operator_private.transfer_jobs where actor_id=a and request_id=p_request_id;if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='22023';end if;return snote_operator_private.transfer_result(j);end$$;
create or replace function snote_operator_private.transfer_abort(p_actor uuid,p_session uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.transfer_jobs;paths jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('snote-operator-request:'||a::text||':'||p_request_id::text,0));
 select * into j from snote_operator_private.transfer_jobs where actor_id=a and request_id=p_request_id for update;if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='22023';end if;
 if j.status='committed' then return jsonb_build_object('status','committed','cleanupPaths','[]'::jsonb,'result',j.result);end if;
 select coalesce(jsonb_agg(x->'target'->'file_path'),'[]') into paths from jsonb_array_elements(j.media_plan)x;
 update snote_operator_private.transfer_jobs set status='aborted' where actor_id=a and request_id=p_request_id;
 update snote_operator_private.requests set status='aborted' where actor_id=a and request_id=p_request_id;
 perform snote_operator_private.log(a,p_session,'transfer_abort',p_request_id::text,(j.source->>'companyId')::uuid,p_request_id,null,jsonb_build_object('cleanupPaths',paths));
 return jsonb_build_object('status','aborted','cleanupPaths',paths);
end$$;
create or replace function snote_operator_private.redact_ciphers(p_value jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb; e record;
begin
 if jsonb_typeof(p_value)='string' and (p_value#>>'{}')~'^(smi1|isi1)[.]' then return '"[encrypted-identity]"'::jsonb;end if;
 if jsonb_typeof(p_value)='object' then r:='{}';for e in select * from jsonb_each(p_value) loop r:=r||jsonb_build_object(e.key,snote_operator_private.redact_ciphers(e.value));end loop;return r;
 elsif jsonb_typeof(p_value)='array' then r:='[]';for e in select value from jsonb_array_elements(p_value) loop r:=r||jsonb_build_array(snote_operator_private.redact_ciphers(e.value));end loop;return r;end if;
 return p_value;
end$$;
create or replace function snote_operator_private.transfer_commit(p_actor uuid,p_session uuid,p_request_id uuid,p_vehicle jsonb,p_customer jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.transfer_jobs;cur jsonb;co uuid;sc uuid;so uuid;tc uuid;tu uuid;oldid text;newid text;alias text;car jsonb;cp jsonb;x jsonb;t jsonb;obj storage.objects;rowrrn zc_private.rrn_secrets;secret_source text;secret_target text;newcipher bytea;v_flag text;v_result jsonb;archive_result jsonb;cover jsonb;v_target_dataset public.zc_datasets;
begin
 perform pg_advisory_xact_lock(hashtextextended('snote-operator-request:'||a::text||':'||p_request_id::text,0));
 select * into j from snote_operator_private.transfer_jobs where actor_id=a and request_id=p_request_id for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND' using errcode='22023';end if;
 if j.status='committed' then return j.result;end if;
 if j.status<>'prepared' or j.created_at<clock_timestamp()-interval '1 hour' then raise exception 'TRANSFER_NOT_PREPARED' using errcode='40001';end if;
 if jsonb_array_length(j.blockers)>0 then raise exception 'TRANSFER_BLOCKED' using errcode='22023';end if;
 sc:=(j.source->>'companyId')::uuid;so:=(j.source->>'ownerId')::uuid;tc:=(j.target->>'companyId')::uuid;tu:=(j.target->>'ownerId')::uuid;oldid:=j.source->>'carId';newid:=j.target->>'carId';alias:=snote_operator_private.alias(tu);
 for co in select distinct c from unnest(array[sc,tc])c order by c loop perform snote_private.recycle_lock(co);end loop;
 perform 1 from public.zc_members m join auth.users u on u.id=m.user_id where m.company_id=tc and m.user_id=tu and m.active and m.role in('admin','dealer') and u.deleted_at is null and(u.banned_until is null or u.banned_until<=clock_timestamp()) and not exists(select 1 from snote_operator_private.company_state where company_id=tc and archived) and not exists(select 1 from snote_operator_private.account_state where user_id=tu and archived) for share of m,u;
 if not found then raise exception 'ACTIVE_DESTINATION_OWNER_REQUIRED' using errcode='40001';end if;
 cur:=snote_operator_private.transfer_snapshot(j.source,j.target);
 if cur is distinct from j.snapshot then raise exception 'TRANSFER_SOURCE_OR_TARGET_CHANGED' using errcode='40001';end if;
 perform snote_operator_private.validate_custom_costs(p_vehicle);
 if p_vehicle is null or snote_operator_private.redact_ciphers(p_vehicle) is distinct from snote_operator_private.redact_ciphers(j.snapshot->'vehicle') then raise exception 'TRANSFER_VEHICLE_CHANGED' using errcode='22023';end if;
 if (j.snapshot->'customers'->0) is not null then
  if p_customer is null or snote_operator_private.redact_ciphers(p_customer) is distinct from snote_operator_private.redact_ciphers(j.snapshot->'customers'->0->'payload') then raise exception 'TRANSFER_CUSTOMER_CHANGED' using errcode='22023';end if;
 elsif p_customer is not null then raise exception 'TRANSFER_CUSTOMER_CHANGED' using errcode='22023';end if;
 -- A byte-for-byte old ciphertext in a different AAD context is unusable. Every
 -- old cipher path must be present and rewrapped, including embedded snapshots.
 for x in select value from jsonb_each(snote_operator_private.cipher_map(j.snapshot->'vehicle')) loop
  if exists(select 1 from jsonb_each(snote_operator_private.cipher_map(p_vehicle)) e where e.value=x) then raise exception 'TRANSFER_CIPHER_NOT_REWRAPPED' using errcode='22023';end if;
 end loop;
 if p_customer is not null then for x in select value from jsonb_each(snote_operator_private.cipher_map(j.snapshot->'customers'->0->'payload')) loop
  if exists(select 1 from jsonb_each(snote_operator_private.cipher_map(p_customer)) e where e.value=x) then raise exception 'TRANSFER_CIPHER_NOT_REWRAPPED' using errcode='22023';end if;
 end loop;end if;
 for x in select value from jsonb_array_elements(j.media_plan) loop
  t:=x->'target';select * into obj from storage.objects where bucket_id='zc-vehicle-private' and name=t->>'file_path' for share;
  if not found or obj.metadata->>'mimetype' is distinct from t->>'mime_type' or coalesce(obj.metadata->>'size','') is distinct from t->>'file_size' then raise exception 'TRANSFER_FILE_NOT_COPIED' using errcode='40001';end if;
  if exists(select 1 from public.zc_media where file_path=t->>'file_path' or(company_id=tc and owner_id=tu and id=t->>'id')) then raise exception 'TRANSFER_DESTINATION_COLLISION' using errcode='40001';end if;
 end loop;
 if exists(select 1 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]' end)c where d.company_id=tc and d.dataset='cars' and c->>'id'=newid) or exists(select 1 from public.zc_customers where company_id=tc and car_id=newid) or exists(select 1 from public.zc_media where company_id=tc and car_id=newid) then raise exception 'TRANSFER_DESTINATION_COLLISION' using errcode='40001';end if;
 if j.mode='move' then
  archive_result:=snote_operator_private.recycle_trash_vehicle(a,p_session,sc,so,oldid,(j.snapshot->>'sourceRevision')::integer,(j.snapshot->>'sourceCoversRevision')::integer,p_request_id);
 end if;
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 car:=p_vehicle||jsonb_build_object('id',newid,'ownerId',alias,'transferSource',jsonb_build_object('companyId',sc,'ownerId',so,'carId',oldid,'mode',j.mode,'requestId',p_request_id,'transferredAt',clock_timestamp()));
 insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision,updated_by) values(tc,'cars',tu,'[]',0,a) on conflict do nothing;
 select * into v_target_dataset from public.zc_datasets where company_id=tc and owner_id=tu and dataset='cars' for update;
 if jsonb_typeof(v_target_dataset.payload)<>'array' or octet_length((v_target_dataset.payload||jsonb_build_array(car))::text)>3000000 then raise exception 'DESTINATION_DATASET_LIMIT' using errcode='22023';end if;
 update public.zc_datasets set payload=payload||jsonb_build_array(car),revision=revision+1,updated_by=a,updated_at=clock_timestamp() where company_id=tc and owner_id=tu and dataset='cars';
 for x in select value from jsonb_array_elements(j.media_plan) loop insert into public.zc_media select (jsonb_populate_record(null::public.zc_media,x->'target')).*;end loop;
 if p_customer is not null then
  cp:=p_customer||jsonb_build_object('id',alias||':'||newid,'ownerId',alias,'carId',newid,'transferSource',jsonb_build_object('companyId',sc,'ownerId',j.snapshot->'customers'->0->>'owner_id','carId',oldid,'requestId',p_request_id));
  insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by,updated_at,restore_generation) values(tc,tu,newid,cp,(j.snapshot->'customers'->0->>'has_rrn')::boolean,a,clock_timestamp(),gen_random_uuid());
 end if;
 for x in select value from jsonb_array_elements(j.snapshot->'rrn') loop
  rowrrn:=jsonb_populate_record(null::zc_private.rrn_secrets,x);
  if not exists(select 1 from public.zc_companies where id=tc and rrn_enabled) then raise exception 'LEGACY_RRN_TARGET_DISABLED' using errcode='22023';end if;
  if sc=tc then newcipher:=rowrrn.cipher;
  else
   select secret into secret_source from zc_private.rrn_keys where company_id=sc;select secret into secret_target from zc_private.rrn_keys where company_id=tc;
   if secret_source is null or secret_target is null then raise exception 'LEGACY_RRN_KEY_UNAVAILABLE' using errcode='22023';end if;
   newcipher:=extensions.pgp_sym_encrypt(extensions.pgp_sym_decrypt(rowrrn.cipher,secret_source),secret_target,'cipher-algo=aes256');
  end if;
  insert into zc_private.rrn_secrets(company_id,owner_id,car_id,cipher,expires_at,created_at) values(tc,tu,newid,newcipher,rowrrn.expires_at,rowrrn.created_at);
 end loop;
 select plan_entry.payload->'target'->'id' into cover from jsonb_array_elements(j.media_plan)plan_entry(payload) where plan_entry.payload->'source'->>'group_name'='photos' and plan_entry.payload->'source'->>'id'=j.snapshot->>'cover' limit 1;
 if cover is not null then
  insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision,updated_by) values(tc,'covers',tu,'{}',0,a) on conflict do nothing;
  update public.zc_datasets set payload=jsonb_set(payload,array[newid],cover,true),revision=revision+1,updated_by=a,updated_at=clock_timestamp() where company_id=tc and owner_id=tu and dataset='covers';
 end if;
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 v_result:=jsonb_build_object('ok',true,'status','committed','mode',j.mode,'source',j.source,'target',j.target,'recycleId',archive_result->'id','vehicle',snote_operator_private.safe_vehicle(car));
 update snote_operator_private.transfer_jobs set status='committed',result=v_result where actor_id=a and request_id=p_request_id;
 perform snote_operator_private.log(a,p_session,'vehicle_'||j.mode,newid,tc,p_request_id,jsonb_build_object('source',j.source),jsonb_build_object('target',j.target,'recycleId',archive_result->'id'));
 return snote_operator_private.complete_request(a,p_request_id,v_result);
end$$;
create or replace function snote_operator_private.auth_prepare(p_actor uuid,p_session uuid,p_user uuid,p_expected text,p_request_id uuid,p_fingerprint text,p_fields text[],p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.auth_jobs;r jsonb;
begin
 if p_user is null or p_fingerprint is null or length(p_fingerprint) not between 32 and 200 or cardinality(p_fields) not between 1 and 2 or not(p_fields<@array['email','password']) or ('email'=any(p_fields) and(coalesce(length(p_email),0) not between 3 and 254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')) then raise exception 'INVALID_AUTH_UPDATE' using errcode='22023';end if;
 r:=snote_operator_private.begin_request(a,p_request_id,'auth_update',jsonb_build_array(p_user,p_expected,p_fingerprint,to_jsonb(p_fields),p_email));
 select * into j from snote_operator_private.auth_jobs where actor_id=a and request_id=p_request_id for update;
 if found then
  if j.status='prepared' and(j.created_at<clock_timestamp()-interval '15 minutes' or j.expected_version is distinct from snote_operator_private.account_version(j.user_id)) then raise exception 'AUTH_PLAN_STALE' using errcode='40001';end if;
  return jsonb_build_object('status',j.status,'userId',j.user_id,'result',j.result);
 end if;
 perform 1 from auth.users where id=p_user for update;if not found then raise exception 'ACCOUNT_NOT_FOUND' using errcode='22023';end if;
 if p_expected is distinct from snote_operator_private.account_version(p_user) then raise exception 'CONFLICT' using errcode='40001';end if;
 if exists(select 1 from snote_operator_private.auth_jobs where user_id=p_user and status='prepared' and created_at>clock_timestamp()-interval '15 minutes') then raise exception 'AUTH_UPDATE_IN_PROGRESS' using errcode='40001';end if;
 insert into snote_operator_private.auth_jobs(actor_id,request_id,session_id,user_id,fingerprint,expected_version,fields,email) values(a,p_request_id,p_session,p_user,p_fingerprint,p_expected,p_fields,p_email);
 perform snote_operator_private.log(a,p_session,'auth_update_prepare',p_user::text,null,p_request_id,null,jsonb_build_object('fields',p_fields));
 return jsonb_build_object('status','prepared','userId',p_user);
end$$;
create or replace function snote_operator_private.auth_finalize(p_actor uuid,p_session uuid,p_request_id uuid,p_success boolean,p_auth_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_operator_private.server_actor(p_actor,p_session);j snote_operator_private.auth_jobs;r jsonb;email_current text;
begin
 perform pg_advisory_xact_lock(hashtextextended('snote-operator-request:'||a::text||':'||p_request_id::text,0));
 select * into j from snote_operator_private.auth_jobs where actor_id=a and request_id=p_request_id for update;
 if not found then raise exception 'AUTH_JOB_NOT_FOUND' using errcode='22023';end if;
 if j.status<>'prepared' then return j.result;end if;
 if j.created_at<clock_timestamp()-interval '15 minutes' then raise exception 'AUTH_PLAN_STALE' using errcode='40001';end if;
 if p_success is null or p_auth_result->>'id' is distinct from j.user_id::text or exists(select 1 from jsonb_object_keys(p_auth_result) k where k not in('id','email')) then raise exception 'INVALID_AUTH_RESULT' using errcode='22023';end if;
 select email into email_current from auth.users where id=j.user_id for update;
 if p_success and 'email'=any(j.fields) and (email_current is distinct from j.email or p_auth_result->>'email' is distinct from j.email) then raise exception 'AUTH_UPDATE_NOT_CONFIRMED' using errcode='40001';end if;
 if p_success then delete from auth.sessions where user_id=j.user_id and id<>p_session;end if;
 r:=jsonb_build_object('ok',p_success,'status',case when p_success then 'committed' else 'failed' end,'userId',j.user_id,'fields',j.fields,'account',snote_operator_private.account_snapshot(j.user_id)||jsonb_build_object('version',snote_operator_private.account_version(j.user_id)));
 update snote_operator_private.auth_jobs set status=case when p_success then 'committed' else 'failed' end,result=r where actor_id=a and request_id=p_request_id;
 perform snote_operator_private.log(a,p_session,case when p_success then 'auth_update_committed' else 'auth_update_failed' end,j.user_id::text,null,p_request_id,null,jsonb_build_object('fields',j.fields));
 return snote_operator_private.complete_request(a,p_request_id,r);
end$$;

-- A copied private object must remain invisible to ordinary tenant members
-- until the SQL commit activates its metadata. Random paths are not authorization.
create or replace function snote_operator_private.transfer_file_visible(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_bucket<>'zc-vehicle-private' or not exists(
  select 1 from snote_operator_private.transfer_files f join snote_operator_private.transfer_jobs j using(actor_id,request_id)
  where f.file_path=p_path and j.status<>'committed');
$$;
drop policy if exists snote_operator_transfer_files_guard on storage.objects;
create policy snote_operator_transfer_files_guard on storage.objects as restrictive for all to authenticated
 using(snote_operator_private.transfer_file_visible(bucket_id,name))
 with check(snote_operator_private.transfer_file_visible(bucket_id,name));

create index if not exists operator_transfer_source_path on snote_operator_private.transfer_files(source_path);
create or replace function snote_operator_private.transfer_file_writable(p_bucket text,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select snote_operator_private.transfer_file_visible(p_bucket,p_path) and (p_bucket<>'zc-vehicle-private' or not exists(
  select 1 from snote_operator_private.transfer_files f join snote_operator_private.transfer_jobs j using(actor_id,request_id)
  where f.source_path=p_path and j.status='prepared' and jsonb_array_length(j.blockers)=0 and j.created_at>now()-interval '1 hour'));
$$;
drop policy if exists snote_operator_transfer_source_update_guard on storage.objects;
create policy snote_operator_transfer_source_update_guard on storage.objects as restrictive for update to authenticated
 using(snote_operator_private.transfer_file_writable(bucket_id,name)) with check(snote_operator_private.transfer_file_writable(bucket_id,name));
drop policy if exists snote_operator_transfer_source_insert_guard on storage.objects;
create policy snote_operator_transfer_source_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(snote_operator_private.transfer_file_writable(bucket_id,name));
drop policy if exists snote_operator_transfer_source_delete_guard on storage.objects;
create policy snote_operator_transfer_source_delete_guard on storage.objects as restrictive for delete to authenticated
 using(snote_operator_private.transfer_file_writable(bucket_id,name));

create or replace function public.snote_operator_context()
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.context();$$;

create or replace function public.snote_operator_vehicles_list(p_query jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.vehicles_list(p_query);$$;

create or replace function public.snote_operator_accounts_list(p_query jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.accounts_list(p_query);$$;

create or replace function public.snote_operator_companies_list(p_query jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.companies_list(p_query);$$;

create or replace function public.snote_operator_vehicle_save(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_vehicle jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.vehicle_save(p_company,p_owner,p_car_id,p_expected,p_vehicle,p_request_id);$$;

create or replace function public.snote_operator_vehicle_archive(p_company uuid,p_owner uuid,p_car_id text,p_expected integer,p_expected_covers integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.vehicle_archive(p_company,p_owner,p_car_id,p_expected,p_expected_covers,p_request_id);$$;

create or replace function public.snote_operator_vehicle_restore(p_company uuid,p_entry uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.vehicle_restore(p_company,p_entry,p_request_id);$$;

create or replace function public.snote_operator_account_save(p_user uuid,p_expected text,p_patch jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.account_save(p_user,p_expected,p_patch,p_request_id);$$;

create or replace function public.snote_operator_account_state(p_user uuid,p_expected text,p_active boolean,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.account_state(p_user,p_expected,p_active,p_request_id);$$;

create or replace function public.snote_operator_company_save(p_company uuid,p_expected text,p_patch jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.company_save(p_company,p_expected,p_patch,p_request_id);$$;

create or replace function public.snote_operator_company_state(p_company uuid,p_expected text,p_active boolean,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.company_state(p_company,p_expected,p_active,p_request_id);$$;

create or replace function public.snote_operator_vehicle_read(p_actor uuid,p_session uuid,p_company uuid,p_owner uuid,p_car_id text)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.vehicle_read(p_actor,p_session,p_company,p_owner,p_car_id);$$;

create or replace function public.snote_operator_transfer_prepare(p_actor uuid,p_session uuid,p_request_id uuid,p_source jsonb,p_target jsonb,p_mode text)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.transfer_prepare(p_actor,p_session,p_request_id,p_source,p_target,p_mode);$$;

create or replace function public.snote_operator_transfer_get(p_actor uuid,p_session uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.transfer_get(p_actor,p_session,p_request_id);$$;

create or replace function public.snote_operator_transfer_abort(p_actor uuid,p_session uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.transfer_abort(p_actor,p_session,p_request_id);$$;

create or replace function public.snote_operator_transfer_commit(p_actor uuid,p_session uuid,p_request_id uuid,p_vehicle jsonb,p_customer jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.transfer_commit(p_actor,p_session,p_request_id,p_vehicle,p_customer);$$;

create or replace function public.snote_operator_auth_prepare(p_actor uuid,p_session uuid,p_user uuid,p_expected text,p_request_id uuid,p_fingerprint text,p_fields text[],p_email text)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.auth_prepare(p_actor,p_session,p_user,p_expected,p_request_id,p_fingerprint,p_fields,p_email);$$;

create or replace function public.snote_operator_auth_finalize(p_actor uuid,p_session uuid,p_request_id uuid,p_success boolean,p_auth_result jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_operator_private.auth_finalize(p_actor,p_session,p_request_id,p_success,p_auth_result);$$;

do $acl$
declare r record;
begin
 for r in select tablename from pg_tables where schemaname='snote_operator_private' loop
  execute format('alter table snote_operator_private.%I enable row level security',r.tablename);
  execute format('revoke all on table snote_operator_private.%I from public,anon,authenticated,service_role',r.tablename);
 end loop;
 for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_operator_private' and p.proname=any(array['account_save','account_snapshot','account_state','account_version','accounts_list','actor','alias','auth_finalize','auth_prepare','begin_request','block_archived_member','cipher_map','claim_session','companies_list','company_save','company_snapshot','company_state','company_version','complete_request','context','digest_json','immutable_audit','log','paginate','query_options','recycle_restore','recycle_trash_vehicle','redact_ciphers','require_operator','safe_vehicle','server_actor','sort_items','transfer_abort','transfer_commit','transfer_file_visible','transfer_file_writable','transfer_get','transfer_prepare','transfer_result','transfer_snapshot','validate_custom_costs','vehicle_archive','vehicle_read','vehicle_restore','vehicle_save','vehicles_list','verified_session']) loop
  execute format('revoke all on function snote_operator_private.%I(%s) from public,anon,authenticated,service_role',r.proname,r.args);
 end loop;
 for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['snote_operator_account_save','snote_operator_account_state','snote_operator_accounts_list','snote_operator_auth_finalize','snote_operator_auth_prepare','snote_operator_companies_list','snote_operator_company_save','snote_operator_company_state','snote_operator_context','snote_operator_transfer_abort','snote_operator_transfer_commit','snote_operator_transfer_get','snote_operator_transfer_prepare','snote_operator_vehicle_archive','snote_operator_vehicle_read','snote_operator_vehicle_restore','snote_operator_vehicle_save','snote_operator_vehicles_list']) loop
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',r.proname,r.args);
 end loop;
end $acl$;
grant usage on schema snote_operator_private to authenticated,service_role;
grant execute on function snote_operator_private.context() to authenticated;
grant execute on function public.snote_operator_context() to authenticated;
grant execute on function snote_operator_private.vehicles_list(jsonb) to authenticated;
grant execute on function public.snote_operator_vehicles_list(jsonb) to authenticated;
grant execute on function snote_operator_private.accounts_list(jsonb) to authenticated;
grant execute on function public.snote_operator_accounts_list(jsonb) to authenticated;
grant execute on function snote_operator_private.companies_list(jsonb) to authenticated;
grant execute on function public.snote_operator_companies_list(jsonb) to authenticated;
grant execute on function snote_operator_private.vehicle_save(uuid,uuid,text,integer,jsonb,uuid) to authenticated;
grant execute on function public.snote_operator_vehicle_save(uuid,uuid,text,integer,jsonb,uuid) to authenticated;
grant execute on function snote_operator_private.vehicle_archive(uuid,uuid,text,integer,integer,uuid) to authenticated;
grant execute on function public.snote_operator_vehicle_archive(uuid,uuid,text,integer,integer,uuid) to authenticated;
grant execute on function snote_operator_private.vehicle_restore(uuid,uuid,uuid) to authenticated;
grant execute on function public.snote_operator_vehicle_restore(uuid,uuid,uuid) to authenticated;
grant execute on function snote_operator_private.account_save(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.snote_operator_account_save(uuid,text,jsonb,uuid) to authenticated;
grant execute on function snote_operator_private.account_state(uuid,text,boolean,uuid) to authenticated;
grant execute on function public.snote_operator_account_state(uuid,text,boolean,uuid) to authenticated;
grant execute on function snote_operator_private.company_save(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.snote_operator_company_save(uuid,text,jsonb,uuid) to authenticated;
grant execute on function snote_operator_private.company_state(uuid,text,boolean,uuid) to authenticated;
grant execute on function public.snote_operator_company_state(uuid,text,boolean,uuid) to authenticated;
grant execute on function snote_operator_private.vehicle_read(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.snote_operator_vehicle_read(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function snote_operator_private.transfer_prepare(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function public.snote_operator_transfer_prepare(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
grant execute on function snote_operator_private.transfer_get(uuid,uuid,uuid) to service_role;
grant execute on function public.snote_operator_transfer_get(uuid,uuid,uuid) to service_role;
grant execute on function snote_operator_private.transfer_abort(uuid,uuid,uuid) to service_role;
grant execute on function public.snote_operator_transfer_abort(uuid,uuid,uuid) to service_role;
grant execute on function snote_operator_private.transfer_commit(uuid,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function public.snote_operator_transfer_commit(uuid,uuid,uuid,jsonb,jsonb) to service_role;
grant execute on function snote_operator_private.auth_prepare(uuid,uuid,uuid,text,uuid,text,text[],text) to service_role;
grant execute on function public.snote_operator_auth_prepare(uuid,uuid,uuid,text,uuid,text,text[],text) to service_role;
grant execute on function snote_operator_private.auth_finalize(uuid,uuid,uuid,boolean,jsonb) to service_role;
grant execute on function public.snote_operator_auth_finalize(uuid,uuid,uuid,boolean,jsonb) to service_role;
grant execute on function snote_operator_private.transfer_file_visible(text,text) to authenticated;
grant execute on function snote_operator_private.transfer_file_writable(text,text) to authenticated;
revoke all on function snote_operator_private.unknown_cipher(jsonb) from public,anon,authenticated,service_role;
alter default privileges in schema snote_operator_private revoke execute on functions from public;
notify pgrst,'reload schema';
commit;
