-- Personal phone changes require a server-delivered, single-use possession proof.
-- The existing registered SMS sender and saved historical private address stay intact.
grant usage on schema snote_private to service_role;

create table if not exists snote_private.profile_phone_challenges (
 user_id uuid primary key references auth.users(id) on delete cascade,
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 challenge_id uuid not null unique,
 phone text not null check(phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$'),
 expected_profile jsonb not null,
 otp_hash text check(otp_hash ~ '^[0-9a-f]{64}$'),
 verified_hash text check(verified_hash ~ '^[0-9a-f]{64}$'),
 expires_at timestamptz not null,
 delivery_status text not null check(delivery_status in('pending','sent','failed','unknown')),
 attempts integer not null default 0 check(attempts between 0 and 5),
 created_at timestamptz not null default clock_timestamp(),
 consumed_at timestamptz
);
create table if not exists snote_private.profile_phone_sends (
 challenge_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 phone_hash text not null check(phone_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index if not exists profile_phone_sends_actor_time on snote_private.profile_phone_sends(user_id,created_at);
create index if not exists profile_phone_sends_phone_time on snote_private.profile_phone_sends(phone_hash,created_at);
alter table snote_private.profile_phone_challenges enable row level security;
alter table snote_private.profile_phone_sends enable row level security;
revoke all on snote_private.profile_phone_challenges,snote_private.profile_phone_sends from public,anon,authenticated,service_role;

create or replace function snote_private.profile_actor_snapshot(p_actor uuid,p_company uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('user_id',m.user_id,'company_id',m.company_id,'role',m.role,
  'display_name',m.display_name,'company_name',c.name,
  'phone',coalesce(p.phone,case when m.phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' then m.phone end,''),
  'address',concat_ws(' ',nullif(btrim(c.business_address),''),nullif(btrim(c.business_address_detail),'')),
  'company_address',concat_ws(' ',nullif(btrim(c.business_address),''),nullif(btrim(c.business_address_detail),'')),
  'revision',coalesce(p.revision,0))
 from public.zc_members m join public.zc_companies c on c.id=m.company_id
 join auth.users u on u.id=m.user_id left join snote_private.member_profiles p on p.user_id=m.user_id
 where m.user_id=p_actor and (p_company is null or m.company_id=p_company)
  and m.active is true and m.role in('admin','dealer','accountant')
  and (u.banned_until is null or u.banned_until<=clock_timestamp());
$$;

create or replace function snote_private.profile_check_expected(p_expected jsonb,p_current jsonb,p_phone boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare k text;v_revision numeric;
begin
 if p_expected is null or jsonb_typeof(p_expected)<>'object' or octet_length(p_expected::text)>2000 then
  raise exception 'INVALID_EXPECTED_PROFILE' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_expected) loop
  if k not in('user_id','company_id','display_name','company_name','revision','phone') then
   raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
 end loop;
 foreach k in array array['user_id','company_id','display_name','company_name'] loop
  if jsonb_typeof(p_expected->k) is distinct from 'string' then raise exception 'INVALID_EXPECTED_PROFILE' using errcode='22023';end if;
 end loop;
 if jsonb_typeof(p_expected->'revision') is distinct from 'number'
  or (p_phone and jsonb_typeof(p_expected->'phone') is distinct from 'string')
  or (p_expected?'phone' and jsonb_typeof(p_expected->'phone') is distinct from 'string')
  or p_expected->>'user_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or p_expected->>'company_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  raise exception 'INVALID_EXPECTED_PROFILE' using errcode='22023';end if;
 v_revision:=(p_expected->>'revision')::numeric;
 if v_revision<0 or v_revision>9007199254740991 or v_revision<>trunc(v_revision) then
  raise exception 'INVALID_EXPECTED_PROFILE' using errcode='22023';end if;
 if p_current is null
  or (p_expected->>'user_id')::uuid is distinct from (p_current->>'user_id')::uuid
  or (p_expected->>'company_id')::uuid is distinct from (p_current->>'company_id')::uuid
  or p_expected->'display_name' is distinct from p_current->'display_name'
  or p_expected->'company_name' is distinct from p_current->'company_name'
  or p_expected->'revision' is distinct from p_current->'revision'
  or (p_expected?'phone' and p_expected->'phone' is distinct from p_current->'phone') then
  raise exception 'PROFILE_CONFLICT' using errcode='40001';end if;
end;$$;

create or replace function snote_private.profile_lock_actor(p_actor uuid,p_company uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.zc_members where user_id=p_actor and company_id=p_company
  and active is true and role in('admin','dealer','accountant') for update;
 if not found or not exists(select 1 from auth.users where id=p_actor and (banned_until is null or banned_until<=clock_timestamp())) then
  raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 perform 1 from public.zc_companies where id=p_company for update;
 if not found then raise exception 'COMPANY_UNAVAILABLE' using errcode='42501';end if;
 perform 1 from snote_private.member_profiles where user_id=p_actor for update;
 return snote_private.profile_actor_snapshot(p_actor,p_company);
end;$$;

create or replace function snote_private.profile_read()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_result jsonb;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 v_result:=snote_private.profile_actor_snapshot(v_actor);
 if v_result is null then raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';end if;
 return v_result;
end;$$;

create or replace function snote_private.profile_save(p_expected jsonb,p_profile jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_company uuid;v_current jsonb;k text;v_name text;v_company_name text;v_phone text;
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 select company_id into v_company from public.zc_members where user_id=v_actor;
 v_current:=snote_private.profile_lock_actor(v_actor,v_company);
 perform snote_private.profile_check_expected(p_expected,v_current);
 if p_profile is null or jsonb_typeof(p_profile)<>'object' or octet_length(p_profile::text)>5000 then
  raise exception 'INVALID_PROFILE' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_profile) loop
  if k not in('display_name','company_name','phone','address') then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
 end loop;
 foreach k in array array['display_name','company_name'] loop
  if jsonb_typeof(p_profile->k) is distinct from 'string' then raise exception 'INVALID_PROFILE_FIELD' using errcode='22023';end if;
 end loop;
 if p_profile?'phone' and (jsonb_typeof(p_profile->'phone') is distinct from 'string' or p_profile->>'phone' is distinct from v_current->>'phone') then
  raise exception 'PHONE_VERIFICATION_REQUIRED' using errcode='42501';end if;
 if p_profile?'address' and (jsonb_typeof(p_profile->'address') is distinct from 'string' or p_profile->>'address' is distinct from v_current->>'address') then
  raise exception 'COMPANY_ADDRESS_READONLY' using errcode='42501';end if;
 v_name:=btrim(p_profile->>'display_name');v_company_name:=btrim(p_profile->>'company_name');v_phone:=v_current->>'phone';
 if char_length(v_name) not between 1 and 40 or char_length(v_company_name) not between 2 and 100 then
  raise exception 'INVALID_PROFILE_VALUE' using errcode='22023';end if;
 if v_company_name is distinct from v_current->>'company_name' and v_current->>'role'<>'admin' then
  raise exception 'COMPANY_ADMIN_REQUIRED' using errcode='42501';end if;
 update public.zc_members set display_name=v_name where user_id=v_actor and company_id=v_company;
 if v_company_name is distinct from v_current->>'company_name' then update public.zc_companies set name=v_company_name where id=v_company;end if;
 -- Metadata-only legacy users can save a name without inventing an unverified phone.
 if v_phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' then
  insert into snote_private.member_profiles(user_id,phone,revision) values(v_actor,v_phone,1)
  on conflict(user_id) do update set revision=member_profiles.revision+1,updated_at=clock_timestamp();
 end if;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(v_company,v_actor,'member_profile',v_actor::text,'self_profile_update');
 return snote_private.profile_actor_snapshot(v_actor,v_company);
end;$$;

create or replace function snote_private.profile_phone_failure(p_code text,p_message text,p_retry_after integer default null)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('ok',false,'code',p_code,'message',p_message)
  ||case when p_retry_after is null then '{}'::jsonb else jsonb_build_object('retryAfter',greatest(1,p_retry_after)) end;
$$;

create or replace function snote_private.profile_phone_challenge(p_actor uuid,p_company uuid,p_phone text,p_expected jsonb,p_challenge_id uuid,p_otp_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_current jsonb;v_row snote_private.profile_phone_challenges;v_hash text;v_now timestamptz;v_actor_count integer;v_phone_count integer;v_first timestamptz;v_last timestamptz;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if p_actor is null or p_company is null or p_challenge_id is null or p_phone is null or p_phone!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$'
  or p_otp_hash is null or p_otp_hash!~'^[0-9a-f]{64}$' then return snote_private.profile_phone_failure('VALIDATION_ERROR','인증 요청을 확인해 주세요.');end if;
 begin v_current:=snote_private.profile_lock_actor(p_actor,p_company);perform snote_private.profile_check_expected(p_expected,v_current,true);
 exception when insufficient_privilege then return snote_private.profile_phone_failure('FORBIDDEN','현재 계정의 권한을 확인해 주세요.');
 when serialization_failure then return snote_private.profile_phone_failure('PROFILE_CONFLICT','프로필이 변경되었습니다. 다시 불러와 주세요.');
 when invalid_parameter_value then return snote_private.profile_phone_failure('VALIDATION_ERROR','프로필 정보를 확인해 주세요.');end;
 select * into v_row from snote_private.profile_phone_challenges where user_id=p_actor for update;
 if v_row.challenge_id=p_challenge_id and v_row.company_id=p_company and v_row.phone=p_phone and v_row.expected_profile=p_expected then
  return jsonb_build_object('ok',true,'claimed',false,'challengeId',v_row.challenge_id,'phone',v_row.phone,'expiresAt',v_row.expires_at,'retryAfter',60,
   'status',case when v_row.consumed_at is not null then 'verified' else v_row.delivery_status end);end if;
 if exists(select 1 from snote_private.profile_phone_sends where challenge_id=p_challenge_id) then return snote_private.profile_phone_failure('REQUEST_REUSED','새 인증번호를 요청해 주세요.');end if;
 if p_phone=v_current->>'phone' then return snote_private.profile_phone_failure('VALIDATION_ERROR','변경할 새 휴대전화 번호를 입력해 주세요.');end if;
 v_hash:=encode(sha256(convert_to(p_phone,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('snote-profile-phone:'||v_hash,0));v_now:=clock_timestamp();
 select max(created_at) into v_last from snote_private.profile_phone_sends where user_id=p_actor or phone_hash=v_hash;
 if v_last>v_now-interval '60 seconds' then return snote_private.profile_phone_failure('RATE_LIMITED','인증번호는 60초 후 다시 요청할 수 있습니다.',ceil(extract(epoch from(v_last+interval '60 seconds'-v_now)))::integer);end if;
 select count(*),min(created_at) into v_actor_count,v_first from snote_private.profile_phone_sends where user_id=p_actor and created_at>v_now-interval '1 hour';
 if v_actor_count>=5 then return snote_private.profile_phone_failure('RATE_LIMITED','인증번호 발송 횟수가 많습니다. 잠시 후 다시 시도해 주세요.',ceil(extract(epoch from(v_first+interval '1 hour'-v_now)))::integer);end if;
 select count(*),min(created_at) into v_phone_count,v_first from snote_private.profile_phone_sends where phone_hash=v_hash and created_at>v_now-interval '1 hour';
 if v_phone_count>=10 then return snote_private.profile_phone_failure('RATE_LIMITED','이 휴대전화의 인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.',ceil(extract(epoch from(v_first+interval '1 hour'-v_now)))::integer);end if;
 insert into snote_private.profile_phone_sends(challenge_id,user_id,phone_hash,created_at) values(p_challenge_id,p_actor,v_hash,v_now);
 insert into snote_private.profile_phone_challenges(user_id,company_id,challenge_id,phone,expected_profile,otp_hash,expires_at,delivery_status,attempts,created_at)
 values(p_actor,p_company,p_challenge_id,p_phone,p_expected,p_otp_hash,v_now+interval '5 minutes','pending',0,v_now)
 on conflict(user_id) do update set company_id=excluded.company_id,challenge_id=excluded.challenge_id,phone=excluded.phone,expected_profile=excluded.expected_profile,
  otp_hash=excluded.otp_hash,verified_hash=null,expires_at=excluded.expires_at,delivery_status='pending',attempts=0,created_at=excluded.created_at,consumed_at=null;
 return jsonb_build_object('ok',true,'claimed',true,'challengeId',p_challenge_id,'phone',p_phone,'expiresAt',v_now+interval '5 minutes','retryAfter',60,'status','pending');
end;$$;

create or replace function snote_private.profile_phone_delivery(p_actor uuid,p_company uuid,p_challenge_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row snote_private.profile_phone_challenges;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if p_actor is null or p_company is null or p_challenge_id is null or p_status is null or p_status not in('sent','failed','unknown') then return snote_private.profile_phone_failure('VALIDATION_ERROR','문자 접수 상태를 확인해 주세요.');end if;
 begin perform snote_private.profile_lock_actor(p_actor,p_company);exception when insufficient_privilege then return snote_private.profile_phone_failure('FORBIDDEN','현재 계정의 권한을 확인해 주세요.');end;
 select * into v_row from snote_private.profile_phone_challenges where user_id=p_actor and company_id=p_company for update;
 if not found or v_row.challenge_id is distinct from p_challenge_id then return snote_private.profile_phone_failure('INVALID_CODE','현재 인증 요청이 아닙니다.');end if;
 if v_row.consumed_at is not null or v_row.delivery_status=p_status then return jsonb_build_object('ok',true);end if;
 if v_row.delivery_status<>'pending' and not(v_row.delivery_status='sent' and p_status='unknown') then return snote_private.profile_phone_failure('INVALID_CODE','이미 처리된 인증 요청입니다.');end if;
 if p_status='sent' and (v_row.otp_hash is null or v_row.expires_at<=clock_timestamp()) then
  update snote_private.profile_phone_challenges set delivery_status='unknown',otp_hash=null where user_id=p_actor;
  return snote_private.profile_phone_failure('EXPIRED','인증번호 유효기간이 지났습니다. 새 인증번호를 요청해 주세요.');end if;
 update snote_private.profile_phone_challenges set delivery_status=p_status,otp_hash=case when p_status='sent' then otp_hash else null end where user_id=p_actor;
 return jsonb_build_object('ok',true);
end;$$;

create or replace function snote_private.profile_phone_verify(p_actor uuid,p_company uuid,p_challenge_id uuid,p_otp_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_current jsonb;v_row snote_private.profile_phone_challenges;v_now timestamptz;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if p_actor is null or p_company is null or p_challenge_id is null or p_otp_hash is null or p_otp_hash!~'^[0-9a-f]{64}$' then return snote_private.profile_phone_failure('VALIDATION_ERROR','인증 입력을 확인해 주세요.');end if;
 begin v_current:=snote_private.profile_lock_actor(p_actor,p_company);exception when insufficient_privilege then return snote_private.profile_phone_failure('FORBIDDEN','현재 계정의 권한을 확인해 주세요.');end;
 select * into v_row from snote_private.profile_phone_challenges where user_id=p_actor and company_id=p_company for update;
 if not found or v_row.challenge_id is distinct from p_challenge_id then return snote_private.profile_phone_failure('INVALID_CODE','현재 인증번호를 확인해 주세요.');end if;
 v_now:=clock_timestamp();
 if v_row.expires_at<=v_now then update snote_private.profile_phone_challenges set otp_hash=null,verified_hash=null where user_id=p_actor;return snote_private.profile_phone_failure('EXPIRED','인증번호 유효기간이 지났습니다. 새 인증번호를 요청해 주세요.');end if;
 if v_row.consumed_at is not null then
  if v_row.verified_hash=p_otp_hash and v_current->>'phone'=v_row.phone then return jsonb_build_object('ok',true,'alreadyProcessed',true,'profile',v_current);end if;
  return snote_private.profile_phone_failure('INVALID_CODE','이미 처리된 인증 요청입니다.');end if;
 begin perform snote_private.profile_check_expected(v_row.expected_profile,v_current,true);
 exception when serialization_failure then update snote_private.profile_phone_challenges set otp_hash=null,delivery_status='unknown' where user_id=p_actor;return snote_private.profile_phone_failure('PROFILE_CONFLICT','프로필이 변경되었습니다. 다시 불러와 인증해 주세요.');end;
 if v_row.attempts>=5 then return snote_private.profile_phone_failure('LOCKED','인증 시도 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.');end if;
 if v_row.delivery_status<>'sent' or v_row.otp_hash is null then return snote_private.profile_phone_failure('INVALID_CODE','사용할 수 없는 인증번호입니다. 새 인증번호를 요청해 주세요.');end if;
 if v_row.otp_hash<>p_otp_hash then
  update snote_private.profile_phone_challenges set attempts=attempts+1,otp_hash=case when attempts+1>=5 then null else otp_hash end where user_id=p_actor;
  return snote_private.profile_phone_failure(case when v_row.attempts+1>=5 then 'LOCKED' else 'INVALID_CODE' end,'인증번호가 일치하지 않습니다. 다시 확인해 주세요.');end if;
 insert into snote_private.member_profiles(user_id,phone,revision,updated_at) values(p_actor,v_row.phone,1,v_now)
 on conflict(user_id) do update set phone=excluded.phone,revision=member_profiles.revision+1,updated_at=excluded.updated_at;
 update snote_private.profile_phone_challenges set consumed_at=v_now,verified_hash=otp_hash,otp_hash=null where user_id=p_actor;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,p_actor,'member_profile',p_actor::text,'personal_phone_verified');
 return jsonb_build_object('ok',true,'profile',snote_private.profile_actor_snapshot(p_actor,p_company));
end;$$;

revoke all on function snote_private.profile_actor_snapshot(uuid,uuid),snote_private.profile_check_expected(jsonb,jsonb,boolean),snote_private.profile_lock_actor(uuid,uuid),snote_private.profile_phone_failure(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function snote_private.profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text),snote_private.profile_phone_delivery(uuid,uuid,uuid,text),snote_private.profile_phone_verify(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function snote_private.profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text),snote_private.profile_phone_delivery(uuid,uuid,uuid,text),snote_private.profile_phone_verify(uuid,uuid,uuid,text) to service_role;

create or replace function public.snote_profile_phone_challenge(p_actor uuid,p_company uuid,p_phone text,p_expected jsonb,p_challenge_id uuid,p_otp_hash text)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.profile_phone_challenge(p_actor,p_company,p_phone,p_expected,p_challenge_id,p_otp_hash);$$;
create or replace function public.snote_profile_phone_delivery(p_actor uuid,p_company uuid,p_challenge_id uuid,p_status text)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.profile_phone_delivery(p_actor,p_company,p_challenge_id,p_status);$$;
create or replace function public.snote_profile_phone_verify(p_actor uuid,p_company uuid,p_challenge_id uuid,p_otp_hash text)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.profile_phone_verify(p_actor,p_company,p_challenge_id,p_otp_hash);$$;
revoke all on function public.snote_profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text),public.snote_profile_phone_delivery(uuid,uuid,uuid,text),public.snote_profile_phone_verify(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.snote_profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text),public.snote_profile_phone_delivery(uuid,uuid,uuid,text),public.snote_profile_phone_verify(uuid,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
