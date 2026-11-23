-- A deleted customer must not prevent a dealer from requesting a new customer.
-- Only a new verified submission may create the replacement canonical record.
-- Recycle tombstones, old links and ordinary customer-save guards are retained.
begin;

alter table public.snote_customer_intake
 add column if not exists customer_generation uuid,
 add column if not exists customer_deleted_at timestamptz,
 add column if not exists customer_was_missing boolean not null default false;

create or replace function snote_intake_private.customer_deleted_at(p_company uuid,p_owner uuid,p_car text)
returns timestamptz language sql security invoker set search_path='' as $f$
 select max(deleted_at) from snote_private.recycle_bin
 where company_id=p_company and car_id=p_car
  and(kind='vehicle' or(kind='customer' and owner_id=p_owner));
$f$;

-- Bind requests which predate this migration only when no newer deletion has
-- invalidated them. No customer payload, recycle entry or revocation is changed.
update public.snote_customer_intake i set
 customer_deleted_at=snote_intake_private.customer_deleted_at(i.company_id,i.owner_id,i.car_id),
 customer_generation=coalesce((select c.restore_generation from public.zc_customers c
  where c.company_id=i.company_id and c.owner_id=i.owner_id and c.car_id=i.car_id),
  case when snote_intake_private.customer_deleted_at(i.company_id,i.owner_id,i.car_id) is not null then i.id
   else '00000000-0000-0000-0000-000000000000'::uuid end),
 customer_was_missing=not exists(select 1 from public.zc_customers c
  where c.company_id=i.company_id and c.owner_id=i.owner_id and c.car_id=i.car_id)
where i.customer_generation is null and i.revoked_at is null and i.created_at>coalesce(
 snote_intake_private.customer_deleted_at(i.company_id,i.owner_id,i.car_id),'-infinity'::timestamptz);

