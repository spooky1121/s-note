-- Synthetic-only complete batch: no external SMS/Auth calls and no retained business rows.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $fixtures$
declare i integer;
begin
 if exists(select 1 from pg_trigger where tgrelid in('auth.users'::regclass,'public.zc_companies'::regclass,'public.zc_members'::regclass) and not tgisinternal) then raise exception 'Unexpected fixture trigger';end if;
 if exists(select 1 from auth.users where id::text like 'be279000-0000-4000-8000-0000000000%') or exists(select 1 from public.zc_companies where id::text like 'be279000-0000-4000-8000-0000000001%') then raise exception 'Fixture collision';end if;
 insert into public.zc_companies(id,name,business_address,business_address_detail) values
 ('be279000-0000-4000-8000-000000000101','Synthetic company','Synthetic company address','Suite A'),
 ('be279000-0000-4000-8000-000000000102','Synthetic foreign','Synthetic foreign address','Suite B');
 for i in 1..8 loop
  insert into auth.users(id,email,role,aud,raw_user_meta_data,banned_until)
  values(('be279000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'profile-contact-'||i||'@check.invalid','authenticated','authenticated',
   case when i=3 then '{"snote_registration":{"phone":"01099998888"}}'::jsonb else '{}'::jsonb end,
   case when i=6 then clock_timestamp()+interval '1 day' else null end);
  insert into public.zc_members(user_id,company_id,role,display_name,phone,active)
  values(('be279000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case when i=4 then 'be279000-0000-4000-8000-000000000102'::uuid else 'be279000-0000-4000-8000-000000000101'::uuid end,
   case when i=2 then 'admin' when i=7 then 'accountant' else 'dealer' end,'Synthetic person '||i,
   case when i=3 then '' when i=8 then '0101234567' else '010'||repeat(i::text,4)||'2222' end,i<>5);
 end loop;
 if exists(select 1 from pg_class where oid in('snote_private.profile_phone_challenges'::regclass,'snote_private.profile_phone_sends'::regclass) and not relrowsecurity) then raise exception 'Missing RLS';end if;
 if has_table_privilege('authenticated','snote_private.profile_phone_challenges','SELECT') or has_table_privilege('service_role','snote_private.profile_phone_sends','INSERT')
  or has_function_privilege('authenticated','public.snote_profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text)','EXECUTE')
  or has_function_privilege('anon','public.snote_profile_phone_verify(uuid,uuid,uuid,text)','EXECUTE')
  or not has_function_privilege('service_role','public.snote_profile_phone_delivery(uuid,uuid,uuid,text)','EXECUTE') then raise exception 'OTP ACL exposure';end if;
 if exists(select 1 from pg_proc where oid in('public.snote_profile_phone_challenge(uuid,uuid,text,jsonb,uuid,text)'::regprocedure,'public.snote_profile_phone_delivery(uuid,uuid,uuid,text)'::regprocedure,'public.snote_profile_phone_verify(uuid,uuid,uuid,text)'::regprocedure) and prosecdef) then raise exception 'Public definer exposure';end if;
end $fixtures$;
create temporary table profile_test_expected(user_id uuid primary key,profile jsonb);
grant select on profile_test_expected to service_role;
insert into profile_test_expected select user_id,snote_private.profile_actor_snapshot(user_id) from public.zc_members where user_id::text like 'be279000-0000-4000-8000-0000000000%' and active and user_id<>'be279000-0000-4000-8000-000000000006';
set local role authenticated;
do $normal$
declare v jsonb;e jsonb;p jsonb;
begin
 perform set_config('request.jwt.claim.sub','be279000-0000-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"sub":"be279000-0000-4000-8000-000000000001","role":"authenticated"}',true);
 v:=public.snote_profile_read();if v->>'address' is distinct from 'Synthetic company address Suite A' or v->>'company_address' is distinct from v->>'address' then raise exception 'Company address not derived';end if;
 e:=v-'role'-'address'-'company_address';p:=jsonb_build_object('display_name','Synthetic renamed dealer','company_name',v->'company_name','phone',v->'phone','address',v->'address');
 begin perform public.snote_profile_save(e,p||'{"phone":"01088889999"}');raise exception 'Normal-save phone bypass';exception when insufficient_privilege then if sqlerrm<>'PHONE_VERIFICATION_REQUIRED' then raise;end if;end;
 begin perform public.snote_profile_save(e,p||'{"address":"Arbitrary private address"}');raise exception 'Readonly address overwritten';exception when insufficient_privilege then if sqlerrm<>'COMPANY_ADDRESS_READONLY' then raise;end if;end;
 begin perform public.snote_profile_save(e||'{"user_id":"be279000-0000-4000-8000-000000000002"}',p);raise exception 'Wrong expected UID accepted';exception when serialization_failure then null;end;
 begin perform public.snote_profile_phone_challenge('be279000-0000-4000-8000-000000000001','be279000-0000-4000-8000-000000000101','01088889999',e,'be279000-0000-4000-8000-000000001001',repeat('a',64));raise exception 'Browser reserved OTP directly';exception when insufficient_privilege then null;end;
 v:=public.snote_profile_save(e,p);if v->>'display_name' is distinct from 'Synthetic renamed dealer' or v->>'phone' is distinct from '01011112222' or v->>'revision' is distinct from '1' then raise exception 'Normal name save failed';end if;
 begin perform public.snote_profile_save(e,p);raise exception 'Stale regular CAS accepted';exception when serialization_failure then null;end;
 perform set_config('request.jwt.claim.sub','be279000-0000-4000-8000-000000000003',true);perform set_config('request.jwt.claims','{"sub":"be279000-0000-4000-8000-000000000003","role":"authenticated"}',true);
 v:=public.snote_profile_read();if v->>'phone' is distinct from '' then raise exception 'Editable metadata phone trusted';end if;
 e:=v-'role'-'address'-'company_address';v:=public.snote_profile_save(e,jsonb_build_object('display_name','Synthetic metadata renamed','company_name',v->'company_name','phone','','address',v->'address'));
 if v->>'display_name' is distinct from 'Synthetic metadata renamed' or v->>'phone' is distinct from '' or v->>'revision' is distinct from '0' then raise exception 'Empty-phone name save failed';end if;
 perform set_config('request.jwt.claim.sub','be279000-0000-4000-8000-000000000008',true);perform set_config('request.jwt.claims','{"sub":"be279000-0000-4000-8000-000000000008","role":"authenticated"}',true);
 v:=public.snote_profile_read();if v->>'phone' is distinct from '' then raise exception 'Invalid legacy 010 trusted';end if;
 perform set_config('request.jwt.claims','{"sub":"be279000-0000-4000-8000-000000000008","role":"authenticated","is_anonymous":true}',true);
 begin perform public.snote_profile_read();raise exception 'Anonymous profile read';exception when insufficient_privilege then null;end;
end $normal$;
reset role;
update auth.users set raw_user_meta_data='{"snote_registration":{"phone":"01000001111"}}' where id='be279000-0000-4000-8000-000000000003';
do $metadata$ begin if snote_private.profile_actor_snapshot('be279000-0000-4000-8000-000000000003')->>'phone'<>'' then raise exception 'Metadata edit bypass';end if;end $metadata$;
update profile_test_expected set profile=snote_private.profile_actor_snapshot(user_id);
set local role service_role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
do $otp$
declare a uuid:='be279000-0000-4000-8000-000000000001';c uuid:='be279000-0000-4000-8000-000000000101';e jsonb;r jsonb;i integer;
begin
 select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01088889999',e,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'ok' is distinct from 'true' or r->>'claimed' is distinct from 'true' then raise exception 'Reserve failed: %',r;end if;
 r:=public.snote_profile_phone_challenge(a,c,'01088889999',e,'be279000-0000-4000-8000-000000001001',repeat('b',64));if r->>'claimed' is distinct from 'false' or r->>'status' is distinct from 'pending' then raise exception 'Duplicate nonce resent';end if;
 r:=public.snote_profile_phone_challenge(a,c,'01099990000',e,'be279000-0000-4000-8000-000000001002',repeat('b',64));if r->>'code' is distinct from 'RATE_LIMITED' then raise exception 'Actor cooldown bypass';end if;
 r:=public.snote_profile_phone_challenge('be279000-0000-4000-8000-000000000002',c,'01088889999',(select profile-'role'-'address'-'company_address' from pg_temp.profile_test_expected where user_id='be279000-0000-4000-8000-000000000002'),'be279000-0000-4000-8000-000000001009',repeat('b',64));if r->>'code' is distinct from 'RATE_LIMITED' then raise exception 'Cross-actor phone cooldown bypass';end if;
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'code' is distinct from 'INVALID_CODE' then raise exception 'Unsent OTP accepted';end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001001','sent');
 for i in 1..5 loop r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001001',repeat('b',64));if r->>'code' is distinct from (case when i=5 then 'LOCKED' else 'INVALID_CODE' end) then raise exception 'Attempts rollback: %',r;end if;end loop;
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'code' is distinct from 'LOCKED' then raise exception 'Correct code bypassed attempt lock';end if;
 r:=public.snote_profile_phone_challenge('be279000-0000-4000-8000-000000000005',c,'01088880000',e,'be279000-0000-4000-8000-000000001009',repeat('a',64));if r->>'code' is distinct from 'FORBIDDEN' then raise exception 'Inactive actor accepted';end if;
 r:=public.snote_profile_phone_challenge('be279000-0000-4000-8000-000000000006',c,'01088880000',e,'be279000-0000-4000-8000-000000001009',repeat('a',64));if r->>'code' is distinct from 'FORBIDDEN' then raise exception 'Banned actor accepted';end if;
 r:=public.snote_profile_phone_verify('be279000-0000-4000-8000-000000000004',c,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'code' is distinct from 'FORBIDDEN' then raise exception 'Foreign actor accepted';end if;
end $otp$;
reset role;
do $attempt_state$ begin if(select attempts from snote_private.profile_phone_challenges where user_id='be279000-0000-4000-8000-000000000001')<>5 then raise exception 'Attempts were not committed';end if;end $attempt_state$;
update snote_private.profile_phone_sends set created_at=created_at-interval '61 seconds';
set local role service_role;
do $success$
declare a uuid:='be279000-0000-4000-8000-000000000001';c uuid:='be279000-0000-4000-8000-000000000101';e jsonb;r jsonb;revision jsonb;
begin
 select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01088889999',e,'be279000-0000-4000-8000-000000001002',repeat('c',64));if r->>'ok' is distinct from 'true' then raise exception 'Second reserve failed: %',r;end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001002','sent');
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001002',repeat('c',64));if r->>'ok' is distinct from 'true' or r->'profile'->>'phone' is distinct from '01088889999' or r->'profile'->>'revision' is distinct from '2' or r->'profile'->>'display_name' is distinct from 'Synthetic renamed dealer' then raise exception 'Atomic phone save mismatch: %',r;end if;revision:=r->'profile'->'revision';
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001002',repeat('c',64));if r->>'alreadyProcessed' is distinct from 'true' or r->'profile'->'revision' is distinct from revision then raise exception 'ACK retry mutated twice';end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001002','unknown');
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001002',repeat('d',64));if r->>'code' is distinct from 'INVALID_CODE' then raise exception 'Consumed accepted different code';end if;
 r:=public.snote_profile_phone_challenge(a,c,'01099990000',e,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'code' is distinct from 'PROFILE_CONFLICT' then raise exception 'Stale profile replay accepted';end if;
 -- Empty/metadata-only legacy phone may obtain its first verified private contact.
 a:='be279000-0000-4000-8000-000000000003';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01033330000',e,'be279000-0000-4000-8000-000000001003',repeat('d',64));if r->>'ok' is distinct from 'true' then raise exception 'Empty phone reserve failed: %',r;end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001003','sent');perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001003','unknown');
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001003',repeat('d',64));if r->>'code' is distinct from 'INVALID_CODE' then raise exception 'Unknown delivery accepted';end if;
 r:=public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001003','sent');if r->>'code' is distinct from 'INVALID_CODE' then raise exception 'Unknown delivery revived';end if;
end $success$;
reset role;
do $unchanged$
begin
 if(select phone from public.zc_members where user_id='be279000-0000-4000-8000-000000000001')<>'01011112222' then raise exception 'SMS sender changed';end if;
 if(select count(*) from public.zc_audit where actor_id='be279000-0000-4000-8000-000000000001' and action='personal_phone_verified')<>1 then raise exception 'Audit duplicate';end if;
 if(select count(*) from snote_private.profile_phone_sends where user_id='be279000-0000-4000-8000-000000000001')<>2 then raise exception 'Ledger duplicate';end if;
end $unchanged$;
update snote_private.profile_phone_sends set created_at=created_at-interval '61 seconds';
update profile_test_expected set profile=snote_private.profile_actor_snapshot(user_id);
set local role service_role;
do $empty_and_legacy$
declare a uuid;c uuid:='be279000-0000-4000-8000-000000000101';e jsonb;r jsonb;
begin
 a:='be279000-0000-4000-8000-000000000001';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01099990000',e,'be279000-0000-4000-8000-000000001001',repeat('a',64));if r->>'code' is distinct from 'REQUEST_REUSED' then raise exception 'Past request nonce reused with fresh CAS';end if;
 a:='be279000-0000-4000-8000-000000000003';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01033330000',e,'be279000-0000-4000-8000-000000001004',repeat('e',64));if r->>'ok' is distinct from 'true' then raise exception 'Empty phone resend failed: %',r;end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001004','sent');r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001004',repeat('e',64));if r->>'ok' is distinct from 'true' or r->'profile'->>'phone' is distinct from '01033330000' or r->'profile'->>'revision' is distinct from '1' then raise exception 'Metadata-only registration failed';end if;
 a:='be279000-0000-4000-8000-000000000008';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01088880000',e,'be279000-0000-4000-8000-000000001005',repeat('f',64));if r->>'ok' is distinct from 'true' then raise exception 'Invalid legacy reserve failed: %',r;end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001005','sent');
