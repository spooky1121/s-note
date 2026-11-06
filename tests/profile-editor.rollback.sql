-- Synthetic-only regression. Always execute this complete file in one transaction.
-- No production row is read or modified, and no Auth message is sent.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
do $fixtures$
begin
 if exists(select 1 from pg_trigger where tgrelid in ('auth.users'::regclass,'public.zc_companies'::regclass,'public.zc_members'::regclass) and not tgisinternal) then raise exception 'Unexpected fixture trigger';end if;
 if exists(select 1 from auth.users where id::text like '88976677-0099-4000-8000-00000000000%')
  or exists(select 1 from public.zc_companies where id='88976677-0099-4000-8000-000000000010') then raise exception 'Synthetic fixture collision';end if;
 if has_table_privilege('authenticated','snote_private.member_profiles','SELECT')
  or has_table_privilege('authenticated','snote_private.member_profiles','UPDATE')
  or has_function_privilege('anon','public.snote_profile_read()','EXECUTE')
  or has_function_privilege('anon','public.snote_profile_save(jsonb,jsonb)','EXECUTE') then raise exception 'Profile ACL exposure';end if;
 if not(select relrowsecurity from pg_class where oid='snote_private.member_profiles'::regclass)
  or exists(select 1 from pg_proc where oid in('public.snote_profile_read()'::regprocedure,'public.snote_profile_save(jsonb,jsonb)'::regprocedure) and prosecdef) then raise exception 'Profile RLS/wrapper configuration';end if;
 insert into auth.users(id,email,role,aud,raw_user_meta_data) values
 ('88976677-0099-4000-8000-000000000001','profile-dealer@db-check.invalid','authenticated','authenticated','{"snote_registration":{"phone":"01011112222"}}'),
 ('88976677-0099-4000-8000-000000000002','profile-admin@db-check.invalid','authenticated','authenticated','{}'),
 ('88976677-0099-4000-8000-000000000003','profile-accountant@db-check.invalid','authenticated','authenticated','{}');
 insert into public.zc_companies(id,name) values('88976677-0099-4000-8000-000000000010','Synthetic profile company');
 insert into public.zc_members(user_id,company_id,role,display_name,phone) values
 ('88976677-0099-4000-8000-000000000001','88976677-0099-4000-8000-000000000010','dealer','Synthetic dealer',''),
 ('88976677-0099-4000-8000-000000000002','88976677-0099-4000-8000-000000000010','admin','Synthetic admin','01099998888'),
 ('88976677-0099-4000-8000-000000000003','88976677-0099-4000-8000-000000000010','accountant','Synthetic accountant','01033334444');
end $fixtures$;
set local role authenticated;
do $dealer$
declare v jsonb;v_saved jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000001","role":"authenticated"}',true);
 v:=public.snote_profile_read();
 if v->>'phone'<>'01011112222' or v->>'revision'<>'0' or v->>'address'<>'' or v->>'role'<>'dealer' then raise exception 'Initial own profile fallback';end if;
 expected:=jsonb_build_object('user_id',v->'user_id','company_id',v->'company_id','display_name',v->'display_name','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name','Synthetic saved dealer','company_name',v->'company_name','phone','01055556666','address','Synthetic personal address');
 begin perform public.snote_profile_save(expected,patch||'{"user_id":"88976677-0099-4000-8000-000000000002"}');raise exception 'Target user accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_save(expected,patch||'{"role":"admin"}');raise exception 'Role accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_save(expected,patch||'{"company_id":"88976677-0099-4000-8000-000000000010"}');raise exception 'Company move accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_save(expected,patch||'{"company_name":"Unauthorized rename"}');raise exception 'Dealer company rename accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_save(expected,patch||'{"phone":"bad"}');raise exception 'Invalid phone accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_save(expected,patch||'{"phone":"0101234567"}');raise exception 'Short 010 accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_save(expected||'{"company_id":"not-a-uuid"}',patch);raise exception 'Invalid company UUID accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_save(expected||'{"user_id":"not-a-uuid"}',patch);raise exception 'Invalid expected user UUID accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_save(expected||'{"user_id":"88976677-0099-4000-8000-000000000002"}',patch);raise exception 'Wrong expected user accepted';exception when serialization_failure then null;end;
 begin perform public.snote_profile_save(expected||'{"company_id":"88976677-0099-4000-8000-000000000099"}',patch);raise exception 'Moved company context accepted';exception when serialization_failure then null;end;
 begin perform public.snote_profile_save(expected,patch||jsonb_build_object('address',repeat('x',301)));raise exception 'Long address accepted';exception when invalid_parameter_value then null;end;
 v_saved:=public.snote_profile_save(expected,patch);
 if v_saved->>'display_name'<>'Synthetic saved dealer' or v_saved->>'phone'<>'01055556666' or v_saved->>'revision'<>'1' or v_saved->>'address'<>'Synthetic personal address' then raise exception 'Save roundtrip mismatch';end if;
 if public.snote_profile_read()<>v_saved then raise exception 'Readback mismatch';end if;
 begin perform public.snote_profile_save(expected,patch);raise exception 'Stale CAS accepted';exception when serialization_failure then null;end;
 if(select phone from public.zc_members where user_id='88976677-0099-4000-8000-000000000001')<>'' then raise exception 'SMS sender mutated';end if;
 if not exists(select 1 from public.zc_members where user_id='88976677-0099-4000-8000-000000000002' and role='admin' and display_name='Synthetic admin' and phone='01099998888') then raise exception 'Sibling modified';end if;
 begin perform 1 from snote_private.member_profiles;raise exception 'Direct private read accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000001","role":"anon"}',true);
 begin perform public.snote_profile_read();raise exception 'Anon claim accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
 begin perform public.snote_profile_read();raise exception 'Anonymous user accepted';exception when insufficient_privilege then null;end;
