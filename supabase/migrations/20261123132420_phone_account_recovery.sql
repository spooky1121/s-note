-- Phone recovery is a server-only possession proof, never password retrieval.
-- Legacy contacts additionally require native Auth email recovery. No plaintext
-- OTP, receipt, password, phone/IP hash secret or original password is stored.
begin;
create table if not exists snote_private.recovery_phone_bindings(
 user_id uuid primary key references auth.users(id) on delete cascade,
 phone text not null,verified_at timestamptz not null,source text not null check(source in('profile_otp','auth_phone')),
 challenge_id uuid,invalidated_at timestamptz
);
create table if not exists snote_private.recovery_challenges(
 challenge_id uuid primary key,request_id uuid not null unique,purpose text not null check(purpose in('id','password')),
 name_key text not null,phone text not null,phone_hash text not null,ip_hash text not null,
 user_id uuid,snapshot jsonb,trusted_phone boolean not null default false,
 otp_hash text,verified_hash text,receipt_hash text,attempts integer not null default 0 check(attempts between 0 and 5),
 delivery_status text not null default 'pending' check(delivery_status in('pending','sent','failed','unknown','suppressed')),
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 verified_at timestamptz,receipt_expires_at timestamptz,consumed_at timestamptz,
 email_claimed_at timestamptz,email_status text check(email_status in('pending','sent','failed','unknown'))
);
create table if not exists snote_private.recovery_rate_events(
 request_id uuid primary key,phone_hash text not null,ip_hash text not null,created_at timestamptz not null default clock_timestamp()
);
create index if not exists recovery_rate_phone on snote_private.recovery_rate_events(phone_hash,created_at);
create index if not exists recovery_rate_ip on snote_private.recovery_rate_events(ip_hash,created_at);
create index if not exists recovery_challenge_expiry on snote_private.recovery_challenges(created_at);
create table if not exists snote_private.recovery_reset_jobs(
 job_id uuid primary key,challenge_id uuid not null unique references snote_private.recovery_challenges(challenge_id),
 user_id uuid not null,receipt_hash text not null,password_fingerprint text not null,executor_hash text not null,
 snapshot jsonb not null,state text not null check(state in('applying','applied','failed','unknown')),
 created_at timestamptz not null default clock_timestamp(),apply_until timestamptz not null,finished_at timestamptz
);
create index if not exists recovery_job_actor on snote_private.recovery_reset_jobs(user_id,apply_until) where state in('applying','unknown');

do $acl$ declare t text;begin foreach t in array array['recovery_phone_bindings','recovery_challenges','recovery_rate_events','recovery_reset_jobs'] loop
 execute format('alter table snote_private.%I enable row level security',t);execute format('revoke all on table snote_private.%I from public,anon,authenticated,service_role',t);
end loop;end$acl$;

create or replace function snote_private.recovery_service() returns void language plpgsql set search_path='' as $$begin
 if auth.jwt()->>'role' is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
end$$;
create or replace function snote_private.recovery_failure(p_code text,p_retry integer default null) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('ok',false,'code',p_code)||case when p_retry is null then '{}'::jsonb else jsonb_build_object('retryAfter',greatest(1,p_retry)) end;
$$;
create or replace function snote_private.recovery_phone(p_value text) returns text language sql immutable set search_path='' as $$
 select snote_private.registration_phone(p_value);
$$;
create or replace function snote_private.recovery_name(p_value text) returns text language sql immutable set search_path='' as $$
 select pg_catalog.normalize(btrim(coalesce(p_value,'')),'NFC');
