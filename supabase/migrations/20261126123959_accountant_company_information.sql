-- Company information registers are independent from payment settings and financial ledgers.
-- All access uses verified live sessions, active company membership and CAS revisions.
begin;
create schema if not exists snote_information_private;
revoke all on schema snote_information_private from public,anon,authenticated,service_role;

create table if not exists snote_information_private.contact_groups (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 60 and name=btrim(name) and name!~'[[:cntrl:]]'),
 revision integer not null check(revision between 1 and 2147483647),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz,
 unique(company_id,id)
);
create table if not exists snote_information_private.contacts (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 100 and name=btrim(name) and name!~'[[:cntrl:]]'),
 phone text not null check(char_length(phone) between 1 and 40 and phone=btrim(phone) and phone~'^\+?[0-9() -]+$' and char_length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 20),
 group_id uuid,
 memo text not null default '' check(char_length(memo)<=2000 and regexp_replace(memo,E'[\t\n\r]','','g')!~'[[:cntrl:]]'),
 revision integer not null check(revision between 1 and 2147483647),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz,
 foreign key(company_id,group_id) references snote_information_private.contact_groups(company_id,id)
);
create table if not exists snote_information_private.bank_accounts (
 id uuid primary key check(id<>'00000000-0000-0000-0000-000000000000'::uuid),
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 bank_name text not null check(char_length(bank_name) between 1 and 60 and bank_name=btrim(bank_name) and bank_name!~'[[:cntrl:]]'),
 account_number text not null check(char_length(account_number) between 1 and 64 and account_number=btrim(account_number) and account_number~'^[0-9 -]+$' and char_length(regexp_replace(account_number,'[^0-9]','','g')) between 6 and 40),
 memo text not null default '' check(char_length(memo)<=2000 and regexp_replace(memo,E'[\t\n\r]','','g')!~'[[:cntrl:]]'),
 revision integer not null check(revision between 1 and 2147483647),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz
);
create unique index if not exists information_group_live_name_idx on snote_information_private.contact_groups(company_id,lower(name)) where deleted_at is null;
create index if not exists information_groups_company_live_idx on snote_information_private.contact_groups(company_id,id) where deleted_at is null;
create index if not exists information_contacts_company_live_idx on snote_information_private.contacts(company_id,id) where deleted_at is null;
create index if not exists information_contacts_group_idx on snote_information_private.contacts(company_id,group_id);
create index if not exists information_accounts_company_live_idx on snote_information_private.bank_accounts(company_id,id) where deleted_at is null;
create index if not exists information_accounts_company_idx on snote_information_private.bank_accounts(company_id);
create index if not exists information_groups_created_by_idx on snote_information_private.contact_groups(created_by);
create index if not exists information_groups_updated_by_idx on snote_information_private.contact_groups(updated_by);
create index if not exists information_contacts_created_by_idx on snote_information_private.contacts(created_by);
create index if not exists information_contacts_updated_by_idx on snote_information_private.contacts(updated_by);
create index if not exists information_accounts_created_by_idx on snote_information_private.bank_accounts(created_by);
create index if not exists information_accounts_updated_by_idx on snote_information_private.bank_accounts(updated_by);
-- Explicit deny policies add a defense if a table grant is accidentally introduced later.
alter table snote_information_private.contact_groups enable row level security;
alter table snote_information_private.contacts enable row level security;
alter table snote_information_private.bank_accounts enable row level security;
revoke all on table snote_information_private.contact_groups,snote_information_private.contacts,snote_information_private.bank_accounts from public,anon,authenticated,service_role;
drop policy if exists information_groups_direct_deny on snote_information_private.contact_groups;
create policy information_groups_direct_deny on snote_information_private.contact_groups for all to authenticated using(false) with check(false);
drop policy if exists information_contacts_direct_deny on snote_information_private.contacts;
create policy information_contacts_direct_deny on snote_information_private.contacts for all to authenticated using(false) with check(false);
drop policy if exists information_accounts_direct_deny on snote_information_private.bank_accounts;
create policy information_accounts_direct_deny on snote_information_private.bank_accounts for all to authenticated using(false) with check(false);

