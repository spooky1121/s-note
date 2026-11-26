-- Work contacts are company-owned overrides, independent of account identity.
-- Keep v1's exact three-register envelope for already-open clients.
begin;
create table if not exists snote_information_private.staff_contacts (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 member_id uuid not null references auth.users(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 120 and name=btrim(name) and name!~'[[:cntrl:]]'),
 phone text not null default '' check(phone=btrim(phone) and char_length(phone)<=40 and (phone='' or (phone~'^\+?[0-9() -]+$' and char_length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 20))),
 memo text not null default '' check(char_length(memo)<=2000 and regexp_replace(memo,E'[\t\n\r]','','g')!~'[[:cntrl:]]'),
 revision integer not null check(revision between 1 and 2147483647),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz
);
create unique index if not exists information_staff_live_member_idx on snote_information_private.staff_contacts(company_id,member_id) where deleted_at is null;
create index if not exists information_staff_company_live_idx on snote_information_private.staff_contacts(company_id,id) where deleted_at is null;
create index if not exists information_staff_member_idx on snote_information_private.staff_contacts(member_id);
create index if not exists information_staff_created_by_idx on snote_information_private.staff_contacts(created_by);
create index if not exists information_staff_updated_by_idx on snote_information_private.staff_contacts(updated_by);
alter table snote_information_private.staff_contacts enable row level security;
revoke all on snote_information_private.staff_contacts from public,anon,authenticated,service_role;
drop policy if exists information_staff_direct_deny on snote_information_private.staff_contacts;
create policy information_staff_direct_deny on snote_information_private.staff_contacts for all to authenticated using(false) with check(false);

create or replace function snote_information_private.staff_value(p_row snote_information_private.staff_contacts)
returns jsonb language sql immutable strict set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'memberId',p_row.member_id,'name',p_row.name,'phone',p_row.phone,'memo',p_row.memo,'revision',p_row.revision,
  'createdAt',to_char(p_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char(p_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
$$;
create or replace function snote_information_private.validate_staff(p_record jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;i uuid;target uuid;n text;p text;m text;
begin
 if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>16384 or not(p_record?&array['id','memberId','name','phone','memo']) then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_record) loop
  if k not in('id','memberId','name','phone','memo') or jsonb_typeof(p_record->k) is distinct from 'string' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 end loop;
 foreach k in array array['id','memberId'] loop
  if p_record->>k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_record->>k='00000000-0000-0000-0000-000000000000' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 end loop;
 i:=(p_record->>'id')::uuid;target:=(p_record->>'memberId')::uuid;n:=btrim(p_record->>'name');p:=btrim(p_record->>'phone');m:=p_record->>'memo';
 if char_length(n) not between 1 and 120 or n~'[[:cntrl:]]' or char_length(p)>40 or (p<>'' and (p!~'^\+?[0-9() -]+$' or char_length(regexp_replace(p,'[^0-9]','','g')) not between 7 and 20))
  or char_length(m)>2000 or regexp_replace(m,E'[\t\n\r]','','g')~'[[:cntrl:]]' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 return jsonb_build_object('id',i,'memberId',target,'name',n,'phone',p,'memo',m);
end$$;

create or replace function snote_information_private.staff_target(p_company uuid,p_member uuid)
returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.zc_members m join auth.users u on u.id=m.user_id where m.company_id=p_company and m.user_id=p_member and m.active and m.role in('admin','dealer','accountant')
  and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share of m,u;
 if not found or exists(select 1 from snote_operator_private.operators where user_id=p_member)
  or exists(select 1 from snote_operator_private.account_state where user_id=p_member and archived) then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
end$$;

create or replace function snote_information_private.list_records_v2(p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);r jsonb;staff jsonb;amount bigint;
begin
 r:=snote_information_private.list_records(p_expected_company_id);
 with live as materialized (
  select s.* from snote_information_private.staff_contacts s join public.zc_members m on m.company_id=s.company_id and m.user_id=s.member_id join auth.users u on u.id=m.user_id
  where s.company_id=p_expected_company_id and s.deleted_at is null and m.active and m.role in('admin','dealer','accountant')
   and u.deleted_at is null and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=clock_timestamp())
   and not exists(select 1 from snote_operator_private.operators o where o.user_id=m.user_id)
   and not exists(select 1 from snote_operator_private.account_state x where x.user_id=m.user_id and x.archived)
 ) select (select count(*) from live),coalesce((select jsonb_agg(snote_information_private.staff_value(s) order by s.id) from (select * from live order by id limit 5000)s),'[]'::jsonb) into amount,staff;
 return r||jsonb_build_object('staffContacts',staff,'counts',(r->'counts')||jsonb_build_object('staffContacts',amount),'complete',(r->>'complete')::boolean and amount<=5000);
end$$;

create or replace function snote_information_private.save_staff(p_expected_company_id uuid,p_record jsonb,p_expected_revision integer)
returns jsonb language plpgsql set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);v jsonb;r snote_information_private.staff_contacts;i uuid;target uuid;
begin
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception 'INFORMATION_INVALID_REVISION' using errcode='22023';end if;
 v:=snote_information_private.validate_staff(p_record);i:=(v->>'id')::uuid;target:=(v->>'memberId')::uuid;
 perform snote_information_private.staff_target(p_expected_company_id,target);
 perform pg_advisory_xact_lock(hashtextextended('snote-information:'||p_expected_company_id::text,0));
 select * into r from snote_information_private.staff_contacts where company_id=p_expected_company_id and id=i;
 if found then
  if r.deleted_at is not null then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
  if r.member_id<>target then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
  if r.revision=p_expected_revision+1 and (snote_information_private.staff_value(r)-array['revision','createdAt','updatedAt'])=v then
   return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind','staffContacts','record',snote_information_private.staff_value(r),'duplicate',true);
  end if;
  if p_expected_revision<1 or r.revision<>p_expected_revision then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 elsif p_expected_revision<>0 then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';
 else
  if exists(select 1 from snote_information_private.staff_contacts where id=i) then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
  if exists(select 1 from snote_information_private.staff_contacts where company_id=p_expected_company_id and member_id=target and deleted_at is null) then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
  if (select count(*) from snote_information_private.staff_contacts where company_id=p_expected_company_id and deleted_at is null)>=5000 then raise exception 'INFORMATION_LIMIT_REACHED' using errcode='54000';end if;
 end if;
 if p_expected_revision=0 then
  insert into snote_information_private.staff_contacts(id,company_id,member_id,name,phone,memo,revision,created_by,updated_by) values(i,p_expected_company_id,target,v->>'name',v->>'phone',v->>'memo',1,a,a) on conflict do nothing returning * into r;
 else
  update snote_information_private.staff_contacts s set name=v->>'name',phone=v->>'phone',memo=v->>'memo',revision=s.revision+1,updated_at=clock_timestamp(),updated_by=a
   where s.company_id=p_expected_company_id and s.id=i and s.member_id=target and s.revision=p_expected_revision and s.deleted_at is null returning * into r;
 end if;
 if r.id is null then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind','staffContacts','record',snote_information_private.staff_value(r),'duplicate',false);