$$;
-- An existing private empty phone is authoritative; never revive a stale member
-- number. Metadata phone strings are not an account recovery authority.
create or replace function snote_private.recovery_canonical_phone(p_user uuid) returns text language sql stable set search_path='' as $$
 select snote_private.recovery_phone(coalesce(p.phone,case when m.phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' then m.phone end,''))
 from public.zc_members m left join snote_private.member_profiles p on p.user_id=m.user_id where m.user_id=p_user order by active desc,joined_at,company_id limit 1;
$$;
create or replace function snote_private.recovery_candidate(p_name text,p_phone text) returns jsonb language plpgsql stable set search_path='' as $$
declare u auth.users;m public.zc_members;matches integer;uid uuid;trusted boolean;
begin
 select count(*),min(x.user_id::text)::uuid into matches,uid from public.zc_members x join auth.users a on a.id=x.user_id
 where x.active and x.role in('admin','dealer','accountant') and snote_private.recovery_name(x.display_name)=p_name
 and snote_private.recovery_canonical_phone(x.user_id)=p_phone and p_phone<>'';
 if matches<>1 then return null;end if;
 select * into u from auth.users where id=uid;select * into m from public.zc_members where user_id=uid order by active desc,joined_at,company_id limit 1;
 if u.email is null or u.email_confirmed_at is null or u.deleted_at is not null or coalesce(u.is_anonymous,false) or (u.banned_until is not null and u.banned_until>clock_timestamp())
 or exists(select 1 from snote_operator_private.operators where user_id=uid)
 or exists(select 1 from snote_operator_private.account_state where user_id=uid and archived)
 or exists(select 1 from snote_operator_private.company_state where company_id=m.company_id and archived)
 or exists(select 1 from auth.users where id<>uid and snote_private.recovery_phone(phone)=p_phone)
 or exists(select 1 from public.zc_members where user_id<>uid and snote_private.recovery_phone(phone)=p_phone)
 or exists(select 1 from snote_private.member_profiles where user_id<>uid and snote_private.recovery_phone(phone)=p_phone) then return null;end if;
 trusted:=exists(select 1 from snote_private.recovery_phone_bindings b where b.user_id=uid and b.phone=p_phone and b.invalidated_at is null);
 return jsonb_build_object('userId',uid,'companyId',m.company_id,'role',m.role,'name',p_name,'phone',p_phone,'email',u.email,
  'authUpdatedAt',u.updated_at,'passwordVersion',encode(sha256(convert_to(coalesce(u.encrypted_password,''),'UTF8')),'hex'),'trustedPhone',trusted);
end$$;

-- Preserve an actual authenticated phone proof before the old one-row challenge
-- is overwritten. No registration or metadata value is silently enrolled.
create or replace function snote_private.recovery_capture_phone_proof() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.consumed_at is not null and new.verified_hash ~ '^[0-9a-f]{64}$' and new.phone=snote_private.recovery_canonical_phone(new.user_id) and exists(select 1 from public.zc_members where user_id=new.user_id and active) then
  insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source,challenge_id,invalidated_at) values(new.user_id,new.phone,new.consumed_at,'profile_otp',new.challenge_id,null)
  on conflict(user_id) do update set phone=excluded.phone,verified_at=excluded.verified_at,source=excluded.source,challenge_id=excluded.challenge_id,invalidated_at=null;
 end if;return new;
end$$;
drop trigger if exists snote_recovery_capture_phone on snote_private.profile_phone_challenges;
create trigger snote_recovery_capture_phone after insert or update of consumed_at,verified_hash on snote_private.profile_phone_challenges for each row execute function snote_private.recovery_capture_phone_proof();
insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source,challenge_id)
 select user_id,phone,consumed_at,'profile_otp',challenge_id from snote_private.profile_phone_challenges c where consumed_at is not null and verified_hash ~ '^[0-9a-f]{64}$' and phone=snote_private.recovery_canonical_phone(user_id) and exists(select 1 from public.zc_members m where m.user_id=c.user_id and m.active)
 on conflict(user_id) do nothing;
insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source)
 select id,snote_private.recovery_phone(phone),phone_confirmed_at,'auth_phone' from auth.users where phone_confirmed_at is not null and snote_private.recovery_phone(phone)<>'' and snote_private.recovery_phone(phone)=snote_private.recovery_canonical_phone(id) and exists(select 1 from public.zc_members m where m.user_id=auth.users.id and m.active)
 on conflict(user_id) do nothing;

-- Invalidate old proofs on canonical contact/inactivation changes. A later return
-- to an old phone must obtain a fresh proof rather than resurrect the binding.
create or replace function snote_private.recovery_invalidate_binding() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;bad boolean:=false;
begin
 if tg_table_schema='auth' then uid:=new.id;elsif tg_op='DELETE' then uid:=old.user_id;else uid:=new.user_id;end if;
 if tg_table_name='zc_members' then bad:=tg_op='DELETE';if tg_op<>'DELETE' then bad:=not new.active;end if;end if;
 if tg_table_schema='auth' then
  update snote_private.recovery_phone_bindings set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where user_id=uid and source='auth_phone' and (new.phone_confirmed_at is null or phone is distinct from snote_private.recovery_phone(new.phone));
  if new.phone_confirmed_at is not null and new.phone_confirmed_at is distinct from old.phone_confirmed_at and snote_private.recovery_phone(new.phone)<>'' and snote_private.recovery_phone(new.phone)=snote_private.recovery_canonical_phone(uid) and exists(select 1 from public.zc_members where user_id=uid and active) then
   insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source,invalidated_at) values(uid,snote_private.recovery_phone(new.phone),new.phone_confirmed_at,'auth_phone',null) on conflict(user_id) do update set phone=excluded.phone,verified_at=excluded.verified_at,source=excluded.source,challenge_id=null,invalidated_at=null;
  end if;
 end if;
 update snote_private.recovery_phone_bindings b set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where b.user_id=uid and (bad or b.phone is distinct from snote_private.recovery_canonical_phone(uid));
 return null;
end$$;
drop trigger if exists snote_recovery_profile_binding on snote_private.member_profiles;
create trigger snote_recovery_profile_binding after insert or update of phone or delete on snote_private.member_profiles for each row execute function snote_private.recovery_invalidate_binding();
drop trigger if exists snote_recovery_member_binding on public.zc_members;
create trigger snote_recovery_member_binding after insert or update of phone,active or delete on public.zc_members for each row execute function snote_private.recovery_invalidate_binding();
drop trigger if exists snote_recovery_auth_binding on auth.users;
create trigger snote_recovery_auth_binding after update of phone,phone_confirmed_at on auth.users for each row execute function snote_private.recovery_invalidate_binding();

