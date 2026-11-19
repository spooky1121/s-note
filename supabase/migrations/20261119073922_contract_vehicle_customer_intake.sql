-- Contract-pending vehicles are still inventory. Keep mobile customer-intake
-- eligibility in sync while preserving all current ownership/recycle/lock guards.
begin;
do $migration$
declare
  definition text;
  old_statuses constant text := '(''판매중'', ''매입진행'', ''수리중'')';
  new_statuses constant text := '(''판매중'', ''계약중'', ''매입진행'', ''수리중'')';
begin
  select pg_catalog.pg_get_functiondef(
    'snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'::regprocedure
  ) into definition;
  if pg_catalog.strpos(definition, old_statuses) = 0 then
    if pg_catalog.strpos(definition, new_statuses) > 0 then return; end if;
    raise exception 'Unexpected customer intake inventory statuses; no function changed';
  end if;
  if (pg_catalog.length(definition) - pg_catalog.length(
    pg_catalog.replace(definition, old_statuses, '')
  )) / pg_catalog.length(old_statuses) <> 1 then
    raise exception 'Ambiguous customer intake inventory statuses; no function changed';
  end if;
  execute pg_catalog.replace(definition, old_statuses, new_statuses);
end;
$migration$;
commit;