-- Copy the installed inventory predicate rather than reconstructing historical
-- schema compatibility. Remove exactly the customer-recycle gate only from
-- these intake-only copies; the original helpers remain unchanged.
do $copy$
declare source text;old_name text;new_name text;gate text;actor_lock text;
begin
 gate:='if snote_private.recycle_blocked(p_company,p_owner,p_car_id) then return null;end if;';
 actor_lock:=$actor$perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-intake:actor:' || p_owner::text, 0));$actor$;
 for old_name,new_name in values
  ('snote_intake_private.lock_actor_car_owned_v2188','snote_intake_private.lock_actor_car_owned_restart_v2198'),
  ('snote_intake_private.lock_actor_car','snote_intake_private.lock_actor_car_restart_v2198')
 loop
  if to_regprocedure(new_name||'(uuid,uuid,text,boolean)') is not null then continue;end if;
  source:=replace(pg_get_functiondef(to_regprocedure(old_name||'(uuid,uuid,text,boolean)')),E'\r\n',E'\n');
  if source is null or (length(source)-length(replace(source,gate,'')))/length(gate)<>1 then
   raise exception 'Unexpected intake recycle predicate baseline';
  end if;
  if (length(source)-length(replace(source,'FUNCTION '||old_name||'(','')))/length('FUNCTION '||old_name||'(')<>1 then
   raise exception 'Unexpected intake function identity';
  end if;
  source:=replace(source,'FUNCTION '||old_name||'(','FUNCTION '||new_name||'(');
  source:=replace(source,gate,$actorcheck$-- Customer trash is separated by request generation below.
  if auth.uid() is not null and(auth.uid() is distinct from p_owner
    or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true') then return null;end if;$actorcheck$);
  if old_name='snote_intake_private.lock_actor_car' then
   if (length(source)-length(replace(source,'snote_intake_private.lock_actor_car_owned_v2188(','')))/length('snote_intake_private.lock_actor_car_owned_v2188(')<>1 then
    raise exception 'Unexpected intake owned predicate baseline';
   end if;
   source:=replace(source,'snote_intake_private.lock_actor_car_owned_v2188(',
    'snote_intake_private.lock_actor_car_owned_restart_v2198(');
  else
   if (length(source)-length(replace(source,actor_lock,'')))/length(actor_lock)<>1 then raise exception 'Unexpected intake actor baseline';end if;
   -- Authenticated entrypoints retain their outer actor lock. Public links use
   -- the company lock only, avoiding a company -> actor / actor -> company cycle.
   source:=replace(source,actor_lock,'-- Intake scope is serialized by its company lock.');
  end if;
  execute source;
 end loop;
end$copy$;

create or replace function snote_intake_private.bind_customer_generation(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $f$
declare r public.snote_customer_intake;c public.zc_customers;cutoff timestamptz;
begin
 select * into r from public.snote_customer_intake where id=p_id for update;
 if not found then raise exception 'Missing customer intake';end if;
 cutoff:=snote_intake_private.customer_deleted_at(r.company_id,r.owner_id,r.car_id);
 select * into c from public.zc_customers where company_id=r.company_id and owner_id=r.owner_id and car_id=r.car_id for share;
 update public.snote_customer_intake set customer_deleted_at=cutoff,
  customer_was_missing=c.car_id is null,
  customer_generation=coalesce(c.restore_generation,case when cutoff is not null then r.id
   else '00000000-0000-0000-0000-000000000000'::uuid end)
 where id=r.id;
end$f$;

create or replace function snote_intake_private.customer_generation_valid(p_row public.snote_customer_intake)
returns boolean language plpgsql security invoker set search_path='' as $f$
declare c public.zc_customers;cutoff timestamptz;
begin
 if p_row.id is null or p_row.revoked_at is not null or p_row.customer_generation is null then return false;end if;
 cutoff:=snote_intake_private.customer_deleted_at(p_row.company_id,p_row.owner_id,p_row.car_id);
 if p_row.customer_deleted_at is distinct from cutoff then return false;end if;
 select * into c from public.zc_customers where company_id=p_row.company_id and owner_id=p_row.owner_id and car_id=p_row.car_id;
 if not found then return p_row.customer_was_missing;end if;
 return c.restore_generation=p_row.customer_generation;
end$f$;

create or replace function snote_intake_private.lock_link(p_token_hash text)
returns public.snote_customer_intake language plpgsql set search_path='' as $f$
declare r public.snote_customer_intake;
begin
 if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 select * into r from public.snote_customer_intake where token_hash=p_token_hash;
 if not found then return null;end if;
 -- Keep source/recipient company order before recipient recycle/intake locks.
 if left(lower(r.car_id),3)='sc:' and snote_private.shared_contract_lock(r.company_id,r.owner_id,r.car_id,false) is null then return null;end if;
 perform snote_private.recycle_lock(r.company_id);
 if snote_intake_private.lock_actor_car_restart_v2198(r.owner_id,r.company_id,r.car_id,false) is null then return null;end if;
 select * into r from public.snote_customer_intake where id=r.id and token_hash=p_token_hash for update;
 if not found then return null;end if;
 -- Preserve the existing generic REVOKED response without exposing old payload.
 if r.revoked_at is not null then return r;end if;
 if not snote_intake_private.customer_generation_valid(r) then return null;end if;
 return r;
end$f$;

-- Preserve installed role/anonymous-JWT checks, share validation, rate limits,
-- company selection, KRW compatibility and explicit resend cancellation.
do $entrypoints$
declare signature text;source text;old_block text;new_block text;
begin
 foreach signature in array array['public.snote_intake_create(text,text,text)','public.snote_intake_list(text)',
  'public.snote_intake_details_v3(uuid)','public.snote_intake_rrn_access(uuid)'] loop
  source:=replace(pg_get_functiondef(to_regprocedure(signature)),E'\r\n',E'\n');
  if source is null and signature='public.snote_intake_rrn_access(uuid)' then continue;end if;
  if source is null then raise exception 'Missing intake generation baseline';end if;
  if strpos(source,'lock_actor_car_restart_v2198(')>0 then continue;end if;
  if (length(source)-length(replace(source,'snote_intake_private.lock_actor_car(','')))/length('snote_intake_private.lock_actor_car(')<>1 then raise exception 'Unexpected intake inventory baseline';end if;
  source:=replace(source,'snote_intake_private.lock_actor_car(','snote_intake_private.lock_actor_car_restart_v2198(');
  if signature='public.snote_intake_create(text,text,text)' then
   old_block:='  -- 다른 actor와 토큰 해시가 충돌해도 기존 링크를 먼저 폐기하지 않습니다.';
   new_block:=E'  perform snote_intake_private.bind_customer_generation(v_row.id);\n'||old_block;
  elsif signature='public.snote_intake_list(text)' then
   old_block:='and intake.car_id = p_car_id';
   new_block:=old_block||' and snote_intake_private.customer_generation_valid(intake)';
  else
   old_block:='if not found or v_row.revoked_at is not null';
   new_block:='if not found or not snote_intake_private.customer_generation_valid(v_row) or v_row.revoked_at is not null';
  end if;
  if (length(source)-length(replace(source,old_block,'')))/length(old_block)<>1 then raise exception 'Unexpected intake generation block';end if;
  execute replace(source,old_block,new_block);
 end loop;
end$entrypoints$;

do $revoke$
declare source text;old_block text;new_block text;
begin
 source:=replace(pg_get_functiondef('public.snote_intake_revoke(uuid)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,'customer_generation_valid(v_row)')>0 then return;end if;
 old_block:=$old$  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user for update;$old$;
 new_block:=$new$  if snote_intake_private.lock_actor_car_restart_v2198(v_user,v_row.company_id,v_row.car_id,true) is null
    or(v_row.revoked_at is null and not snote_intake_private.customer_generation_valid(v_row)) then
    return snote_intake_private.failure('FORBIDDEN','현재 고객 입력 요청만 폐기할 수 있습니다.');
  end if;
  select intake.* into v_row from public.snote_customer_intake as intake where intake.id = p_id and intake.owner_id = v_user for update;$new$;
 if (length(source)-length(replace(source,old_block,'')))/length(old_block)<>1 then raise exception 'Unexpected intake cancellation baseline';end if;
 execute replace(source,old_block,new_block);
end$revoke$;

-- The trusted new submission is the only path which may create a replacement
-- customer. Never restore or merge the trashed customer's payload/signature.
do $canonical$
declare source text;old_block text;new_block text;
begin
 source:=replace(pg_get_functiondef('public.snote_intake_submit_v3(text,text,jsonb,text,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 if strpos(source,'customer_generation_valid(v_row)')>0 then return;end if;
 old_block:=$old$  insert into public.zc_customers(company_id, owner_id, car_id, payload, updated_by, updated_at)
    values(v_row.company_id, v_row.owner_id, v_row.car_id, v_canonical, v_row.owner_id, v_row.submitted_at)
    on conflict (company_id, owner_id, car_id) do nothing;
  get diagnostics v_inserted = row_count;$old$;
 new_block:=$new$  if not snote_intake_private.customer_generation_valid(v_row) then
    raise exception 'Customer intake generation changed' using errcode='40001';
  end if;
  v_inserted:=0;
  if not exists(select 1 from public.zc_customers where company_id=v_row.company_id and owner_id=v_row.owner_id and car_id=v_row.car_id) then
    -- Company/vehicle/request locks above serialize deletion, restore and save.
    -- Nonzero generations also prevent old clients from recreating/overwriting.
    declare v_internal text:=current_setting('snote.recycle_internal',true);
    begin
      if v_row.customer_was_missing and v_row.customer_deleted_at is not null
        and v_row.customer_generation=v_row.id then
        perform set_config('snote.recycle_internal','1',true);
      end if;
      insert into public.zc_customers(company_id,owner_id,car_id,payload,updated_by,updated_at,restore_generation)
        values(v_row.company_id,v_row.owner_id,v_row.car_id,v_canonical,v_row.owner_id,v_row.submitted_at,v_row.customer_generation)
        on conflict(company_id,owner_id,car_id) do nothing;
      get diagnostics v_inserted=row_count;
      perform set_config('snote.recycle_internal',coalesce(v_internal,''),true);
    end;
  end if;$new$;
 if (length(source)-length(replace(source,old_block,'')))/length(old_block)<>1 then raise exception 'Unexpected intake canonical baseline';end if;
 execute replace(source,old_block,new_block);
end$canonical$;

revoke all on function snote_intake_private.customer_deleted_at(uuid,uuid,text),
 snote_intake_private.lock_actor_car_owned_restart_v2198(uuid,uuid,text,boolean),
 snote_intake_private.lock_actor_car_restart_v2198(uuid,uuid,text,boolean),
 snote_intake_private.bind_customer_generation(uuid),
 snote_intake_private.customer_generation_valid(public.snote_customer_intake)
 from public,anon,authenticated,service_role;

commit;
