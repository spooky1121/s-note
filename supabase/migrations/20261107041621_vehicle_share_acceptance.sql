-- A newly granted vehicle share is an invitation, not data access. Existing
-- grants remain accepted; deleting and re-inviting creates a fresh opaque ID.
begin;
alter table snote_private.vehicle_shares add column if not exists invitation_id uuid not null default gen_random_uuid();
alter table snote_private.vehicle_shares add column if not exists version integer not null default 1 check(version>0);
alter table snote_private.vehicle_shares add column if not exists state text not null default 'accepted' check(state in('pending','accepted','rejected'));
alter table snote_private.vehicle_shares alter column state set default 'pending';
alter table snote_private.vehicle_shares add column if not exists recipient_company_id uuid references public.zc_companies(id) on delete cascade;
alter table snote_private.vehicle_shares add column if not exists responded_at timestamptz;
update snote_private.vehicle_shares s set recipient_company_id=(select m.company_id from public.zc_members m where m.user_id=s.recipient_id order by m.active desc,m.company_id limit 1) where s.recipient_company_id is null;
create unique index if not exists vehicle_shares_invitation_id on snote_private.vehicle_shares(invitation_id);
create index if not exists vehicle_shares_incoming_state on snote_private.vehicle_shares(recipient_id,state,recipient_company_id);
alter table snote_private.vehicle_notifications drop constraint if exists vehicle_notifications_event_type_check;
alter table snote_private.vehicle_notifications add constraint vehicle_notifications_event_type_check check(event_type in('shared','changed','share_invitation'));
alter table snote_private.vehicle_notifications add column if not exists share_invitation_id uuid;

-- Helpers run only inside a checked definer RPC or policy function. The
-- recipient company is captured at invitation time, never supplied on reply.
create or replace function snote_private.share_member(p_user uuid,p_company uuid)
returns boolean language sql stable set search_path='' as $$
 select p_company is not null and exists(select 1 from public.zc_members m join auth.users u on u.id=m.user_id
 where m.user_id=p_user and m.company_id=p_company and m.active and m.role in('dealer','admin')
 and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()));
$$;
create or replace function snote_private.share_actor()
returns uuid language plpgsql stable set search_path='' as $$
declare a uuid:=auth.uid();
begin
 if a is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true'
 or not exists(select 1 from auth.users where id=a and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<=now())) then
  raise exception 'FORBIDDEN' using errcode='42501';end if;
 return a;
end$$;
create or replace function snote_private.share_vehicle_owner(p_company uuid,p_car text)
returns uuid language sql stable set search_path='' as $$
 select case when count(*)=1 then min(d.owner_id::text)::uuid end
 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
 where d.company_id=p_company and d.dataset='cars' and c->>'id'=p_car;
