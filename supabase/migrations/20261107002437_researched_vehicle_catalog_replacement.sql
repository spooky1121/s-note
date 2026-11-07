-- Replace every legacy selector source with versioned research observations.
-- No vehicle, customer, auth or company records are changed.
-- Apply schema first, stage the exact runtime JSON bytes, then activate_dataset.
-- Existing company-specific taxonomy is backed up privately once; future custom
-- registration uses a separate, initially empty epoch.
begin;

create schema if not exists snote_catalog_private;
revoke all on schema snote_catalog_private from public, anon, authenticated, service_role;

create table if not exists snote_catalog_private.legacy_entries (
  id uuid primary key,
  row_data jsonb not null check (pg_catalog.jsonb_typeof(row_data) = 'object'),
  backed_up_at timestamptz not null default pg_catalog.clock_timestamp()
);
create table if not exists snote_catalog_private.legacy_backup_manifest (
  singleton boolean primary key default true check (singleton),
  entry_count integer not null check (entry_count >= 0),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  backed_up_at timestamptz not null default pg_catalog.clock_timestamp()
);
-- The marker and rows commit together. Reapplying never snapshots the new epoch
-- or replaces the original backup, even if an operator later edits the old table.
do $backup$
begin
  lock table public.zc_vehicle_taxonomy in share mode;
  if not exists (select 1 from snote_catalog_private.legacy_backup_manifest) then
    insert into snote_catalog_private.legacy_entries(id, row_data)
      select entry.id, pg_catalog.to_jsonb(entry) from public.zc_vehicle_taxonomy as entry;
    insert into snote_catalog_private.legacy_backup_manifest(singleton, entry_count, payload_sha256)
      select true, pg_catalog.count(*)::integer,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
          coalesce(pg_catalog.jsonb_agg(row_data order by id), '[]'::jsonb)::text, 'UTF8')), 'hex')
      from snote_catalog_private.legacy_entries;
  end if;
end;
$backup$;

create table if not exists snote_catalog_private.datasets (
  dataset_version text primary key check (dataset_version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  expected_count integer not null check (expected_count between 1 and 50000),
  -- Exact UTF-8 JSON document, including whitespace and final newline. Only
  -- research facts belong here; company/customer/browser data must never seed it.
  raw_document text not null default '',
  staged_at timestamptz not null default pg_catalog.clock_timestamp(),
  activated_at timestamptz
);
create table if not exists snote_catalog_private.catalog_entries (
  dataset_version text not null references snote_catalog_private.datasets(dataset_version),
  research_id text not null check (pg_catalog.char_length(research_id) between 1 and 160),
  ordinal integer not null check (ordinal > 0),
  payload jsonb not null check (
    pg_catalog.jsonb_typeof(payload) = 'object'
    and pg_catalog.jsonb_typeof(payload -> 'id') is not distinct from 'string'
    and payload ->> 'id' is not distinct from research_id
    and pg_catalog.jsonb_typeof(payload -> 'researchId') is not distinct from 'string'
    and payload ->> 'researchId' is not distinct from research_id
  ),
  primary key(dataset_version, research_id),
  unique(dataset_version, ordinal)
);
-- Five classification labels are deliberately NOT unique: year, market,
-- engine, fuel and evidence observations sharing labels must remain distinct.
create table if not exists snote_catalog_private.active_dataset (
  singleton boolean primary key default true check (singleton),
  dataset_version text not null references snote_catalog_private.datasets(dataset_version),
  activated_at timestamptz not null default pg_catalog.clock_timestamp()
);

create table if not exists snote_catalog_private.custom_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  company_id uuid not null references public.zc_companies(id) on delete cascade,
  make text not null check (pg_catalog.char_length(make) between 1 and 45),
  group_name text not null check (pg_catalog.char_length(group_name) between 1 and 80),
  model text not null check (pg_catalog.char_length(model) between 1 and 100),
  grade text not null default '' check (pg_catalog.char_length(grade) <= 100),
  subgrade text not null default '' check (pg_catalog.char_length(subgrade) <= 80),
  model_year text not null default '' check (model_year = '' or (
    model_year ~ '^[0-9]{4}$' and model_year::integer between 1970 and extract(year from current_date)::integer + 1
  )),
  canonical_identity text generated always as (
    snote_taxonomy_private.identity(make, group_name, model, grade, subgrade)
  ) stored,
  created_by uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint custom_entries_company_identity_key unique (company_id, canonical_identity),
  constraint custom_entries_labels_check check (
    make = snote_taxonomy_private.label(make) and group_name = snote_taxonomy_private.label(group_name)
    and model = snote_taxonomy_private.label(model) and grade = snote_taxonomy_private.label(grade)
    and subgrade = snote_taxonomy_private.label(subgrade)
    and not (make || group_name || model || grade || subgrade || model_year) ~ '[[:cntrl:]]'
  )
);