create or replace function snote_private.phone_recovery_prepare(p_request_id uuid,p_challenge_id uuid,p_purpose text,p_name text,p_phone text,p_phone_hash text,p_ip_hash text,p_otp_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r snote_private.recovery_challenges;s jsonb;n integer;t timestamptz;stamp timestamptz:=clock_timestamp();namekey text:=snote_private.recovery_name(p_name);
begin
 perform snote_private.recovery_service();
 if p_request_id is null or p_challenge_id is null or p_purpose is null or p_purpose not in('id','password') or length(coalesce(p_name,'')) not between 1 and 40 or namekey='' or p_phone is null or p_phone!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' or p_phone_hash is null or p_phone_hash!~'^[0-9a-f]{64}$' or p_ip_hash is null or p_ip_hash!~'^[0-9a-f]{64}$' or p_otp_hash is null or p_otp_hash!~'^[0-9a-f]{64}$' then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-recovery-phone:'||p_phone_hash,0));perform pg_advisory_xact_lock(hashtextextended('snote-recovery-ip:'||p_ip_hash,0));
 select * into r from snote_private.recovery_challenges where request_id=p_request_id for update;
 if found then
  if r.purpose<>p_purpose or r.name_key<>namekey or r.phone<>p_phone or r.phone_hash<>p_phone_hash or r.ip_hash<>p_ip_hash then return snote_private.recovery_failure('REQUEST_REUSED');end if;
  return jsonb_build_object('ok',true,'claimed',false,'canSend',false,'phone',case when r.user_id is not null then r.phone end,'challengeId',r.challenge_id,'status',r.delivery_status,'expiresAt',r.expires_at,'retryAfter',60);
 end if;
 if exists(select 1 from snote_private.recovery_challenges where challenge_id=p_challenge_id) then return snote_private.recovery_failure('REQUEST_REUSED');end if;
 select max(created_at) into t from snote_private.recovery_rate_events where phone_hash=p_phone_hash;
 if t>stamp-interval'60 seconds' then return snote_private.recovery_failure('RATE_LIMITED',ceil(extract(epoch from(t+interval'60 seconds'-stamp)))::integer);end if;
 select count(*) into n from snote_private.recovery_rate_events where phone_hash=p_phone_hash and created_at>stamp-interval'1 hour';if n>=5 then return snote_private.recovery_failure('RATE_LIMITED',3600);end if;
 select count(*) into n from snote_private.recovery_rate_events where ip_hash=p_ip_hash and created_at>stamp-interval'1 hour';if n>=30 then return snote_private.recovery_failure('RATE_LIMITED',3600);end if;
 select count(*) into n from snote_private.recovery_rate_events where phone_hash=p_phone_hash and created_at>stamp-interval'24 hours';if n>=10 then return snote_private.recovery_failure('RATE_LIMITED',86400);end if;
 select count(*) into n from snote_private.recovery_rate_events where ip_hash=p_ip_hash and created_at>stamp-interval'24 hours';if n>=100 then return snote_private.recovery_failure('RATE_LIMITED',86400);end if;
 s:=snote_private.recovery_candidate(namekey,p_phone);
 insert into snote_private.recovery_rate_events(request_id,phone_hash,ip_hash) values(p_request_id,p_phone_hash,p_ip_hash);
 insert into snote_private.recovery_challenges(challenge_id,request_id,purpose,name_key,phone,phone_hash,ip_hash,user_id,snapshot,trusted_phone,otp_hash,delivery_status,expires_at)
 values(p_challenge_id,p_request_id,p_purpose,namekey,p_phone,p_phone_hash,p_ip_hash,(s->>'userId')::uuid,s,coalesce((s->>'trustedPhone')::boolean,false),p_otp_hash,case when s is null then 'suppressed' else 'pending' end,stamp+interval'5 minutes') returning * into r;
 -- Bounded maintenance touches only the new rate table, never customer history.
 delete from snote_private.recovery_rate_events where request_id in(select request_id from snote_private.recovery_rate_events where created_at<stamp-interval'2 days' order by created_at limit 100);
 delete from snote_private.recovery_reset_jobs where job_id in(select job_id from snote_private.recovery_reset_jobs where created_at<stamp-interval'30 days' order by created_at limit 100);
 delete from snote_private.recovery_challenges where challenge_id in(select c.challenge_id from snote_private.recovery_challenges c where c.created_at<stamp-interval'30 days' and not exists(select 1 from snote_private.recovery_reset_jobs j where j.challenge_id=c.challenge_id) order by c.created_at limit 100);
 return jsonb_build_object('ok',true,'claimed',true,'canSend',s is not null,'phone',case when s is not null then p_phone end,'challengeId',r.challenge_id,'status',r.delivery_status,'expiresAt',r.expires_at,'retryAfter',60);