$$;
create or replace function snote_private.vehicle_share(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.share_actor();v_member public.zc_members;v_owner boolean;v_target uuid;v_row public.zc_datasets;v_car jsonb;v_result jsonb;v_key text;v_value jsonb;v_safe jsonb;v_patch jsonb;v_share snote_private.vehicle_shares;v_recipient_company uuid;
 v_fields text[]:=array['id','model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','costs','repairItems','fuel','transmission','category','moneyUnit'];
 v_edit text[]:=array['model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt'];
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 select * into v_member from public.zc_members where user_id=v_actor and active and role in ('dealer','admin');
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action='incoming' then
  select coalesce(jsonb_agg(item order by item->>'sharedAt' desc),'[]') into v_result from (
   select jsonb_build_object('companyId',s.company_id,'ownerId',s.owner_id,'carId',s.car_id,'ownerName',m.display_name,'sharedAt',s.created_at,'state',s.state,'invitationId',s.invitation_id,'version',s.version,'model',c->>'model','plate',c->>'plate') item
   from snote_private.vehicle_shares s join public.zc_members m on m.user_id=s.owner_id and m.company_id=s.company_id and m.active
   join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
   where s.recipient_id=v_actor and s.state='accepted' and snote_private.share_member(s.recipient_id,s.recipient_company_id) and snote_private.share_member(s.owner_id,s.company_id) and snote_private.share_vehicle_owner(s.company_id,s.car_id)=s.owner_id and c->>'id'=s.car_id limit 1000
  )x;return v_result;
 end if;
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_owner:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company and m.active and m.role in('dealer','admin') and (v_actor=p_owner or m.role='admin'));
 perform snote_private.recycle_lock(p_company);
 if not snote_private.share_member(p_owner,p_company) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action in ('grant','revoke','outgoing') and not v_owner then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Serialize a shared edit with the existing owner CAS write, never replace an unrelated car.
 select * into v_row from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if not found or jsonb_typeof(v_row.payload)<>'array' then raise exception 'CAR_NOT_FOUND';end if;
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select c into v_car from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car;
 if v_car is null or (select count(*) from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car)<>1 then raise exception 'CAR_NOT_FOUND';end if;
 if snote_private.share_vehicle_owner(p_company,p_car) is distinct from p_owner then raise exception 'AMBIGUOUS_CAR' using errcode='40001';end if;
 if p_action='grant' then
  if p_email is null or length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL' using errcode='22023';end if;
  select u.id,m.company_id into v_target,v_recipient_company from auth.users u join public.zc_members m on m.user_id=u.id and m.active and m.role in ('dealer','admin') where lower(u.email)=lower(btrim(p_email)) and snote_private.share_member(u.id,m.company_id) order by m.company_id limit 1;
  if v_target is null then raise exception 'DEALER_NOT_FOUND';end if;
  if v_target=p_owner then raise exception 'SELF_SHARE' using errcode='22023';end if;
  if (select count(*) from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car)>=30 and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_target) then raise exception 'SHARE_LIMIT';end if;
  insert into snote_private.vehicle_shares(company_id,owner_id,car_id,recipient_id,created_by,recipient_company_id,state) values(p_company,p_owner,p_car,v_target,v_actor,v_recipient_company,'pending') on conflict do nothing;
  select * into v_share from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_target;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'grant:'||v_target);
  return jsonb_build_object('ok',true,'recipientId',v_target,'invitationId',v_share.invitation_id,'version',v_share.version,'state',v_share.state);
 elsif p_action='revoke' then
  delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=p_target;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'revoke:'||p_target);
  return jsonb_build_object('ok',true);
 elsif p_action='outgoing' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.recipient_id,'email',u.email,'name',m.display_name,'createdAt',s.created_at,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'respondedAt',s.responded_at) order by s.created_at),'[]') into v_result from snote_private.vehicle_shares s join auth.users u on u.id=s.recipient_id left join public.zc_members m on m.user_id=s.recipient_id and m.company_id=s.recipient_company_id where s.company_id=p_company and s.owner_id=p_owner and s.car_id=p_car;return v_result;
 elsif p_action='update' then
  if p_expected is null or v_row.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
  if jsonb_typeof(p_patch)<>'object' or p_patch is null or octet_length(p_patch::text)>10000 then raise exception 'INVALID_PATCH' using errcode='22023';end if;
  for v_key,v_value in select * from jsonb_each(p_patch) loop
   if not(v_key=any(v_edit)) then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
   if v_key in ('buy','sell','mileage') then
    if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric<0 or (v_value#>>'{}')::numeric>900000000000 then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key='mileage' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key in ('buy','sell') and ((v_car->>'moneyUnit'='KRW' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)) or (coalesce(v_car->>'moneyUnit','')<>'KRW' and (v_value#>>'{}')::numeric*10000<>trunc((v_value#>>'{}')::numeric*10000))) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
   elsif jsonb_typeof(v_value)<>'string' or length(v_value#>>'{}')>200 then raise exception 'INVALID_TEXT' using errcode='22023';end if;
  end loop;
  v_car:=v_car||p_patch;
  if octet_length((v_car)::text)>1000000 then raise exception 'INVALID_PATCH';end if;
  update public.zc_datasets set payload=(select jsonb_agg(case when c->>'id'=p_car then v_car else c end order by ord) from jsonb_array_elements(v_row.payload) with ordinality as a(c,ord)),revision=revision+1,updated_at=now(),updated_by=v_actor where company_id=p_company and owner_id=p_owner and dataset='cars' returning * into v_row;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'edit');
 elsif p_action not in ('read','media') then raise exception 'INVALID_ACTION' using errcode='22023';
 end if;
 if p_action='media' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'path',file_path,'group',group_name,'name',original_name)),'[]') into v_result from public.zc_media where company_id=p_company and car_id=p_car and group_name in ('photos','registration','inspection1','inspection2');return v_result;
 end if;
 select coalesce(jsonb_object_agg(key,value),'{}') into v_safe from jsonb_each(v_car) where key=any(v_fields);
 return jsonb_build_object('car',v_safe,'revision',v_row.revision);