-- No client can inspect any table, including the private company-id backup.
-- RLS remains a second barrier if a SELECT grant is accidentally added later.
alter table snote_catalog_private.legacy_entries enable row level security;
alter table snote_catalog_private.legacy_backup_manifest enable row level security;
alter table snote_catalog_private.datasets enable row level security;
alter table snote_catalog_private.catalog_entries enable row level security;
alter table snote_catalog_private.active_dataset enable row level security;
alter table snote_catalog_private.custom_entries enable row level security;
alter table public.zc_vehicle_taxonomy enable row level security;
revoke all on all tables in schema snote_catalog_private from public, anon, authenticated, service_role;
revoke all on table public.zc_vehicle_taxonomy from public, anon, authenticated, service_role;

create or replace function snote_catalog_private.reject_legacy_change()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  raise exception 'Legacy taxonomy backup is immutable.' using errcode = '55000';
end;
$function$;
drop trigger if exists legacy_entries_immutable on snote_catalog_private.legacy_entries;
create trigger legacy_entries_immutable before insert or update or delete or truncate
  on snote_catalog_private.legacy_entries for each statement
  execute function snote_catalog_private.reject_legacy_change();
drop trigger if exists legacy_manifest_immutable on snote_catalog_private.legacy_backup_manifest;
create trigger legacy_manifest_immutable before insert or update or delete or truncate
  on snote_catalog_private.legacy_backup_manifest for each statement
  execute function snote_catalog_private.reject_legacy_change();

create or replace function snote_catalog_private.reject_activated_change()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  if tg_table_name = 'datasets' then
    if old.activated_at is not null then
      raise exception 'Activated catalog versions are immutable.' using errcode = '55000';
    end if;
  else
    -- Also lock the parent version: a concurrent stage write cannot commit in
    -- the gap between activation validation and the active-pointer switch.
    if tg_op in ('UPDATE', 'DELETE') then
      perform 1 from snote_catalog_private.datasets as d
        where d.dataset_version = old.dataset_version for share;
      if exists (select 1 from snote_catalog_private.datasets as d
        where d.dataset_version = old.dataset_version and d.activated_at is not null) then
        raise exception 'Activated catalog entries are immutable.' using errcode = '55000';
      end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform 1 from snote_catalog_private.datasets as d
        where d.dataset_version = new.dataset_version for share;
      if exists (select 1 from snote_catalog_private.datasets as d
        where d.dataset_version = new.dataset_version and d.activated_at is not null) then
        raise exception 'Activated catalog entries are immutable.' using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
drop trigger if exists datasets_immutable on snote_catalog_private.datasets;
create trigger datasets_immutable before update or delete on snote_catalog_private.datasets
  for each row execute function snote_catalog_private.reject_activated_change();
drop trigger if exists catalog_entries_immutable on snote_catalog_private.catalog_entries;
create trigger catalog_entries_immutable before insert or update or delete on snote_catalog_private.catalog_entries
  for each row execute function snote_catalog_private.reject_activated_change();

