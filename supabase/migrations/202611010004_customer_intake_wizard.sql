-- v2.15 고객 입력: 최종 입력·암호문·동의 서명을 한 번의 제출로 저장합니다.
-- 0001 적용 후 실행할 수 있습니다. 0003은 선택 사항이며 기존 컬럼/자료를 바꾸지 않습니다.
-- 회사 rrn_enabled는 사용하지 않고 기존 직원·담당 차량·인증·보관기간 검사는 유지합니다.
-- 기존 고객 레코드는 덮어쓰지 않습니다. 신규 고객만 같은 트랜잭션 안에서 추가합니다.
begin;

-- 정규화 서명만 저장합니다. 임의 SVG/HTML/이미지 주소는 받지 않습니다.
create or replace function snote_intake_private.wizard_signature(p_signature jsonb)
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_key text;
  v_stroke jsonb;
  v_point jsonb;
  v_points jsonb := '[]'::jsonb;
  v_strokes jsonb := '[]'::jsonb;
  v_normal_stroke jsonb;
  v_total integer := 0;
  v_x numeric;
  v_y numeric;
  v_min_x numeric;
  v_max_x numeric;
  v_min_y numeric;
  v_max_y numeric;
  v_has_ink boolean := false;
begin
  if p_signature is null or pg_catalog.jsonb_typeof(p_signature) <> 'object'
    or pg_catalog.octet_length(p_signature::text) > 65536 then return null; end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_signature) loop
    if v_key not in ('version', 'strokes') then return null; end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_signature -> 'version') is distinct from 'number' then return null; end if;
  if (p_signature ->> 'version')::numeric <> 1
    or pg_catalog.jsonb_typeof(p_signature -> 'strokes') is distinct from 'array' then return null; end if;
  if pg_catalog.jsonb_array_length(p_signature -> 'strokes') not between 1 and 24 then return null; end if;
  for v_stroke in select item.value from pg_catalog.jsonb_array_elements(p_signature -> 'strokes') as item(value) loop
    if pg_catalog.jsonb_typeof(v_stroke) <> 'array' then return null; end if;
    if pg_catalog.jsonb_array_length(v_stroke) not between 1 and 256 then return null; end if;
    v_normal_stroke := '[]'::jsonb;
    for v_point in select item.value from pg_catalog.jsonb_array_elements(v_stroke) as item(value) loop
      if pg_catalog.jsonb_typeof(v_point) <> 'array' then return null; end if;
      if pg_catalog.jsonb_array_length(v_point) <> 2
        or pg_catalog.jsonb_typeof(v_point -> 0) is distinct from 'number'
        or pg_catalog.jsonb_typeof(v_point -> 1) is distinct from 'number' then return null; end if;
      v_x := (v_point ->> 0)::numeric; v_y := (v_point ->> 1)::numeric;
      if v_x not between 0 and 1 or v_y not between 0 and 1 then return null; end if;
      v_x := pg_catalog.round(v_x, 4); v_y := pg_catalog.round(v_y, 4);
      v_total := v_total + 1;
      if v_total > 1200 then return null; end if;
      v_min_x := least(v_min_x, v_x); v_max_x := greatest(v_max_x, v_x);
      v_min_y := least(v_min_y, v_y); v_max_y := greatest(v_max_y, v_y);
      v_normal_stroke := v_normal_stroke || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_x, v_y));
      v_points := v_points || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(v_x, v_y));
    end loop;
    v_strokes := v_strokes || pg_catalog.jsonb_build_array(v_normal_stroke);
  end loop;
  if v_total < 2 then return null; end if;
  if v_max_x - v_min_x > 0.005 or v_max_y - v_min_y > 0.005 then
    v_has_ink := true;
  elsif (v_max_x - v_min_x) * (v_max_x - v_min_x) + (v_max_y - v_min_y) * (v_max_y - v_min_y) > 0.000025 then
    -- 경계 안의 작은 도형은 실제 두 점의 거리를 검사합니다. 전체 점 수는 위에서 제한했습니다.
    select exists (
      select 1 from pg_catalog.jsonb_array_elements(v_points) with ordinality as a(point, n)
      join pg_catalog.jsonb_array_elements(v_points) with ordinality as b(point, n) on b.n > a.n
      where ((a.point ->> 0)::numeric - (b.point ->> 0)::numeric) * ((a.point ->> 0)::numeric - (b.point ->> 0)::numeric)
          + ((a.point ->> 1)::numeric - (b.point ->> 1)::numeric) * ((a.point ->> 1)::numeric - (b.point ->> 1)::numeric) > 0.000025
    ) into v_has_ink;
  end if;
  if not v_has_ink then return null; end if;
  return pg_catalog.jsonb_build_object('version', 1, 'strokes', v_strokes);
