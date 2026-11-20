-- v2.160: immutable customer-selected receipt details beside the same intake
-- signature. Existing completed intakes/customers are never backfilled as consent.
begin;

create or replace function snote_intake_private.receipt_details(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = ''
as $function$
declare
  v_key text;
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) <> 'object'
    or pg_catalog.octet_length(p_value::text) > 1024 then return null; end if;
  if not (p_value ?& array['children','business','privacyConsent','insuranceConfirmed','delegationConfirmed','cashConfirmed','consentVersion']) then return null; end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_value) loop
    if v_key not in ('children','business','privacyConsent','insuranceConfirmed','delegationConfirmed','cashConfirmed','consentVersion') then return null; end if;
  end loop;
  if pg_catalog.jsonb_typeof(p_value -> 'children') not in ('null','string')
    or (p_value ->> 'children' is not null and p_value ->> 'children' not in ('none','two','three'))
    or pg_catalog.jsonb_typeof(p_value -> 'business') not in ('null','string')
    or (p_value ->> 'business' is not null and p_value ->> 'business' not in ('invoice','cash'))
    or pg_catalog.jsonb_typeof(p_value -> 'consentVersion') is distinct from 'string'
    or p_value ->> 'consentVersion' is distinct from 'receipt-v1' then return null; end if;
  foreach v_key in array array['privacyConsent','insuranceConfirmed','delegationConfirmed','cashConfirmed'] loop
    if pg_catalog.jsonb_typeof(p_value -> v_key) is distinct from 'boolean' then return null; end if;
  end loop;
  return p_value;
end;
$function$;

create or replace function public.snote_intake_submit_v4(
  p_token_hash text, p_session_hash text, p_customer jsonb, p_consent_version text,
  p_identity_cipher text, p_signature jsonb, p_receipt_details jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_row public.snote_customer_intake%rowtype;
  v_receipt jsonb;
  v_result jsonb;
  v_count integer;
begin
  -- Reuse the same locked link/session/active owner/car checks as the existing
  -- signed wizard. Nothing can be stored before those checks succeed.
  v_context := public.snote_intake_submit_context_v3(p_token_hash, p_session_hash);
  if v_context ->> 'ok' is distinct from 'true' then return v_context; end if;
  v_receipt := snote_intake_private.receipt_details(p_receipt_details);
  if v_receipt is null then
    return snote_intake_private.failure('VALIDATION_ERROR', '인수증 확인 항목을 다시 확인해 주세요.');
  end if;
  select intake.* into v_row from public.snote_customer_intake as intake
    where intake.token_hash = p_token_hash for update;
  if not found then raise exception '접수 정보를 확인하지 못했습니다.' using errcode='P0001'; end if;
  if v_row.submitted_at is not null and v_row.submission_payload -> 'receiptDetails' is distinct from v_receipt then
    -- A retry may acknowledge the existing identical receipt, but can never add
    -- new consent to a previously signed v3 intake or revise an existing receipt.
    return snote_intake_private.failure('ALREADY_SUBMITTED', '이미 완료된 접수입니다. 인수증 확인 항목을 새로 저장하지 않았습니다.');
  end if;
  v_result := public.snote_intake_submit_v3(p_token_hash, p_session_hash, p_customer,
    p_consent_version, p_identity_cipher, p_signature);
  if v_result ->> 'ok' is distinct from 'true' or v_result ->> 'alreadySubmitted' = 'true' then return v_result; end if;
  select intake.* into v_row from public.snote_customer_intake as intake
    where intake.token_hash = p_token_hash for update;
  update public.snote_customer_intake
    set submission_payload = submission_payload || pg_catalog.jsonb_build_object('receiptDetails', v_receipt)
    where id = v_row.id;
  if not found then raise exception '인수증 확인 항목을 저장하지 못했습니다.' using errcode='P0001'; end if;
  if v_result ->> 'canonicalApplied' = 'true' then
    update public.zc_customers as customer
      set payload = customer.payload || pg_catalog.jsonb_build_object('receiptDetails', v_receipt)
      where customer.company_id = v_row.company_id and customer.owner_id = v_row.owner_id and customer.car_id = v_row.car_id
        and customer.payload -> 'intakeSource' ->> 'requestId' = v_row.id::text
        and customer.payload -> 'customerSignature' = v_row.submission_payload -> 'signature';
    get diagnostics v_count = row_count;
    if v_count <> 1 then raise exception '고객 인수증 확인 항목을 저장하지 못했습니다.' using errcode='P0001'; end if;
  end if;
  -- Any statement failure rolls back the underlying v3 submission, encrypted
  -- identity, signature and new canonical customer together.
  return v_result;
end;
$function$;

revoke all on function snote_intake_private.receipt_details(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.snote_intake_submit_v4(text,text,jsonb,text,text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.snote_intake_submit_v4(text,text,jsonb,text,text,jsonb,jsonb) to service_role;

commit;
