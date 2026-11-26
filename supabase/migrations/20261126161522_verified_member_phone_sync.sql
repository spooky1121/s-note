-- Reuse the existing server-created possession proof. Work contacts and signup
-- metadata cannot enroll a number, and Auth/recovery functions remain unchanged.
begin;
create or replace function snote_private.sync_verified_member_phone(p_user uuid)
returns boolean language plpgsql set search_path='' as $$
declare m public.zc_members;u auth.users;b snote_private.recovery_phone_bindings;
begin
 -- Profile OTP already owns this membership lock. NOWAIT also avoids reversing
 -- its member/Auth lock order when a genuine Auth-phone confirmation invokes us.
 select * into m from public.zc_members where user_id=p_user and active and role in('admin','dealer','accountant') for update nowait;
 if not found then return false;end if;
 select * into u from auth.users where id=p_user and deleted_at is null and not coalesce(is_anonymous,false) and (banned_until is null or banned_until<=clock_timestamp()) for share nowait;
 if not found or exists(select 1 from snote_operator_private.operators where user_id=p_user)
  or exists(select 1 from snote_operator_private.account_state where user_id=p_user and archived)
  or exists(select 1 from snote_operator_private.company_state where company_id=m.company_id and archived) then return false;end if;
 select * into b from snote_private.recovery_phone_bindings where user_id=p_user and invalidated_at is null for share nowait;
 if not found or b.phone!~'^(010[0-9]{8}|01[16789][0-9]{7,8})$' or b.phone is distinct from snote_private.recovery_canonical_phone(p_user) then return false;end if;
 if b.source='auth_phone' then
  if u.phone_confirmed_at is null or snote_private.recovery_phone(u.phone) is distinct from b.phone or u.phone_confirmed_at is distinct from b.verified_at then return false;end if;
 elsif b.source<>'profile_otp' then return false;
 end if;
 if m.phone is not distinct from b.phone then return false;end if;
 -- Existing registration uniqueness, recovery/reset and account guards still run.
 update public.zc_members set phone=b.phone where user_id=p_user and company_id=m.company_id and active and role in('admin','dealer','accountant');
 return found;
exception when lock_not_available then return false;
end$$;
create or replace function snote_private.sync_verified_member_phone_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.invalidated_at is null then perform snote_private.sync_verified_member_phone(new.user_id);end if;
 return new;
end$$;
revoke all on function snote_private.sync_verified_member_phone(uuid),snote_private.sync_verified_member_phone_trigger() from public,anon,authenticated,service_role;
drop trigger if exists snote_verified_member_phone_sync on snote_private.recovery_phone_bindings;
create trigger snote_verified_member_phone_sync after insert or update of phone,verified_at,source,invalidated_at on snote_private.recovery_phone_bindings
 for each row execute function snote_private.sync_verified_member_phone_trigger();

-- Reconcile only durable, still-valid evidence. There is no unverified signup or
-- metadata backfill. A currently locked/resetting/conflicting identity is left
-- untouched rather than bypassing any existing guard.
do $sync$
declare candidate record;
begin
 for candidate in select b.user_id from snote_private.recovery_phone_bindings b join public.zc_members m on m.user_id=b.user_id
  where b.invalidated_at is null and m.active and m.role in('admin','dealer','accountant') and m.phone is distinct from b.phone order by b.user_id
 loop
  begin perform snote_private.sync_verified_member_phone(candidate.user_id);
  exception when unique_violation or serialization_failure then null;
   when raise_exception then if sqlerrm<>'CONTACT_EXISTS' then raise;end if;
  end;
 end loop;
end$sync$;
commit;
