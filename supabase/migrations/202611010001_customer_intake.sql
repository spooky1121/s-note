-- 고객 휴대전화 소유 확인용 일회성 접수입니다. PASS/실명 본인인증이 아닙니다.
-- 기존 zc_companies / zc_members / zc_datasets 테이블이 있는 프로젝트에서 실행합니다.
-- 운영 환경 설정과 개통 시험 절차를 확인한 뒤 적용하고, 0002 정리 스케줄도 적용하세요.
-- 기존 고객 원장·계약서는 변경하지 않습니다. 전체 파일을 한 번에 실행하세요.
begin;

create schema if not exists snote_intake_private;
revoke all on schema snote_intake_private from public, anon, authenticated, service_role;

create table if not exists public.snote_customer_intake (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  company_id uuid not null references public.zc_companies(id) on delete cascade,
  owner_id uuid not null,
  car_id text not null check (pg_catalog.char_length(car_id) between 1 and 200),
  car_snapshot jsonb not null check (pg_catalog.jsonb_typeof(car_snapshot) = 'object'),
  company_name text not null,
  phone text not null check (phone ~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'failed', 'unknown')),
  challenge_id uuid,
  otp_hash text check (otp_hash is null or otp_hash ~ '^[0-9a-f]{64}$'),
  otp_expires_at timestamptz,
  otp_delivery_status text not null default 'none'
    check (otp_delivery_status in ('none', 'pending', 'sent', 'failed', 'unknown')),
  otp_attempts integer not null default 0 check (otp_attempts between 0 and 5),
  otp_send_count integer not null default 0 check (otp_send_count between 0 and 5),
  last_otp_sent_at timestamptz,
  session_hash text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  verified_at timestamptz,
  session_expires_at timestamptz,
  submission_payload jsonb,
  consent_version text,
  consented_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  check (otp_expires_at is null or otp_expires_at <= expires_at),
  check (session_expires_at is null or session_expires_at <= expires_at),
  check (submission_payload is null or pg_catalog.jsonb_typeof(submission_payload) = 'object'),
  check ((submitted_at is null and submission_payload is null and consent_version is null and consented_at is null)
    or (submitted_at is not null and submission_payload is not null
        and consent_version = '2026-11-01' and consented_at is not null))
);

create index if not exists snote_intake_owner_created_idx
  on public.snote_customer_intake(owner_id, created_at desc);
create index if not exists snote_intake_car_created_idx
  on public.snote_customer_intake(company_id, owner_id, car_id, created_at desc);
create index if not exists snote_intake_purge_pending_idx
  on public.snote_customer_intake(expires_at) where submitted_at is null;
create index if not exists snote_intake_purge_submitted_idx
  on public.snote_customer_intake(submitted_at) where submitted_at is not null;

-- 전화번호별 최근 1시간 발송 예약만 계산합니다. 전화번호 원문을 중복 저장하지 않습니다.
create table if not exists public.snote_customer_intake_otp_sends (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  intake_id uuid not null references public.snote_customer_intake(id) on delete cascade,
  phone_hash text not null check (phone_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index if not exists snote_intake_otp_phone_created_idx
  on public.snote_customer_intake_otp_sends(phone_hash, created_at);

alter table public.snote_customer_intake enable row level security;
alter table public.snote_customer_intake_otp_sends enable row level security;
revoke all on table public.snote_customer_intake from public, anon, authenticated, service_role;
revoke all on table public.snote_customer_intake_otp_sends from public, anon, authenticated, service_role;
-- 정책을 만들지 않습니다. SECURITY DEFINER RPC만 비공개 테이블을 읽고 씁니다.

create or replace function snote_intake_private.failure(p_code text, p_message text, p_retry integer default null)
returns jsonb language sql immutable set search_path = ''
as $function$
  select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'ok', false, 'code', p_code, 'message', p_message,
    'retryAfter', case when p_retry is not null then greatest(1, p_retry) end
  ));
$function$;

