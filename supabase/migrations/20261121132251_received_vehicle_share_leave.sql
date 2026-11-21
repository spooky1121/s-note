begin;

-- A recipient may leave only their own accepted invitation. This does not grant
-- permission to edit/delete the vehicle or to revoke another recipient's share.
create or replace function snote_private.vehicle_share_leave(
 p_company uuid,p_owner uuid,p_car text,p_recipient_company uuid,
 p_invitation uuid,p_expected integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_private.share_actor();s snote_private.vehicle_shares;processed boolean:=false;
begin
 if p_company is null or p_owner is null or p_car is null or length(p_car) not between 1 and 200
 or p_recipient_company is null or p_invitation is null or p_expected is null or p_expected<1 or p_expected>=2147483647 then
  raise exception 'INVALID_REQUEST' using errcode='22023';
 end if;
 perform snote_private.recycle_lock(p_company);
 select * into s from snote_private.vehicle_shares
 where invitation_id=p_invitation and recipient_id=a and company_id=p_company
 and owner_id=p_owner and car_id=p_car and recipient_company_id=p_recipient_company for update;
 if not found then raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
 if not snote_private.share_member(a,p_recipient_company) or not snote_private.share_member(p_owner,p_company) then
  raise exception 'FORBIDDEN' using errcode='42501';
 end if;
 if snote_private.share_vehicle_owner(p_company,p_car) is distinct from p_owner then
  raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';
 end if;
 -- Recheck active company membership after the ownership lookup and row lock.
 if snote_private.share_actor() is distinct from a or not snote_private.share_member(a,p_recipient_company)
 or not snote_private.share_member(p_owner,p_company) then raise exception 'FORBIDDEN' using errcode='42501';end if;
 if s.state='rejected' and s.version=p_expected+1 and exists(
  select 1 from public.zc_audit where company_id=p_company and actor_id=a and entity='vehicle_share'
  and item_key=p_car and action='leave:'||s.invitation_id||':'||p_expected
 ) then processed:=true;
 elsif s.state='accepted' and s.version=p_expected then
  update snote_private.vehicle_shares set state='rejected',version=version+1,responded_at=clock_timestamp()
  where invitation_id=s.invitation_id and recipient_id=a returning * into s;
  insert into public.zc_audit(company_id,actor_id,entity,item_key,action)
  values(p_company,a,'vehicle_share',p_car,'leave:'||s.invitation_id||':'||p_expected);
 else raise exception 'SHARE_ACCESS_CHANGED' using errcode='40001';end if;
 return jsonb_build_object('apiVersion',2,'ok',true,'left',true,'companyId',s.company_id,
  'ownerId',s.owner_id,'carId',s.car_id,'recipientCompanyId',s.recipient_company_id,
  'invitationId',s.invitation_id,'version',s.version,'state',s.state,'alreadyProcessed',processed);
end$$;

create or replace function public.snote_vehicle_share_leave(
 p_company uuid,p_owner uuid,p_car text,p_recipient_company uuid,
 p_invitation uuid,p_expected integer
)
returns jsonb language sql security invoker set search_path='' as $$
 select snote_private.vehicle_share_leave(p_company,p_owner,p_car,p_recipient_company,p_invitation,p_expected);
$$;

revoke all on function snote_private.vehicle_share_leave(uuid,uuid,text,uuid,uuid,integer),
 public.snote_vehicle_share_leave(uuid,uuid,text,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function snote_private.vehicle_share_leave(uuid,uuid,text,uuid,uuid,integer),
 public.snote_vehicle_share_leave(uuid,uuid,text,uuid,uuid,integer) to authenticated;
commit;
