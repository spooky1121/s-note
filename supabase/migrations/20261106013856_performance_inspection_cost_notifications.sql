-- Vehicle costs remain in zc_datasets.payload JSONB; no existing car is rewritten.
-- Extend only the existing shared-change trigger, retaining its access checks and ACL.
do $guard$ begin
 if to_regprocedure('snote_private.record_shared_vehicle_change()') is null then raise exception 'Shared vehicle notification baseline is required';end if;
end $guard$;

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
 if not exists(select 1 from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id) then return new;end if;
 for v_new in select c from jsonb_array_elements(new.payload)c where exists(select 1 from snote_private.vehicle_shares s where s.company_id=new.company_id and s.owner_id=new.owner_id and s.car_id=c->>'id') loop
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
  insert into snote_private.vehicle_notifications(company_id,owner_id,car_id,recipient_id,actor_id,car_label,changes,money_unit)
  select new.company_id,new.owner_id,v_new->>'id',r.id,v_actor,left(concat_ws(' · ',v_new->>'model',v_new->>'plate'),300),v_changes,coalesce(v_new->>'moneyUnit','legacy') from (
   select new.owner_id id union select recipient_id from snote_private.vehicle_shares where company_id=new.company_id and owner_id=new.owner_id and car_id=v_new->>'id'
  )r join public.zc_members m on m.user_id=r.id and m.active and m.role in ('dealer','admin') where r.id<>v_actor;
 end loop;return new;
end;$function$
;