end $empty_and_legacy$;
reset role;
update public.zc_members set display_name='Externally changed name' where user_id='be279000-0000-4000-8000-000000000008';
set local role service_role;
do $conflict$
declare r jsonb;
begin
 r:=public.snote_profile_phone_verify('be279000-0000-4000-8000-000000000008','be279000-0000-4000-8000-000000000101','be279000-0000-4000-8000-000000001005',repeat('f',64));if r->>'code' is distinct from 'PROFILE_CONFLICT' then raise exception 'Stale reserved profile overwrote name';end if;
end $conflict$;
reset role;
update snote_private.profile_phone_challenges set expires_at=clock_timestamp()-interval '1 second' where user_id='be279000-0000-4000-8000-000000000008';
do $rate_seed$
declare i integer;
begin
 for i in 1..5 loop insert into snote_private.profile_phone_sends(challenge_id,user_id,phone_hash,created_at) values(gen_random_uuid(),'be279000-0000-4000-8000-000000000007',encode(sha256(convert_to('actor-limit-'||i,'UTF8')),'hex'),clock_timestamp()-interval '2 minutes');end loop;
 for i in 1..10 loop insert into snote_private.profile_phone_sends(challenge_id,user_id,phone_hash,created_at) values(gen_random_uuid(),'be279000-0000-4000-8000-000000000004',encode(sha256(convert_to('01099990000','UTF8')),'hex'),clock_timestamp()-interval '2 minutes');end loop;