create or replace function snote_information_private.actor(p_expected_company_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare a uuid:=auth.uid();
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' or a is null or p_expected_company_id is null then
  raise exception 'INFORMATION_CONTEXT_CHANGED' using errcode='42501';
 end if;
 begin
  perform 1 from snote_operator_private.verified_session(a,snote_operator_private.claim_session());
 exception when insufficient_privilege then raise exception 'INFORMATION_CONTEXT_CHANGED' using errcode='42501';
 end;
 perform 1 from public.zc_members m where m.user_id=a and m.company_id=p_expected_company_id and m.active and m.role in('admin','accountant') for share;
 if not found then raise exception 'INFORMATION_CONTEXT_CHANGED' using errcode='42501';end if;
 perform 1 from public.zc_companies c where c.id=p_expected_company_id
  and not exists(select 1 from snote_operator_private.company_state s where s.company_id=c.id and s.archived) for share;
 if not found or exists(select 1 from snote_operator_private.operators o where o.user_id=a) then
  raise exception 'INFORMATION_CONTEXT_CHANGED' using errcode='42501';
 end if;
 return a;
end$$;

create or replace function snote_information_private.table_name(p_kind text)
returns text language plpgsql immutable set search_path='' as $$
begin
 case p_kind when 'groups' then return 'contact_groups';when 'contacts' then return 'contacts';when 'accounts' then return 'bank_accounts';
 else raise exception 'INFORMATION_INVALID_KIND' using errcode='22023';end case;
end$$;

create or replace function snote_information_private.row_value(p_kind text,p_row jsonb)
returns jsonb language plpgsql immutable strict set search_path='' as $$
declare r jsonb;
begin
 case p_kind
 when 'groups' then r:=jsonb_build_object('id',p_row->>'id','name',p_row->>'name');
 when 'contacts' then r:=jsonb_build_object('id',p_row->>'id','name',p_row->>'name','phone',p_row->>'phone','groupId',p_row->>'group_id','memo',p_row->>'memo');
 when 'accounts' then r:=jsonb_build_object('id',p_row->>'id','bankName',p_row->>'bank_name','accountNumber',p_row->>'account_number','memo',p_row->>'memo');
 else raise exception 'INFORMATION_INVALID_KIND' using errcode='22023';end case;
 return r||jsonb_build_object('revision',(p_row->>'revision')::integer,
  'createdAt',to_char((p_row->>'created_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'updatedAt',to_char((p_row->>'updated_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end$$;

create or replace function snote_information_private.validate_record(p_kind text,p_record jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;keys text[];i uuid;g uuid;n text;v text;m text;
begin
 perform snote_information_private.table_name(p_kind);
 keys:=case p_kind when 'groups' then array['id','name'] when 'contacts' then array['id','name','phone','groupId','memo'] else array['id','bankName','accountNumber','memo'] end;
 if p_record is null or jsonb_typeof(p_record)<>'object' or octet_length(p_record::text)>16384 or not(p_record ?& keys) then
  raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 for k in select jsonb_object_keys(p_record) loop
  if not(k=any(keys)) then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
  if k='groupId' then
   if jsonb_typeof(p_record->k) not in('string','null') then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
  elsif jsonb_typeof(p_record->k) is distinct from 'string' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 end loop;
 if (p_record->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_record->>'id'='00000000-0000-0000-0000-000000000000' then
  raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 i:=(p_record->>'id')::uuid;
 if p_kind='groups' then
  n:=btrim(p_record->>'name');
  if char_length(n) not between 1 and 60 or n~'[[:cntrl:]]' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
  return jsonb_build_object('id',i,'name',n);
 end if;
 m:=p_record->>'memo';
 if char_length(m)>2000 or regexp_replace(m,E'[\t\n\r]','','g')~'[[:cntrl:]]' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 if p_kind='contacts' then
  n:=btrim(p_record->>'name');v:=btrim(p_record->>'phone');
  if char_length(n) not between 1 and 100 or n~'[[:cntrl:]]' or char_length(v) not between 1 and 40 or v!~'^\+?[0-9() -]+$' or char_length(regexp_replace(v,'[^0-9]','','g')) not between 7 and 20 then
   raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
  if p_record->>'groupId' is not null then
   if (p_record->>'groupId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or p_record->>'groupId'='00000000-0000-0000-0000-000000000000' then raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
   g:=(p_record->>'groupId')::uuid;
  end if;
  return jsonb_build_object('id',i,'name',n,'phone',v,'groupId',g,'memo',m);
 end if;
 n:=btrim(p_record->>'bankName');v:=btrim(p_record->>'accountNumber');
 if char_length(n) not between 1 and 60 or n~'[[:cntrl:]]' or char_length(v) not between 1 and 64 or v!~'^[0-9 -]+$' or char_length(regexp_replace(v,'[^0-9]','','g')) not between 6 and 40 then
  raise exception 'INFORMATION_INVALID_RECORD' using errcode='22023';end if;
 return jsonb_build_object('id',i,'bankName',n,'accountNumber',v,'memo',m);
end$$;

create or replace function snote_information_private.list_records(p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);r jsonb;
begin
 -- One statement gives all arrays, counts and completeness the same MVCC snapshot.
 with groups_live as not materialized (select * from snote_information_private.contact_groups where company_id=p_expected_company_id and deleted_at is null),
 contacts_live as not materialized (select * from snote_information_private.contacts where company_id=p_expected_company_id and deleted_at is null),
 accounts_live as not materialized (select * from snote_information_private.bank_accounts where company_id=p_expected_company_id and deleted_at is null),
 totals as(select (select count(*) from groups_live) groups_count,(select count(*) from contacts_live) contacts_count,(select count(*) from accounts_live) accounts_count)
 select jsonb_build_object('ok',true,'companyId',p_expected_company_id,
  'groups',coalesce((select jsonb_agg(snote_information_private.row_value('groups',to_jsonb(g)) order by g.id) from (select * from groups_live order by id limit 500)g),'[]'::jsonb),
  'contacts',coalesce((select jsonb_agg(snote_information_private.row_value('contacts',to_jsonb(c)) order by c.id) from (select * from contacts_live order by id limit 5000)c),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(snote_information_private.row_value('accounts',to_jsonb(b)) order by b.id) from (select * from accounts_live order by id limit 2000)b),'[]'::jsonb),
  'counts',jsonb_build_object('groups',groups_count,'contacts',contacts_count,'accounts',accounts_count),
  'complete',groups_count<=500 and contacts_count<=5000 and accounts_count<=2000) into r from totals;
 return r;
end$$;

create or replace function snote_information_private.save_record(p_expected_company_id uuid,p_kind text,p_record jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);v jsonb;r jsonb;t text;i uuid;amount integer;cap integer;duplicate boolean:=false;
begin
 t:=snote_information_private.table_name(p_kind);
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 then raise exception 'INFORMATION_INVALID_REVISION' using errcode='22023';end if;
 v:=snote_information_private.validate_record(p_kind,p_record);i:=(v->>'id')::uuid;
 -- Scope-keyed transaction serialization protects count limits and group assignment/deletion races.
 perform pg_advisory_xact_lock(hashtextextended('snote-information:'||p_expected_company_id::text,0));
 execute format('select to_jsonb(r) from snote_information_private.%I r where r.company_id=$1 and r.id=$2',t) into r using p_expected_company_id,i;
 if r is not null then
  if r->>'deleted_at' is not null then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
  if (r->>'revision')::integer=p_expected_revision+1 and (snote_information_private.row_value(p_kind,r)-array['revision','createdAt','updatedAt'])=v then
   return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind',p_kind,'record',snote_information_private.row_value(p_kind,r),'duplicate',true);
  end if;
  if p_expected_revision<1 or (r->>'revision')::integer<>p_expected_revision then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 elsif p_expected_revision<>0 then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';
 else
  -- A globally known UUID from another company cannot become a new local record.
  execute format('select exists(select 1 from snote_information_private.%I where id=$1)',t) into duplicate using i;
  if duplicate then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
  cap:=case p_kind when 'groups' then 500 when 'contacts' then 5000 else 2000 end;
  execute format('select count(*)::integer from snote_information_private.%I where company_id=$1 and deleted_at is null',t) into amount using p_expected_company_id;
  if amount>=cap then raise exception 'INFORMATION_LIMIT_REACHED' using errcode='54000';end if;
 end if;
 if p_kind='contacts' and v->>'groupId' is not null then
  perform 1 from snote_information_private.contact_groups where company_id=p_expected_company_id and id=(v->>'groupId')::uuid and deleted_at is null;
  if not found then raise exception 'INFORMATION_GROUP_UNAVAILABLE' using errcode='42501';end if;
 end if;
 if p_expected_revision=0 then
  case p_kind
  when 'groups' then
   insert into snote_information_private.contact_groups(id,company_id,name,revision,created_by,updated_by) values(i,p_expected_company_id,v->>'name',1,a,a) on conflict(id) do nothing returning to_jsonb(contact_groups.*) into r;
  when 'contacts' then
   insert into snote_information_private.contacts(id,company_id,name,phone,group_id,memo,revision,created_by,updated_by) values(i,p_expected_company_id,v->>'name',v->>'phone',(v->>'groupId')::uuid,v->>'memo',1,a,a) on conflict(id) do nothing returning to_jsonb(contacts.*) into r;
  when 'accounts' then
   insert into snote_information_private.bank_accounts(id,company_id,bank_name,account_number,memo,revision,created_by,updated_by) values(i,p_expected_company_id,v->>'bankName',v->>'accountNumber',v->>'memo',1,a,a) on conflict(id) do nothing returning to_jsonb(bank_accounts.*) into r;
  end case;
 else
  case p_kind
  when 'groups' then
   update snote_information_private.contact_groups g set name=v->>'name',revision=g.revision+1,updated_by=a,updated_at=clock_timestamp() where g.company_id=p_expected_company_id and g.id=i and g.revision=p_expected_revision and g.deleted_at is null returning to_jsonb(g.*) into r;
  when 'contacts' then
   update snote_information_private.contacts c set name=v->>'name',phone=v->>'phone',group_id=(v->>'groupId')::uuid,memo=v->>'memo',revision=c.revision+1,updated_by=a,updated_at=clock_timestamp() where c.company_id=p_expected_company_id and c.id=i and c.revision=p_expected_revision and c.deleted_at is null returning to_jsonb(c.*) into r;
  when 'accounts' then
   update snote_information_private.bank_accounts b set bank_name=v->>'bankName',account_number=v->>'accountNumber',memo=v->>'memo',revision=b.revision+1,updated_by=a,updated_at=clock_timestamp() where b.company_id=p_expected_company_id and b.id=i and b.revision=p_expected_revision and b.deleted_at is null returning to_jsonb(b.*) into r;
  end case;
 end if;
 if r is null then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind',p_kind,'record',snote_information_private.row_value(p_kind,r),'duplicate',duplicate);
 exception when unique_violation then raise exception 'INFORMATION_GROUP_EXISTS' using errcode='23505';
end$$;

create or replace function snote_information_private.delete_record(p_expected_company_id uuid,p_kind text,p_id uuid,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_information_private.actor(p_expected_company_id);t text;r jsonb;duplicate boolean:=false;
begin
 t:=snote_information_private.table_name(p_kind);
 if p_id is null or p_id='00000000-0000-0000-0000-000000000000'::uuid or p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=2147483647 then raise exception 'INFORMATION_INVALID_REVISION' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-information:'||p_expected_company_id::text,0));
 execute format('select to_jsonb(r) from snote_information_private.%I r where r.company_id=$1 and r.id=$2',t) into r using p_expected_company_id,p_id;
 if r is null then raise exception 'INFORMATION_RECORD_UNAVAILABLE' using errcode='42501';end if;
 if r->>'deleted_at' is not null and (r->>'revision')::integer=p_expected_revision+1 then duplicate:=true;
 elsif r->>'deleted_at' is null and (r->>'revision')::integer=p_expected_revision then
  if p_kind='groups' and exists(select 1 from snote_information_private.contacts where company_id=p_expected_company_id and group_id=p_id and deleted_at is null) then raise exception 'INFORMATION_GROUP_IN_USE' using errcode='40001';end if;
  execute format('update snote_information_private.%I r set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),updated_by=$1,revision=r.revision+1 where r.company_id=$2 and r.id=$3 and r.revision=$4 and r.deleted_at is null returning to_jsonb(r)',t) into r using a,p_expected_company_id,p_id,p_expected_revision;
  if r is null then raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 else raise exception 'INFORMATION_CONFLICT' using errcode='40001';end if;
 return jsonb_build_object('ok',true,'companyId',p_expected_company_id,'kind',p_kind,'id',p_id,'revision',(r->>'revision')::integer,'deleted',true,'duplicate',duplicate);
end$$;

create or replace function public.snote_information_list(p_expected_company_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.list_records(p_expected_company_id);$$;
create or replace function public.snote_information_save(p_expected_company_id uuid,p_kind text,p_record jsonb,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.save_record(p_expected_company_id,p_kind,p_record,p_expected_revision);$$;
create or replace function public.snote_information_delete(p_expected_company_id uuid,p_kind text,p_id uuid,p_expected_revision integer)
returns jsonb language sql security invoker set search_path='' as $$select snote_information_private.delete_record(p_expected_company_id,p_kind,p_id,p_expected_revision);$$;

revoke all on function snote_information_private.actor(uuid),snote_information_private.table_name(text),snote_information_private.row_value(text,jsonb),snote_information_private.validate_record(text,jsonb),snote_information_private.list_records(uuid),snote_information_private.save_record(uuid,text,jsonb,integer),snote_information_private.delete_record(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.snote_information_list(uuid),public.snote_information_save(uuid,text,jsonb,integer),public.snote_information_delete(uuid,text,uuid,integer) from public,anon,authenticated,service_role;
grant usage on schema snote_information_private to authenticated;
grant execute on function snote_information_private.list_records(uuid),snote_information_private.save_record(uuid,text,jsonb,integer),snote_information_private.delete_record(uuid,text,uuid,integer) to authenticated;
grant execute on function public.snote_information_list(uuid),public.snote_information_save(uuid,text,jsonb,integer),public.snote_information_delete(uuid,text,uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
