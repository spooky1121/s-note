-- Face photos remain private to the current account and its active company scope.
-- Upload new immutable objects first; publish them with an independent CAS revision.
create schema if not exists snote_private;
revoke all on schema snote_private from public,anon;
grant usage on schema snote_private to authenticated;

create table if not exists snote_private.profile_avatars (
 user_id uuid not null references auth.users(id) on delete cascade,
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 file_path text not null check(char_length(file_path)<=140),
 previous_path text,
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default now(),
 primary key(user_id,company_id),
 unique(file_path)
);
alter table snote_private.profile_avatars enable row level security;
revoke all on snote_private.profile_avatars from public,anon,authenticated;
drop policy if exists profile_avatars_own on snote_private.profile_avatars;


insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('snote-profile-photos','snote-profile-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
 on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function snote_private.avatar_actor(p_company uuid,p_lock boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
  raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 if p_lock then
  perform 1 from public.zc_members where user_id=v_actor and company_id=p_company
   and active is true and role in('admin','dealer','accountant') for share;
 else
  perform 1 from public.zc_members where user_id=v_actor and company_id=p_company
   and active is true and role in('admin','dealer','accountant');
 end if;
 if not found or not exists(select 1 from auth.users where id=v_actor and (banned_until is null or banned_until<=now())) then
  raise exception 'ACTIVE_MEMBERSHIP_REQUIRED' using errcode='42501';
 end if;
 return v_actor;
end;$$;

create or replace function snote_private.avatar_path_valid(p_company uuid,p_actor uuid,p_path text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select p_path is not null and char_length(p_path)<=140
  and p_path ~ ('^'||p_company::text||'/'||p_actor::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$');
$$;

create or replace function snote_private.avatar_read(p_company uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.avatar_actor(p_company);v_row snote_private.profile_avatars;
begin
 select * into v_row from snote_private.profile_avatars where user_id=v_actor and company_id=p_company;
 return jsonb_build_object('user_id',v_actor,'company_id',p_company,'avatar_path',v_row.file_path,'avatar_revision',coalesce(v_row.revision,0));
end;$$;

create or replace function snote_private.avatar_save(p_company uuid,p_expected_revision bigint,p_file_path text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.avatar_actor(p_company,true);v_row snote_private.profile_avatars;
 v_object storage.objects;v_mime text;v_size numeric;v_ext text;v_revision bigint;v_previous text;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>9007199254740991
  or not coalesce(snote_private.avatar_path_valid(p_company,v_actor,p_file_path),false) then
  raise exception 'INVALID_AVATAR' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtext('snote-profile-avatar'),hashtext(v_actor::text||'/'||p_company::text));
 select * into v_row from snote_private.profile_avatars where user_id=v_actor and company_id=p_company for update;
 select * into v_object from storage.objects where bucket_id='snote-profile-photos' and name=p_file_path for share;
 if not found then raise exception 'AVATAR_FILE_MISSING' using errcode='40001';end if;
 if coalesce(nullif(v_object.owner_id,''),v_object.owner::text) is distinct from v_actor::text then
  raise exception 'AVATAR_FILE_FORBIDDEN' using errcode='42501';
 end if;
 v_ext:=substring(p_file_path from '\.(jpg|png|webp)$');v_mime:=v_object.metadata->>'mimetype';
 if jsonb_typeof(v_object.metadata->'size') is distinct from 'number'
  or coalesce(v_object.metadata->>'size','')!~'^[0-9]{1,10}$' then
  raise exception 'INVALID_AVATAR_FILE' using errcode='22023';
 end if;
 v_size:=(v_object.metadata->>'size')::numeric;
 if v_size<1 or v_size>5242880 or v_mime is distinct from (case v_ext when 'jpg' then 'image/jpeg' when 'png' then 'image/png' when 'webp' then 'image/webp' end) then
  raise exception 'INVALID_AVATAR_FILE' using errcode='22023';
 end if;
 -- A lost ACK can be retried with the same expected revision and immutable path.
 if v_row.file_path=p_file_path and v_row.revision=p_expected_revision+1 then
  return jsonb_build_object('user_id',v_actor,'company_id',p_company,'avatar_path',v_row.file_path,'avatar_revision',v_row.revision,'previous_path',v_row.previous_path);
 end if;
 if coalesce(v_row.revision,0)<>p_expected_revision then raise exception 'AVATAR_CONFLICT' using errcode='40001';end if;
 if p_expected_revision=9007199254740991 then raise exception 'AVATAR_REVISION_EXHAUSTED' using errcode='22023';end if;
 v_revision:=p_expected_revision+1;v_previous:=v_row.file_path;
 insert into snote_private.profile_avatars(user_id,company_id,file_path,previous_path,revision)
  values(v_actor,p_company,p_file_path,v_previous,v_revision)
  on conflict(user_id,company_id) do update set file_path=excluded.file_path,previous_path=excluded.previous_path,revision=excluded.revision,updated_at=now();
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action)
  values(p_company,v_actor,'member_avatar',v_actor::text,'self_avatar_update');
 return jsonb_build_object('user_id',v_actor,'company_id',p_company,'avatar_path',p_file_path,'avatar_revision',v_revision,'previous_path',v_previous);
end;$$;

-- Restrictive guards keep a future broad Storage policy from exposing face photos.
create or replace function snote_private.avatar_storage_allow(p_bucket text,p_name text,p_delete boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_company uuid;
begin
 if p_bucket<>'snote-profile-photos' then return true;end if;
 if v_actor is null or coalesce(auth.jwt()->>'role','')<>'authenticated'
  or coalesce(auth.jwt()->>'is_anonymous','false')='true' then return false;end if;
 if split_part(p_name,'/',1)!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false;end if;
 v_company:=split_part(p_name,'/',1)::uuid;
 if not coalesce(snote_private.avatar_path_valid(v_company,v_actor,p_name),false) then return false;end if;
 if p_delete then
  perform 1 from public.zc_members where user_id=v_actor and company_id=v_company
   and active is true and role in('admin','dealer','accountant') for share;
 else
  perform 1 from public.zc_members where user_id=v_actor and company_id=v_company
   and active is true and role in('admin','dealer','accountant');
 end if;
 if not found or not exists(select 1 from auth.users where id=v_actor and (banned_until is null or banned_until<=now())) then return false;end if;
 if p_delete then
  perform pg_advisory_xact_lock(hashtext('snote-profile-avatar'),hashtext(v_actor::text||'/'||v_company::text));
  return not exists(select 1 from snote_private.profile_avatars where file_path=p_name);
 end if;
 return true;
end;$$;

revoke all on function snote_private.avatar_actor(uuid,boolean) from public,anon,authenticated;
revoke all on function snote_private.avatar_path_valid(uuid,uuid,text) from public,anon,authenticated;
revoke all on function snote_private.avatar_read(uuid) from public,anon;
revoke all on function snote_private.avatar_save(uuid,bigint,text) from public,anon;
revoke all on function snote_private.avatar_storage_allow(text,text,boolean) from public,anon;
grant execute on function snote_private.avatar_read(uuid),snote_private.avatar_save(uuid,bigint,text),snote_private.avatar_storage_allow(text,text,boolean) to authenticated;

create or replace function public.snote_profile_avatar_read(p_company uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.avatar_read(p_company);$$;
create or replace function public.snote_profile_avatar_save(p_company uuid,p_expected_revision bigint,p_file_path text)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.avatar_save(p_company,p_expected_revision,p_file_path);$$;
revoke all on function public.snote_profile_avatar_read(uuid),public.snote_profile_avatar_save(uuid,bigint,text) from public,anon;
grant execute on function public.snote_profile_avatar_read(uuid),public.snote_profile_avatar_save(uuid,bigint,text) to authenticated;

create policy profile_avatars_own on snote_private.profile_avatars for all to authenticated
 using(user_id=(select auth.uid()) and snote_private.avatar_storage_allow('snote-profile-photos',file_path,false))
 with check(user_id=(select auth.uid()) and snote_private.avatar_storage_allow('snote-profile-photos',file_path,false));

drop policy if exists snote_avatar_storage_read on storage.objects;
drop policy if exists snote_avatar_storage_insert on storage.objects;
drop policy if exists snote_avatar_storage_delete on storage.objects;
drop policy if exists snote_avatar_storage_read_guard on storage.objects;
drop policy if exists snote_avatar_storage_insert_guard on storage.objects;
drop policy if exists snote_avatar_storage_update_guard on storage.objects;
drop policy if exists snote_avatar_storage_delete_guard on storage.objects;
create policy snote_avatar_storage_read on storage.objects for select to authenticated
 using(bucket_id='snote-profile-photos' and snote_private.avatar_storage_allow(bucket_id,name,false));
create policy snote_avatar_storage_insert on storage.objects for insert to authenticated
 with check(bucket_id='snote-profile-photos' and owner_id=(select auth.uid())::text and snote_private.avatar_storage_allow(bucket_id,name,false));
create policy snote_avatar_storage_delete on storage.objects for delete to authenticated
 using(bucket_id='snote-profile-photos' and snote_private.avatar_storage_allow(bucket_id,name,true));
create policy snote_avatar_storage_read_guard on storage.objects as restrictive for select to authenticated
 using(snote_private.avatar_storage_allow(bucket_id,name,false));
create policy snote_avatar_storage_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'snote-profile-photos' or (owner_id=(select auth.uid())::text and snote_private.avatar_storage_allow(bucket_id,name,false)));
create policy snote_avatar_storage_update_guard on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'snote-profile-photos') with check(bucket_id<>'snote-profile-photos');
create policy snote_avatar_storage_delete_guard on storage.objects as restrictive for delete to authenticated
 using(snote_private.avatar_storage_allow(bucket_id,name,true));
notify pgrst,'reload schema';
