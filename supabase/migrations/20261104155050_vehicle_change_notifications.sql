-- Durable per-recipient notifications for actual changes to shared vehicles.
create table snote_private.vehicle_notifications(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.zc_companies(id) on delete cascade,
 owner_id uuid not null references auth.users(id) on delete cascade,car_id text not null,
 recipient_id uuid not null references auth.users(id) on delete cascade,actor_id uuid not null references auth.users(id),
 car_label text not null,changes jsonb not null check(jsonb_typeof(changes)='array'),money_unit text not null,
 created_at timestamptz not null default now(),read_at timestamptz
);
alter table snote_private.vehicle_notifications enable row level security;
revoke all on snote_private.vehicle_notifications from public,anon,authenticated;
create index vehicle_notifications_recipient_time on snote_private.vehicle_notifications(recipient_id,created_at desc);
create index vehicle_notifications_unread on snote_private.vehicle_notifications(recipient_id) where read_at is null;
create function snote_private.record_shared_vehicle_change() returns trigger language plpgsql security definer set search_path='' as $$
declare v_old jsonb;v_new jsonb;v_changes jsonb;v_actor uuid:=auth.uid();v_key text;
 v_fields text[]:=array['model','plate','make','year','vin','mileage','color','purchaseAt','buy','sell','status','inventoryLoan','inventoryLender'];
begin
 if new.dataset<>'cars' or v_actor is null or new.updated_by is distinct from v_actor or new.payload is not distinct from old.payload or jsonb_typeof(new.payload)<>'array' or jsonb_typeof(old.payload)<>'array' then return new;end if;
 if not exists(select 1 from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id) then return new;end if;
 for v_new in select c from jsonb_array_elements(new.payload)c where exists(select 1 from snote_private.vehicle_shares s where s.company_id=new.company_id and s.owner_id=new.owner_id and s.car_id=c->>'id') loop
  select c into v_old from jsonb_array_elements(old.payload)c where c->>'id'=v_new->>'id';if v_old is null then continue;end if;
  v_changes:='[]';
  foreach v_key in array v_fields loop
   if v_old->v_key is distinct from v_new->v_key then v_changes:=v_changes||jsonb_build_array(jsonb_build_object('field',v_key,'before',v_old->v_key,'after',v_new->v_key));end if;
  end loop;
  if jsonb_array_length(v_changes)=0 then continue;end if;
  insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit)
  select new.company_id,new.owner_id,v_new->>'id',r.id,v_actor,left(concat_ws(' · ',v_new->>'model',v_new->>'plate'),300),v_changes,coalesce(v_new->>'moneyUnit','legacy') from (
   select new.owner_id id union select recipient_id from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id and car_id=v_new->>'id'
  )r join public.zc_members m on m.user_id=r.id and m.active and m.role in ('dealer','admin') where r.id<>v_actor;
 end loop;return new;
end;$$;
revoke all on function snote_private.record_shared_vehicle_change() from public,anon,authenticated;
create trigger snote_shared_vehicle_change after update on public.zc_datasets for each row execute function snote_private.record_shared_vehicle_change();
create function snote_private.vehicle_notifications(p_action text,p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_items jsonb;v_unread bigint;
begin
 if v_actor is null or not exists(select 1 from public.zc_members where user_id=v_actor and active and role in ('dealer','admin')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action not in ('summary','list','read') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 if p_action='read' then
  if coalesce(cardinality(p_ids),0)>100 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  update snote_private.vehicle_notifications set read_at=coalesce(read_at,now()) where recipient_id=v_actor and id=any(p_ids);
 end if;
 select count(*) into v_unread from snote_private.vehicle_notifications n where n.recipient_id=v_actor and n.read_at is null and n.created_at>=now()-interval '90 days' and (n.owner_id=v_actor or exists(select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=v_actor));
 if p_action='list' then
  select coalesce(jsonb_agg(item order by created_at desc),'[]') into v_items from (
   select n.created_at,jsonb_build_object('id',n.id,'car',n.car_label,'actor',coalesce(m.display_name,'딜러'),'createdAt',n.created_at,'readAt',n.read_at,'changes',n.changes,'moneyUnit',n.money_unit) item from snote_private.vehicle_notifications n left join public.zc_members m on m.user_id=n.actor_id
   where n.recipient_id=v_actor and n.created_at>=now()-interval '90 days' and (n.owner_id=v_actor or exists(select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=v_actor)) order by n.created_at desc limit 100
  )x;
 end if;
 return jsonb_build_object('unread',v_unread,'items',coalesce(v_items,'[]'));
end;$$;
revoke all on function snote_private.vehicle_notifications(text,uuid[]) from public,anon;
grant execute on function snote_private.vehicle_notifications(text,uuid[]) to authenticated;
create function public.snote_vehicle_notifications(p_action text default 'summary',p_ids uuid[] default '{}') returns jsonb language sql security invoker set search_path='' as $$select snote_private.vehicle_notifications(p_action,p_ids);$$;
revoke all on function public.snote_vehicle_notifications(text,uuid[]) from public,anon;
grant execute on function public.snote_vehicle_notifications(text,uuid[]) to authenticated;
notify pgrst,'reload schema';