end;$$;

create or replace function snote_private.vehicle_share_reply(p_invitation uuid,p_expected integer,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_private.share_actor();s snote_private.vehicle_shares;c uuid;desired text;
begin
 if p_invitation is null or p_expected is null or p_expected<1 or p_accept is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select company_id into c from snote_private.vehicle_shares where invitation_id=p_invitation and recipient_id=a;
 if c is null then raise exception 'INVITATION_CHANGED' using errcode='40001';end if;
 perform snote_private.recycle_lock(c);
 select * into s from snote_private.vehicle_shares where invitation_id=p_invitation and recipient_id=a for update;
 if not found then raise exception 'INVITATION_CHANGED' using errcode='40001';end if;
 if not snote_private.share_member(a,s.recipient_company_id) or not snote_private.share_member(s.owner_id,s.company_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if snote_private.share_vehicle_owner(s.company_id,s.car_id) is distinct from s.owner_id then raise exception 'INVITATION_CHANGED' using errcode='40001';end if;
 desired:=case when p_accept then 'accepted' else 'rejected' end;
 if s.state<>'pending' then
  if s.state=desired and s.version=p_expected+1 then return jsonb_build_object('ok',true,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'alreadyProcessed',true);end if;
  raise exception 'INVITATION_CHANGED' using errcode='40001';
 end if;
 if s.version<>p_expected then raise exception 'INVITATION_CHANGED' using errcode='40001';end if;
 update snote_private.vehicle_shares set state=desired,version=version+1,responded_at=clock_timestamp() where invitation_id=s.invitation_id returning * into s;
 update snote_private.vehicle_notifications set read_at=coalesce(read_at,clock_timestamp()) where recipient_id=a and share_invitation_id=s.invitation_id and event_type='share_invitation';
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(s.company_id,a,'vehicle_share',s.car_id,desired||':'||s.invitation_id);
 return jsonb_build_object('ok',true,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'alreadyProcessed',false);
end$$;
create or replace function public.snote_vehicle_share_reply(p_invitation uuid,p_expected integer,p_accept boolean)
returns jsonb language sql security invoker set search_path='' as $$select snote_private.vehicle_share_reply(p_invitation,p_expected,p_accept)$$;

create or replace function snote_private.shared_vehicle_file(p_path text)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and auth.jwt()->>'role'='authenticated' and coalesce(auth.jwt()->>'is_anonymous','false')<>'true' and exists(
  select 1 from public.zc_media f join snote_private.vehicle_shares s on s.company_id=f.company_id and s.car_id=f.car_id
  join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
  where s.recipient_id=auth.uid() and s.state='accepted' and snote_private.share_member(s.recipient_id,s.recipient_company_id)
  and snote_private.share_member(s.owner_id,s.company_id) and f.file_path=p_path and f.group_name in('photos','registration','inspection1','inspection2')
  and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)x where x->>'id'=s.car_id));
