-- Synthetic fixtures only. Nothing in this transaction is retained.
begin;
do $fixtures$
begin
 if exists(select 1 from auth.users where id::text like '886533aa-%')
    or exists(select 1 from public.zc_companies where id in('886533aa-0000-4000-8000-000000000010','886533aa-0000-4000-8000-000000000020')) then
   raise exception 'Company purchase fixture id collision';
 end if;
 insert into auth.users(id,email,aud,role,raw_user_meta_data) values
 ('886533aa-0000-4000-8000-000000000001','company-purchase-admin@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000002','company-purchase-dealer@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000003','company-purchase-accountant@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000004','company-purchase-inactive@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000005','company-purchase-moved@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000006','company-purchase-former@db-check.invalid','authenticated','authenticated','{}'),
 ('886533aa-0000-4000-8000-000000000007','company-purchase-foreign-admin@db-check.invalid','authenticated','authenticated','{}');
 insert into public.zc_companies(id,name) values
 ('886533aa-0000-4000-8000-000000000010','Synthetic company purchase A'),
 ('886533aa-0000-4000-8000-000000000020','Synthetic company purchase B');
 insert into public.zc_members(user_id,company_id,role,display_name,active) values
 ('886533aa-0000-4000-8000-000000000001','886533aa-0000-4000-8000-000000000010','admin','Synthetic admin',true),
 ('886533aa-0000-4000-8000-000000000002','886533aa-0000-4000-8000-000000000010','dealer','Synthetic dealer',true),
 ('886533aa-0000-4000-8000-000000000003','886533aa-0000-4000-8000-000000000010','accountant','Synthetic accountant',true),
 ('886533aa-0000-4000-8000-000000000004','886533aa-0000-4000-8000-000000000010','dealer','Synthetic inactive',false),
 ('886533aa-0000-4000-8000-000000000005','886533aa-0000-4000-8000-000000000020','dealer','FOREIGN_MEMBER_NAME',true),
 ('886533aa-0000-4000-8000-000000000007','886533aa-0000-4000-8000-000000000020','admin','Foreign admin',true);
 insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision) values
 ('886533aa-0000-4000-8000-000000000010','cars','886533aa-0000-4000-8000-000000000001','[{"id":"synthetic-own","ownerId":"UNTRUSTED_PAYLOAD_OWNER","model":"Synthetic own car"}]',7),
 ('886533aa-0000-4000-8000-000000000010','cars','886533aa-0000-4000-8000-000000000002','[{"id":"synthetic-dealer","model":"Synthetic dealer car"}]',8),
 ('886533aa-0000-4000-8000-000000000010','cars','886533aa-0000-4000-8000-000000000004','[{"id":"synthetic-inactive","model":"Synthetic inactive car"}]',9),
 ('886533aa-0000-4000-8000-000000000010','cars','886533aa-0000-4000-8000-000000000005','[{"id":"synthetic-moved","model":"Synthetic moved car"}]',10),
 ('886533aa-0000-4000-8000-000000000010','cars','886533aa-0000-4000-8000-000000000006','[{"id":"synthetic-former","model":"Synthetic former car"}]',11),
 ('886533aa-0000-4000-8000-000000000010','covers','886533aa-0000-4000-8000-000000000004','{}',3),
 ('886533aa-0000-4000-8000-000000000010','finance_limits','00000000-0000-0000-0000-000000000000','["PRIVATE_FINANCE"]',2),
 ('886533aa-0000-4000-8000-000000000020','cars','886533aa-0000-4000-8000-000000000007','[{"id":"FOREIGN_CAR","model":"Foreign car"}]',6);
end $fixtures$;
set local role authenticated;
do $checks$
declare v jsonb;target uuid;actor uuid;
begin
 perform set_config('request.jwt.claim.sub','886533aa-0000-4000-8000-000000000001',true);
 perform set_config('request.jwt.claims','{"sub":"886533aa-0000-4000-8000-000000000001","role":"authenticated"}',true);
 v:=public.snote_company_purchase_rows('886533aa-0000-4000-8000-000000000010');
 if jsonb_array_length(v->'datasets')<>6 or jsonb_array_length(v->'owners')<>5 then raise exception 'Inactive or former company datasets omitted';end if;
 if v::text like '%FOREIGN_CAR%' or v::text like '%PRIVATE_FINANCE%' or v::text like '%FOREIGN_MEMBER_NAME%' then raise exception 'Foreign company or non-vehicle fields leaked';end if;
 if not exists(select 1 from jsonb_array_elements(v->'datasets') x where x->>'ownerId'='886533aa-0000-4000-8000-000000000005' and x->>'revision'='10') then raise exception 'Canonical moved-owner row missing';end if;
 if not exists(select 1 from jsonb_array_elements(v->'owners') x where x->>'id'='886533aa-0000-4000-8000-000000000004' and x->>'active'='false' and x->>'memberExists'='true') then raise exception 'Inactive owner status missing';end if;
 if not exists(select 1 from jsonb_array_elements(v->'owners') x where x->>'id'='886533aa-0000-4000-8000-000000000005' and x->>'name'='이전 직원' and x->>'memberExists'='false') then raise exception 'Moved owner name crossed companies';end if;
 begin perform public.snote_company_purchase_rows('886533aa-0000-4000-8000-000000000020');raise exception 'Foreign company accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"sub":"886533aa-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}',true);
 begin perform public.snote_company_purchase_rows('886533aa-0000-4000-8000-000000000010');raise exception 'Anonymous admin claim accepted';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims','{"sub":"886533aa-0000-4000-8000-000000000001","role":"anon"}',true);
 begin perform public.snote_company_purchase_rows('886533aa-0000-4000-8000-000000000010');raise exception 'Anon claim accepted';exception when insufficient_privilege then null;end;
 foreach actor in array array['886533aa-0000-4000-8000-000000000002'::uuid,'886533aa-0000-4000-8000-000000000003'::uuid,'886533aa-0000-4000-8000-000000000004'::uuid,'886533aa-0000-4000-8000-000000000005'::uuid,'886533aa-0000-4000-8000-000000000007'::uuid] loop
   perform set_config('request.jwt.claim.sub',actor::text,true);
   perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
   begin perform public.snote_company_purchase_rows('886533aa-0000-4000-8000-000000000010');raise exception 'Unauthorized actor accepted';exception when insufficient_privilege then null;end;
 end loop;
 perform set_config('request.jwt.claim.sub','886533aa-0000-4000-8000-000000000003',true);
 perform set_config('request.jwt.claims','{"sub":"886533aa-0000-4000-8000-000000000003","role":"authenticated"}',true);
 if(select count(*) from public.zc_datasets where company_id='886533aa-0000-4000-8000-000000000010' and dataset in('cars','covers'))<>6 then raise exception 'Existing accountant finance read scope changed';end if;
 if has_function_privilege('anon','public.snote_company_purchase_rows(uuid)','execute') or not has_function_privilege('authenticated','public.snote_company_purchase_rows(uuid)','execute') then raise exception 'Function ACL mismatch';end if;
 if(select prosecdef from pg_proc where oid='public.snote_company_purchase_rows(uuid)'::regprocedure) then raise exception 'Function bypasses RLS';end if;
end $checks$;
reset role;
rollback;
select 'company_purchase_rollback_checks_passed' as status;