end$$;
create or replace function snote_private.phone_recovery_delivery(p_challenge_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$declare r snote_private.recovery_challenges;begin
 perform snote_private.recovery_service();if p_status is null or p_status not in('sent','failed','unknown') then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 select * into r from snote_private.recovery_challenges where challenge_id=p_challenge_id for update;
 if not found or r.user_id is null then return snote_private.recovery_failure('UNAVAILABLE');end if;
 if r.delivery_status=p_status or r.verified_at is not null then return jsonb_build_object('ok',true);end if;
 if r.delivery_status<>'pending' and not(r.delivery_status='sent' and p_status='unknown') then return snote_private.recovery_failure('UNAVAILABLE');end if;
 update snote_private.recovery_challenges set delivery_status=p_status,otp_hash=case when p_status='sent' and expires_at>clock_timestamp() then otp_hash end where challenge_id=p_challenge_id;
 return jsonb_build_object('ok',true);
end$$;
create or replace function snote_private.phone_recovery_verify(p_challenge_id uuid,p_purpose text,p_otp_hash text,p_receipt_hash text,p_ip_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r snote_private.recovery_challenges;s jsonb;stamp timestamptz:=clock_timestamp();claim_email boolean:=false;
begin
 perform snote_private.recovery_service();
 if p_purpose is null or p_purpose not in('id','password') or p_otp_hash is null or p_otp_hash!~'^[0-9a-f]{64}$' or p_receipt_hash is null or p_receipt_hash!~'^[0-9a-f]{64}$' or p_ip_hash is null or p_ip_hash!~'^[0-9a-f]{64}$' then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 select * into r from snote_private.recovery_challenges where challenge_id=p_challenge_id for update;
 if not found or r.purpose<>p_purpose or r.ip_hash<>p_ip_hash then return snote_private.recovery_failure('INVALID_CODE');end if;
 if r.consumed_at is not null then return snote_private.recovery_failure('PROOF_CONSUMED');end if;
 if r.verified_at is not null then
  if r.receipt_expires_at<=stamp then return snote_private.recovery_failure('EXPIRED');end if;
  if r.verified_hash is distinct from p_otp_hash or r.receipt_hash is distinct from p_receipt_hash then return snote_private.recovery_failure('INVALID_CODE');end if;
 else
  if r.expires_at<=stamp then update snote_private.recovery_challenges set otp_hash=null where challenge_id=p_challenge_id;return snote_private.recovery_failure('EXPIRED');end if;
  if r.attempts>=5 then return snote_private.recovery_failure('LOCKED');end if;
  if r.delivery_status<>'sent' or r.otp_hash is null or r.otp_hash<>p_otp_hash then
   update snote_private.recovery_challenges set attempts=attempts+1,otp_hash=case when attempts+1>=5 then null else otp_hash end where challenge_id=p_challenge_id;return snote_private.recovery_failure(case when r.attempts>=4 then 'LOCKED' else 'INVALID_CODE' end);
  end if;
 end if;
 s:=snote_private.recovery_candidate(r.name_key,r.phone);
 if s is null or s is distinct from r.snapshot then update snote_private.recovery_challenges set otp_hash=null,receipt_hash=null where challenge_id=p_challenge_id;return snote_private.recovery_failure('UNAVAILABLE');end if;
 if r.verified_at is null then
  claim_email:=not r.trusted_phone;
  update snote_private.recovery_challenges set verified_at=stamp,receipt_expires_at=stamp+interval'5 minutes',verified_hash=otp_hash,otp_hash=null,receipt_hash=p_receipt_hash,email_claimed_at=case when claim_email then stamp end,email_status=case when claim_email then 'pending' end where challenge_id=p_challenge_id returning * into r;
 end if;
 return jsonb_build_object('ok',true,'route',case when r.trusted_phone then 'phone' else 'email' end,'email',r.snapshot->>'email','challengeId',r.challenge_id,'resetExpiresAt',r.receipt_expires_at,'claimedEmail',claim_email,'emailStatus',r.email_status);
end$$;
create or replace function snote_private.phone_recovery_email_delivery(p_challenge_id uuid,p_receipt_hash text,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$declare r snote_private.recovery_challenges;begin
 perform snote_private.recovery_service();
 if p_status is null or p_status not in('sent','failed','unknown') then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 select * into r from snote_private.recovery_challenges where challenge_id=p_challenge_id for update;
 if not found or r.trusted_phone or r.verified_at is null or r.receipt_hash is distinct from p_receipt_hash or r.email_claimed_at is null then return snote_private.recovery_failure('UNAVAILABLE');end if;
 if r.email_status='pending' then update snote_private.recovery_challenges set email_status=p_status where challenge_id=p_challenge_id returning * into r;
 elsif r.email_status<>p_status then return snote_private.recovery_failure('REQUEST_REUSED');end if;
 return jsonb_build_object('ok',true,'emailStatus',r.email_status);
end$$;

create or replace function snote_private.phone_recovery_reset_prepare(p_job_id uuid,p_challenge_id uuid,p_receipt_hash text,p_password_fingerprint text,p_executor_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r snote_private.recovery_challenges;j snote_private.recovery_reset_jobs;s jsonb;
begin
 perform snote_private.recovery_service();
 if p_job_id is null or p_challenge_id is null or p_receipt_hash is null or p_receipt_hash!~'^[0-9a-f]{64}$' or p_password_fingerprint is null or p_password_fingerprint!~'^[0-9a-f]{64}$' or p_executor_hash is null or p_executor_hash!~'^[0-9a-f]{64}$' then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 select * into r from snote_private.recovery_challenges where challenge_id=p_challenge_id for update;
 if not found then return snote_private.recovery_failure('UNAVAILABLE');end if;
 select * into j from snote_private.recovery_reset_jobs where job_id=p_job_id for update;
 if found then
  if j.challenge_id<>p_challenge_id or j.receipt_hash<>p_receipt_hash or j.password_fingerprint<>p_password_fingerprint or j.executor_hash<>p_executor_hash then return snote_private.recovery_failure('REQUEST_REUSED');end if;
  return jsonb_build_object('ok',true,'claimed',false,'state',j.state,'jobId',j.job_id,'userId',j.user_id,'email',j.snapshot->>'email','expiresAt',j.apply_until);
 end if;
 if r.consumed_at is not null then return snote_private.recovery_failure('PROOF_CONSUMED');end if;
 if not r.trusted_phone or r.purpose<>'password' or r.verified_at is null or r.receipt_hash is distinct from p_receipt_hash then return snote_private.recovery_failure('UNAVAILABLE');end if;
 if r.receipt_expires_at<=clock_timestamp() then return snote_private.recovery_failure('EXPIRED');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('snote-recovery-user:'||r.user_id::text,0)) then return snote_private.recovery_failure('UNAVAILABLE');end if;
 s:=snote_private.recovery_candidate(r.name_key,r.phone);if s is distinct from r.snapshot then return snote_private.recovery_failure('UNAVAILABLE');end if;
 if exists(select 1 from snote_private.recovery_reset_jobs where user_id=r.user_id and state in('applying','unknown') and apply_until>clock_timestamp()) then return snote_private.recovery_failure('UNAVAILABLE');end if;
 insert into snote_private.recovery_reset_jobs(job_id,challenge_id,user_id,receipt_hash,password_fingerprint,executor_hash,snapshot,state,apply_until) values(p_job_id,p_challenge_id,r.user_id,p_receipt_hash,p_password_fingerprint,p_executor_hash,s,'applying',clock_timestamp()+interval'60 seconds') returning * into j;
 update snote_private.recovery_challenges set consumed_at=clock_timestamp() where challenge_id=p_challenge_id;
 return jsonb_build_object('ok',true,'claimed',true,'state',j.state,'jobId',j.job_id,'userId',j.user_id,'email',j.snapshot->>'email','expiresAt',j.apply_until);
end$$;
create or replace function snote_private.phone_recovery_reset_finalize(p_job_id uuid,p_receipt_hash text,p_password_fingerprint text,p_executor_hash text,p_outcome text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j snote_private.recovery_reset_jobs;r snote_private.recovery_challenges;s jsonb;
begin
 perform snote_private.recovery_service();if p_outcome is null or p_outcome not in('applied','failed','unknown') then return snote_private.recovery_failure('VALIDATION_ERROR');end if;
 select * into j from snote_private.recovery_reset_jobs where job_id=p_job_id for update;
 if not found or j.receipt_hash is distinct from p_receipt_hash or j.password_fingerprint is distinct from p_password_fingerprint or j.executor_hash is distinct from p_executor_hash then return snote_private.recovery_failure('UNAVAILABLE');end if;
 if j.state<>'applying' then if j.state<>p_outcome then return snote_private.recovery_failure('REQUEST_REUSED');end if;return jsonb_build_object('ok',true,'state',j.state,'jobId',j.job_id);end if;
 if p_outcome='applied' then
  select * into r from snote_private.recovery_challenges where challenge_id=j.challenge_id;
  s:=snote_private.recovery_candidate(r.name_key,r.phone);
  if s is null or s-'authUpdatedAt'-'passwordVersion' is distinct from j.snapshot-'authUpdatedAt'-'passwordVersion' or s->>'passwordVersion'=j.snapshot->>'passwordVersion' then return snote_private.recovery_failure('UNAVAILABLE');end if;
  -- Auth refresh_tokens.session_id and mfa_amr_claims cascade with these exact
  -- sessions. Preserve all other users and every existing authorization guard.
  delete from auth.sessions where user_id=j.user_id;
 end if;
 update snote_private.recovery_reset_jobs set state=p_outcome,finished_at=clock_timestamp() where job_id=p_job_id;
 return jsonb_build_object('ok',true,'state',p_outcome,'jobId',p_job_id);
end$$;

-- Prevent contact/eligibility/operator changes while one bounded external Auth
-- password call is applying or has an uncertain timeout, until its original
-- 60-second deadline. Password-only Auth updates are expressly permitted.
create or replace function snote_private.recovery_guard_user(p_user uuid) returns void language plpgsql set search_path='' as $$begin
 if not pg_try_advisory_xact_lock(hashtextextended('snote-recovery-user:'||p_user::text,0)) then raise exception 'RECOVERY_BUSY' using errcode='40001';end if;
 if exists(select 1 from snote_private.recovery_reset_jobs where user_id=p_user and state in('applying','unknown') and apply_until>clock_timestamp()) then raise exception 'RECOVERY_BUSY' using errcode='40001';end if;
end$$;
create or replace function snote_private.recovery_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare uid uuid;changed boolean:=false;row_data record;
begin
 if tg_table_schema='auth' then
  uid:=old.id;changed:=tg_op='DELETE';if tg_op='UPDATE' then changed:=new.email is distinct from old.email or new.phone is distinct from old.phone or new.email_confirmed_at is distinct from old.email_confirmed_at or new.phone_confirmed_at is distinct from old.phone_confirmed_at or new.deleted_at is distinct from old.deleted_at or new.banned_until is distinct from old.banned_until or new.is_anonymous is distinct from old.is_anonymous;end if;
 elsif tg_table_name='zc_members' then
  uid:=old.user_id;changed:=tg_op='DELETE';if tg_op='UPDATE' then changed:=new.phone is distinct from old.phone or new.active is distinct from old.active or new.role is distinct from old.role or new.company_id is distinct from old.company_id or new.display_name is distinct from old.display_name;end if;
 elsif tg_table_name='member_profiles' then
  uid:=case when tg_op='INSERT' then new.user_id else old.user_id end;changed:=tg_op<>'UPDATE';if tg_op='UPDATE' then changed:=new.phone is distinct from old.phone;end if;
 elsif tg_table_name='operators' then uid:=new.user_id;changed:=true;
 elsif tg_table_name='account_state' then uid:=new.user_id;changed:=new.archived;
 elsif tg_table_name='company_state' then
  if new.archived then for row_data in select user_id from public.zc_members where company_id=new.company_id order by user_id loop perform snote_private.recovery_guard_user(row_data.user_id);update snote_private.recovery_phone_bindings set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where user_id=row_data.user_id;end loop;end if;return new;
 end if;
 if changed then perform snote_private.recovery_guard_user(uid);if tg_table_name='account_state' then update snote_private.recovery_phone_bindings set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where user_id=uid;end if;end if;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
drop trigger if exists snote_recovery_auth_guard on auth.users;
create trigger snote_recovery_auth_guard before update or delete on auth.users for each row execute function snote_private.recovery_identity_guard();
drop trigger if exists snote_recovery_member_guard on public.zc_members;
create trigger snote_recovery_member_guard before update or delete on public.zc_members for each row execute function snote_private.recovery_identity_guard();
drop trigger if exists snote_recovery_profile_guard on snote_private.member_profiles;
create trigger snote_recovery_profile_guard before insert or update or delete on snote_private.member_profiles for each row execute function snote_private.recovery_identity_guard();
drop trigger if exists snote_recovery_operator_guard on snote_operator_private.operators;
create trigger snote_recovery_operator_guard before insert or update on snote_operator_private.operators for each row execute function snote_private.recovery_identity_guard();
drop trigger if exists snote_recovery_account_guard on snote_operator_private.account_state;
create trigger snote_recovery_account_guard before insert or update of archived on snote_operator_private.account_state for each row execute function snote_private.recovery_identity_guard();
drop trigger if exists snote_recovery_company_guard on snote_operator_private.company_state;
create trigger snote_recovery_company_guard before insert or update of archived on snote_operator_private.company_state for each row execute function snote_private.recovery_identity_guard();

create or replace function public.snote_phone_recovery_prepare(p_request_id uuid,p_challenge_id uuid,p_purpose text,p_name text,p_phone text,p_phone_hash text,p_ip_hash text,p_otp_hash text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_prepare(p_request_id,p_challenge_id,p_purpose,p_name,p_phone,p_phone_hash,p_ip_hash,p_otp_hash);$$;
create or replace function public.snote_phone_recovery_delivery(p_challenge_id uuid,p_status text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_delivery(p_challenge_id,p_status);$$;
create or replace function public.snote_phone_recovery_verify(p_challenge_id uuid,p_purpose text,p_otp_hash text,p_receipt_hash text,p_ip_hash text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_verify(p_challenge_id,p_purpose,p_otp_hash,p_receipt_hash,p_ip_hash);$$;
create or replace function public.snote_phone_recovery_email_delivery(p_challenge_id uuid,p_receipt_hash text,p_status text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_email_delivery(p_challenge_id,p_receipt_hash,p_status);$$;
create or replace function public.snote_phone_recovery_reset_prepare(p_job_id uuid,p_challenge_id uuid,p_receipt_hash text,p_password_fingerprint text,p_executor_hash text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_reset_prepare(p_job_id,p_challenge_id,p_receipt_hash,p_password_fingerprint,p_executor_hash);$$;
create or replace function public.snote_phone_recovery_reset_finalize(p_job_id uuid,p_receipt_hash text,p_password_fingerprint text,p_executor_hash text,p_outcome text) returns jsonb language sql security invoker set search_path='' as $$select snote_private.phone_recovery_reset_finalize(p_job_id,p_receipt_hash,p_password_fingerprint,p_executor_hash,p_outcome);$$;

do $acl$ declare r record;begin
 for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='snote_private' and (starts_with(p.proname,'recovery_') or starts_with(p.proname,'phone_recovery_'))) or (n.nspname='public' and starts_with(p.proname,'snote_phone_recovery_')) loop
  execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
  if starts_with(r.proname,'phone_recovery_') or starts_with(r.proname,'snote_phone_recovery_') then execute format('grant execute on function %I.%I(%s) to service_role',r.nspname,r.proname,r.args);end if;
 end loop;
end$acl$;
notify pgrst,'reload schema';
commit;