$$;
create or replace function snote_private.vehicle_share_badges()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=snote_private.share_actor();result jsonb;
begin
 if not exists(select 1 from public.zc_members where user_id=a and active and role in('dealer','admin','accountant')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('ownerId',x.owner_id,'carId',x.car_id,'state','accepted')),'[]'::jsonb) into result from(
 select distinct s.owner_id,s.car_id from snote_private.vehicle_shares s
 join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
 where s.state='accepted' and snote_private.share_member(s.owner_id,s.company_id) and snote_private.share_member(s.recipient_id,s.recipient_company_id) and snote_private.share_vehicle_owner(s.company_id,s.car_id)=s.owner_id
 and exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=s.company_id and m.active and (m.user_id=s.owner_id or m.role in('admin','accountant')))
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c where c->>'id'=s.car_id))x;
 return result;
end$$;

create or replace function snote_private.record_shared_vehicle_registration()
returns trigger language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();car jsonb;
begin
 if a is null or new.created_by is distinct from a or new.state<>'pending' then return new;end if;
 if not snote_private.share_member(new.owner_id,new.company_id) or not snote_private.share_member(new.recipient_id,new.recipient_company_id) then return new;end if;
 select c into car from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c where d.company_id=new.company_id and d.owner_id=new.owner_id and d.dataset='cars' and c->>'id'=new.car_id limit 1;
 if car is null then return new;end if;
 insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit,event_type,share_invitation_id)
 values(new.company_id,new.owner_id,new.car_id,new.recipient_id,a,left(concat_ws(' · ',car->>'model',car->>'plate'),300),'[]'::jsonb,'KRW','share_invitation',new.invitation_id);
 return new;
end$$;
CREATE OR REPLACE FUNCTION snote_private.record_shared_vehicle_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old jsonb;v_new jsonb;v_changes jsonb;v_actor uuid:=auth.uid();v_key text;v_before numeric;v_after numeric;v_factor numeric;
 v_fields text[]:=array['model','plate','make','year','vin','mileage','color','purchaseAt','buy','sell','status','inventoryLoan','inventoryLender'];
begin
 if new.dataset<>'cars' or v_actor is null or new.updated_by is distinct from v_actor or new.payload is not distinct from old.payload or jsonb_typeof(new.payload)<>'array' or jsonb_typeof(old.payload)<>'array' then return new;end if;
 if not exists(select 1 from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id and state='accepted') then return new;end if;
 for v_new in select c from jsonb_array_elements(new.payload)c where exists(select 1 from snote_private.vehicle_shares s where s.company_id=new.company_id and s.owner_id=new.owner_id and s.car_id=c->>'id' and s.state='accepted') loop
  select c into v_old from jsonb_array_elements(old.payload)c where c->>'id'=v_new->>'id';if v_old is null then continue;end if;
  v_changes:='[]';
  foreach v_key in array v_fields loop
   if v_old->v_key is distinct from v_new->v_key then v_changes:=v_changes||jsonb_build_array(jsonb_build_object('field',v_key,'before',v_old->v_key,'after',v_new->v_key));end if;
  end loop;

  -- Compare the new optional cost in won; preserve the outgoing notification's unit.
  v_before:=case when jsonb_typeof(v_old#>'{costs,performanceInspection}')='number' then (v_old#>>'{costs,performanceInspection}')::numeric else 0 end;
  v_after:=case when jsonb_typeof(v_new#>'{costs,performanceInspection}')='number' then (v_new#>>'{costs,performanceInspection}')::numeric else 0 end;
  if coalesce(v_old->>'moneyUnit','legacy')<>'KRW' then v_before:=v_before*10000;end if;
  if coalesce(v_new->>'moneyUnit','legacy')<>'KRW' then v_after:=v_after*10000;end if;
  if v_before is distinct from v_after then
   v_factor:=case when v_new->>'moneyUnit'='KRW' then 1 else 10000 end;
   v_changes:=v_changes||jsonb_build_array(jsonb_build_object('field','costs.performanceInspection','before',v_before/v_factor,'after',v_after/v_factor));
  end if;
  if jsonb_array_length(v_changes)=0 then continue;end if;
  insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit,share_invitation_id)
  select new.company_id,new.owner_id,v_new->>'id',r.id,v_actor,left(concat_ws(' · ',v_new->>'model',v_new->>'plate'),300),v_changes,coalesce(v_new->>'moneyUnit','legacy'),r.invitation_id from (
   select new.owner_id id,null::uuid invitation_id union select recipient_id,invitation_id from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id and car_id=v_new->>'id' and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id)
  )r join public.zc_members m on m.user_id=r.id and m.active and m.role in ('dealer','admin') where r.id<>v_actor;
 end loop;return new;