end;
$function$;

create or replace function public.snote_intake_view_v3(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  v_result := public.snote_intake_view(p_token_hash);
  if v_result ->> 'ok' is distinct from 'true' then return v_result; end if;
  v_result := v_result || pg_catalog.jsonb_build_object('flowVersion', 'wizard-v1');
  if v_result ->> 'status' = 'pending' then
    v_result := v_result || pg_catalog.jsonb_build_object('rrnEnabled', true);
  end if;
  return v_result;
end;
$function$;

create or replace function public.snote_intake_challenge_v3(
  p_token_hash text, p_challenge_id uuid, p_otp_hash text, p_phone text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
begin
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if v_row.submitted_at is not null then return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 입력을 마친 링크입니다.'); end if;
  if p_phone is null or p_phone !~ '^(010[0-9]{8}|01[16789][0-9]{7,8})$' or p_phone <> v_row.phone then
    return snote_intake_private.failure('VALIDATION_ERROR', '문자를 받은 휴대전화 번호를 정확히 입력해 주세요.');
  end if;
  return public.snote_intake_challenge(p_token_hash, p_challenge_id, p_otp_hash);
end;
$function$;

create or replace function public.snote_intake_submit_context_v3(p_token_hash text, p_session_hash text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_row public.snote_customer_intake%rowtype;
  v_error jsonb;
begin
  v_row := snote_intake_private.lock_link(p_token_hash);
  v_error := snote_intake_private.link_error(v_row);
  if v_error is not null then return v_error; end if;
  if p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$'
    or v_row.session_hash is null or v_row.session_hash <> p_session_hash
    or v_row.session_expires_at is null or v_row.session_expires_at <= pg_catalog.clock_timestamp() then
    return snote_intake_private.failure('SESSION_EXPIRED', '휴대전화 인증을 다시 진행해 주세요.');
  end if;
  -- API 내부 암호화 문맥입니다. HTTP 고객 응답에 회사/담당자 식별자를 전달하지 않습니다.
  return pg_catalog.jsonb_build_object('ok', true, 'companyId', v_row.company_id,
    'ownerId', v_row.owner_id, 'carId', v_row.car_id, 'phone', v_row.phone);
end;
$function$;

create or replace function public.snote_intake_submit_v3(
  p_token_hash text, p_session_hash text, p_customer jsonb, p_consent_version text,
  p_identity_cipher text, p_signature jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_row public.snote_customer_intake%rowtype;
  v_signature jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_car jsonb;
  v_car_id jsonb;
  v_owner_alias text;
  v_canonical jsonb;
  v_applied boolean;
  v_inserted integer;
  v_stamp bigint;
begin
  v_context := public.snote_intake_submit_context_v3(p_token_hash, p_session_hash);
  if v_context ->> 'ok' is distinct from 'true' then return v_context; end if;
  if p_identity_cipher is null or p_identity_cipher !~ '^smi1[.][0-9a-f]{24}[.][0-9a-f]{58}$' then
    return snote_intake_private.failure('VALIDATION_ERROR', '주민등록번호 입력을 다시 확인해 주세요.');
  end if;
  v_signature := snote_intake_private.wizard_signature(p_signature);
  if v_signature is null then return snote_intake_private.failure('VALIDATION_ERROR', '동의 내용을 확인한 뒤 서명해 주세요.'); end if;
  if p_customer is null or pg_catalog.jsonb_typeof(p_customer) <> 'object'
    or pg_catalog.jsonb_typeof(p_customer -> 'phone') is distinct from 'string'
    or p_customer ->> 'phone' is distinct from v_context ->> 'phone' then
    return snote_intake_private.failure('VALIDATION_ERROR', '인증한 휴대전화 번호를 확인해 주세요.');
  end if;

  -- 기존 함수가 일반 입력의 허용 필드·길이·주소·환급 동의를 다시 검증합니다.
  -- 이 호출 이전에는 고객 입력/서명/암호문을 저장하지 않습니다.
  v_result := public.snote_intake_submit(p_token_hash, p_session_hash, p_customer - 'phone', p_consent_version);
  if v_result ->> 'ok' is distinct from 'true' then return v_result; end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.token_hash = p_token_hash for update;
  if not found then raise exception '입력 정보 저장을 완료하지 못했습니다.' using errcode = 'P0001'; end if;
  if v_result ->> 'alreadySubmitted' = 'true' then
    if v_row.submission_payload ->> 'flowVersion' is distinct from 'wizard-v1'
      or pg_catalog.jsonb_typeof(v_row.submission_payload -> 'identityCipher') is distinct from 'string'
      or (v_row.submission_payload ->> 'identityCipher') !~ '^smi1[.][0-9a-f]{24}[.][0-9a-f]{58}$'
      or snote_intake_private.wizard_signature(v_row.submission_payload -> 'signature') is null then
      -- 구버전의 이미 끝난 접수를 새 서명까지 저장한 성공으로 안내하지 않습니다.
      return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 완료된 접수입니다. 새 서명을 저장하지 않았습니다.');
    end if;
    return v_result || pg_catalog.jsonb_build_object('canonicalApplied', coalesce(v_row.submission_payload ->> 'canonicalApplied' = 'true', false));
  end if;

  -- lock_link가 같은 dataset을 SHARE로 잠근 상태입니다. 원래 JSON id의 숫자/문자열 타입을 보존합니다.
  select item.value into v_car from public.zc_datasets as dataset
    cross join lateral pg_catalog.jsonb_array_elements(dataset.payload) as item(value)
    where dataset.company_id = v_row.company_id and dataset.owner_id = v_row.owner_id
      and dataset.dataset = 'cars' and item.value ->> 'id' = v_row.car_id;
  if not found then raise exception '담당 차량 정보를 확인하지 못했습니다.' using errcode = 'P0001'; end if;
  v_car_id := v_car -> 'id';
  if pg_catalog.jsonb_typeof(v_car_id) not in ('string', 'number') then
    raise exception '담당 차량 정보를 확인하지 못했습니다.' using errcode = 'P0001';
  end if;
  v_payload := v_row.submission_payload || pg_catalog.jsonb_build_object(
    'identityCipher', p_identity_cipher, 'signature', v_signature, 'signedAt', v_row.submitted_at,
    'flowVersion', 'wizard-v1'
  );
  v_owner_alias := 'cld_' || pg_catalog.left(pg_catalog.replace(v_row.owner_id::text, '-', ''), 18);
  v_stamp := pg_catalog.floor(extract(epoch from v_row.submitted_at) * 1000)::bigint;
  v_canonical := v_row.submission_payload || pg_catalog.jsonb_build_object(
    'id', v_owner_alias || ':' || v_row.car_id, 'ownerId', v_owner_alias, 'carId', v_car_id,
    'address', pg_catalog.concat_ws(' ', nullif(v_row.submission_payload ->> 'addressBase', ''), nullif(v_row.submission_payload ->> 'addressDetail', '')),
    'mailing', pg_catalog.concat_ws(' ', nullif(v_row.submission_payload ->> 'mailingBase', ''), nullif(v_row.submission_payload ->> 'mailingDetail', '')),
    'refund', pg_catalog.concat_ws(' · ', nullif(v_row.submission_payload ->> 'refundBank', ''), nullif(v_row.submission_payload ->> 'refundAccount', ''), nullif(v_row.submission_payload ->> 'refundHolder', '')),
    'identityCipher', p_identity_cipher, 'customerSignature', v_signature, 'customerSignatureSignedAt', v_row.submitted_at,
    'intakeSource', pg_catalog.jsonb_build_object('requestId', v_row.id, 'submittedAt', v_row.submitted_at),
    'contractData', null, 'contractSavedAt', null, 'createdAt', v_stamp, 'updatedAt', v_stamp
  );
  insert into public.zc_customers(company_id, owner_id, car_id, payload, updated_by, updated_at)
    values(v_row.company_id, v_row.owner_id, v_row.car_id, v_canonical, v_row.owner_id, v_row.submitted_at)
    on conflict (company_id, owner_id, car_id) do nothing;
  get diagnostics v_inserted = row_count;
  v_applied := v_inserted = 1;
  update public.snote_customer_intake set submission_payload = v_payload || pg_catalog.jsonb_build_object('canonicalApplied', v_applied)
    where id = v_row.id;
  if not found then raise exception '입력 정보 저장을 완료하지 못했습니다.' using errcode = 'P0001'; end if;
  -- 위 INSERT/UPDATE 실패는 예외로 같은 트랜잭션의 일반 제출도 함께 롤백됩니다.
  return v_result || pg_catalog.jsonb_build_object('canonicalApplied', v_applied);
end;
$function$;

create or replace function public.snote_intake_details_v3(p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.snote_customer_intake%rowtype;
  v_cipher text;
begin
  if v_user is null or p_id is null then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '입력 정보를 확인할 수 없습니다.'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || v_user::text, 0));
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user;
  if not found then return snote_intake_private.failure('RRN_NOT_AVAILABLE', '입력 정보를 확인할 수 없습니다.'); end if;
  if snote_intake_private.lock_actor_car(v_user, v_row.company_id, v_row.car_id, true) is null then
    return snote_intake_private.failure('RRN_NOT_AVAILABLE', '입력 정보를 확인할 수 없습니다.');
  end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user for update;
  if not found or v_row.revoked_at is not null or v_row.submitted_at is null
    or v_row.submitted_at <= pg_catalog.clock_timestamp() - interval '30 days' then
    return snote_intake_private.failure('RRN_NOT_AVAILABLE', '입력 정보를 확인할 수 없습니다.');
  end if;
  if not pg_catalog.jsonb_exists(v_row.submission_payload, 'identityCipher') then
    return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'source', 'legacy');
  end if;
  v_cipher := v_row.submission_payload ->> 'identityCipher';
  if pg_catalog.jsonb_typeof(v_row.submission_payload -> 'identityCipher') is distinct from 'string'
    or v_cipher !~ '^smi1[.][0-9a-f]{24}[.][0-9a-f]{58}$' then
    return snote_intake_private.failure('RRN_NOT_AVAILABLE', '입력 정보를 확인할 수 없습니다.');
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'id', v_row.id, 'companyId', v_row.company_id,
    'ownerId', v_row.owner_id, 'carId', v_row.car_id, 'identityCipher', v_cipher);
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
      'submission', case when intake.submitted_at is not null then intake.submission_payload else null end,
      'hasRrn', intake.revoked_at is null and intake.submitted_at is not null
        and (coalesce(pg_catalog.jsonb_typeof(intake.submission_payload -> 'identityCipher') = 'string', false)
          or pg_catalog.to_jsonb(intake) ->> 'rrn_cipher' is not null),
      'hasSignature', intake.revoked_at is null and intake.submitted_at is not null
        and coalesce(pg_catalog.jsonb_typeof(intake.submission_payload -> 'signature') = 'object', false),
      'canonicalApplied', coalesce(intake.submission_payload ->> 'canonicalApplied' = 'true', false)
    ) as body from public.snote_customer_intake as intake
      where intake.company_id = v_company and intake.owner_id = v_user and intake.car_id = p_car_id
        and ((intake.submitted_at is not null and intake.submitted_at > pg_catalog.clock_timestamp() - interval '30 days')
          or (intake.submitted_at is null and intake.expires_at > pg_catalog.clock_timestamp() - interval '7 days'))
      order by intake.created_at desc, intake.id desc limit 5) as item;
  return v_result;
end;
$function$;

revoke all on function snote_intake_private.wizard_signature(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_view_v3(text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_challenge_v3(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_submit_context_v3(text, text) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_submit_v3(text, text, jsonb, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_details_v3(uuid) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_list(text) from public, anon, authenticated, service_role;
grant execute on function public.snote_intake_view_v3(text) to service_role;
grant execute on function public.snote_intake_challenge_v3(text, uuid, text, text) to service_role;
grant execute on function public.snote_intake_submit_context_v3(text, text) to service_role;
grant execute on function public.snote_intake_submit_v3(text, text, jsonb, text, text, jsonb) to service_role;
grant execute on function public.snote_intake_details_v3(uuid) to authenticated;
grant execute on function public.snote_intake_list(text) to authenticated;

notify pgrst, 'reload schema';
commit;
