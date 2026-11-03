-- Accept one-won prices on the legacy dataset wire (four decimal places).
-- No balances, ownership checks, locking, function privileges or search_path change.
do $migration$
declare
  definition text;
  old_pattern constant text := '^[0-9]{1,9}([.][0-9]{1,2})?$';
  new_pattern constant text := '^[0-9]{1,9}([.][0-9]{1,4})?$';
begin
  select pg_catalog.pg_get_functiondef('snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'::regprocedure) into definition;
  if pg_catalog.strpos(definition, old_pattern) = 0 then
    if pg_catalog.strpos(definition, new_pattern) > 0 then return; end if;
    raise exception 'Unexpected customer intake price validation; no function changed';
  end if;
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_pattern, ''))) / pg_catalog.length(old_pattern) <> 1 then
    raise exception 'Ambiguous customer intake price validation; no function changed';
  end if;
  execute pg_catalog.replace(definition, old_pattern, new_pattern);
end;
$migration$;