end;$function$
;

create or replace function snote_private.vehicle_notification_visible(n snote_private.vehicle_notifications,p_actor uuid)
returns boolean language sql stable set search_path='' as $$
 select snote_private.share_member(n.owner_id,n.company_id) and (
 (n.owner_id=p_actor and n.event_type<>'share_invitation') or exists(
 select 1 from snote_private.vehicle_shares s where s.company_id=n.company_id and s.owner_id=n.owner_id and s.car_id=n.car_id and s.recipient_id=p_actor
 and snote_private.share_member(s.recipient_id,s.recipient_company_id) and (
  n.event_type='share_invitation' and n.share_invitation_id=s.invitation_id
  or n.event_type in('shared','changed') and s.state='accepted' and (n.share_invitation_id=s.invitation_id or n.share_invitation_id is null and n.created_at>=s.created_at))));
$$;
create or replace function snote_private.vehicle_notifications(p_action text,p_ids uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_private.share_actor();items jsonb;unread bigint;
begin
 if not exists(select 1 from public.zc_members where user_id=a and active and role in('dealer','admin')) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action not in('summary','list','read') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 if p_action='read' then
  if coalesce(cardinality(p_ids),0)>100 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  update snote_private.vehicle_notifications n set read_at=coalesce(read_at,clock_timestamp()) where n.recipient_id=a and n.id=any(p_ids) and snote_private.vehicle_notification_visible(n,a);
 end if;
 select count(*) into unread from snote_private.vehicle_notifications n where n.recipient_id=a and n.read_at is null and n.created_at>=now()-interval '90 days' and snote_private.vehicle_notification_visible(n,a);
 if p_action='list' then
  select coalesce(jsonb_agg(item order by created_at desc,id),'[]') into items from(
  select n.created_at,n.id,jsonb_build_object('id',n.id,'car',n.car_label,'actor',coalesce(m.display_name,'딜러'),'createdAt',n.created_at,'readAt',n.read_at,
   'changes',case when n.event_type='share_invitation' then '[]'::jsonb else n.changes end,'moneyUnit',n.money_unit,'eventType',n.event_type)
   ||case when n.event_type='share_invitation' then jsonb_build_object('invitation',jsonb_build_object('id',s.invitation_id,'version',s.version,'state',s.state,'companyId',s.company_id,'ownerId',s.owner_id,'carId',s.car_id)) else '{}'::jsonb end item
  from snote_private.vehicle_notifications n
  left join lateral(select actor_member.display_name from public.zc_members actor_member where actor_member.user_id=n.actor_id order by actor_member.active desc,(actor_member.company_id=n.company_id) desc,actor_member.company_id limit 1)m on true
  left join snote_private.vehicle_shares s on s.invitation_id=n.share_invitation_id
  where n.recipient_id=a and n.created_at>=now()-interval '90 days' and snote_private.vehicle_notification_visible(n,a)
  order by n.created_at desc,n.id limit 100)x;
 end if;
 return jsonb_build_object('unread',unread,'items',coalesce(items,'[]'));
end$$;

-- Older company-wide permissive file policies must not bypass recipient
-- consent. Normal admins/accountants retain their existing company access;
-- dealers use the canonical vehicle owner, not the document uploader.
create or replace function snote_private.shared_vehicle_scope(p_company uuid,p_car text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid();owners uuid[];
begin
 if a is null or auth.jwt()->>'role' is distinct from 'authenticated' or auth.jwt()->>'is_anonymous'='true'
 or not exists(select 1 from auth.users where id=a and email_confirmed_at is not null and deleted_at is null and (banned_until is null or banned_until<=now())) then return false;end if;
 if exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=p_company and m.active and m.role in('admin','accountant')) then return true;end if;
 select array_agg(d.owner_id) into owners from public.zc_datasets d
 cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
 where d.company_id=p_company and d.dataset='cars' and c->>'id'=p_car;
 if coalesce(cardinality(owners),0)<>1 then return false;end if;
 if owners[1]=a and snote_private.share_member(a,p_company) then return true;end if;
 return exists(select 1 from snote_private.vehicle_shares s where s.company_id=p_company and s.owner_id=owners[1] and s.car_id=p_car
 and s.recipient_id=a and s.state='accepted' and snote_private.share_member(s.owner_id,s.company_id) and snote_private.share_member(s.recipient_id,s.recipient_company_id));
end$$;
create or replace function snote_private.shared_vehicle_object_scope(p_path text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare n integer;allowed boolean;
begin
 select count(*),bool_and(snote_private.shared_vehicle_scope(f.company_id,f.car_id)) into n,allowed
 from public.zc_media f where f.file_path=p_path and f.group_name in('photos','registration','inspection1','inspection2');
 if n>0 then return allowed;end if;
 -- Covers the upload-before-metadata interval, including accountant uploads.
 -- Non-vehicle branding/profile objects continue through their existing RLS.
 select count(*),bool_and(snote_private.shared_vehicle_scope(d.company_id,c->>'id')) into n,allowed
 from public.zc_datasets d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
 where d.dataset='cars' and d.company_id::text=split_part(p_path,'/',1) and snote_private.recycle_uri_component(c->>'id')=split_part(p_path,'/',3);
 return case when n>0 then allowed else true end;
end$$;
drop policy if exists snote_vehicle_share_consent_media on public.zc_media;
create policy snote_vehicle_share_consent_media on public.zc_media as restrictive for select to authenticated
 using(group_name not in('photos','registration','inspection1','inspection2') or snote_private.shared_vehicle_scope(company_id,car_id));
drop policy if exists snote_vehicle_share_consent_objects on storage.objects;
create policy snote_vehicle_share_consent_objects on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'zc-vehicle-private' or snote_private.shared_vehicle_object_scope(name));

revoke all on function snote_private.shared_vehicle_scope(uuid,text),snote_private.shared_vehicle_object_scope(text) from public,anon,authenticated,service_role;
grant execute on function snote_private.shared_vehicle_scope(uuid,text),snote_private.shared_vehicle_object_scope(text) to authenticated;
revoke all on function snote_private.share_member(uuid,uuid),snote_private.share_actor(),snote_private.share_vehicle_owner(uuid,text),snote_private.vehicle_notification_visible(snote_private.vehicle_notifications,uuid) from public,anon,authenticated,service_role;
revoke all on function snote_private.vehicle_share_reply(uuid,integer,boolean),public.snote_vehicle_share_reply(uuid,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function snote_private.vehicle_share_reply(uuid,integer,boolean),public.snote_vehicle_share_reply(uuid,integer,boolean) to authenticated;
-- Existing invoker wrappers, private-table deny policies, exact-company admin
-- scope and the private bucket's ordinary owner/company access remain intact.
notify pgrst,'reload schema';
commit;
