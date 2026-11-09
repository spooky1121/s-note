begin;

-- Vehicle-sharing presets are data privileges, not client-side presentation.
-- Existing grants keep their previous edit capability; new grants default to read.
alter table snote_private.vehicle_shares add column if not exists permission text not null default 'edit';
alter table snote_private.vehicle_shares alter column permission set default 'read';
alter table snote_private.vehicle_shares drop constraint if exists vehicle_shares_permission_check;
alter table snote_private.vehicle_shares add constraint vehicle_shares_permission_check check(permission in('read','edit','delete','all'));

create or replace function snote_private.vehicle_share_assert_access_shape(p_access jsonb)
returns void language plpgsql immutable set search_path='' as $$
begin
 if p_access is null or jsonb_typeof(p_access)<>'object' then raise exception 'SHARE_ACCESS_REQUIRED' using errcode='42501';end if;
 if (select count(*) from jsonb_object_keys(p_access))<>2 or jsonb_typeof(p_access->'invitationId') is distinct from 'string' or jsonb_typeof(p_access->'version') is distinct from 'number'
 or coalesce(p_access->>'invitationId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(p_access->>'version','')!~'^[1-9][0-9]{0,9}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if (p_access->>'version')::numeric>2147483647 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
end$$;

create or replace function snote_private.vehicle_share_access(p_company uuid,p_owner uuid,p_car text)
returns jsonb language plpgsql stable set search_path='' as $$
declare a uuid:=snote_private.share_actor();s snote_private.vehicle_shares;
begin
 if not exists(select 1 from public.zc_members where user_id=a and active and role in('dealer','admin')) or not snote_private.share_member(p_owner,p_company) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if exists(select 1 from public.zc_members where user_id=a and company_id=p_company and active and role in('dealer','admin') and(a=p_owner or role='admin')) then
  return jsonb_build_object('apiVersion',2,'permission','all','canRead',true,'canEdit',true,'canDelete',true,'nativeAccess',true,'invitationId',null,'version',null);
 end if;
 select * into s from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=a and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id);
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return jsonb_build_object('apiVersion',2,'permission',s.permission,'canRead',true,'canEdit',s.permission in('edit','all'),'canDelete',s.permission in('delete','all'),'nativeAccess',false,'invitationId',s.invitation_id,'version',s.version);
end$$;