-- 잠금 순서는 항상 actor advisory → 멤버 → 차량 dataset → 접수 row → 전화 advisory입니다.
-- 차량 dataset의 SHARE 잠금으로 확인과 접수 저장 사이에 판매/삭제되는 경합을 막습니다.
create or replace function snote_intake_private.lock_actor_car(
  p_owner uuid, p_company uuid, p_car_id text, p_allow_sold boolean default false
)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_payload jsonb;
  v_car jsonb;
  v_count integer;
  v_sell numeric;
begin
  if p_owner is null or p_company is null or p_car_id is null then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || p_owner::text, 0));
  perform 1 from public.zc_members as member
    where member.user_id = p_owner and member.company_id = p_company
      and member.active is true and member.role in ('dealer', 'admin')
    for share;
  if not found then return null; end if;
  select dataset.payload into v_payload
    from public.zc_datasets as dataset
    where dataset.company_id = p_company and dataset.owner_id = p_owner and dataset.dataset = 'cars'
    for share;
  if not found or pg_catalog.jsonb_typeof(v_payload) is distinct from 'array' then return null; end if;
  select pg_catalog.count(*) into v_count
    from pg_catalog.jsonb_array_elements(v_payload) as item(value)
    where pg_catalog.jsonb_typeof(item.value) = 'object' and item.value ->> 'id' = p_car_id;
  if v_count <> 1 then return null; end if;
  select item.value into v_car from pg_catalog.jsonb_array_elements(v_payload) as item(value)
    where item.value ->> 'id' = p_car_id;
  if not p_allow_sold and coalesce(v_car ->> 'status', '') not in ('판매중', '매입진행', '수리중') then return null; end if;
  if pg_catalog.jsonb_typeof(v_car -> 'model') is distinct from 'string'
    or pg_catalog.char_length(pg_catalog.btrim(v_car ->> 'model')) not between 1 and 200 then return null; end if;
  if pg_catalog.jsonb_typeof(v_car -> 'sell') in ('number', 'string')
    and (v_car ->> 'sell') ~ '^[0-9]{1,9}([.][0-9]{1,2})?$' then
    v_sell := (v_car ->> 'sell')::numeric;
  end if;
  return pg_catalog.jsonb_build_object(
    'model', pg_catalog.btrim(v_car ->> 'model'),
    'plate', case when pg_catalog.jsonb_typeof(v_car -> 'plate') = 'string' then pg_catalog.left(v_car ->> 'plate', 30) else '' end,
    'year', case when pg_catalog.jsonb_typeof(v_car -> 'year') in ('number', 'string') and (v_car ->> 'year') ~ '^[0-9]{4}$' then v_car -> 'year' else 'null'::jsonb end,
    'km', case when pg_catalog.jsonb_typeof(v_car -> 'km') in ('number', 'string') then pg_catalog.left(v_car ->> 'km', 30) else '' end,
    'color', case when pg_catalog.jsonb_typeof(v_car -> 'color') = 'string' then pg_catalog.left(v_car ->> 'color', 50) else '' end,
    'sell', v_sell
  );
end;
$function$;

-- 토큰 해시를 먼저 조회하여 actor를 찾되, 실제 판정/변경은 정해진 잠금 순서 뒤에 합니다.
-- 비활성 직원·타 상사 이동·판매/삭제된 차량은 존재하지 않는 링크와 같은 응답입니다.
create or replace function snote_intake_private.lock_link(p_token_hash text)
returns public.snote_customer_intake language plpgsql set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.token_hash = p_token_hash;
  if not found then return null; end if;
  if snote_intake_private.lock_actor_car(v_row.owner_id, v_row.company_id, v_row.car_id) is null then return null; end if;
  select intake.* into v_row from public.snote_customer_intake as intake
    where intake.id = v_row.id and intake.token_hash = p_token_hash for update;
  if not found then return null; end if;
  return v_row;
end;
$function$;