end $rate_seed$;
set local role service_role;
do $expiry_rates$
declare a uuid;c uuid:='be279000-0000-4000-8000-000000000101';e jsonb;r jsonb;
begin
 r:=public.snote_profile_phone_verify('be279000-0000-4000-8000-000000000008',c,'be279000-0000-4000-8000-000000001005',repeat('f',64));if r->>'code' is distinct from 'EXPIRED' then raise exception 'Expired accepted';end if;
 a:='be279000-0000-4000-8000-000000000007';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01077770000',e,'be279000-0000-4000-8000-000000001006',repeat('a',64));if r->>'code' is distinct from 'RATE_LIMITED' then raise exception 'Actor hourly limit bypass';end if;
 a:='be279000-0000-4000-8000-000000000002';select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01099990000',e,'be279000-0000-4000-8000-000000001006',repeat('a',64));if r->>'code' is distinct from 'RATE_LIMITED' then raise exception 'Global phone hourly limit bypass';end if;
 r:=public.snote_profile_phone_challenge(a,c,'01099990001',e||'{"user_id":"be279000-0000-4000-8000-000000000001"}','be279000-0000-4000-8000-000000001006',repeat('a',64));if r->>'code' is distinct from 'PROFILE_CONFLICT' then raise exception 'Switched expected UID accepted';end if;