end $dealer$;
reset role;
-- Grant is transaction-local for a defense-in-depth RLS probe and rolls back.
grant select on snote_private.member_profiles to authenticated;
set local role authenticated;
do $admin$
declare v jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000002","role":"authenticated"}',true);
 if exists(select 1 from snote_private.member_profiles) then raise exception 'Company peer private data RLS leak';end if;
 v:=public.snote_profile_read();if v->>'phone'<>'01099998888' or v->>'address'<>'' then raise exception 'Admin read touched dealer private row';end if;
 expected:=jsonb_build_object('user_id',v->'user_id','company_id',v->'company_id','display_name',v->'display_name','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name','Synthetic saved admin','company_name','Synthetic renamed company','phone','01077778888','address','Synthetic admin address');
 v:=public.snote_profile_save(expected,patch);
 if v->>'company_name'<>'Synthetic renamed company' or v->>'role'<>'admin' then raise exception 'Admin company name save failed';end if;
 if(select count(*) from snote_private.member_profiles)<>1 then raise exception 'Own-only profile RLS mismatch';end if;
end $admin$;
do $accountant$
declare v jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000003',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000003","role":"authenticated"}',true);
 v:=public.snote_profile_read();
 expected:=jsonb_build_object('user_id',v->'user_id','company_id',v->'company_id','display_name',v->'display_name','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name','Synthetic saved accountant','company_name',v->'company_name','phone','01033334444','address','');
 v:=public.snote_profile_save(expected,patch);if v->>'role'<>'accountant' then raise exception 'Accountant own profile failed';end if;
end $accountant$;
reset role;
update public.zc_members set display_name='Synthetic externally changed dealer' where user_id='88976677-0099-4000-8000-000000000001';
set local role authenticated;
do $legacy_cas$
declare v jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000001","role":"authenticated"}',true);
 v:=public.snote_profile_read();
 expected:=jsonb_build_object('user_id',v->'user_id','company_id',v->'company_id','display_name','Synthetic saved dealer','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name','Lost update attempt','company_name',v->'company_name','phone','01055556666','address','');
 begin perform public.snote_profile_save(expected,patch);raise exception 'Legacy administrator edit overwritten';exception when serialization_failure then null;end;
end $legacy_cas$;
reset role;
-- Identical names and private revisions must never let A's draft save as B.
update public.zc_members set display_name='Synthetic identical name'
 where user_id in('88976677-0099-4000-8000-000000000001','88976677-0099-4000-8000-000000000002');
set local role authenticated;
do $same_name_account_switch$
declare v jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000002',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000002","role":"authenticated"}',true);
 v:=public.snote_profile_read();
 expected:=jsonb_build_object('user_id','88976677-0099-4000-8000-000000000001','company_id',v->'company_id','display_name',v->'display_name','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name',v->'display_name','company_name',v->'company_name','phone','01055556666','address','Old account draft');
 begin perform public.snote_profile_save(expected,patch);raise exception 'Same-name switched account modified';exception when serialization_failure then null;end;
 if public.snote_profile_read()<>v then raise exception 'Switched account changed despite UID guard';end if;
end $same_name_account_switch$;
reset role;
-- The new company deliberately has the same name as the original company.
insert into public.zc_companies(id,name) values('88976677-0099-4000-8000-000000000020','Synthetic renamed company');
update public.zc_members set company_id='88976677-0099-4000-8000-000000000020' where user_id='88976677-0099-4000-8000-000000000001';
set local role authenticated;
do $same_name_company_switch$
declare v jsonb;expected jsonb;patch jsonb;
begin
 perform set_config('request.jwt.claim.sub','88976677-0099-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"88976677-0099-4000-8000-000000000001","role":"authenticated"}',true);
 v:=public.snote_profile_read();
 expected:=jsonb_build_object('user_id',v->'user_id','company_id','88976677-0099-4000-8000-000000000010','display_name',v->'display_name','company_name',v->'company_name','revision',v->'revision');
 patch:=jsonb_build_object('display_name',v->'display_name','company_name',v->'company_name','phone','01055556666','address','Old company draft');
 begin perform public.snote_profile_save(expected,patch);raise exception 'Same-name moved company draft accepted';exception when serialization_failure then null;end;
end $same_name_company_switch$;
reset role;
update public.zc_members set active=false where user_id='88976677-0099-4000-8000-000000000001';
set local role authenticated;
do $inactive$
begin
 begin perform public.snote_profile_read();raise exception 'Inactive profile read accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_save('{}','{}');raise exception 'Inactive profile save accepted';exception when insufficient_privilege then null;end;
end $inactive$;
reset role;
select 'PASS own profile save/read, private ACL/RLS, all roles, JWT, inactive, field allowlist, admin-only rename, SMS preservation, CAS and rollback' as result;
rollback;
