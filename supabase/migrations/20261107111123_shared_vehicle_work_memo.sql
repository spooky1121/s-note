-- Vehicle work notes stay in the existing cars JSON. Keep the checked sharing
-- RPC and accepted-recipient notification rules; extend only this editable field.
-- Replacing existing functions preserves their owner, ACL and empty search_path.
begin;

create or replace function snote_private.vehicle_share(p_action text,p_company uuid,p_owner uuid,p_car text,p_email text,p_target uuid,p_expected integer,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=snote_private.share_actor();v_member public.zc_members;v_owner boolean;v_target uuid;v_row public.zc_datasets;v_car jsonb;v_result jsonb;v_key text;v_value jsonb;v_safe jsonb;v_patch jsonb;v_share snote_private.vehicle_shares;v_recipient_company uuid;v_memo text;v_memo_units bigint;v_memo_controls boolean;
 v_fields text[]:=array['id','model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','status','inventoryLoan','inventoryLender','costs','repairItems','fuel','transmission','category','moneyUnit','vehicleMemo'];
 v_edit text[]:=array['model','make','year','plate','vin','mileage','color','buy','sell','purchaseAt','vehicleMemo'];
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
 return jsonb_build_object('car',v_safe,'revision',v_row.revision);
end;$$;

CREATE OR REPLACE FUNCTION snote_private.record_shared_vehicle_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_old jsonb;v_new jsonb;v_changes jsonb;v_actor uuid:=auth.uid();v_key text;v_before numeric;v_after numeric;v_factor numeric;
 v_fields text[]:=array['model','plate','make','year','vin','mileage','color','purchaseAt','buy','sell','status','inventoryLoan','inventoryLender','vehicleMemo'];
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

commit;
