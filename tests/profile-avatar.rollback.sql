-- Synthetic metadata only: no Storage object API calls, messages or production rows.
begin;
set local statement_timeout='20s';
set local lock_timeout='5s';
set local storage.allow_delete_query='true';
do $fixtures$
begin
 if exists(select 1 from auth.users where id::text like '7ab9c800-0d7f-4000-8000-00000000000%')
  or exists(select 1 from public.zc_companies where id in('7ab9c800-0d7f-4000-8000-000000000010','7ab9c800-0d7f-4000-8000-000000000020')) then raise exception 'Avatar fixture collision';end if;
 if exists(select 1 from pg_trigger where tgrelid in('auth.users'::regclass,'public.zc_companies'::regclass,'public.zc_members'::regclass) and not tgisinternal) then raise exception 'Unexpected avatar fixture trigger';end if;
 if has_table_privilege('authenticated','snote_private.profile_avatars','SELECT') or has_table_privilege('authenticated','snote_private.profile_avatars','UPDATE')
  or has_function_privilege('anon','public.snote_profile_avatar_read(uuid)','EXECUTE') or has_function_privilege('anon','public.snote_profile_avatar_save(uuid,bigint,text)','EXECUTE')
  or exists(select 1 from pg_proc where oid in('public.snote_profile_avatar_read(uuid)'::regprocedure,'public.snote_profile_avatar_save(uuid,bigint,text)'::regprocedure) and prosecdef) then raise exception 'Avatar ACL/wrapper exposure';end if;
 if not(select relrowsecurity from pg_class where oid='snote_private.profile_avatars'::regclass) then raise exception 'Avatar RLS missing';end if;
 if not exists(select 1 from storage.buckets where id='snote-profile-photos' and public is false and file_size_limit=5242880 and allowed_mime_types=array['image/jpeg','image/png','image/webp']) then raise exception 'Avatar bucket limits mismatch';end if;
 insert into auth.users(id,email,role,aud) values
 ('7ab9c800-0d7f-4000-8000-000000000001','avatar-owner@db-check.invalid','authenticated','authenticated'),
 ('7ab9c800-0d7f-4000-8000-000000000002','avatar-admin@db-check.invalid','authenticated','authenticated'),
 ('7ab9c800-0d7f-4000-8000-000000000003','avatar-foreign@db-check.invalid','authenticated','authenticated'),
 ('7ab9c800-0d7f-4000-8000-000000000004','avatar-accountant@db-check.invalid','authenticated','authenticated');
 insert into public.zc_companies(id,name) values('7ab9c800-0d7f-4000-8000-000000000010','Synthetic avatar company'),('7ab9c800-0d7f-4000-8000-000000000020','Synthetic avatar foreign');
 insert into public.zc_members(user_id,company_id,role,display_name) values
 ('7ab9c800-0d7f-4000-8000-000000000001','7ab9c800-0d7f-4000-8000-000000000010','dealer','Synthetic avatar dealer'),
 ('7ab9c800-0d7f-4000-8000-000000000002','7ab9c800-0d7f-4000-8000-000000000010','admin','Synthetic avatar admin'),
 ('7ab9c800-0d7f-4000-8000-000000000003','7ab9c800-0d7f-4000-8000-000000000020','dealer','Synthetic avatar foreign'),
 ('7ab9c800-0d7f-4000-8000-000000000004','7ab9c800-0d7f-4000-8000-000000000010','accountant','Synthetic avatar accountant');
