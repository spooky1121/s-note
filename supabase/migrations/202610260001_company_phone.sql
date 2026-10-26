-- 기존 202610240001_company_profile.sql 적용 후 전체 내용을 실행하세요.
-- 여러 번 실행할 수 있으며 계정, 직원 역할, 기존 전화번호를 변경하지 않습니다.
begin;

alter table public.zc_companies
  add column if not exists business_phone text not null default '';

create or replace function public.snote_save_company_profile(
  p_company uuid,
  p_profile jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_field text;
  v_name text;
  v_business_number text;
  v_business_phone text;
  v_business_phone_supplied boolean;
  v_representative_name text;
  v_business_postcode text;
  v_business_address text;
  v_business_address_detail text;
  v_admin_name text;
  v_admin_phone text;
  v_company jsonb;
  v_admin jsonb;
begin
  if v_user is null then
    raise exception '로그인한 관리자만 상사 정보를 수정할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_company is null then
    raise exception '수정할 상사 정보를 확인해 주세요.'
      using errcode = '22023';
  end if;

  -- 갱신 전 요청자 본인의 활성 관리자 멤버십을 잠급니다.
  -- 동시에 진행되는 권한 변경·비활성화와 직렬화하여 기존 권한 검사를 유지합니다.
  perform 1
    from public.zc_members as member
    where member.user_id = v_user
      and member.company_id = p_company
      and member.role = 'admin'
      and member.active is true
    for update;

  if not found then
    raise exception '활성 상사 관리자만 소속 상사 정보를 수정할 수 있습니다.'
      using errcode = '42501';
  end if;

  if p_profile is null or pg_catalog.jsonb_typeof(p_profile) <> 'object' then
    raise exception '상사 정보 입력 형식을 확인해 주세요.'
      using errcode = '22023';
  end if;

  -- 아래 기존 필드는 누락/null/문자열 이외 값을 오류로 처리합니다.
  -- 잘못된 입력으로 기존 필드가 조용히 지워지지 않도록 검증을 유지합니다.
  foreach v_field in array array[
    'name', 'business_number', 'representative_name', 'business_postcode',
    'business_address', 'business_address_detail', 'admin_name', 'admin_phone'
  ] loop
    if pg_catalog.jsonb_typeof(p_profile -> v_field) is distinct from 'string' then
      raise exception '상사 정보 입력 형식을 확인해 주세요.'
        using errcode = '22023';
    end if;
  end loop;

  v_name := pg_catalog.btrim(p_profile ->> 'name');
  v_business_number := pg_catalog.btrim(p_profile ->> 'business_number');
  v_representative_name := pg_catalog.btrim(p_profile ->> 'representative_name');
  v_business_postcode := pg_catalog.btrim(p_profile ->> 'business_postcode');
  v_business_address := pg_catalog.btrim(p_profile ->> 'business_address');
  v_business_address_detail := pg_catalog.btrim(p_profile ->> 'business_address_detail');
  v_admin_name := pg_catalog.btrim(p_profile ->> 'admin_name');
  v_admin_phone := pg_catalog.btrim(p_profile ->> 'admin_phone');

  -- 구버전 클라이언트가 전화번호 키를 보내지 않으면 기존 값을 보존합니다.
  -- 키가 있으면 null/숫자 등을 허용하지 않고, 빈 문자열만 선택적 삭제로 처리합니다.
  v_business_phone_supplied := pg_catalog.jsonb_exists(p_profile, 'business_phone');
  if v_business_phone_supplied then
    if pg_catalog.jsonb_typeof(p_profile -> 'business_phone') is distinct from 'string' then
      raise exception '상사 전화번호 입력 형식을 확인해 주세요.'
        using errcode = '22023';
    end if;
    v_business_phone := pg_catalog.btrim(p_profile ->> 'business_phone');
    if v_business_phone !~ '^([0-9]{8,12})?$' then
      raise exception '상사 전화번호는 숫자 8~12자리로 입력하거나 비워 주세요.'
        using errcode = '22023';
    end if;
  end if;

  if pg_catalog.char_length(v_name) not between 2 and 100 then
    raise exception '상사명은 2~100자로 입력해 주세요.' using errcode = '22023';
  end if;
  if v_business_number !~ '^[0-9]{10}$' then
    raise exception '사업자등록번호는 숫자 10자리로 입력해 주세요.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_representative_name) not between 1 and 40 then
    raise exception '대표자명은 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;
  if v_business_postcode !~ '^([0-9]{5})?$' then
    raise exception '우편번호는 숫자 5자리로 입력하거나 비워 주세요.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_business_address) not between 1 and 200 then
    raise exception '상사 주소는 1~200자로 입력해 주세요.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_business_address_detail) > 200 then
    raise exception '상세주소는 200자 이내로 입력해 주세요.' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_admin_name) not between 1 and 40 then
    raise exception '관리자 성명은 1~40자로 입력해 주세요.' using errcode = '22023';
  end if;
  if v_admin_phone !~ '^01[016789][0-9]{7,8}$' then
    raise exception '관리자 휴대전화 번호를 확인해 주세요.' using errcode = '22023';
  end if;

  update public.zc_companies as company
    set name = v_name,
        business_number = v_business_number,
        business_phone = case
          when v_business_phone_supplied then v_business_phone
          else company.business_phone
        end,
        representative_name = v_representative_name,
        business_postcode = v_business_postcode,
        business_address = v_business_address,
        business_address_detail = v_business_address_detail
    where company.id = p_company
    returning pg_catalog.jsonb_build_object(
      'id', company.id,
      'name', company.name,
      'rrn_enabled', company.rrn_enabled,
      'business_number', company.business_number,
      'business_phone', company.business_phone,
      'representative_name', company.representative_name,
      'business_postcode', company.business_postcode,
      'business_address', company.business_address,
      'business_address_detail', company.business_address_detail
    ) into v_company;

  if not found then
    raise exception '등록된 상사 정보를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;

  update public.zc_members as member
    set display_name = v_admin_name,
        phone = v_admin_phone
    where member.user_id = v_user
      and member.company_id = p_company
      and member.role = 'admin'
      and member.active is true
    returning pg_catalog.jsonb_build_object(
      'display_name', member.display_name,
      'phone', member.phone
    ) into v_admin;

  if not found then
    raise exception '관리자 정보를 갱신할 수 없습니다. 다시 로그인해 주세요.'
      using errcode = '42501';
  end if;

  return pg_catalog.jsonb_build_object('company', v_company, 'admin', v_admin);
end;
$function$;

revoke all on function public.snote_save_company_profile(uuid, jsonb) from public;
revoke all on function public.snote_save_company_profile(uuid, jsonb) from anon;
grant execute on function public.snote_save_company_profile(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
