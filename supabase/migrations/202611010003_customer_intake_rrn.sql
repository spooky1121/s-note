-- 0001/0002 이후 적용하는 선택적 주민등록번호 암호문 확장입니다.
-- 회사 rrn_enabled를 자동 활성화하지 않으며 기존 고객 원장/주민번호 RPC를 변경하지 않습니다.
-- 평문은 Cloudflare 서버에서 전용 AES-GCM 키로 암호화하고 일반 접수 JSON에는 넣지 않습니다.
-- 구버전 4인자 submit 및 주민번호 없는 접수는 계속 사용할 수 있습니다.
begin;

alter table public.snote_customer_intake
  add column if not exists rrn_cipher text,
  add column if not exists rrn_collected_at timestamptz,
  add column if not exists rrn_notice_version text,
  add column if not exists rrn_last_accessed_at timestamptz,
  add column if not exists rrn_access_count bigint not null default 0;

do $constraint$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.snote_customer_intake'::pg_catalog.regclass
      and conname = 'snote_intake_rrn_storage_check') then
    alter table public.snote_customer_intake add constraint snote_intake_rrn_storage_check check (
      (rrn_cipher is null and rrn_collected_at is null and rrn_notice_version is null)
      or (rrn_cipher is not null and rrn_cipher ~ '^v1[.][0-9a-f]{24}[.][0-9a-f]{58}$'
        and rrn_collected_at is not null and rrn_notice_version is not distinct from '2026-11-01-r1'
        and submitted_at is not null)
    );
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.snote_customer_intake'::pg_catalog.regclass
      and conname = 'snote_intake_rrn_access_count_check') then
    alter table public.snote_customer_intake add constraint snote_intake_rrn_access_count_check check (rrn_access_count >= 0);
  end if;
end;
$constraint$;

-- 신규 컬럼을 포함한 테이블도 RPC 이외의 직접 접근은 계속 허용하지 않습니다.
revoke all on table public.snote_customer_intake from public, anon, authenticated, service_role;

create or replace function public.snote_intake_view_v2(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_result jsonb;
  v_company uuid;
  v_enabled boolean := false;
begin
  -- 기존 함수가 actor/차량/접수 row를 정해진 순서로 잠그고 유효기간도 검사합니다.
  v_result := public.snote_intake_view(p_token_hash);
  if v_result ->> 'ok' is distinct from 'true' or v_result ->> 'status' is distinct from 'pending' then return v_result; end if;
  select intake.company_id into v_company from public.snote_customer_intake as intake where intake.token_hash = p_token_hash;
  if found then
    select company.rrn_enabled into v_enabled from public.zc_companies as company where company.id = v_company for share;
  end if;
  return v_result || pg_catalog.jsonb_build_object('rrnEnabled', coalesce(v_enabled, false));
end;
$function$;

create or replace function public.snote_intake_submit_v2(
  p_token_hash text,
  p_session_hash text,
  p_customer jsonb,
  p_consent_version text,
  p_rrn_cipher text default null,
  p_rrn_notice_version text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
  v_result jsonb;
  v_enabled boolean;
begin
  if p_rrn_cipher is null then
    if p_rrn_notice_version is not null then return snote_intake_private.failure('VALIDATION_ERROR', '주민등록번호 수집 안내 확인 항목을 확인해 주세요.'); end if;
    return public.snote_intake_submit(p_token_hash, p_session_hash, p_customer, p_consent_version);
  end if;
  if p_rrn_cipher !~ '^v1[.][0-9a-f]{24}[.][0-9a-f]{58}$'
    or p_rrn_notice_version is distinct from '2026-11-01-r1' then
    return snote_intake_private.failure('VALIDATION_ERROR', '주민등록번호 입력과 별도 수집 안내 확인을 다시 진행해 주세요.');
  end if;
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  -- 기존 잠금 순서(actor→멤버→dataset→접수)를 유지한 뒤 회사 설정을 잠급니다.
  -- 설정이 꺼지는 경합에서도 검사와 암호문 저장 사이에 허용 상태가 바뀌지 않습니다.
  select company.rrn_enabled into v_enabled from public.zc_companies as company where company.id = v_row.company_id for share;
  if not found or v_enabled is not true then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '이 상사에서는 주민등록번호 접수를 사용할 수 없습니다.'); end if;

  -- 일반 입력/세션/동의 검증과 제출을 같은 트랜잭션 안에서 수행합니다.
  -- 이 호출 뒤에는 실패 JSON을 반환하지 않습니다. 아래 갱신 실패는 예외로 전체 롤백합니다.
  v_result := public.snote_intake_submit(p_token_hash, p_session_hash, p_customer, p_consent_version);
  if v_result ->> 'ok' is distinct from 'true' then return v_result; end if;
  if v_result ->> 'alreadySubmitted' = 'true' then return v_result; end if;
  update public.snote_customer_intake as intake
    set rrn_cipher = p_rrn_cipher, rrn_collected_at = intake.submitted_at,
        rrn_notice_version = p_rrn_notice_version
    where intake.id = v_row.id and intake.submitted_at is not null and intake.rrn_cipher is null;
  if not found then
    raise exception '접수 저장을 완료하지 못했습니다. 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  return v_result;
end;
$function$;

-- 담당 직원 JWT로 직접 권한을 판정합니다. 클라이언트가 actor/company/owner를 지정하지 않습니다.
-- 반환 암호문은 Cloudflare에서만 복호화하며 브라우저 목록에는 hasRrn만 포함됩니다.
create or replace function public.snote_intake_rrn_access(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.snote_customer_intake%rowtype;
  v_enabled boolean;
begin
  if v_user is null or p_id is null then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '주민등록번호를 확인할 수 없습니다.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user;
  if not found then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '주민등록번호를 확인할 수 없습니다.'); end if;
  if snote_intake_private.lock_actor_car(v_user, v_row.company_id, v_row.car_id, true) is null then
    return snote_intake_private.failure('RRN_NOT_AVAILABLE', '주민등록번호를 확인할 수 없습니다.');
  end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user for update;
  if not found or v_row.revoked_at is not null or v_row.submitted_at is null
    or v_row.submitted_at <= pg_catalog.clock_timestamp() - interval '30 days' or v_row.rrn_cipher is null then
    return snote_intake_private.failure('RRN_NOT_AVAILABLE', '주민등록번호를 확인할 수 없습니다.');
  end if;
  select company.rrn_enabled into v_enabled from public.zc_companies as company where company.id = v_row.company_id for share;
  if not found or v_enabled is not true then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '주민등록번호를 확인할 수 없습니다.'); end if;
  update public.snote_customer_intake as intake
    set rrn_last_accessed_at = pg_catalog.clock_timestamp(), rrn_access_count = intake.rrn_access_count + 1
    where intake.id = v_row.id;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'tokenHash', v_row.token_hash, 'rrnCipher', v_row.rrn_cipher);
