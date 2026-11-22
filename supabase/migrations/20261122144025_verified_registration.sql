-- Verified, resumable registration. Evidence and credentials never enter public
-- company/vehicle records or user-editable authorization metadata.
begin;
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated,service_role;

create table if not exists snote_private.registration_applications(
 id uuid primary key,
 profile jsonb not null check(jsonb_typeof(profile)='object'),
 documents jsonb not null check(jsonb_typeof(documents)='array' and jsonb_array_length(documents)=2),
 company_key text not null,business_number text not null,email text not null,phone text not null,
 stage text not null default 'draft' check(stage in('draft','pending_auth','expired','cancelled','completed')),
 created_at timestamptz not null default clock_timestamp(),
 draft_expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 ready_at timestamptz,completed_at timestamptz,
 user_id uuid references auth.users(id) on delete set null,
 company_id uuid references public.zc_companies(id) on delete set null
);
alter table snote_private.registration_applications enable row level security;
revoke all on snote_private.registration_applications from public,anon,authenticated,service_role;
create unique index if not exists registration_active_company on snote_private.registration_applications(company_key) where stage in('draft','pending_auth');
create unique index if not exists registration_active_business on snote_private.registration_applications(business_number) where stage in('draft','pending_auth');
create unique index if not exists registration_active_email on snote_private.registration_applications(email) where stage in('draft','pending_auth');
create unique index if not exists registration_active_phone on snote_private.registration_applications(phone) where stage in('draft','pending_auth');
create unique index if not exists registration_bound_user on snote_private.registration_applications(user_id) where user_id is not null;
create index if not exists registration_resume_email on snote_private.registration_applications(email,created_at desc);

create table if not exists snote_private.registration_rate_events(
 key text not null check(key~'^[0-9a-f]{64}$'),
 action text not null check(action in('check-company','register')),
 created_at timestamptz not null default clock_timestamp()
);
alter table snote_private.registration_rate_events enable row level security;
revoke all on snote_private.registration_rate_events from public,anon,authenticated,service_role;
create index if not exists registration_rate_key_time on snote_private.registration_rate_events(key,action,created_at);
create index if not exists registration_rate_expiry on snote_private.registration_rate_events(created_at);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('snote-registration-documents','snote-registration-documents',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No client policies grant evidence access; these guards also prevent future
-- broad Storage policies from granting access to another account or coworker.
drop policy if exists snote_registration_storage_guard on storage.objects;
create policy snote_registration_storage_guard on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id<>'snote-registration-documents') with check(bucket_id<>'snote-registration-documents');

create or replace function snote_private.registration_service()
returns void language plpgsql stable security definer set search_path='' as $f$
begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'FORBIDDEN' using errcode='42501';end if;
end$f$;
create or replace function snote_private.registration_name(p_value text)
returns text language sql immutable set search_path='' as $f$
 select lower(regexp_replace(pg_catalog.normalize(btrim(coalesce(p_value,'')),'NFC'),'[[:space:]]+','','g'));
$f$;
create or replace function snote_private.registration_email(p_value text)
returns text language sql immutable set search_path='' as $f$
 select lower(btrim(coalesce(p_value,'')));
$f$;
create or replace function snote_private.registration_phone(p_value text)
returns text language plpgsql immutable set search_path='' as $f$
declare value text:=regexp_replace(coalesce(p_value,''),'[^0-9]','','g');
begin
 if left(value,2)='82' then value:='0'||substring(value from 3);end if;
 if value!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' then return '';end if;
 return value;
end$f$;
create or replace function snote_private.registration_lock(p_wait boolean default true)
returns void language plpgsql set search_path='' as $f$
begin
 if p_wait then perform pg_advisory_xact_lock(20261122,2189);
 elsif not pg_try_advisory_xact_lock(20261122,2189) then raise exception 'REGISTRATION_CONFLICT' using errcode='40001';end if;
end$f$;
create or replace function snote_private.registration_expire()
returns void language sql security definer set search_path='' as $f$
 update snote_private.registration_applications set stage='expired'
 where (stage='draft' and draft_expires_at<=clock_timestamp())
 or (stage='pending_auth' and ready_at<=clock_timestamp()-interval '24 hours');