create or replace function snote_private.vehicle_share_v2(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb,p_permission text,p_access jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.share_actor();v_member public.zc_members;v_owner boolean;v_target uuid;v_row public.zc_datasets;v_car jsonb;v_result jsonb;v_key text;v_value jsonb;v_safe jsonb;v_patch jsonb;v_share snote_private.vehicle_shares;v_recipient_company uuid;v_memo text;v_memo_units bigint;v_memo_controls boolean;v_access jsonb;v_mode text;v_before_mode text;v_request uuid;
 v_fields text[]:=array['id','model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','costs','repairItems','fuel','transmission','category','moneyUnit','vehicleMemo'];
 v_edit text[]:=array['model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','vehicleMemo'];
begin
 if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode='42501';end if;
 if p_action is null or p_action not in('incoming','grant','revoke','outgoing','permissions','update','read','media','delete') then raise exception 'INVALID_ACTION' using errcode='22023';end if;
 select * into v_member from public.zc_members where user_id=v_actor and active and role in ('dealer','admin');
 if not found then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action in('grant','permissions') then
  if p_permission is null or p_permission not in('read','edit','delete','all') then raise exception 'INVALID_PERMISSION' using errcode='22023';end if;
 elsif p_permission is not null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 if p_action='delete' then
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  if (select count(*) from jsonb_object_keys(p_patch))<>1 or jsonb_typeof(p_patch->'requestId') is distinct from 'string' or coalesce(p_patch->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  if p_access is not null then perform snote_private.vehicle_share_assert_access_shape(p_access);end if;
  return snote_private.shared_vehicle_trash(p_company,p_owner,p_car,p_expected,(p_patch->>'requestId')::uuid,(p_access->>'invitationId')::uuid,(p_access->>'version')::integer);
 end if;
 if p_action='incoming' then
  select coalesce(jsonb_agg(item order by item->>'sharedAt' desc),'[]') into v_result from (
   select jsonb_build_object('companyId',s.company_id,'ownerId',s.owner_id,'carId',s.car_id,'ownerName',m.display_name,'sharedAt',s.created_at,'state',s.state,'invitationId',s.invitation_id,'version',s.version,'model',c->>'model','plate',c->>'plate','permission',s.permission,'canRead',true,'canEdit',s.permission in('edit','all'),'canDelete',s.permission in('delete','all'),'nativeAccess',false,'apiVersion',2) item
   from snote_private.vehicle_shares s join public.zc_members m on m.user_id=s.owner_id and m.company_id=s.company_id and m.active
   join public.zc_datasets d on d.company_id=s.company_id and d.owner_id=s.owner_id and d.dataset='cars'
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end)c
   where s.recipient_id=v_actor and s.state='accepted' and snote_private.share_member(s.recipient_id,s.recipient_company_id) and snote_private.share_member(s.owner_id,s.company_id) and snote_private.share_vehicle_owner(s.company_id,s.car_id)=s.owner_id and c->>'id'=s.car_id limit 1000
  )x;return v_result;
 end if;
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 v_owner:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company and m.active and m.role in('dealer','admin') and (v_actor=p_owner or m.role='admin'));
 perform snote_private.recycle_lock(p_company);
 perform snote_private.share_actor();
 select * into v_member from public.zc_members where user_id=v_actor and active and role in('dealer','admin');
 if not found or (select count(*) from public.zc_members where user_id=v_actor and active and role in('dealer','admin'))<>1 or not snote_private.share_member(v_actor,v_member.company_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 v_owner:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company and m.active and m.role in('dealer','admin') and(v_actor=p_owner or m.role='admin'));
 if not snote_private.share_member(p_owner,p_company) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if p_action in ('grant','revoke','outgoing','permissions') and not v_owner then raise exception 'FORBIDDEN' using errcode='42501';end if;
 -- Serialize a shared edit with the existing owner CAS write, never replace an unrelated car.
 select * into v_row from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if not found or jsonb_typeof(v_row.payload)<>'array' then raise exception 'CAR_NOT_FOUND';end if;
 perform snote_private.share_actor();
 select * into v_member from public.zc_members where user_id=v_actor and active and role in('dealer','admin');
 if not found or (select count(*) from public.zc_members where user_id=v_actor and active and role in('dealer','admin'))<>1 or not snote_private.share_member(v_actor,v_member.company_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 v_owner:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company and m.active and m.role in('dealer','admin') and(v_actor=p_owner or m.role='admin'));
 if not v_owner and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor and state='accepted' and snote_private.share_member(recipient_id,recipient_company_id)) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 select c into v_car from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car;
 if v_car is null or (select count(*) from jsonb_array_elements(v_row.payload)c where c->>'id'=p_car)<>1 then raise exception 'CAR_NOT_FOUND';end if;
 if snote_private.share_vehicle_owner(p_company,p_car) is distinct from p_owner then raise exception 'AMBIGUOUS_CAR' using errcode='40001';end if;
 v_access:=snote_private.vehicle_share_access(p_company,p_owner,p_car);
 -- Native membership can change while waiting for locks; never reuse the pre-lock privilege.
 v_owner:=(v_access->>'nativeAccess')::boolean;
 if p_action in('grant','revoke','outgoing','permissions') and not v_owner then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if not v_owner then
  if p_action='update' and p_access is null then raise exception 'SHARE_ACCESS_REQUIRED' using errcode='42501';end if;
  if p_access is not null then perform snote_private.vehicle_share_assert_access_shape(p_access);
   if (p_access->>'invitationId')::uuid is distinct from (v_access->>'invitationId')::uuid or (p_access->>'version')::integer is distinct from (v_access->>'version')::integer then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
  end if;
  if p_action='update' and not(v_access->>'canEdit')::boolean then raise exception 'FORBIDDEN' using errcode='42501';end if;
 end if;
 if p_action='grant' then
  if p_email is null or length(p_email)>254 or p_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_EMAIL' using errcode='22023';end if;
  select u.id,m.company_id into v_target,v_recipient_company from auth.users u join public.zc_members m on m.user_id=u.id and m.active and m.role in ('dealer','admin') where lower(u.email)=lower(btrim(p_email)) and snote_private.share_member(u.id,m.company_id) order by m.company_id limit 1;
  if v_target is null then raise exception 'DEALER_NOT_FOUND';end if;
  if v_target=p_owner then raise exception 'SELF_SHARE' using errcode='22023';end if;
  if (select count(*) from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car)>=30 and not exists(select 1 from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_target) then raise exception 'SHARE_LIMIT';end if;
  insert into snote_private.vehicle_shares(company_id,owner_id,car_id,recipient_id,created_by,recipient_company_id,state,permission) values(p_company,p_owner,p_car,v_target,v_actor,v_recipient_company,'pending',p_permission) on conflict do nothing;
  select * into v_share from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_target;
  if v_share.permission is distinct from p_permission then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'grant:'||v_target);
  return jsonb_build_object('ok',true,'apiVersion',2,'recipientId',v_target,'invitationId',v_share.invitation_id,'version',v_share.version,'state',v_share.state,'permission',v_share.permission);
 elsif p_action='revoke' then
  delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=p_target;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'revoke:'||p_target);
  return jsonb_build_object('ok',true,'apiVersion',2);
 elsif p_action='outgoing' then
  select coalesce(jsonb_agg(jsonb_build_object('id',s.recipient_id,'email',u.email,'name',m.display_name,'createdAt',s.created_at,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'respondedAt',s.responded_at,'permission',s.permission,'canRead',true,'canEdit',s.permission in('edit','all'),'canDelete',s.permission in('delete','all'),'nativeAccess',false,'apiVersion',2) order by s.created_at),'[]') into v_result from snote_private.vehicle_shares s join auth.users u on u.id=s.recipient_id left join public.zc_members m on m.user_id=s.recipient_id and m.company_id=s.recipient_company_id where s.company_id=p_company and s.owner_id=p_owner and s.car_id=p_car;return v_result;
 elsif p_action='permissions' then
  if p_target is null then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
  perform snote_private.vehicle_share_assert_access_shape(p_access);
  select * into v_share from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=p_target for update;
  if not found or v_share.invitation_id is distinct from (p_access->>'invitationId')::uuid or v_share.version is distinct from (p_access->>'version')::integer or (p_expected is not null and p_expected<>v_share.version) then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
  if not snote_private.share_member(v_share.recipient_id,v_share.recipient_company_id) then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if v_share.permission<>p_permission then
   if v_share.version=2147483647 then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
   v_before_mode:=v_share.permission;
   update snote_private.vehicle_shares set permission=p_permission,version=version+1 where invitation_id=v_share.invitation_id returning * into v_share;
   if v_share.state='pending' then
    update snote_private.vehicle_notifications set read_at=null where recipient_id=p_target and share_invitation_id=v_share.invitation_id and event_type='share_invitation';
   elsif v_share.state='accepted' then
    insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit,event_type,share_invitation_id)
    values(p_company,p_owner,p_car,p_target,v_actor,left(concat_ws(' · ',v_car->>'model',v_car->>'plate'),300),jsonb_build_array(jsonb_build_object('field','sharePermission','before',v_before_mode,'after',p_permission)),coalesce(v_car->>'moneyUnit','legacy'),'changed',v_share.invitation_id);
   end if;
   insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'vehicle_share',p_car,'permission:'||p_target||':'||p_permission);
  end if;
  return jsonb_build_object('ok',true,'apiVersion',2,'recipientId',p_target,'invitationId',v_share.invitation_id,'version',v_share.version,'state',v_share.state,'permission',v_share.permission);
 elsif p_action='update' then
  if p_expected is null or v_row.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
  if jsonb_typeof(p_patch)<>'object' or p_patch is null or octet_length(p_patch::text)>10000 then raise exception 'INVALID_PATCH' using errcode='22023';end if;
  for v_key,v_value in select * from jsonb_each(p_patch) loop
   if not(v_key=any(v_edit)) then raise exception 'FIELD_FORBIDDEN' using errcode='42501';end if;
   if v_key in ('buy','sell','mileage') then
    if jsonb_typeof(v_value)<>'number' or (v_value#>>'{}')::numeric<0 or (v_value#>>'{}')::numeric>900000000000 then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key='mileage' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
    if v_key in ('buy','sell') and ((v_car->>'moneyUnit'='KRW' and (v_value#>>'{}')::numeric<>trunc((v_value#>>'{}')::numeric)) or (coalesce(v_car->>'moneyUnit','')<>'KRW' and (v_value#>>'{}')::numeric*10000<>trunc((v_value#>>'{}')::numeric*10000))) then raise exception 'INVALID_NUMBER' using errcode='22023';end if;
   elsif v_key='vehicleMemo' then
    if jsonb_typeof(v_value)<>'string' then raise exception 'INVALID_VEHICLE_MEMO' using errcode='22023';end if;
    -- The browser maxlength counts UTF-16 units. Supplementary characters count
    -- twice here as well; only line-ending normalization changes the text.
    v_memo:=replace(replace(v_value#>>'{}',E'\r\n',E'\n'),E'\r',E'\n');
    select coalesce(sum(case when ascii(ch)>65535 then 2 else 1 end),0),
           coalesce(bool_or(ascii(ch) between 1 and 8 or ascii(ch) in(11,12,127) or ascii(ch) between 14 and 31),false)
      into v_memo_units,v_memo_controls
      from regexp_split_to_table(v_memo,'') as chars(ch) where ch<>'';
    if v_memo_units>2000 or v_memo_controls then raise exception 'INVALID_VEHICLE_MEMO' using errcode='22023';end if;
    p_patch:=jsonb_set(p_patch,array[v_key],to_jsonb(v_memo));
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
 return jsonb_build_object('car',v_safe,'revision',v_row.revision)||v_access;
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
  if s.state=desired and s.version=p_expected+1 then return jsonb_build_object('ok',true,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'alreadyProcessed',true,'permission',s.permission,'apiVersion',2);end if;
  raise exception 'INVITATION_CHANGED' using errcode='40001';
 end if;
 if s.version<>p_expected then raise exception 'INVITATION_CHANGED' using errcode='40001';end if;
 update snote_private.vehicle_shares set state=desired,version=version+1,responded_at=clock_timestamp() where invitation_id=s.invitation_id returning * into s;
 update snote_private.vehicle_notifications set read_at=coalesce(read_at,clock_timestamp()) where recipient_id=a and share_invitation_id=s.invitation_id and event_type='share_invitation';
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(s.company_id,a,'vehicle_share',s.car_id,desired||':'||s.invitation_id);
 return jsonb_build_object('ok',true,'invitationId',s.invitation_id,'version',s.version,'state',s.state,'alreadyProcessed',false,'permission',s.permission,'apiVersion',2);
end$$;

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
   ||case when n.event_type='share_invitation' then jsonb_build_object('invitation',jsonb_build_object('id',s.invitation_id,'version',s.version,'state',s.state,'companyId',s.company_id,'ownerId',s.owner_id,'carId',s.car_id,'permission',s.permission,'apiVersion',2)) else '{}'::jsonb end item
  from snote_private.vehicle_notifications n
  left join lateral(select actor_member.display_name from public.zc_members actor_member where actor_member.user_id=n.actor_id order by actor_member.active desc,(actor_member.company_id=n.company_id) desc,actor_member.company_id limit 1)m on true
  left join snote_private.vehicle_shares s on s.invitation_id=n.share_invitation_id
  where n.recipient_id=a and n.created_at>=now()-interval '90 days' and snote_private.vehicle_notification_visible(n,a)
  order by n.created_at desc,n.id limit 100)x;
 end if;
 return jsonb_build_object('unread',unread,'items',coalesce(items,'[]'));
end$$;

-- The old endpoint cannot bind a recipient mutation to an invitation version.
-- Keep native-owner/admin operations and safe reads, but require v2 for shared edits.
create or replace function snote_private.vehicle_share(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select snote_private.vehicle_share_v2(p_action,p_company,p_owner,p_car,p_email,p_target,p_expected,p_patch,case when p_action='grant' then 'read' else null end,null);
$$;

create or replace function public.snote_vehicle_share_v2(p_action text,p_company uuid default null,p_owner uuid default null,p_car text default null,p_email text default null,p_target uuid default null,p_expected integer default null,p_patch jsonb default null,p_permission text default null,p_access jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$
 select snote_private.vehicle_share_v2(p_action,p_company,p_owner,p_car,p_email,p_target,p_expected,p_patch,p_permission,p_access);
$$;

revoke all on function snote_private.vehicle_share_assert_access_shape(jsonb),snote_private.vehicle_share_access(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function snote_private.vehicle_share_v2(text,uuid,uuid,text,text,uuid,integer,jsonb,text,jsonb),public.snote_vehicle_share_v2(text,uuid,uuid,text,text,uuid,integer,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function snote_private.vehicle_share_v2(text,uuid,uuid,text,text,uuid,integer,jsonb,text,jsonb),public.snote_vehicle_share_v2(text,uuid,uuid,text,text,uuid,integer,jsonb,text,jsonb) to authenticated;
revoke all on function snote_private.vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function snote_private.vehicle_share(text,uuid,uuid,text,text,uuid,integer,jsonb) to authenticated;


-- Recipient deletion stays separate from owner/customer/recycle permissions.
-- Called only by the versioned sharing dispatcher; no client EXECUTE privilege.
create or replace function snote_private.shared_vehicle_trash(
 p_company uuid,p_owner uuid,p_car text,p_expected integer,
 p_request uuid,p_invitation uuid,p_version integer
) returns jsonb language plpgsql security definer set search_path='' as $shared_trash$
declare
 v_actor uuid:=snote_private.share_actor();v_actor_company uuid;v_actor_role text;v_members integer;v_native boolean;
 v_share snote_private.vehicle_shares;v_receipt snote_private.recycle_requests;v_archive snote_private.recycle_bin;
 d public.zc_datasets;cd public.zc_datasets;car jsonb;customers jsonb;rrns jsonb;files jsonb;
 v_id uuid;v_hash text;v_flag text;v_cover boolean;
begin
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200
    or p_expected is null or p_expected<1 or p_request is null
    or (p_invitation is null)<>(p_version is null) or (p_version is not null and p_version<1)
 then raise exception 'INVALID_REQUEST' using errcode='22023';end if;
 select count(*),min(m.company_id::text)::uuid,min(m.role) into v_members,v_actor_company,v_actor_role
 from public.zc_members m where m.user_id=v_actor and m.active and m.role in('dealer','admin')
 and snote_private.share_member(m.user_id,m.company_id);
 if v_members<>1 then raise exception 'FORBIDDEN' using errcode='42501';end if;
 perform snote_private.recycle_lock(p_company);
 -- All scopes are revalidated after waiting for the shared company lock.
 perform snote_private.share_actor();
 if not snote_private.share_member(v_actor,v_actor_company) or not snote_private.share_member(p_owner,p_company)
 then raise exception 'FORBIDDEN' using errcode='42501';end if;
 v_native:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company
  and m.active and m.role in('dealer','admin') and (v_actor=p_owner or m.role='admin'));
 v_hash:=md5(jsonb_build_array('shared-vehicle-trash:v1',v_actor,v_actor_company,v_actor_role,
  p_company,p_owner,p_car,p_expected,p_invitation,p_version)::text);
 -- A confirmed deletion removes the share. Replay is consequently authorized
 -- by this actor's exact, scoped receipt, never by a now-missing share row.
 select * into v_receipt from snote_private.recycle_requests
 where company_id=p_company and actor_id=v_actor and request_id=p_request;
 if found then
  if v_receipt.request_hash is distinct from v_hash or v_receipt.owner_id is distinct from p_owner
     or v_receipt.car_id is distinct from p_car or v_receipt.kind<>'vehicle'
     or jsonb_typeof(v_receipt.entry_ids) is distinct from 'array' or jsonb_array_length(v_receipt.entry_ids)<>1
  then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='22023';end if;
  select * into v_archive from snote_private.recycle_bin where id=(v_receipt.entry_ids->>0)::uuid
   and company_id=p_company and owner_id=p_owner and car_id=p_car and kind='vehicle'
   and deleted_by=v_actor and request_id=p_request and request_hash=v_hash;
  if not found or v_archive.restored_at is not null then raise exception 'CONFLICT' using errcode='40001';end if;
  return jsonb_build_object('ok',true,'carId',p_car,'requestId',p_request,'deleted',true,'alreadyProcessed',true);
 end if;
 if not v_native then
  if p_invitation is null or p_version is null then raise exception 'SHARE_ACCESS_REQUIRED' using errcode='42501';end if;
  select * into v_share from snote_private.vehicle_shares
  where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor;
  if not found or v_share.state is distinct from 'accepted' or not snote_private.share_member(v_actor,v_share.recipient_company_id)
     or v_share.permission is null or v_share.permission not in('delete','all') then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if v_share.invitation_id is distinct from p_invitation or v_share.version is distinct from p_version
  then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
 end if;
 -- Preserve the lock order and atomic archive operations of the live owner
 -- recycle_trash_vehicle implementation. Covers use the locked current row;
 -- a recipient never needs the owner's entire covers dataset or its revision.
 perform 1 from public.snote_customer_intake where company_id=p_company and car_id=p_car order by id for update;
 select * into d from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='cars' for update;
 if not found or jsonb_typeof(d.payload) is distinct from 'array' then raise exception 'CAR_NOT_FOUND';end if;
 if d.revision<>p_expected then raise exception 'CONFLICT' using errcode='40001';end if;
 perform snote_private.share_actor();
 if not snote_private.share_member(v_actor,v_actor_company) or not snote_private.share_member(p_owner,p_company)
 then raise exception 'FORBIDDEN' using errcode='42501';end if;
 v_native:=exists(select 1 from public.zc_members m where m.user_id=v_actor and m.company_id=p_company
  and m.active and m.role in('dealer','admin') and (v_actor=p_owner or m.role='admin'));
 if not v_native then
  select * into v_share from snote_private.vehicle_shares
  where company_id=p_company and owner_id=p_owner and car_id=p_car and recipient_id=v_actor for update;
  if not found or v_share.state is distinct from 'accepted' or not snote_private.share_member(v_actor,v_share.recipient_company_id)
     or v_share.permission is null or v_share.permission not in('delete','all') then raise exception 'FORBIDDEN' using errcode='42501';end if;
  if v_share.invitation_id is distinct from p_invitation or v_share.version is distinct from p_version
  then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
 end if;
 car:=snote_private.recycle_car(p_company,p_owner,p_car,true)->'car';
 select * into cd from public.zc_datasets where company_id=p_company and owner_id=p_owner and dataset='covers' for update;
 if cd.payload is not null and jsonb_typeof(cd.payload)<>'object' then raise exception 'INVALID_COVERS';end if;
 perform 1 from zc_private.rrn_secrets where company_id=p_company and car_id=p_car order by owner_id for update;
 perform 1 from public.zc_customers where company_id=p_company and car_id=p_car order by owner_id for update;
 perform 1 from public.zc_media where company_id=p_company and car_id=p_car and group_name in('photos','registration','inspection1','inspection2') order by owner_id,id for update;
 select coalesce(jsonb_agg(to_jsonb(c) order by owner_id),'[]') into customers from public.zc_customers c where company_id=p_company and car_id=p_car;
 select coalesce(jsonb_agg(to_jsonb(r) order by owner_id),'[]') into rrns from zc_private.rrn_secrets r where company_id=p_company and car_id=p_car;
 select coalesce(jsonb_agg(to_jsonb(f) order by owner_id,id),'[]') into files from public.zc_media f where company_id=p_company and car_id=p_car and group_name in('photos','registration','inspection1','inspection2');
 v_cover:=coalesce(cd.payload?p_car,false);
 insert into snote_private.recycle_bin(company_id,owner_id,car_id,kind,source_id,summary,snapshot,deleted_by,request_id,request_hash)
 values(p_company,p_owner,p_car,'vehicle',p_car,
  jsonb_build_object('label',left(concat_ws(' · ',car->>'model',car->>'plate'),300),'model',left(car->>'model',200),'plate',left(car->>'plate',40)),
  jsonb_build_object('car',car,'coverExists',v_cover,'cover',cd.payload->p_car,'customers',customers,'rrn',rrns,'media',files),
  v_actor,p_request,v_hash) returning id into v_id;
 insert into snote_private.recycle_files(entry_id,company_id,file_path) select v_id,p_company,value->>'file_path' from jsonb_array_elements(files);
 v_flag:=current_setting('snote.recycle_internal',true);perform set_config('snote.recycle_internal','1',true);
 update public.snote_customer_intake set revoked_at=coalesce(revoked_at,clock_timestamp()) where company_id=p_company and car_id=p_car;
 delete from snote_private.vehicle_shares where company_id=p_company and owner_id=p_owner and car_id=p_car;
 delete from public.zc_media where company_id=p_company and car_id=p_car and group_name in('photos','registration','inspection1','inspection2');
 delete from public.zc_customers where company_id=p_company and car_id=p_car;
 delete from zc_private.rrn_secrets where company_id=p_company and car_id=p_car;
 update public.zc_datasets set payload=(select coalesce(jsonb_agg(c order by ord),'[]') from jsonb_array_elements(d.payload) with ordinality a(c,ord) where c->>'id'<>p_car),
  revision=revision+1,updated_by=v_actor,updated_at=clock_timestamp()
 where company_id=p_company and owner_id=p_owner and dataset='cars';
 if v_cover then update public.zc_datasets set payload=payload-p_car,revision=revision+1,updated_by=v_actor,updated_at=clock_timestamp()
  where company_id=p_company and owner_id=p_owner and dataset='covers';end if;
 insert into public.zc_audit(company_id,actor_id,entity,item_key,action) values(p_company,v_actor,'recycle',v_id::text,'trash_vehicle');
 perform snote_private.recycle_receipt(p_company,p_owner,p_car,'vehicle',p_request,v_hash,jsonb_build_array(v_id));
 perform set_config('snote.recycle_internal',coalesce(v_flag,''),true);
 return jsonb_build_object('ok',true,'carId',p_car,'requestId',p_request,'deleted',true,'alreadyProcessed',false);
end;
$shared_trash$;
revoke all on function snote_private.shared_vehicle_trash(uuid,uuid,text,integer,uuid,uuid,integer) from public,anon,authenticated,service_role;


notify pgrst,'reload schema';
commit;
