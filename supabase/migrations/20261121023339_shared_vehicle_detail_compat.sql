begin;

-- Shared detail read compatibility; keeps existing authentication, grants,
-- accepted-share permissions, edit allowlist, CAS, and private-data boundaries.
create or replace function snote_private.vehicle_share_v2(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb,p_permission text,p_access jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.share_actor();v_member public.zc_members;v_owner boolean;v_target uuid;v_row public.zc_datasets;v_car jsonb;v_result jsonb;v_key text;v_value jsonb;v_safe jsonb;v_patch jsonb;v_share snote_private.vehicle_shares;v_recipient_company uuid;v_memo text;v_memo_units bigint;v_memo_controls boolean;v_access jsonb;v_mode text;v_before_mode text;v_request uuid;v_odometer text;v_distance numeric;
 v_fields text[]:=array['id','model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','costs','customCosts','customCostLabels','repairItems','fuel','transmission','category','moneyUnit','vehicleMemo'];
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
  -- The external edit allowlist remains mileage-only. Owner forms store km;
  -- synchronize its alias only after every caller-supplied field is validated.
  if p_patch ? 'mileage' then p_patch:=jsonb_set(p_patch,array['km'],p_patch->'mileage');end if;
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
 -- Only bounded basic vehicle labels are added to the existing redacted view.
 -- Never project arbitrary owner/customer/financial objects into a shared car.
 for v_key,v_value in select key,value from jsonb_each(v_car) where key in('group','generation','grade','subgrade','extra') loop
  if jsonb_typeof(v_value)='string' and length(v_value#>>'{}')<=200 then
   v_safe:=jsonb_set(v_safe,array[v_key],v_value);
  end if;
 end loop;
 -- Owner data uses km (including comma-formatted strings); older cars use
 -- mileage. Canonicalize the response only, without touching data or revision.
 v_safe:=v_safe-'km'-'mileage';
 foreach v_key in array array['km','mileage'] loop
  v_value:=v_car->v_key;
  v_odometer:=btrim(v_value#>>'{}');
  if jsonb_typeof(v_value) in('number','string') and length(v_odometer) between 1 and 32 then
   if (jsonb_typeof(v_value)='number' and v_odometer~'^[0-9]+([.]0+)?$')
      or (jsonb_typeof(v_value)='string' and (v_odometer~'^[0-9]+$' or v_odometer~'^[0-9]{1,3}(,[0-9]{3})+$')) then
    v_distance:=replace(v_odometer,',','')::numeric;
    if v_distance>=0 and v_distance<=900000000000 and v_distance=trunc(v_distance) then
     v_safe:=v_safe||jsonb_build_object('km',v_distance,'mileage',v_distance);
     exit;
    end if;
   end if;
  end if;
 end loop;
 return jsonb_build_object('car',v_safe,'revision',v_row.revision)||v_access;
end;$$;

commit;