end $fixtures$;
set local role authenticated;
do $own$
declare c uuid:='7ab9c800-0d7f-4000-8000-000000000010';u uuid:='7ab9c800-0d7f-4000-8000-000000000001';
 a text:=c::text||'/'||u::text||'/11111111-1111-4111-8111-111111111111.jpg';
 b text:=c::text||'/'||u::text||'/22222222-2222-4222-8222-222222222222.png';
 bad text:=c::text||'/'||u::text||'/33333333-3333-4333-8333-333333333333.webp';
 ack jsonb;v jsonb;n integer;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 v:=public.snote_profile_avatar_read(c);if v->>'avatar_revision'<>'0' or v->'avatar_path'<>'null'::jsonb then raise exception 'Empty avatar read mismatch';end if;
 begin perform 1 from snote_private.profile_avatars;raise exception 'Private avatar direct read accepted';exception when insufficient_privilege then null;end;
 begin perform public.snote_profile_avatar_save(c,0,a);raise exception 'Missing object accepted';exception when serialization_failure then null;end;
 begin perform public.snote_profile_avatar_save(c,0,'https://external.invalid/photo.jpg');raise exception 'External URL accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_avatar_save(c,0,c::text||'/7ab9c800-0d7f-4000-8000-000000000002/11111111-1111-4111-8111-111111111111.jpg');raise exception 'Other owner path accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_avatar_save(c,0,c::text||'/'||u::text||'/../file.jpg');raise exception 'Traversal accepted';exception when invalid_parameter_value then null;end;
 begin perform public.snote_profile_avatar_save(c,null,a);raise exception 'Null revision accepted';exception when invalid_parameter_value then null;end;
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',a,u::text,'{"size":123,"mimetype":"image/jpeg"}');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',b,u::text,'{"size":5242880,"mimetype":"image/png"}');
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',bad,u::text,'{"size":5242881,"mimetype":"image/webp"}');
 if(select count(*) from storage.objects where bucket_id='snote-profile-photos')<>3 then raise exception 'Own upload/read failed';end if;
 begin perform public.snote_profile_avatar_save(c,0,bad);raise exception 'Oversize object accepted';exception when invalid_parameter_value then null;end;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=bad;
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',bad,u::text,'{"size":12,"mimetype":"image/png"}');
 begin perform public.snote_profile_avatar_save(c,0,bad);raise exception 'MIME/extension mismatch accepted';exception when invalid_parameter_value then null;end;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=bad;
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',bad,u::text,'{"size":0,"mimetype":"image/webp"}');
 begin perform public.snote_profile_avatar_save(c,0,bad);raise exception 'Empty image metadata accepted';exception when invalid_parameter_value then null;end;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=bad;
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',bad,u::text,'{"size":"12","mimetype":"image/webp"}');
 begin perform public.snote_profile_avatar_save(c,0,bad);raise exception 'String size accepted';exception when invalid_parameter_value then null;end;
 ack:=public.snote_profile_avatar_save(c,0,a);if ack->>'avatar_path'<>a or ack->>'avatar_revision'<>'1' or ack->'previous_path'<>'null'::jsonb then raise exception 'First avatar save mismatch';end if;
 if public.snote_profile_avatar_save(c,0,a)<>ack then raise exception 'Lost ACK retry mismatch';end if;
 if public.snote_profile_avatar_read(c)<>ack-'previous_path' then raise exception 'Avatar readback mismatch';end if;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=a;get diagnostics n=row_count;if n<>0 then raise exception 'Current avatar deletion accepted';end if;
 update storage.objects set metadata='{"size":1,"mimetype":"image/png"}' where bucket_id='snote-profile-photos' and name=a;get diagnostics n=row_count;if n<>0 then raise exception 'Immutable avatar overwrite accepted';end if;
 begin perform public.snote_profile_avatar_save(c,0,b);raise exception 'Stale CAS accepted';exception when serialization_failure then null;end;
 ack:=public.snote_profile_avatar_save(c,1,b);if ack->>'avatar_revision'<>'2' or ack->>'previous_path'<>a then raise exception 'Replacement metadata mismatch';end if;
 if public.snote_profile_avatar_save(c,1,b)<>ack then raise exception 'Replacement retry lost previous path';end if;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=a;get diagnostics n=row_count;if n<>1 then raise exception 'Old unreferenced cleanup denied';end if;
 delete from storage.objects where bucket_id='snote-profile-photos' and name=bad;get diagnostics n=row_count;if n<>1 then raise exception 'Failed staged upload cleanup denied';end if;
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('zc-vehicle-private',c::text||'/'||u::text||'/avatar-fixture-other-bucket/fixture.jpg',u::text,'{}');
 if not exists(select 1 from storage.objects where bucket_id='zc-vehicle-private' and name=c::text||'/'||u::text||'/avatar-fixture-other-bucket/fixture.jpg') then raise exception 'Existing bucket policy narrowed';end if;
 delete from storage.objects where bucket_id='zc-vehicle-private' and name=c::text||'/'||u::text||'/avatar-fixture-other-bucket/fixture.jpg';get diagnostics n=row_count;if n<>1 then raise exception 'Existing bucket delete narrowed';end if;
 perform set_config('request.jwt.claim.sub','7ab9c800-0d7f-4000-8000-000000000002',true);perform set_config('request.jwt.claims','{"sub":"7ab9c800-0d7f-4000-8000-000000000002","role":"authenticated"}',true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Same-company admin face photo leak';end if;
 if public.snote_profile_avatar_read(c)->>'avatar_revision'<>'0' then raise exception 'Admin read another profile metadata';end if;
 delete from storage.objects where bucket_id='snote-profile-photos';get diagnostics n=row_count;if n<>0 then raise exception 'Admin deleted another avatar';end if;
 begin insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',a,u::text,'{}');raise exception 'Foreign path upload accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','7ab9c800-0d7f-4000-8000-000000000003',true);perform set_config('request.jwt.claims','{"sub":"7ab9c800-0d7f-4000-8000-000000000003","role":"authenticated"}',true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Cross-company avatar leak';end if;
 begin perform public.snote_profile_avatar_read(c);raise exception 'Foreign-company RPC accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','is_anonymous',true)::text,true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Anonymous identity read accepted';end if;
 begin perform public.snote_profile_avatar_read(c);raise exception 'Anonymous profile read accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','anon')::text,true);
 begin perform public.snote_profile_avatar_read(c);raise exception 'Wrong JWT role accepted';exception when insufficient_privilege then null;end;
