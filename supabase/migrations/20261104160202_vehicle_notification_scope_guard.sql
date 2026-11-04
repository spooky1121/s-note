-- Notifications follow the original owner company and active membership.
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
   select n.created_at,jsonb_build_object('id',n.id,'car',n.car_label,'actor',coalesce(m.display_name,'딜러'),'createdAt',n.created_at,'readAt',n.read_at,'changes',n.changes,'moneyUnit',n.money_unit) item from snote_private.vehicle_notifications n left join public.zc_members m on m.user_id=n.actor_id
   where n.recipient_id=v_actor and n.created_at>=now()-interval '90 days' and exists(select 1 from public.zc_members owner_member where owner_member.user_id=n.owner_id and owner_member.company_id=n.company_id and owner_member.active) and (n.owner_id=v_actor or exists(select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=v_actor)) order by n.created_at desc limit 100
  )x;
 end if;
 return jsonb_build_object('unread',v_unread,'items',coalesce(v_items,'[]'));
end;$$;
