-- 직접 입력한 차종을 소속 상사 안에서 공유합니다. 공식 검증 자료로 승격하지 않습니다.
-- 기존 zc_companies / zc_members가 있는 프로젝트에서 전체 파일을 실행하세요.
-- 차량·고객·기존 차종 자료는 수정하지 않습니다. 같은 SQL을 다시 실행할 수 있습니다.
begin;

create schema if not exists snote_taxonomy_private;
revoke all on schema snote_taxonomy_private from public, anon, authenticated, service_role;

create or replace function snote_taxonomy_private.label(p_value text)
returns text language sql immutable strict set search_path = ''
as $function$
  select pg_catalog.btrim(pg_catalog.regexp_replace(p_value,
    '[[:space:]' || U&'\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF' || ']+', ' ', 'g'));
$function$;

create or replace function snote_taxonomy_private.identity(
  p_make text, p_group text, p_model text, p_grade text, p_subgrade text
)
returns text language sql immutable strict set search_path = ''
as $function$
  -- 브라우저와 동일하게 NFKC 후 ASCII 대문자만 접습니다. Unicode lower의
  -- locale/context 차이(예: 그리스 시그마·터키어 I)로 ACK가 달라지지 않게 합니다.
  select pg_catalog.jsonb_build_array(
    pg_catalog.translate(snote_taxonomy_private.label(pg_catalog.normalize(p_make, 'NFKC')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    pg_catalog.translate(snote_taxonomy_private.label(pg_catalog.normalize(p_group, 'NFKC')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    pg_catalog.translate(snote_taxonomy_private.label(pg_catalog.normalize(p_model, 'NFKC')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    pg_catalog.translate(snote_taxonomy_private.label(pg_catalog.normalize(p_grade, 'NFKC')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
    pg_catalog.translate(snote_taxonomy_private.label(pg_catalog.normalize(p_subgrade, 'NFKC')), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
  )::text;
$function$;

create table if not exists public.zc_vehicle_taxonomy (
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
  constraint zc_vehicle_taxonomy_company_identity_key unique (company_id, canonical_identity),
  constraint zc_vehicle_taxonomy_labels_check check (
    make = snote_taxonomy_private.label(make) and group_name = snote_taxonomy_private.label(group_name)
    and model = snote_taxonomy_private.label(model) and grade = snote_taxonomy_private.label(grade)
    and subgrade = snote_taxonomy_private.label(subgrade)
    and not (make || group_name || model || grade || subgrade || model_year) ~ '[[:cntrl:]]'
  )
);

alter table public.zc_vehicle_taxonomy enable row level security;
revoke all on table public.zc_vehicle_taxonomy from public, anon, authenticated, service_role;
-- 의도적으로 직접 접근 정책/권한을 만들지 않습니다. 아래 RPC만 사용합니다.

create or replace function snote_taxonomy_private.member(p_write boolean)
returns table(company_id uuid, actor_id uuid)
language plpgsql set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_member record;
  v_company uuid;
  v_role text;
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception '로그인한 상사 회원만 차종 자료를 이용할 수 있습니다.' using errcode = '42501';
  end if;
  for v_member in
    select membership.company_id, membership.role from public.zc_members as membership
    where membership.user_id = v_actor and membership.active is true
    for share
  loop
    v_count := v_count + 1;
    v_company := v_member.company_id;
    v_role := v_member.role;
  end loop;
  if v_count <> 1 or v_company is null or v_role is null
    or v_role not in ('admin', 'dealer', 'accountant')
    or (p_write and v_role not in ('admin', 'dealer')) then
    raise exception '현재 소속과 차종 자료 이용 권한을 확인해 주세요.' using errcode = '42501';
  end if;
  return query select v_company, v_actor;
end;
$function$;

create or replace function snote_taxonomy_private.entry(p_row public.zc_vehicle_taxonomy)
returns jsonb language sql immutable strict set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_row.id, 'make', p_row.make, 'group', p_row.group_name,
    'model', p_row.model, 'grade', p_row.grade, 'subgrade', p_row.subgrade,
    'model_year', p_row.model_year, 'verification', 'user_import',
    'source', 'company_vehicle_registration', 'market', 'KR'
  );
$function$;

create or replace function public.snote_vehicle_taxonomy_list()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_context record;
  v_entries jsonb;
begin
  select * into v_context from snote_taxonomy_private.member(false);
  select coalesce(pg_catalog.jsonb_agg(snote_taxonomy_private.entry(entry)
    order by entry.canonical_identity, entry.id), '[]'::jsonb)
    into v_entries from public.zc_vehicle_taxonomy as entry
    where entry.company_id = v_context.company_id;
  return pg_catalog.jsonb_build_object('company_id', v_context.company_id, 'entries', v_entries);
end;
$function$;

-- 이전 초안의 보호 없는 overload가 남아 있어도 호출할 수 없게 제거합니다.
drop function if exists public.snote_vehicle_taxonomy_upsert(jsonb);
create or replace function public.snote_vehicle_taxonomy_upsert(p_entry jsonb, p_expected_company_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_context record;
  v_key text;
  v_raw text;
  v_values jsonb := '{}'::jsonb;
  v_value text;
  v_max integer;
  v_row public.zc_vehicle_taxonomy;
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
  insert into public.zc_vehicle_taxonomy(company_id, make, group_name, model, grade, subgrade, model_year, created_by)
    values(v_context.company_id, v_values ->> 'make', v_values ->> 'group', v_values ->> 'model',
      v_values ->> 'grade', v_values ->> 'subgrade', v_values ->> 'model_year', v_context.actor_id)
    on conflict on constraint zc_vehicle_taxonomy_company_identity_key do nothing
    returning * into v_row;
  v_inserted := found;
  if not v_inserted then
    select * into v_row from public.zc_vehicle_taxonomy as entry
      where entry.company_id = v_context.company_id and entry.canonical_identity = v_identity;
    if not found then
      raise exception '차종 동시 저장 결과를 확인하지 못했습니다. 다시 시도해 주세요.' using errcode = '40001';
    end if;
  end if;
  return pg_catalog.jsonb_build_object('company_id', v_context.company_id,
    'entry', snote_taxonomy_private.entry(v_row), 'inserted', v_inserted);
end;
$function$;

revoke all on function snote_taxonomy_private.label(text) from public, anon, authenticated, service_role;
revoke all on function snote_taxonomy_private.identity(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function snote_taxonomy_private.member(boolean) from public, anon, authenticated, service_role;
revoke all on function snote_taxonomy_private.entry(public.zc_vehicle_taxonomy) from public, anon, authenticated, service_role;
revoke all on function public.snote_vehicle_taxonomy_list() from public, anon, authenticated, service_role;
revoke all on function public.snote_vehicle_taxonomy_upsert(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.snote_vehicle_taxonomy_list() to authenticated;
grant execute on function public.snote_vehicle_taxonomy_upsert(jsonb, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
