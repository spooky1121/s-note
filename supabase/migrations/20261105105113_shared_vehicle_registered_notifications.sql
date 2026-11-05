-- Existing records remain change events; only a newly inserted vehicle grant notifies its receiver.
alter table snote_private.vehicle_notifications add column event_type text not null default 'changed' check(event_type in ('shared','changed'));
create function snote_private.record_shared_vehicle_registration() returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_car jsonb;
begin
 if v_actor is null or new.created_by is distinct from v_actor or new.recipient_id=v_actor then return new;end if;
 if not exists(select 1 from public.zc_members m where m.user_id=new.owner_id and m.company_id=new.company_id and m.active and m.role in ('dealer','admin')) or not exists(select 1 from public.zc_members m where m.user_id=new.recipient_id and m.active and m.role in ('dealer','admin')) then return new;end if;
 select c into v_car from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c where d.company_id=new.company_id and d.owner_id=new.owner_id and d.dataset='cars' and c->>'id'=new.car_id limit 1;
 if v_car is null then return new;end if;
 insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit,event_type)
 values(new.company_id,new.owner_id,new.car_id,new.recipient_id,v_actor,left(concat_ws(' · ',v_car->>'model',v_car->>'plate'),300),'[]'::jsonb,coalesce(v_car->>'moneyUnit','legacy'),'shared');
 return new;
end;$$;
revoke all on function snote_private.record_shared_vehicle_registration() from public,anon,authenticated;
create trigger snote_shared_vehicle_registration after insert on snote_private.vehicle_shares for each row execute function snote_private.record_shared_vehicle_registration();

create or replace function snote_private.vehicle_notifications(p_action text,p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_items jsonb;v_unread bigint;
begin
 if v_actor is null or not exists(select 1 from public.zc_members where user_id=v_actor and active and role in ('dealer','admin')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action not in ('summary','list','read') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 if p_action='read' then
  if coalesce(cardinality(p_ids),0)>100 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  update snote_private.vehicle_notifications set read_at=coalesce(read_at,now()) where recipient_id=v_actor and id=any(p_ids);
 end if;
 select count(*) into v_unread from snote_private.vehicle_notifications n where n.recipient_id=v_actor and n.read_at is null and n.created_at>=now()-interval '90 days' and exists(select 1 from public.zc_members owner_member where owner_member.user_id=n.owner_id and owner_member.company_id=n.company_id and owner_member.active) and (n.owner_id=v_actor or exists(select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=v_actor));
 if p_action='list' then
  select coalesce(jsonb_agg(item order by created_at desc),'[]') into v_items from (
   select n.created_at,jsonb_build_object('id',n.id,'car',n.car_label,'actor',coalesce(m.display_name,'딜러'),'createdAt',n.created_at,'readAt',n.read_at,'changes',n.changes,'moneyUnit',n.money_unit,'eventType',n.event_type) item from snote_private.vehicle_notifications n left join public.zc_members m on m.user_id=n.actor_id
   where n.recipient_id=v_actor and n.created_at>=now()-interval '90 days' and exists(select 1 from public.zc_members owner_member where owner_member.user_id=n.owner_id and owner_member.company_id=n.company_id and owner_member.active) and (n.owner_id=v_actor or exists(select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=v_actor)) order by n.created_at desc limit 100
  )x;
 end if;
 return jsonb_build_object('unread',v_unread,'items',coalesce(v_items,'[]'));
end;$$;

notify pgrst,'reload schema';

-- Badges expose only IDs already visible within the viewer's normal company/owner scope.
create function snote_private.vehicle_share_badges() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();v_member public.zc_members;v_result jsonb;
begin
 select * into v_member from public.zc_members where user_id=v_actor and active and role in ('dealer','admin','accountant');
 if v_actor is null or not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('ownerId',x.owner_id,'carId',x.car_id)),'[]'::jsonb) into v_result from (
  select distinct s.owner_id,s.car_id from snote_private.vehicle_shares s
  join public.zc_members recipient on recipient.user_id=s.recipient_id and recipient.active and recipient.role in ('dealer','admin')
  join public.zc_members owner_member on owner_member.user_id=s.owner_id and owner_member.company_id=s.company_id and owner_member.active
  join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
  where s.company_id=v_member.company_id and (s.owner_id=v_actor or v_member.role in ('admin','accountant')) and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c where c->>'id'=s.car_id)
 )x;return v_result;
end;$$;
revoke all on function snote_private.vehicle_share_badges() from public,anon;
grant execute on function snote_private.vehicle_share_badges() to authenticated;
create function public.snote_vehicle_share_badges() returns jsonb language sql stable security invoker set search_path='' as $$select snote_private.vehicle_share_badges();$$;
revoke all on function public.snote_vehicle_share_badges() from public,anon;
grant execute on function public.snote_vehicle_share_badges() to authenticated;
notify pgrst,'reload schema';