end;
$function$;

create or replace function public.snote_intake_list(p_car_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_result jsonb;
  v_rrn_enabled boolean := false;
begin
  if v_user is null then return snote_intake_private.failure('FORBIDDEN', '로그인 상태를 확인해 주세요.'); end if;
  if p_car_id is null or pg_catalog.char_length(p_car_id) not between 1 and 200 then return snote_intake_private.failure('VALIDATION_ERROR', '차량 정보를 확인해 주세요.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select member.company_id into v_company from public.zc_members as member
    where member.user_id = v_user and member.active is true and member.role in ('dealer', 'admin') for share;
  if not found or snote_intake_private.lock_actor_car(v_user, v_company, p_car_id, true) is null then
    return snote_intake_private.failure('FORBIDDEN', '본인에게 배정된 차량의 입력 요청만 확인할 수 있습니다.');
  end if;
  select company.rrn_enabled into v_rrn_enabled from public.zc_companies as company where company.id = v_company for share;
  select coalesce(pg_catalog.jsonb_agg(item.body order by item.created_at desc, item.id desc), '[]'::jsonb) into v_result
    from (select intake.id, intake.created_at, pg_catalog.jsonb_build_object(
      'id', intake.id, 'phone', intake.phone, 'createdAt', intake.created_at, 'expiresAt', intake.expires_at,
      'submittedAt', intake.submitted_at, 'revokedAt', intake.revoked_at, 'deliveryStatus', intake.delivery_status,
      'status', case when intake.revoked_at is not null then 'revoked' when intake.submitted_at is not null then 'submitted'
        when intake.expires_at <= pg_catalog.clock_timestamp() then 'expired' else 'pending' end,
      'submission', case when intake.submitted_at is not null then intake.submission_payload else null end,
      'hasRrn', coalesce(v_rrn_enabled, false) and intake.rrn_cipher is not null and intake.revoked_at is null
        and intake.submitted_at is not null and intake.submitted_at > pg_catalog.clock_timestamp() - interval '30 days'
    ) as body from public.snote_customer_intake as intake
      where intake.company_id = v_company and intake.owner_id = v_user and intake.car_id = p_car_id
        and ((intake.submitted_at is not null and intake.submitted_at > pg_catalog.clock_timestamp() - interval '30 days')
          or (intake.submitted_at is null and intake.expires_at > pg_catalog.clock_timestamp() - interval '7 days'))
      order by intake.created_at desc, intake.id desc limit 5) as item;
  return v_result;
end;
$function$;

revoke all on function public.snote_intake_view_v2(text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_submit_v2(text, text, jsonb, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_rrn_access(uuid) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_list(text) from public, anon, authenticated, service_role;
grant execute on function public.snote_intake_view_v2(text) to service_role;
grant execute on function public.snote_intake_submit_v2(text, text, jsonb, text, text, text) to service_role;
grant execute on function public.snote_intake_rrn_access(uuid) to authenticated;
grant execute on function public.snote_intake_list(text) to authenticated;

notify pgrst, 'reload schema';
commit;