$f$;
create or replace function snote_private.registration_bucket()
returns void language plpgsql security definer set search_path='' as $f$
begin
 if not exists(select 1 from storage.buckets where id='snote-registration-documents' and public=false
  and file_size_limit=5242880 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']) then
  raise exception 'REGISTRATION_STORAGE_UNAVAILABLE' using errcode='55000';end if;
end$f$;

create or replace function snote_private.registration_profile(p_profile jsonb)
returns jsonb language plpgsql immutable set search_path='' as $f$
declare key text;value text;result jsonb:='{}';phone text;email text;business text;
begin
 if jsonb_typeof(p_profile) is distinct from 'object' or octet_length(p_profile::text)>8000
  or (select count(*) from jsonb_object_keys(p_profile))<>8 then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 for key,value in select k,v#>>'{}' from jsonb_each(p_profile) x(k,v) loop
  if key not in('kind','companyName','businessNumber','representativeName','businessAddress','displayName','phone','email')
   or jsonb_typeof(p_profile->key)<>'string' or value~'[[:cntrl:]]' then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
  result:=result||jsonb_build_object(key,btrim(value));
 end loop;
 phone:=snote_private.registration_phone(result->>'phone');email:=snote_private.registration_email(result->>'email');
 business:=regexp_replace(result->>'businessNumber','[ -]','','g');
 if result->>'kind' not in('representative','dealer') or length(result->>'companyName') not between 2 and 100
  or length(snote_private.registration_name(result->>'companyName'))<2 or business!~'^[0-9]{10}$'
  or length(result->>'representativeName') not between 1 and 100 or length(result->>'businessAddress') not between 1 and 300
  or length(result->>'displayName') not between 1 and 40 or phone='' or length(email) not between 3 and 254
  or email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 return result||jsonb_build_object('phone',phone,'email',email,'businessNumber',business);
end$f$;

create or replace function snote_private.registration_documents(p_id uuid,p_documents jsonb)
returns jsonb language plpgsql immutable set search_path='' as $f$
declare doc jsonb;key text;slot text;ext text;result jsonb:='[]';
begin
 if p_id is null or jsonb_typeof(p_documents) is distinct from 'array' or jsonb_array_length(p_documents)<>2 or octet_length(p_documents::text)>8000 then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 for doc in select value from jsonb_array_elements(p_documents) order by value->>'slot' loop
  if jsonb_typeof(doc)<>'object' or (select count(*) from jsonb_object_keys(doc))<>6 then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
  for key in select jsonb_object_keys(doc) loop
   if key not in('slot','path','mimeType','size','sha256','originalName') or (key<>'size' and jsonb_typeof(doc->key)<>'string') then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
  end loop;
  slot:=doc->>'slot';ext:=case doc->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if slot not in('business','dealer') or ext is null
   or doc->>'path' !~ ('^'||p_id::text||'/'||slot||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.'||ext||'$')
   or jsonb_typeof(doc->'size')<>'number' or (doc->>'size')!~'^[0-9]{1,7}$' or (doc->>'size')::bigint not between 1 and 5242880
   or doc->>'sha256'!~'^[0-9a-f]{64}$' or length(doc->>'originalName') not between 1 and 180 or doc->>'originalName'~'[[:cntrl:]]'
   then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
  result:=result||jsonb_build_array(doc);
 end loop;
 if (select count(distinct value->>'slot') from jsonb_array_elements(result))<>2 then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 return result;
end$f$;

create or replace function snote_private.registration_company_assert(p_name text,p_business text,p_company uuid default null,p_app uuid default null)
returns void language plpgsql stable security definer set search_path='' as $f$
begin
 if exists(select 1 from public.zc_companies where id is distinct from p_company
  and ((p_name<>'' and snote_private.registration_name(name)=snote_private.registration_name(p_name))
   or (p_business<>'' and regexp_replace(business_number,'[^0-9]','','g')=p_business)))
 or exists(select 1 from snote_private.registration_applications where id is distinct from p_app and stage in('draft','pending_auth')
  and ((p_name<>'' and company_key=snote_private.registration_name(p_name)) or (p_business<>'' and business_number=p_business))) then raise exception 'COMPANY_EXISTS';end if;
end$f$;
create or replace function snote_private.registration_contact_assert(p_email text,p_phone text,p_user uuid default null,p_app uuid default null)
returns void language plpgsql stable security definer set search_path='' as $f$
begin
 if exists(select 1 from auth.users where id is distinct from p_user
  and ((p_email<>'' and snote_private.registration_email(email)=p_email) or(p_phone<>'' and snote_private.registration_phone(phone)=p_phone)))
 or (p_phone<>'' and (exists(select 1 from public.zc_members where user_id is distinct from p_user and snote_private.registration_phone(phone)=p_phone)
  or exists(select 1 from snote_private.member_profiles where user_id is distinct from p_user and snote_private.registration_phone(phone)=p_phone)))
 or exists(select 1 from snote_private.registration_applications where id is distinct from p_app and stage in('draft','pending_auth')
  and ((p_email<>'' and email=p_email)or(p_phone<>'' and phone=p_phone))) then raise exception 'CONTACT_EXISTS';end if;
end$f$;

create or replace function snote_private.registration_object_assert(p_documents jsonb)
returns void language plpgsql security definer set search_path='' as $f$
declare doc jsonb;obj storage.objects;
begin
 perform snote_private.registration_bucket();
 for doc in select value from jsonb_array_elements(p_documents) loop
  select * into obj from storage.objects where bucket_id='snote-registration-documents' and name=doc->>'path' for share;
  if not found or obj.metadata->>'mimetype' is distinct from doc->>'mimeType'
   or jsonb_typeof(obj.metadata->'size') is distinct from 'number' or obj.metadata->>'size' is distinct from doc->>'size' then raise exception 'REGISTRATION_DOCUMENTS_REQUIRED' using errcode='22023';end if;
 end loop;
end$f$;

create or replace function snote_private.registration_company_check(p_name text)
returns jsonb language plpgsql security definer set search_path='' as $f$
begin
 perform snote_private.registration_service();
 if p_name is null or length(btrim(p_name)) not between 2 and 100 or p_name~'[[:cntrl:]]' or length(snote_private.registration_name(p_name))<2 then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 perform snote_private.registration_lock();perform snote_private.registration_expire();
 return jsonb_build_object('ok',true,'available',not(exists(select 1 from public.zc_companies where snote_private.registration_name(name)=snote_private.registration_name(p_name))
  or exists(select 1 from snote_private.registration_applications where stage in('draft','pending_auth') and company_key=snote_private.registration_name(p_name))));
end$f$;
create or replace function snote_private.registration_prepare(p_id uuid,p_profile jsonb,p_documents jsonb)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare profile jsonb;documents jsonb;app snote_private.registration_applications;
begin
 perform snote_private.registration_service();profile:=snote_private.registration_profile(p_profile);documents:=snote_private.registration_documents(p_id,p_documents);
 perform snote_private.registration_bucket();perform snote_private.registration_lock();perform snote_private.registration_expire();
 select * into app from snote_private.registration_applications where id=p_id for update;
 if found then
  if app.profile is distinct from profile or app.documents is distinct from documents then raise exception 'REGISTRATION_CONFLICT' using errcode='40001';end if;
  if app.stage in('expired','cancelled') then raise exception 'REGISTRATION_EXPIRED' using errcode='22023';end if;
  return jsonb_build_object('ok',true,'id',app.id,'stage',app.stage,'expiresAt',app.draft_expires_at);
 end if;
 perform snote_private.registration_company_assert(profile->>'companyName',profile->>'businessNumber');
 perform snote_private.registration_contact_assert(profile->>'email',profile->>'phone');
 insert into snote_private.registration_applications(id,profile,documents,company_key,business_number,email,phone)
  values(p_id,profile,documents,snote_private.registration_name(profile->>'companyName'),profile->>'businessNumber',profile->>'email',profile->>'phone') returning * into app;
 return jsonb_build_object('ok',true,'id',app.id,'stage',app.stage,'expiresAt',app.draft_expires_at);
end$f$;
create or replace function snote_private.registration_ready(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare app snote_private.registration_applications;matching_user uuid;
begin
 perform snote_private.registration_service();perform snote_private.registration_lock();perform snote_private.registration_expire();
 select * into app from snote_private.registration_applications where id=p_id for update;
 if not found or app.stage not in('draft','pending_auth') then raise exception 'REGISTRATION_EXPIRED' using errcode='22023';end if;
 select min(id::text)::uuid into matching_user from auth.users where snote_private.registration_email(email)=app.email
  and created_at>=app.created_at-interval '5 seconds' having count(*)=1;
 perform snote_private.registration_company_assert(app.profile->>'companyName',app.business_number,null,app.id);
 perform snote_private.registration_contact_assert(app.email,app.phone,matching_user,app.id);
 perform snote_private.registration_object_assert(app.documents);
 update snote_private.registration_applications set stage='pending_auth',ready_at=coalesce(ready_at,clock_timestamp()) where id=app.id;
 return jsonb_build_object('ok',true,'id',app.id,'stage','pending_auth');
end$f$;
create or replace function snote_private.registration_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare app snote_private.registration_applications;
begin
 perform snote_private.registration_service();perform snote_private.registration_lock();
 select * into app from snote_private.registration_applications where id=p_id for update;
 if not found or app.stage not in('draft','pending_auth','expired') or app.user_id is not null
  or exists(select 1 from auth.users where snote_private.registration_email(email)=app.email and created_at>=app.created_at-interval '5 seconds') then return jsonb_build_object('ok',true,'cancelled',false);end if;
 update snote_private.registration_applications set stage='cancelled' where id=app.id;
 return jsonb_build_object('ok',true,'cancelled',true);
end$f$;

create or replace function snote_private.registration_complete()
returns jsonb language plpgsql security definer set search_path='' as $f$
declare actor uuid:=auth.uid();person auth.users;app snote_private.registration_applications;company uuid;assigned_role text;v_email text;
begin
 if actor is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 -- Pin preexisting actor rows BEFORE the registration lock. Identity triggers
 -- use try-locks and never wait for this lock while holding legacy row locks.
 perform 1 from auth.users where id=actor for share;
 perform 1 from public.zc_members where user_id=actor for update;
 perform 1 from snote_private.member_profiles where user_id=actor for update;
 perform snote_private.registration_lock();perform snote_private.registration_expire();
 select * into person from auth.users where id=actor;
 if not found or person.email_confirmed_at is null or person.deleted_at is not null or coalesce(person.is_anonymous,false)
  or (person.banned_until is not null and person.banned_until>clock_timestamp()) then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 select * into app from snote_private.registration_applications where user_id=actor and stage='completed';
 if found then
  if app.company_id is null or not exists(select 1 from public.zc_members where user_id=actor and company_id=app.company_id and active and role=case app.profile->>'kind' when 'representative' then 'admin' else 'dealer' end) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  return jsonb_build_object('ok',true,'companyId',app.company_id,'role',case app.profile->>'kind' when 'representative' then 'admin' else 'dealer' end);
 end if;
 if exists(select 1 from public.zc_members where user_id=actor) then return jsonb_build_object('ok',false,'code','REGISTRATION_REQUIRED');end if;
 v_email:=snote_private.registration_email(person.email);
 select * into app from snote_private.registration_applications where registration_applications.email=v_email
  and stage in('pending_auth','expired') and ready_at is not null and (user_id is null or user_id=actor)
  and person.created_at>=created_at-interval '5 seconds' order by created_at desc limit 1 for update;
 if not found then return jsonb_build_object('ok',false,'code','REGISTRATION_REQUIRED');end if;
 perform snote_private.registration_company_assert(app.profile->>'companyName',app.business_number,null,app.id);
 perform snote_private.registration_contact_assert(app.email,app.phone,actor,app.id);
 perform snote_private.registration_object_assert(app.documents);
 -- Binding is private and transaction-local until all inserts succeed; it also
 -- identifies this reservation to the narrow table guards below.
 update snote_private.registration_applications set user_id=actor where id=app.id;
 assigned_role:=case app.profile->>'kind' when 'representative' then 'admin' else 'dealer' end;
 insert into public.zc_companies(name,business_number,representative_name,business_address)
  values(app.profile->>'companyName',app.business_number,app.profile->>'representativeName',app.profile->>'businessAddress') returning id into company;
 insert into public.zc_members(user_id,company_id,role,display_name,phone)
  values(actor,company,assigned_role,app.profile->>'displayName',app.phone);
 insert into snote_private.member_profiles(user_id,phone,revision) values(actor,app.phone,1)
  on conflict(user_id) do update set phone=excluded.phone,revision=member_profiles.revision+1,updated_at=clock_timestamp();
 insert into zc_private.rrn_keys(company_id,secret) values(company,encode(extensions.gen_random_bytes(32),'hex'));
 update snote_private.registration_applications set stage='completed',company_id=company,completed_at=clock_timestamp() where id=app.id;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(company,actor,'registration',app.id::text,'registration_completed');
 return jsonb_build_object('ok',true,'companyId',company,'role',assigned_role);
end$f$;

-- Reject new identity collisions across old settings/operator/Auth paths too.
-- Existing unchanged legacy values, normal sign-ins and metadata-only updates
-- acquire no registration lock and are never rewritten by this migration.
create or replace function snote_private.registration_company_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare app uuid;name_changed boolean;business_changed boolean;
begin
 name_changed:=tg_op='INSERT';business_changed:=tg_op='INSERT';
 if tg_op='UPDATE' then name_changed:=snote_private.registration_name(new.name) is distinct from snote_private.registration_name(old.name);business_changed:=regexp_replace(new.business_number,'[^0-9]','','g') is distinct from regexp_replace(old.business_number,'[^0-9]','','g');end if;
 if not name_changed and not business_changed then return new;end if;
 perform snote_private.registration_lock(false);perform snote_private.registration_expire();
 select id into app from snote_private.registration_applications where user_id=auth.uid() and stage in('pending_auth','expired') and ready_at is not null;
 -- Only changed keys are checked: changing an unrelated legacy field cannot
 -- retroactively fail because another old row already has its unchanged key.
 perform snote_private.registration_company_assert(case when name_changed then new.name else '' end,
  case when business_changed then regexp_replace(new.business_number,'[^0-9]','','g') else '' end,new.id,app);
 return new;
end$f$;
create or replace function snote_private.registration_contact_guard()
returns trigger language plpgsql security definer set search_path='' as $f$
declare actor uuid;email text:='';phone text:='';app uuid;stamp timestamptz;email_changed boolean:=false;phone_changed boolean:=false;
begin
 if tg_table_schema='auth' then
  actor:=new.id;stamp:=new.created_at;
  email_changed:=tg_op='INSERT';phone_changed:=tg_op='INSERT';
  if tg_op='UPDATE' then email_changed:=snote_private.registration_email(new.email) is distinct from snote_private.registration_email(old.email);phone_changed:=snote_private.registration_phone(new.phone) is distinct from snote_private.registration_phone(old.phone);end if;
  if email_changed then email:=snote_private.registration_email(new.email);end if;
  if phone_changed then phone:=snote_private.registration_phone(new.phone);end if;
 else
  actor:=new.user_id;phone_changed:=tg_op='INSERT';
  if tg_op='UPDATE' then phone_changed:=snote_private.registration_phone(new.phone) is distinct from snote_private.registration_phone(old.phone);end if;
  if phone_changed then phone:=snote_private.registration_phone(new.phone);end if;
 end if;
 if email='' and phone='' then return new;end if;
 perform snote_private.registration_lock(false);perform snote_private.registration_expire();
 if tg_table_schema='auth' then
  select id into app from snote_private.registration_applications where registration_applications.email=snote_private.registration_email(new.email)
   and stage='pending_auth' and new.created_at>=created_at-interval '5 seconds' limit 1;
 else
  select id into app from snote_private.registration_applications where user_id=actor and stage in('pending_auth','expired') and ready_at is not null limit 1;
 end if;
 perform snote_private.registration_contact_assert(email,phone,actor,app);
 return new;
end$f$;
drop trigger if exists snote_registration_company_guard on public.zc_companies;
create trigger snote_registration_company_guard before insert or update of name,business_number on public.zc_companies for each row execute function snote_private.registration_company_guard();
drop trigger if exists snote_registration_member_guard on public.zc_members;
create trigger snote_registration_member_guard before insert or update of phone on public.zc_members for each row execute function snote_private.registration_contact_guard();
drop trigger if exists snote_registration_profile_guard on snote_private.member_profiles;
create trigger snote_registration_profile_guard before insert or update of phone on snote_private.member_profiles for each row execute function snote_private.registration_contact_guard();
drop trigger if exists snote_registration_auth_guard on auth.users;
create trigger snote_registration_auth_guard before insert or update of email,phone on auth.users for each row execute function snote_private.registration_contact_guard();

create or replace function snote_private.registration_rate_limit(p_key text,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare stamp timestamptz:=clock_timestamp();period interval;budget integer;count integer;first timestamptz;
begin
 perform snote_private.registration_service();
 if p_key is null or p_key!~'^[0-9a-f]{64}$' or p_action is null or p_action not in('check-company','register') then raise exception 'VALIDATION_ERROR' using errcode='22023';end if;
 period:=case p_action when 'check-company' then interval '1 minute' else interval '1 hour' end;budget:=case p_action when 'check-company' then 60 else 20 end;
 perform pg_advisory_xact_lock(hashtextextended('snote-registration-rate:'||p_action||':'||p_key,0));
 delete from snote_private.registration_rate_events where key=p_key and action=p_action and created_at<=stamp-period;
 select count(*)::integer,min(created_at) into count,first from snote_private.registration_rate_events where key=p_key and action=p_action and created_at>stamp-period;
 if count>=budget then return jsonb_build_object('ok',false,'code','RATE_LIMITED','retryAfter',greatest(1,ceil(extract(epoch from(first+period-stamp)))::integer));end if;
 insert into snote_private.registration_rate_events(key,action,created_at) values(p_key,p_action,stamp);
 return jsonb_build_object('ok',true);
end$f$;

create or replace function public.snote_registration_company_check(p_name text) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_company_check(p_name);$f$;
create or replace function public.snote_registration_prepare(p_id uuid,p_profile jsonb,p_documents jsonb) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_prepare(p_id,p_profile,p_documents);$f$;
create or replace function public.snote_registration_ready(p_id uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_ready(p_id);$f$;
create or replace function public.snote_registration_cancel(p_id uuid) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_cancel(p_id);$f$;
create or replace function public.snote_registration_complete() returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_complete();$f$;
create or replace function public.snote_registration_rate_limit(p_key text,p_action text) returns jsonb language sql security invoker set search_path='' as $f$select snote_private.registration_rate_limit(p_key,p_action);$f$;

-- Legacy metadata/bootstrap cannot create an unverified administrator or skip
-- evidence/uniqueness checks. Invitation joins retain their exact existing body.
create or replace function public.zc_bootstrap_company(p_name text,p_display_name text)
returns uuid language plpgsql security invoker set search_path='' as $f$
declare result jsonb;
begin
 result:=snote_private.registration_complete();
 if result->>'ok' is distinct from 'true' or result->>'role' is distinct from 'admin' then raise exception 'REGISTRATION_REQUIRED' using errcode='42501';end if;
 return (result->>'companyId')::uuid;
end$f$;

revoke all on function snote_private.registration_service(),snote_private.registration_name(text),snote_private.registration_email(text),snote_private.registration_phone(text),snote_private.registration_lock(boolean),snote_private.registration_expire(),snote_private.registration_bucket(),snote_private.registration_profile(jsonb),snote_private.registration_documents(uuid,jsonb),snote_private.registration_company_assert(text,text,uuid,uuid),snote_private.registration_contact_assert(text,text,uuid,uuid),snote_private.registration_object_assert(jsonb),snote_private.registration_company_guard(),snote_private.registration_contact_guard() from public,anon,authenticated,service_role;
revoke all on function snote_private.registration_company_check(text),snote_private.registration_prepare(uuid,jsonb,jsonb),snote_private.registration_ready(uuid),snote_private.registration_cancel(uuid),snote_private.registration_complete(),snote_private.registration_rate_limit(text,text) from public,anon,authenticated,service_role;
revoke all on function public.snote_registration_company_check(text),public.snote_registration_prepare(uuid,jsonb,jsonb),public.snote_registration_ready(uuid),public.snote_registration_cancel(uuid),public.snote_registration_complete(),public.snote_registration_rate_limit(text,text) from public,anon,authenticated,service_role;
grant execute on function snote_private.registration_company_check(text),snote_private.registration_prepare(uuid,jsonb,jsonb),snote_private.registration_ready(uuid),snote_private.registration_cancel(uuid),snote_private.registration_rate_limit(text,text),public.snote_registration_company_check(text),public.snote_registration_prepare(uuid,jsonb,jsonb),public.snote_registration_ready(uuid),public.snote_registration_cancel(uuid),public.snote_registration_rate_limit(text,text) to service_role;
grant execute on function snote_private.registration_complete(),public.snote_registration_complete() to authenticated;
revoke all on function public.zc_bootstrap_company(text,text) from public,anon,service_role;
grant execute on function public.zc_bootstrap_company(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
