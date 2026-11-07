-- Personal reauthentication preference only. This does not change finance-data
-- permissions, company roles, existing accounts, vehicles or financial records.
begin;
create schema if not exists snote_workspace_private;
revoke all on schema snote_workspace_private from public, anon, authenticated, service_role;

create table if not exists snote_workspace_private.finance_lock_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 company_id uuid not null references public.zc_companies(id) on delete cascade,
 finance_lock_enabled boolean not null,
 revision integer not null check (revision between 1 and 2147483647),
 updated_at timestamptz not null default pg_catalog.clock_timestamp(),
 primary key (user_id, company_id)
);
-- The primary key indexes the user FK; this indexes the company FK as well.
create index if not exists finance_lock_preferences_company_idx
 on snote_workspace_private.finance_lock_preferences(company_id);
alter table snote_workspace_private.finance_lock_preferences enable row level security;
revoke all on table snote_workspace_private.finance_lock_preferences from public, anon, authenticated, service_role;

create or replace function snote_workspace_private.get_finance_lock()
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
 v_actor record;
 v_preference snote_workspace_private.finance_lock_preferences;
 v_role text;
begin
 -- The existing helper verifies auth.uid() against exactly one real active
 -- membership and holds that membership stable for this transaction.
 select * into v_actor from snote_taxonomy_private.member(false);
 select * into v_preference from snote_workspace_private.finance_lock_preferences
  where user_id = v_actor.actor_id and company_id = v_actor.company_id;
 if found then
  return pg_catalog.jsonb_build_object('enabled', v_preference.finance_lock_enabled,
   'revision', v_preference.revision);
 end if;
 select membership.role into v_role from public.zc_members as membership
  where membership.user_id = v_actor.actor_id and membership.company_id = v_actor.company_id
   and membership.active is true;
 -- Preserve current behavior without inserting any default rows: dealers have
 -- the personal gate, admins do not. Accountants cannot save this preference;
 -- an own read of false does not grant a settings or finance route.
 return pg_catalog.jsonb_build_object('enabled', v_role = 'dealer', 'revision', 0);
end;
$function$;

create or replace function snote_workspace_private.save_finance_lock(
 p_expected_company_id uuid, p_expected_user_id uuid,
 p_enabled boolean, p_expected_revision integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
 v_actor record;
 v_preference snote_workspace_private.finance_lock_preferences;
begin
 select * into v_actor from snote_taxonomy_private.member(true);
 if p_expected_company_id is distinct from v_actor.company_id
  or p_expected_user_id is distinct from v_actor.actor_id then
  raise exception 'FINANCE_LOCK_CONTEXT_CHANGED' using errcode = '42501';
 end if;
 if p_enabled is null or p_expected_revision is null
  or p_expected_revision < 0 or p_expected_revision >= 2147483647 then
  raise exception 'FINANCE_LOCK_INVALID_PREFERENCE' using errcode = '22023';
 end if;
 if p_expected_revision = 0 then
  -- The unique key makes concurrent first saves atomic; the losing writer
  -- cannot replace the winner's choice even when both observed revision zero.
  insert into snote_workspace_private.finance_lock_preferences
   (user_id, company_id, finance_lock_enabled, revision)
   values (v_actor.actor_id, v_actor.company_id, p_enabled, 1)
   on conflict (user_id, company_id) do nothing
   returning * into v_preference;
 else
  update snote_workspace_private.finance_lock_preferences as preference
   set finance_lock_enabled = p_enabled, revision = preference.revision + 1,
    updated_at = pg_catalog.clock_timestamp()
   where preference.user_id = v_actor.actor_id and preference.company_id = v_actor.company_id
    and preference.revision = p_expected_revision
   returning * into v_preference;
 end if;
 if not found then
  raise exception 'FINANCE_LOCK_CONFLICT' using errcode = '40001';
 end if;
 return pg_catalog.jsonb_build_object('enabled', v_preference.finance_lock_enabled,
  'revision', v_preference.revision);
end;
$function$;

create or replace function public.snote_finance_lock_get()
returns jsonb language sql security invoker set search_path = ''
as $function$ select snote_workspace_private.get_finance_lock(); $function$;
create or replace function public.snote_finance_lock_save(
 p_expected_company_id uuid, p_expected_user_id uuid,
 p_enabled boolean, p_expected_revision integer
)
returns jsonb language sql security invoker set search_path = ''
as $function$
 select snote_workspace_private.save_finance_lock(
  p_expected_company_id, p_expected_user_id, p_enabled, p_expected_revision);
$function$;

revoke all on function snote_workspace_private.get_finance_lock() from public, anon, authenticated, service_role;
revoke all on function snote_workspace_private.save_finance_lock(uuid, uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.snote_finance_lock_get() from public, anon, authenticated, service_role;
revoke all on function public.snote_finance_lock_save(uuid, uuid, boolean, integer) from public, anon, authenticated, service_role;
grant usage on schema snote_workspace_private to authenticated;
grant execute on function snote_workspace_private.get_finance_lock() to authenticated;
grant execute on function snote_workspace_private.save_finance_lock(uuid, uuid, boolean, integer) to authenticated;
grant execute on function public.snote_finance_lock_get() to authenticated;
grant execute on function public.snote_finance_lock_save(uuid, uuid, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