create or replace function snote_catalog_private.reject_catalog_truncate()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  raise exception 'Versioned catalog tables cannot be truncated.' using errcode = '55000';
end;
$function$;
drop trigger if exists datasets_no_truncate on snote_catalog_private.datasets;
create trigger datasets_no_truncate before truncate on snote_catalog_private.datasets
  for each statement execute function snote_catalog_private.reject_catalog_truncate();
drop trigger if exists catalog_entries_no_truncate on snote_catalog_private.catalog_entries;
create trigger catalog_entries_no_truncate before truncate on snote_catalog_private.catalog_entries
  for each statement execute function snote_catalog_private.reject_catalog_truncate();

-- Owner-only staging finalizer. No EXECUTE grant is given to API roles.
-- This validates bytes AND all staged observations before switching one pointer.
create or replace function snote_catalog_private.activate_dataset(
  p_dataset_version text, p_manifest_sha256 text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $function$
declare
  v_dataset snote_catalog_private.datasets;
  v_document jsonb;
  v_count integer;
  v_previous text;
begin
  select * into v_dataset from snote_catalog_private.datasets
    where dataset_version = p_dataset_version for update;
  if not found then raise exception 'Catalog stage is missing.' using errcode = '55000'; end if;
  if p_manifest_sha256 is distinct from v_dataset.manifest_sha256
    or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_dataset.raw_document, 'UTF8')), 'hex')
      is distinct from p_manifest_sha256 then
    raise exception 'Catalog document SHA-256 does not match.' using errcode = '22023';
  end if;
  begin
    v_document := v_dataset.raw_document::jsonb;
  exception when invalid_text_representation then
    raise exception 'Catalog document is not valid JSON.' using errcode = '22023';
  end;
  if pg_catalog.jsonb_typeof(v_document) is distinct from 'object'
    or v_document ->> 'catalogVersion' is distinct from p_dataset_version
    or v_document ->> 'schemaVersion' is distinct from '1'
    or pg_catalog.jsonb_typeof(v_document -> 'records') is distinct from 'array'
    or v_document #>> '{counts,records}' is distinct from v_dataset.expected_count::text then
    raise exception 'Catalog version, schema or declared count is invalid.' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(v_document -> 'records') <> v_dataset.expected_count then
    raise exception 'Catalog source count does not match.' using errcode = '22023';
  end if;
  select pg_catalog.count(*)::integer into v_count from snote_catalog_private.catalog_entries
    where dataset_version = p_dataset_version;
  if v_count <> v_dataset.expected_count then
    raise exception 'Catalog staged count does not match.' using errcode = '22023';
  end if;
  -- Matching ordinal, stable id, and the complete JSON payload prevents a
  -- changed year/engine/market/source from passing a mere row-count check.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_document -> 'records') with ordinality as original(payload, ordinal)
    left join snote_catalog_private.catalog_entries as staged
      on staged.dataset_version = p_dataset_version and staged.ordinal = original.ordinal
    where staged.research_id is distinct from original.payload ->> 'id'
      or staged.research_id is distinct from original.payload ->> 'researchId'
      or staged.payload is distinct from original.payload
  ) then
    raise exception 'Catalog staged observations differ from the source document.' using errcode = '22023';
  end if;
  -- Serialize concurrent activations, including the first pointer creation.
  perform pg_catalog.pg_advisory_xact_lock(20261107, 3128);
  select dataset_version into v_previous from snote_catalog_private.active_dataset where singleton;
  if v_dataset.activated_at is null then
    update snote_catalog_private.datasets set activated_at = pg_catalog.clock_timestamp()
      where dataset_version = p_dataset_version;
  end if;
  insert into snote_catalog_private.active_dataset(singleton, dataset_version)
    values(true, p_dataset_version)
    on conflict (singleton) do update set dataset_version = excluded.dataset_version,
      activated_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('dataset_version', p_dataset_version,
    'manifest_sha256', p_manifest_sha256, 'entry_count', v_count, 'previous_version', v_previous);
end;
$function$;

create or replace function snote_catalog_private.research_list()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_dataset snote_catalog_private.datasets;
  v_entries jsonb;