end$$;

create or replace function snote_information_private.delete_staff(p_expected_company_id uuid,p_id uuid,p_expected_revision integer)
returns jsonb language plpgsql set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);r snote_information_private.staff_contacts;duplicate boolean:=false;
begin
 if p_id is null or p_id='00000000-0000-0000-0000-000000000000'::uuid or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647 then raise exception 'INFORMATION_INVALID_REVISION' using errcode='22023';end if;
 -- Match save's target-before-company-lock ordering, preventing cross-editor deadlocks.
 select * into r from snote_information_private.staff_contacts where company_id=p_expected_company_id and id=p_id;
 if not found then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
 perform snote_information_private.staff_target(p_expected_company_id,r.member_id);
 perform pg_advisory_xact_lock(hashtextextended('snote-information:'||p_expected_company_id::text,0));
 select * into r from snote_information_private.staff_contacts where company_id=p_expected_company_id and id=p_id;
 if r.deleted_at is not null and r.revision=p_expected_revision+1 then duplicate:=true;
 elsif r.deleted_at is null and r.revision=p_expected_revision then
  update snote_information_private.staff_contacts s set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=a,revision=s.revision+1
   where s.company_id=p_expected_company_id and s.id=p_id and s.revision=p_expected_revision and s.deleted_at is null returning * into r;
  if r.id is null then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 else raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind','staffContacts','id',p_id,'revision',r.revision,'deleted',true,'duplicate',duplicate);
end$$;

create or replace function snote_information_private.save_record_v2(p_expected_company_id uuid,p_kind text,p_record jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_kind='staffContacts' then return snote_information_private.save_staff(p_expected_company_id,p_record,p_expected_revision);end if;
 return snote_information_private.save_record(p_expected_company_id,p_kind,p_record,p_expected_revision);
end$$;
create or replace function snote_information_private.delete_record_v2(p_expected_company_id uuid,p_kind text,p_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_kind='staffContacts' then return snote_information_private.delete_staff(p_expected_company_id,p_id,p_expected_revision);end if;
 return snote_information_private.delete_record(p_expected_company_id,p_kind,p_id,p_expected_revision);
end$$;
create or replace function public.snote_information_list_v2(p_expected_company_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.list_records_v2(p_expected_company_id);$$;
create or replace function public.snote_information_save_v2(p_expected_company_id uuid,p_kind text,p_record jsonb,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.save_record_v2(p_expected_company_id,p_kind,p_record,p_expected_revision);$$;
create or replace function public.snote_information_delete_v2(p_expected_company_id uuid,p_kind text,p_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.delete_record_v2(p_expected_company_id,p_kind,p_id,p_expected_revision);$$;

revoke all on function snote_information_private.staff_value(snote_information_private.staff_contacts),snote_information_private.validate_staff(jsonb),snote_information_private.staff_target(uuid,uuid),snote_information_private.save_staff(uuid,jsonb,integer),snote_information_private.delete_staff(uuid,uuid,integer),snote_information_private.list_records_v2(uuid),snote_information_private.save_record_v2(uuid,text,jsonb,integer),snote_information_private.delete_record_v2(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.snote_information_list_v2(uuid),public.snote_information_save_v2(uuid,text,jsonb,integer),public.snote_information_delete_v2(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function snote_information_private.list_records_v2(uuid),snote_information_private.save_record_v2(uuid,text,jsonb,integer),snote_information_private.delete_record_v2(uuid,text,uuid,integer) to authenticated;
grant execute on function public.snote_information_list_v2(uuid),public.snote_information_save_v2(uuid,text,jsonb,integer),public.snote_information_delete_v2(uuid,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