end $expiry_rates$;
reset role;
update snote_private.profile_phone_sends set created_at=created_at-interval '61 seconds';
update profile_test_expected set profile=snote_private.profile_actor_snapshot(user_id);
set local role service_role;
do $invalid_legacy_success$
declare a uuid:='be279000-0000-4000-8000-000000000008';c uuid:='be279000-0000-4000-8000-000000000101';e jsonb;r jsonb;
begin
 select profile-'role'-'address'-'company_address' into e from pg_temp.profile_test_expected where user_id=a;
 r:=public.snote_profile_phone_challenge(a,c,'01088880000',e-'phone','be279000-0000-4000-8000-000000001007',repeat('b',64));if r->>'code' is distinct from 'VALIDATION_ERROR' then raise exception 'Missing previous phone CAS accepted';end if;
 r:=public.snote_profile_phone_challenge(a,c,'01088880000',e,'be279000-0000-4000-8000-000000001007',repeat('b',64));if r->>'ok' is distinct from 'true' then raise exception 'Fresh invalid legacy reserve failed: %',r;end if;
 perform public.snote_profile_phone_delivery(a,c,'be279000-0000-4000-8000-000000001007','sent');
 r:=public.snote_profile_phone_verify(a,c,'be279000-0000-4000-8000-000000001007',repeat('b',64));if r->>'ok' is distinct from 'true' or r->'profile'->>'phone' is distinct from '01088880000' then raise exception 'Invalid legacy could not register verified contact';end if;
end $invalid_legacy_success$;
reset role;
do $legacy_sender$ begin if(select phone from public.zc_members where user_id='be279000-0000-4000-8000-000000000008') is distinct from '0101234567' then raise exception 'Legacy sender silently normalized';end if;end $legacy_sender$;
select 'PASS verified contact security, readonly company address, metadata/invalid legacy, rate/attempt persistence, CAS, delivery, one-time update, ACK retry and rollback' as result;
rollback;