begin
  -- JWT role/company metadata is never trusted: verify auth.uid against actual
  -- active membership rows for every call, including cached UI reloads.
  perform 1 from snote_taxonomy_private.member(false);
  select d.* into v_dataset from snote_catalog_private.datasets as d
    join snote_catalog_private.active_dataset as a using(dataset_version)
    where a.singleton and d.activated_at is not null;
  if not found then
    raise exception 'The research vehicle catalog is not active yet.' using errcode = '55000';
  end if;
  select pg_catalog.jsonb_agg(payload order by ordinal) into v_entries
    from snote_catalog_private.catalog_entries where dataset_version = v_dataset.dataset_version;
  return pg_catalog.jsonb_build_object('dataset_version', v_dataset.dataset_version,
    'manifest_sha256', v_dataset.manifest_sha256, 'entry_count', v_dataset.expected_count,
    'entries', v_entries);
end;
$function$;

create or replace function snote_catalog_private.custom_entry(p_row snote_catalog_private.custom_entries)
returns jsonb language sql immutable strict set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_row.id, 'make', p_row.make, 'group', p_row.group_name,
    'model', p_row.model, 'grade', p_row.grade, 'subgrade', p_row.subgrade,
    'model_year', p_row.model_year, 'verification', 'user_import',
    'source', 'company_vehicle_registration', 'market', 'KR'
  );
$function$;

create or replace function snote_catalog_private.custom_list()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_context record; v_entries jsonb;
begin
  select * into v_context from snote_taxonomy_private.member(false);
  select coalesce(pg_catalog.jsonb_agg(snote_catalog_private.custom_entry(entry)
    order by entry.canonical_identity, entry.id), '[]'::jsonb)
    into v_entries from snote_catalog_private.custom_entries as entry
    where entry.company_id = v_context.company_id;
  return pg_catalog.jsonb_build_object('company_id', v_context.company_id, 'entries', v_entries);
end;
$function$;

create or replace function snote_catalog_private.custom_upsert(p_entry jsonb, p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_context record;
  v_key text;
  v_raw text;
  v_values jsonb := '{}'::jsonb;
  v_value text;
  v_max integer;
  v_row snote_catalog_private.custom_entries;
  v_inserted boolean;
  v_identity text;
begin
  select * into v_context from snote_taxonomy_private.member(true);
  -- 회사는 서버 회원정보로만 결정합니다. expected는 이전 화면의 회사가
  -- 소속 변경 후 다른 회사에 입력되는 것을 막는 비교용 값일 뿐입니다.
  if p_expected_company_id is distinct from v_context.company_id then
    raise exception '회사 연결이 변경되었습니다. 차량 등록 화면을 다시 열어 주세요.' using errcode = '42501';
  end if;
  if p_entry is null or pg_catalog.jsonb_typeof(p_entry) <> 'object'
    or pg_catalog.octet_length(p_entry::text) > 8192 then
    raise exception '차종 입력 형식을 확인해 주세요.' using errcode = '22023';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_entry) loop
    if v_key not in ('make', 'group', 'model', 'grade', 'subgrade', 'model_year')
      or pg_catalog.jsonb_typeof(p_entry -> v_key) is distinct from 'string' then
      raise exception '차종 입력 형식을 확인해 주세요.' using errcode = '22023';
    end if;
  end loop;
  foreach v_key in array array['make', 'group', 'model', 'grade', 'subgrade', 'model_year'] loop
    v_raw := coalesce(p_entry ->> v_key, '');
    if v_raw ~ '[[:cntrl:]]' then
      raise exception '차종 입력에는 제어 문자를 사용할 수 없습니다.' using errcode = '22023';
    end if;
    v_value := snote_taxonomy_private.label(v_raw);
    v_max := case v_key when 'make' then 45 when 'group' then 80 when 'model' then 100
      when 'grade' then 100 when 'subgrade' then 80 else 4 end;
    if pg_catalog.char_length(v_value) > v_max
      or (v_key in ('make', 'group', 'model') and v_value = '') then
      raise exception '차종 입력 길이와 필수 항목을 확인해 주세요.' using errcode = '22023';
    end if;
    if v_key = 'model_year' and v_value <> '' then
      if v_value !~ '^[0-9]{4}$' then
        raise exception '연식은 올바른 네 자리 연도로 입력해 주세요.' using errcode = '22023';
      end if;
      if v_value::integer not between 1970 and extract(year from current_date)::integer + 1 then
        raise exception '연식 범위를 확인해 주세요.' using errcode = '22023';
      end if;
    end if;
    v_values := v_values || pg_catalog.jsonb_build_object(v_key, v_value);
  end loop;
  v_identity := snote_taxonomy_private.identity(v_values ->> 'make', v_values ->> 'group',
    v_values ->> 'model', v_values ->> 'grade', v_values ->> 'subgrade');
  insert into snote_catalog_private.custom_entries(company_id, make, group_name, model, grade, subgrade, model_year, created_by)
    values(v_context.company_id, v_values ->> 'make', v_values ->> 'group', v_values ->> 'model',
      v_values ->> 'grade', v_values ->> 'subgrade', v_values ->> 'model_year', v_context.actor_id)
    on conflict on constraint custom_entries_company_identity_key do nothing
    returning * into v_row;
  v_inserted := found;
  if not v_inserted then
    select * into v_row from snote_catalog_private.custom_entries as entry
      where entry.company_id = v_context.company_id and entry.canonical_identity = v_identity;
    if not found then
      raise exception '차종 동시 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.' using errcode = '40001';
    end if;
  end if;
  return pg_catalog.jsonb_build_object('company_id', v_context.company_id,
    'entry', snote_catalog_private.custom_entry(v_row), 'inserted', v_inserted);