create or replace function snote_intake_private.link_error(p_row public.snote_customer_intake)
returns jsonb language plpgsql set search_path = ''
as $function$
begin
  if p_row.id is null or (p_row.submitted_at is not null and p_row.submitted_at <= pg_catalog.clock_timestamp() - interval '30 days') then
    return snote_intake_private.failure('INVALID_LINK', '사용할 수 없는 입력 링크입니다.');
  end if;
  if p_row.revoked_at is not null then
    return snote_intake_private.failure('REVOKED', '폐기된 입력 링크입니다. 담당 직원에게 새 링크를 요청해 주세요.');
  end if;
  if p_row.expires_at <= pg_catalog.clock_timestamp() then
    return snote_intake_private.failure('EXPIRED', '입력 링크의 유효기간이 지났습니다. 담당 직원에게 새 링크를 요청해 주세요.');
  end if;
  return null;
end;
$function$;

create or replace function public.snote_intake_create(p_car_id text, p_phone text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_car jsonb;
  v_name text;
  v_now timestamptz;
  v_row public.snote_customer_intake%rowtype;
  v_count integer;
  v_first timestamptz;
begin
  if v_user is null then return snote_intake_private.failure('FORBIDDEN', '로그인한 담당 직원만 입력 링크를 발급할 수 있습니다.'); end if;
  if p_car_id is null or pg_catalog.char_length(p_car_id) not between 1 and 200
    or p_phone is null or p_phone !~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$'
    or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return snote_intake_private.failure('VALIDATION_ERROR', '차량과 휴대전화 번호를 확인해 주세요.');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select member.company_id into v_company from public.zc_members as member
    where member.user_id = v_user and member.active is true and member.role in ('dealer', 'admin') for share;
  if not found then return snote_intake_private.failure('FORBIDDEN', '활성 담당 직원만 입력 링크를 발급할 수 있습니다.'); end if;
  v_car := snote_intake_private.lock_actor_car(v_user, v_company, p_car_id);
  if v_car is null then return snote_intake_private.failure('FORBIDDEN', '본인에게 배정된 판매 중 차량만 선택해 주세요.'); end if;
  select company.name into v_name from public.zc_companies as company where company.id = v_company;
  if not found then return snote_intake_private.failure('FORBIDDEN', '소속 상사 정보를 확인할 수 없습니다.'); end if;
  v_now := pg_catalog.clock_timestamp();
  select pg_catalog.count(*), pg_catalog.min(intake.created_at) into v_count, v_first
    from public.snote_customer_intake as intake where intake.owner_id = v_user and intake.created_at > v_now - interval '1 hour';
  if v_count >= 20 then
    return snote_intake_private.failure('RATE_LIMITED', '입력 링크 발급 횟수가 많습니다. 잠시 후 다시 시도해 주세요.',
      pg_catalog.ceil(extract(epoch from (v_first + interval '1 hour' - v_now)))::integer);
  end if;
  if exists (select 1 from public.snote_customer_intake as intake where intake.token_hash = p_token_hash) then
    return snote_intake_private.failure('VALIDATION_ERROR', '새 입력 링크를 다시 요청해 주세요.');
  end if;
  insert into public.snote_customer_intake(company_id, owner_id, car_id, car_snapshot, company_name, phone, token_hash, created_at, expires_at)
    values(v_company, v_user, p_car_id, v_car, v_name, p_phone, p_token_hash, v_now, v_now + interval '24 hours')
    on conflict (token_hash) do nothing
    returning * into v_row;
  if not found then return snote_intake_private.failure('VALIDATION_ERROR', '새 입력 링크를 다시 요청해 주세요.'); end if;
  -- 다른 actor와 토큰 해시가 충돌해도 기존 링크를 먼저 폐기하지 않습니다.
  update public.snote_customer_intake as intake
    set revoked_at = v_now, otp_hash = null, otp_expires_at = null, session_hash = null, session_expires_at = null
    where intake.company_id = v_company and intake.owner_id = v_user and intake.car_id = p_car_id
      and intake.id <> v_row.id and intake.submitted_at is null and intake.revoked_at is null;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'car', v_car, 'companyName', v_name, 'expiresAt', v_row.expires_at);
end;
$function$;

