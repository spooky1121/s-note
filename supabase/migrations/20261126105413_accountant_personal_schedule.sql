-- Allow active accountants to use their own existing personal schedule only.
-- All session, membership, company and operator checks remain unchanged.
-- CREATE OR REPLACE retains the existing private actor OID, owner and grants;
-- no events, RLS policies, RPC grants or financial datasets are changed.
begin;
create or replace function snote_schedule_private.actor(p_expected_company_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare a uuid:=auth.uid();
begin
 if auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true' or a is null or p_expected_company_id is null then
  raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end if;
 begin
  perform 1 from snote_operator_private.verified_session(a,snote_operator_private.claim_session());
 exception when insufficient_privilege then raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end;
 perform 1 from public.zc_members m where m.user_id=a and m.company_id=p_expected_company_id and m.active and m.role in('admin','dealer','accountant') for share;
 if not found then raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';end if;
 perform 1 from public.zc_companies c where c.id=p_expected_company_id
  and not exists(select 1 from snote_operator_private.company_state s where s.company_id=c.id and s.archived) for share;
 if not found or exists(select 1 from snote_operator_private.operators o where o.user_id=a) then
  raise exception 'SCHEDULE_CONTEXT_CHANGED' using errcode='42501';
 end if;
 return a;
end$$;
commit;
