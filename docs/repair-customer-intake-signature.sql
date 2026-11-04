-- Idempotent repair of missing signature metadata only. No names, addresses or money are changed.
-- Match company/owner/car AND customer name/verified phone. Respect the intake retention window.
with candidates as (
 select c.company_id,c.owner_id,c.car_id,c.payload as previous_payload,c.updated_at as previous_updated_at,
        source.id,source.submitted_at,source.submission_payload
 from public.zc_customers c
 join lateral (
  select i.id,i.submitted_at,i.submission_payload from public.snote_customer_intake i
  where i.company_id=c.company_id and i.owner_id=c.owner_id and i.car_id=c.car_id
   and i.revoked_at is null and i.submitted_at>clock_timestamp()-interval '30 days'
   and jsonb_typeof(i.submission_payload->'signature')='object'
   and i.submission_payload->'signature'->>'version'='1'
   and jsonb_typeof(i.submission_payload->'signature'->'strokes')='array'
   and length(btrim(c.payload->>'name'))>0
   and btrim(i.submission_payload->>'name')=btrim(c.payload->>'name')
   and regexp_replace(c.payload->>'phone','[^0-9]','','g') ~ '^01[0-9]{8,9}$'
   and regexp_replace(coalesce(i.submission_payload->>'phone',i.phone),'[^0-9]','','g')=regexp_replace(c.payload->>'phone','[^0-9]','','g')
   and (c.payload->'intakeSource'->>'requestId' is null or c.payload->'intakeSource'->>'requestId'=i.id::text)
  order by i.submitted_at desc,i.id desc limit 1
 ) source on true
 where coalesce(c.payload->'customerSignature','null'::jsonb)='null'::jsonb
), repaired as (
 update public.zc_customers c set
  payload=c.payload||jsonb_build_object('customerSignature',s.submission_payload->'signature','customerSignatureSignedAt',s.submitted_at,
    'intakeSource',jsonb_build_object('requestId',s.id,'submittedAt',s.submitted_at)),
  updated_at=greatest(clock_timestamp(),coalesce(c.updated_at,clock_timestamp())+interval '1 millisecond'),updated_by=c.owner_id
 from candidates s
 where c.company_id=s.company_id and c.owner_id=s.owner_id and c.car_id=s.car_id
  and c.updated_at is not distinct from s.previous_updated_at and c.payload=s.previous_payload
 returning 1
)
select count(*)::integer as repaired_customers from repaired;