end $own$;
reset role;
-- Even an accidentally broad permissive policy must not expose this bucket.
create policy avatar_probe_broad_read on storage.objects for select to authenticated using(true);
create policy avatar_probe_broad_update on storage.objects for update to authenticated using(true) with check(true);
grant select on snote_private.profile_avatars to authenticated;
set local role authenticated;
do $restrictive$
declare n integer;c uuid:='7ab9c800-0d7f-4000-8000-000000000010';u uuid:='7ab9c800-0d7f-4000-8000-000000000002';p text;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') or exists(select 1 from snote_private.profile_avatars) then raise exception 'Broad-policy same-company leak';end if;
 p:=c::text||'/'||u::text||'/44444444-4444-4444-8444-444444444444.webp';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',p,u::text,'{"size":12,"mimetype":"image/webp"}');
 perform public.snote_profile_avatar_save(c,0,p);
 update storage.objects set metadata='{}' where bucket_id='snote-profile-photos' and name=p;get diagnostics n=row_count;if n<>0 then raise exception 'Broad-policy current overwrite';end if;
 if(select count(*) from snote_private.profile_avatars)<>1 then raise exception 'Own-only private table RLS mismatch';end if;
end $restrictive$;
reset role;
set local role authenticated;
do $accountant$
declare c uuid:='7ab9c800-0d7f-4000-8000-000000000010';u uuid:='7ab9c800-0d7f-4000-8000-000000000004';p text;v jsonb;
begin
 perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 p:=c::text||'/'||u::text||'/55555555-5555-4555-8555-555555555555.webp';
 insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',p,u::text,'{"size":12,"mimetype":"image/webp"}');
 v:=public.snote_profile_avatar_save(c,0,p);if v->>'avatar_revision'<>'1' or v->>'user_id'<>u::text then raise exception 'Accountant own photo failed';end if;
 begin insert into storage.objects(bucket_id,name,owner_id,metadata) values('snote-profile-photos',c::text||'/'||u::text||'/66666666-6666-4666-8666-666666666666.png','7ab9c800-0d7f-4000-8000-000000000002','{"size":12,"mimetype":"image/png"}');raise exception 'Forged object owner accepted';exception when insufficient_privilege then null;end;
 if(select count(*) from snote_private.profile_avatars)<>1 then raise exception 'Accountant table saw another avatar';end if;
end $accountant$;
reset role;
update public.zc_members set active=false where user_id='7ab9c800-0d7f-4000-8000-000000000001';
set local role authenticated;
do $inactive$
begin
 perform set_config('request.jwt.claim.sub','7ab9c800-0d7f-4000-8000-000000000001',true);perform set_config('request.jwt.claims','{"sub":"7ab9c800-0d7f-4000-8000-000000000001","role":"authenticated"}',true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Inactive avatar access';end if;
 begin perform public.snote_profile_avatar_read('7ab9c800-0d7f-4000-8000-000000000010');raise exception 'Inactive avatar RPC';exception when insufficient_privilege then null;end;
end $inactive$;
reset role;
update public.zc_members set active=true,company_id='7ab9c800-0d7f-4000-8000-000000000020' where user_id='7ab9c800-0d7f-4000-8000-000000000001';
set local role authenticated;
do $moved$
begin
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Moved user read old company avatar';end if;
 begin perform public.snote_profile_avatar_read('7ab9c800-0d7f-4000-8000-000000000010');raise exception 'Moved old company RPC';exception when insufficient_privilege then null;end;
 if public.snote_profile_avatar_read('7ab9c800-0d7f-4000-8000-000000000020')->>'avatar_revision'<>'0' then raise exception 'New company inherited old avatar';end if;
end $moved$;
reset role;
update auth.users set banned_until=now()+interval '1 day' where id='7ab9c800-0d7f-4000-8000-000000000002';
set local role authenticated;
do $banned$
begin
 perform set_config('request.jwt.claim.sub','7ab9c800-0d7f-4000-8000-000000000002',true);perform set_config('request.jwt.claims','{"sub":"7ab9c800-0d7f-4000-8000-000000000002","role":"authenticated"}',true);
 if exists(select 1 from storage.objects where bucket_id='snote-profile-photos') then raise exception 'Banned user storage access';end if;
 begin perform public.snote_profile_avatar_read('7ab9c800-0d7f-4000-8000-000000000010');raise exception 'Banned user RPC';exception when insufficient_privilege then null;end;
end $banned$;
reset role;
rollback;
select true as avatar_verified,
 not exists(select 1 from auth.users where id::text like '7ab9c800-0d7f-4000-8000-00000000000%')
 and not exists(select 1 from public.zc_companies where id in('7ab9c800-0d7f-4000-8000-000000000010','7ab9c800-0d7f-4000-8000-000000000020'))
 and not exists(select 1 from storage.objects where bucket_id='snote-profile-photos' and name like '7ab9c800-0d7f-4000-8000-000000000010/%')
 and not exists(select 1 from snote_private.profile_avatars where company_id='7ab9c800-0d7f-4000-8000-000000000010') as avatar_test_rows_absent;