create or replace function public.snote_intake_list(p_car_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_result jsonb;
begin
  if v_user is null then return snote_intake_private.failure('FORBIDDEN', '로그인 상태를 확인해 주세요.'); end if;
  if p_car_id is null or pg_catalog.char_length(p_car_id) not between 1 and 200 then return snote_intake_private.failure('VALIDATION_ERROR', '차량 정보를 확인해 주세요.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select member.company_id into v_company from public.zc_members as member
    where member.user_id = v_user and member.active is true and member.role in ('dealer', 'admin') for share;
  if not found or snote_intake_private.lock_actor_car(v_user, v_company, p_car_id, true) is null then
    return snote_intake_private.failure('FORBIDDEN', '본인에게 배정된 차량의 입력 요청만 확인할 수 있습니다.');
  end if;
  select coalesce(pg_catalog.jsonb_agg(item.body order by item.created_at desc, item.id desc), '[]'::jsonb) into v_result
    from (select intake.id, intake.created_at, pg_catalog.jsonb_build_object(
      'id', intake.id, 'phone', intake.phone, 'createdAt', intake.created_at, 'expiresAt', intake.expires_at,
      'submittedAt', intake.submitted_at, 'revokedAt', intake.revoked_at, 'deliveryStatus', intake.delivery_status,
      'status', case when intake.revoked_at is not null then 'revoked' when intake.submitted_at is not null then 'submitted'
        when intake.expires_at <= pg_catalog.clock_timestamp() then 'expired' else 'pending' end,
      'submission', case when intake.submitted_at is not null then intake.submission_payload else null end
    ) as body from public.snote_customer_intake as intake
      where intake.company_id = v_company and intake.owner_id = v_user and intake.car_id = p_car_id
        and ((intake.submitted_at is not null and intake.submitted_at > pg_catalog.clock_timestamp() - interval '30 days')
          or (intake.submitted_at is null and intake.expires_at > pg_catalog.clock_timestamp() - interval '7 days'))
      order by intake.created_at desc, intake.id desc limit 5) as item;
  return v_result;
end;
$function$;

create or replace function public.snote_intake_revoke(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.snote_customer_intake%rowtype;
  v_now timestamptz;
begin
  if v_user is null then return snote_intake_private.failure('FORBIDDEN', '로그인 상태를 확인해 주세요.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user;
  if not found then return snote_intake_private.failure('FORBIDDEN', '본인이 발급한 입력 요청만 폐기할 수 있습니다.'); end if;
  perform 1 from public.zc_members as member where member.user_id = v_user and member.company_id = v_row.company_id
    and member.active is true and member.role in ('dealer', 'admin') for share;
  if not found then return snote_intake_private.failure('FORBIDDEN', '소속 담당 직원만 입력 요청을 폐기할 수 있습니다.'); end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user for update;
  if not found then return snote_intake_private.failure('FORBIDDEN', '입력 요청을 확인할 수 없습니다.'); end if;
  v_now := pg_catalog.clock_timestamp();
  update public.snote_customer_intake as intake set revoked_at = coalesce(intake.revoked_at, v_now),
    otp_hash = null, otp_expires_at = null, session_hash = null, session_expires_at = null where intake.id = v_row.id;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.snote_intake_view(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
begin
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.submitted_at is not null then return pg_catalog.jsonb_build_object('ok', true, 'status', 'submitted', 'expiresAt', v_row.expires_at); end if;
  return pg_catalog.jsonb_build_object('ok', true, 'car', v_row.car_snapshot, 'companyName', v_row.company_name,
    'phoneMasked', pg_catalog.left(v_row.phone, 3) || '-****-' || pg_catalog.right(v_row.phone, 4),
    'expiresAt', v_row.expires_at, 'status', 'pending');
end;
$function$;

create or replace function public.snote_intake_challenge(p_token_hash text, p_challenge_id uuid, p_otp_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
  v_phone_hash text;
  v_now timestamptz;
  v_expiry timestamptz;
  v_count integer;
  v_first timestamptz;
begin
  if p_challenge_id is null or p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$' then return snote_intake_private.failure('VALIDATION_ERROR', '인증 요청을 확인해 주세요.'); end if;
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.submitted_at is not null then return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 입력을 마친 링크입니다.'); end if;
  if v_row.challenge_id = p_challenge_id then return snote_intake_private.failure('INVALID_CODE', '새 인증번호를 요청해 주세요.'); end if;
  v_phone_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_row.phone, 'UTF8')), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:phone:' || v_phone_hash, 0));
  v_now := pg_catalog.clock_timestamp();
  -- 전화 잠금을 기다린 동안 만료됐을 수도 있으므로 현재 시각으로 다시 검사합니다.
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.otp_send_count >= 5 then return snote_intake_private.failure('LOCKED', '이 링크의 인증번호 발송 한도를 초과했습니다. 담당 직원에게 새 링크를 요청해 주세요.'); end if;
  if v_row.last_otp_sent_at is not null and v_row.last_otp_sent_at > v_now - interval '60 seconds' then
    return snote_intake_private.failure('RATE_LIMITED', '인증번호는 60초 후 다시 요청할 수 있습니다.',
      pg_catalog.ceil(extract(epoch from (v_row.last_otp_sent_at + interval '60 seconds' - v_now)))::integer);
  end if;
  select pg_catalog.count(*), pg_catalog.min(send.created_at) into v_count, v_first
    from public.snote_customer_intake_otp_sends as send where send.phone_hash = v_phone_hash and send.created_at > v_now - interval '1 hour';
  if v_count >= 10 then return snote_intake_private.failure('RATE_LIMITED', '이 휴대전화의 인증번호 발송 횟수가 많습니다. 잠시 후 다시 시도해 주세요.',
    pg_catalog.ceil(extract(epoch from (v_first + interval '1 hour' - v_now)))::integer); end if;
  v_expiry := least(v_now + interval '5 minutes', v_row.expires_at);
  insert into public.snote_customer_intake_otp_sends(intake_id, phone_hash, created_at) values(v_row.id, v_phone_hash, v_now);
  update public.snote_customer_intake set challenge_id = p_challenge_id, otp_hash = p_otp_hash,
    otp_expires_at = v_expiry, otp_delivery_status = 'pending', otp_attempts = 0,
    otp_send_count = otp_send_count + 1, last_otp_sent_at = v_now,
    session_hash = null, session_expires_at = null, verified_at = null where id = v_row.id;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'phone', v_row.phone,
    'challengeId', p_challenge_id, 'expiresAt', v_expiry, 'retryAfter', 60);
end;
$function$;

create or replace function public.snote_intake_delivery(p_id uuid, p_kind text, p_challenge_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_token_hash text;
  v_error jsonb;
begin
  if p_kind is null or p_kind not in ('invitation', 'otp') or p_status is null or p_status not in ('sent', 'failed', 'unknown') then
    return snote_intake_private.failure('VALIDATION_ERROR', '문자 접수 상태를 확인해 주세요.');
  end if;
  select intake.token_hash into v_token_hash from public.snote_customer_intake as intake where intake.id = p_id;
  v_row := snote_intake_private.lock_link(v_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.submitted_at is not null then return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 입력을 마친 링크입니다.'); end if;
  if p_kind = 'invitation' then
    if p_challenge_id is not null then return snote_intake_private.failure('VALIDATION_ERROR', '문자 접수 상태를 확인해 주세요.'); end if;
    if v_row.delivery_status = p_status then return pg_catalog.jsonb_build_object('ok', true); end if;
    if v_row.delivery_status <> 'pending' then return snote_intake_private.failure('VALIDATION_ERROR', '이미 처리된 문자 접수 상태입니다.'); end if;
    update public.snote_customer_intake set delivery_status = p_status where id = v_row.id;
  else
    if p_challenge_id is null or v_row.challenge_id is distinct from p_challenge_id then return snote_intake_private.failure('INVALID_CODE', '현재 인증 요청이 아닙니다.'); end if;
    if v_row.otp_delivery_status = p_status then return pg_catalog.jsonb_build_object('ok', true); end if;
    -- sent 기록 응답만 유실된 경우에도 동일 challenge를 불확실 상태로 폐기할 수 있습니다.
    -- 과거 challenge는 위에서 거부하며 unknown/failed에서 sent로 복구하지 않습니다.
    if v_row.otp_delivery_status = 'sent' and p_status = 'unknown' then
      update public.snote_customer_intake set otp_delivery_status = 'unknown', otp_hash = null,
        otp_expires_at = null, session_hash = null, session_expires_at = null, verified_at = null where id = v_row.id;
      return pg_catalog.jsonb_build_object('ok', true);
    end if;
    if v_row.otp_delivery_status <> 'pending' then return snote_intake_private.failure('INVALID_CODE', '이미 처리된 인증 요청입니다.'); end if;
    if p_status = 'sent' and (v_row.otp_hash is null or v_row.otp_expires_at <= pg_catalog.clock_timestamp()) then
      update public.snote_customer_intake set otp_hash = null, otp_expires_at = null, otp_delivery_status = 'unknown' where id = v_row.id;
      return snote_intake_private.failure('INVALID_CODE', '인증번호 유효기간이 지났습니다. 새 인증번호를 요청해 주세요.');
    end if;
    update public.snote_customer_intake set otp_delivery_status = p_status,
      otp_hash = case when p_status = 'sent' then otp_hash else null end,
      otp_expires_at = case when p_status = 'sent' then otp_expires_at else null end,
      session_hash = case when p_status = 'sent' then session_hash else null end,
      session_expires_at = case when p_status = 'sent' then session_expires_at else null end,
      verified_at = case when p_status = 'sent' then verified_at else null end where id = v_row.id;
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.snote_intake_verify(p_token_hash text, p_challenge_id uuid, p_otp_hash text, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
  v_now timestamptz;
  v_expiry timestamptz;
begin
  if p_challenge_id is null or p_otp_hash is null or p_otp_hash !~ '^[0-9a-f]{64}$'
    or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return snote_intake_private.failure('VALIDATION_ERROR', '인증 입력을 확인해 주세요.'); end if;
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.submitted_at is not null then return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 입력을 마친 링크입니다.'); end if;
  if v_row.challenge_id is distinct from p_challenge_id then return snote_intake_private.failure('INVALID_CODE', '현재 인증번호를 다시 확인해 주세요.'); end if;
  if v_row.otp_attempts >= 5 then return snote_intake_private.failure('LOCKED', '인증번호 확인 횟수를 초과했습니다. 새 인증번호를 요청해 주세요.'); end if;
  if v_row.otp_delivery_status <> 'sent' or v_row.otp_hash is null then return snote_intake_private.failure('INVALID_CODE', '사용할 수 없는 인증번호입니다. 새 인증번호를 요청해 주세요.'); end if;
  v_now := pg_catalog.clock_timestamp();
  if v_row.otp_expires_at is null or v_row.otp_expires_at <= v_now then
    update public.snote_customer_intake set otp_hash = null, otp_expires_at = null where id = v_row.id;
    return snote_intake_private.failure('INVALID_CODE', '인증번호 유효기간이 지났습니다. 새 인증번호를 요청해 주세요.');
  end if;
  if v_row.otp_hash <> p_otp_hash then
    update public.snote_customer_intake set otp_attempts = otp_attempts + 1,
      otp_hash = case when otp_attempts + 1 >= 5 then null else otp_hash end where id = v_row.id;
    -- 예외를 던지면 오답 횟수 갱신도 롤백됩니다. 논리 오류 JSON으로 반환합니다.
    return snote_intake_private.failure(case when v_row.otp_attempts + 1 >= 5 then 'LOCKED' else 'INVALID_CODE' end,
      '인증번호가 일치하지 않습니다. 다시 확인해 주세요.');
  end if;
  v_expiry := least(v_now + interval '30 minutes', v_row.expires_at);
  update public.snote_customer_intake set otp_hash = null, otp_expires_at = null,
    session_hash = p_session_hash, session_expires_at = v_expiry, verified_at = v_now where id = v_row.id;
  return pg_catalog.jsonb_build_object('ok', true, 'sessionExpiresAt', v_expiry);
end;
$function$;

create or replace function public.snote_intake_submit(p_token_hash text, p_session_hash text, p_customer jsonb, p_consent_version text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
  v_field text;
  v_name text;
  v_address_base text;
  v_address_detail text;
  v_mailing_base text;
  v_mailing_detail text;
  v_same boolean;
  v_bank text;
  v_account text;
  v_holder text;
  v_refund_consent boolean;
  v_has_refund boolean;
  v_now timestamptz;
  v_submission jsonb;
begin
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return snote_intake_private.failure('SESSION_EXPIRED', '휴대전화 인증을 다시 진행해 주세요.'); end if;
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  v_now := pg_catalog.clock_timestamp();
  if v_row.session_hash is null or v_row.session_hash <> p_session_hash or v_row.session_expires_at is null
    or v_row.session_expires_at <= v_now then return snote_intake_private.failure('SESSION_EXPIRED', '휴대전화 인증 유효기간이 지났습니다. 다시 인증해 주세요.'); end if;
  if p_consent_version is distinct from '2026-11-01' or p_customer is null or pg_catalog.jsonb_typeof(p_customer) <> 'object' then
    return snote_intake_private.failure('VALIDATION_ERROR', '입력 정보와 개인정보 수집 동의를 확인해 주세요.');
  end if;
  for v_field in select pg_catalog.jsonb_object_keys(p_customer) loop
    if v_field not in ('name', 'addressBase', 'addressDetail', 'mailingBase', 'mailingDetail', 'sameAddress',
      'refundBank', 'refundAccount', 'refundHolder', 'refundConsent') then
      return snote_intake_private.failure('VALIDATION_ERROR', '허용되지 않는 입력 항목이 있습니다. 주민등록번호 등 민감정보를 입력하지 마세요.');
    end if;
  end loop;
  foreach v_field in array array['name', 'addressBase', 'addressDetail', 'mailingBase', 'mailingDetail', 'refundBank', 'refundAccount', 'refundHolder'] loop
    if pg_catalog.jsonb_exists(p_customer, v_field) and pg_catalog.jsonb_typeof(p_customer -> v_field) is distinct from 'string' then
      return snote_intake_private.failure('VALIDATION_ERROR', '입력 정보 형식을 확인해 주세요.');
    end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_customer -> 'sameAddress') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_customer -> 'refundConsent') is distinct from 'boolean' then
    return snote_intake_private.failure('VALIDATION_ERROR', '주소와 선택 계좌 동의 항목을 확인해 주세요.');
  end if;
  v_name := pg_catalog.btrim(coalesce(p_customer ->> 'name', ''));
  v_address_base := pg_catalog.btrim(coalesce(p_customer ->> 'addressBase', ''));
  v_address_detail := pg_catalog.btrim(coalesce(p_customer ->> 'addressDetail', ''));
  v_mailing_base := pg_catalog.btrim(coalesce(p_customer ->> 'mailingBase', ''));
  v_mailing_detail := pg_catalog.btrim(coalesce(p_customer ->> 'mailingDetail', ''));
  v_same := (p_customer ->> 'sameAddress')::boolean;
  v_bank := pg_catalog.btrim(coalesce(p_customer ->> 'refundBank', ''));
  v_account := pg_catalog.regexp_replace(coalesce(p_customer ->> 'refundAccount', ''), '[[:space:]]', '', 'g');
  v_holder := pg_catalog.btrim(coalesce(p_customer ->> 'refundHolder', ''));
  v_refund_consent := (p_customer ->> 'refundConsent')::boolean;
  if pg_catalog.char_length(v_name) not between 2 and 50
    or pg_catalog.char_length(v_address_base) not between 1 and 200
    or pg_catalog.char_length(v_address_detail) > 100
    or pg_catalog.char_length(v_address_base || case when v_address_detail <> '' then ' ' || v_address_detail else '' end) > 220
    or pg_catalog.char_length(v_mailing_base) > 200 or pg_catalog.char_length(v_mailing_detail) > 100 then
    return snote_intake_private.failure('VALIDATION_ERROR', '성명과 주소의 입력 길이를 확인해 주세요.');
  end if;
  if v_same then v_mailing_base := v_address_base; v_mailing_detail := v_address_detail; end if;
  if pg_catalog.char_length(v_mailing_base) > 200
    or (v_mailing_base = '' and v_mailing_detail <> '')
    or pg_catalog.char_length(v_mailing_base || case when v_mailing_detail <> '' then ' ' || v_mailing_detail else '' end) > 220 then
    return snote_intake_private.failure('VALIDATION_ERROR', '우편물 수령 주소를 확인해 주세요.');
  end if;
  v_has_refund := v_bank <> '' or v_account <> '' or v_holder <> '';
  if v_refund_consent is distinct from v_has_refund
    or (v_has_refund and (pg_catalog.char_length(v_bank) not between 1 and 35
      or v_account !~ '^[0-9-]{6,32}$' or pg_catalog.char_length(pg_catalog.regexp_replace(v_account, '[^0-9]', '', 'g')) < 6
      or pg_catalog.char_length(v_holder) not between 1 and 50)) then
    return snote_intake_private.failure('VALIDATION_ERROR', '선택 환급계좌는 은행·계좌번호·예금주와 별도 동의를 모두 입력하거나 모두 비워 주세요.');
  end if;
  if v_row.submitted_at is not null then
    return pg_catalog.jsonb_build_object('ok', true, 'submittedAt', v_row.submitted_at, 'alreadySubmitted', true);
  end if;
  v_submission := pg_catalog.jsonb_build_object(
    'name', v_name, 'phone', v_row.phone, 'addressBase', v_address_base, 'addressDetail', v_address_detail,
    'mailingBase', v_mailing_base, 'mailingDetail', v_mailing_detail, 'sameAddress', v_same,
    'refundBank', v_bank, 'refundAccount', v_account, 'refundHolder', v_holder, 'refundConsent', v_refund_consent,
    'carModel', v_row.car_snapshot ->> 'model', 'plate', v_row.car_snapshot ->> 'plate'
  );
  update public.snote_customer_intake set submission_payload = v_submission, consent_version = p_consent_version,
    consented_at = v_now, submitted_at = v_now, otp_hash = null, otp_expires_at = null where id = v_row.id;
  return pg_catalog.jsonb_build_object('ok', true, 'submittedAt', v_now);
end;
$function$;

create or replace function public.snote_intake_purge()
returns integer language plpgsql security definer set search_path = ''
as $function$
declare
  v_deleted integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  delete from public.snote_customer_intake_otp_sends where created_at <= v_now - interval '1 hour';
  delete from public.snote_customer_intake
    where (submitted_at is not null and submitted_at <= v_now - interval '30 days')
       or (submitted_at is null and expires_at <= v_now - interval '7 days');
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- 비공개 보조 함수도 PostgREST 및 일반 SQL 사용자에게 직접 실행 권한을 주지 않습니다.
revoke all on all functions in schema snote_intake_private from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_create(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_list(text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_revoke(uuid) from public, anon, authenticated, service_role;
grant execute on function public.snote_intake_create(text, text, text) to authenticated;
grant execute on function public.snote_intake_list(text) to authenticated;
grant execute on function public.snote_intake_revoke(uuid) to authenticated;

revoke all on function public.snote_intake_view(text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_challenge(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_delivery(uuid, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_verify(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_submit(text, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_purge() from public, anon, authenticated, service_role;
grant execute on function public.snote_intake_view(text) to service_role;
grant execute on function public.snote_intake_challenge(text, uuid, text) to service_role;
grant execute on function public.snote_intake_delivery(uuid, text, uuid, text) to service_role;
grant execute on function public.snote_intake_verify(text, uuid, text, text) to service_role;
grant execute on function public.snote_intake_submit(text, text, jsonb, text) to service_role;
grant execute on function public.snote_intake_purge() to service_role;

notify pgrst, 'reload schema';
commit;