end;
$function$;

-- Public API contains only invoker wrappers, never an unchecked definer.
create or replace function public.snote_research_vehicle_catalog_list()
returns jsonb language sql security invoker set search_path = ''
as $function$ select snote_catalog_private.research_list(); $function$;
create or replace function public.snote_vehicle_taxonomy_list()
returns jsonb language sql security invoker set search_path = ''
as $function$ select snote_catalog_private.custom_list(); $function$;
create or replace function public.snote_vehicle_taxonomy_upsert(p_entry jsonb, p_expected_company_id uuid)
returns jsonb language sql security invoker set search_path = ''
as $function$ select snote_catalog_private.custom_upsert(p_entry, p_expected_company_id); $function$;

revoke all on all functions in schema snote_catalog_private from public, anon, authenticated, service_role;
revoke all on function public.snote_research_vehicle_catalog_list() from public, anon, authenticated, service_role;
revoke all on function public.snote_vehicle_taxonomy_list() from public, anon, authenticated, service_role;
revoke all on function public.snote_vehicle_taxonomy_upsert(jsonb, uuid) from public, anon, authenticated, service_role;
-- USAGE is required for invoker wrappers. It gives no table access. Keep this
-- private schema out of PostgREST's exposed schema list.
grant usage on schema snote_catalog_private to authenticated;
grant execute on function snote_catalog_private.research_list() to authenticated;
grant execute on function snote_catalog_private.custom_list() to authenticated;
grant execute on function snote_catalog_private.custom_upsert(jsonb, uuid) to authenticated;
grant execute on function public.snote_research_vehicle_catalog_list() to authenticated;
grant execute on function public.snote_vehicle_taxonomy_list() to authenticated;
grant execute on function public.snote_vehicle_taxonomy_upsert(jsonb, uuid) to authenticated;

comment on table public.zc_vehicle_taxonomy is 'Legacy selection data: backup only. Active manual entries use snote_catalog_private.custom_entries.';
comment on table snote_catalog_private.legacy_entries is 'Immutable private full-row backup of the pre-research company selection epoch. Never expose through public RPC or repository JSON.';
comment on table snote_catalog_private.catalog_entries is 'Source research observations keyed by dataset version + stable researchId, preserving year/engine/market/evidence context. No five-field collapse.';
notify pgrst, 'reload schema';
commit;
