-- Additive, lazy vehicle workspace: existing cars/customers/media are never rewritten.
-- Money facts and workflow state stay independent of the legacy sold flag.
begin;

create schema if not exists snote_business_private;
revoke all on schema snote_business_private from public,anon,authenticated,service_role;
grant usage on schema snote_business_private to authenticated;

create table if not exists snote_business_private.vehicles(
 company_id uuid not null references public.zc_companies(id),owner_id uuid not null,car_id text not null,
 vehicle_entity_id uuid not null default gen_random_uuid(),current_cycle_id uuid,
 revision bigint not null default 0 check(revision between 0 and 9007199254740990),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 primary key(company_id,owner_id,car_id),unique(vehicle_entity_id),
 check(owner_id<>'00000000-0000-0000-0000-000000000000'::uuid and length(car_id) between 1 and 200 and btrim(car_id)=car_id and car_id!~'[[:cntrl:]]')
);
create table if not exists snote_business_private.cycles(
 id uuid primary key,company_id uuid not null,owner_id uuid not null,car_id text not null,sequence integer not null check(sequence>0),
 status text not null check(status in('open','cancelled','closed')),details jsonb not null,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,owner_id,car_id)references snote_business_private.vehicles(company_id,owner_id,car_id),
 unique(company_id,owner_id,car_id,sequence),unique(company_id,owner_id,car_id,id)
);
create unique index if not exists business_one_open_cycle on snote_business_private.cycles(company_id,owner_id,car_id)where status='open';
create table if not exists snote_business_private.entries(
 id uuid primary key,company_id uuid not null,owner_id uuid not null,car_id text not null,cycle_id uuid not null,
 kind text not null check(kind in('cash','loan','loan_event','cost','document','transfer','task','lead','appraisal','advertising')),
 status text not null,amount_won bigint,effective_date date,due_date date,details jsonb not null,
 reversed_at timestamptz,reversal_date date,reversal_reason text,reversed_by uuid,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,owner_id,car_id,cycle_id)references snote_business_private.cycles(company_id,owner_id,car_id,id),
 unique(company_id,owner_id,car_id,id),
 check(amount_won between 0 and 1000000000000 or(kind='cost'and amount_won between -1000000000000 and -1 and details->>'refundOf'is not null)),
 check((status='reversed')=(reversed_at is not null)),check((reversed_at is null)=(reversal_date is null)),check((reversed_at is null)=(reversal_reason is null))
);
create index if not exists business_entries_scope_due on snote_business_private.entries(company_id,owner_id,due_date,status);
create index if not exists business_entries_cycle on snote_business_private.entries(cycle_id,kind,status,effective_date);
do $$begin if not exists(select 1 from pg_constraint where conrelid='snote_business_private.vehicles'::regclass and conname='business_current_cycle_scope')then
 alter table snote_business_private.vehicles add constraint business_current_cycle_scope foreign key(company_id,owner_id,car_id,current_cycle_id)references snote_business_private.cycles(company_id,owner_id,car_id,id);end if;end$$;
create table if not exists snote_business_private.audit(
 id bigint generated always as identity primary key,company_id uuid not null,owner_id uuid not null,car_id text not null,
 actor_id uuid not null,request_id uuid not null,operation text not null,entity_id uuid,
 customer_private boolean not null default false,changes jsonb not null,created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,owner_id,car_id)references snote_business_private.vehicles(company_id,owner_id,car_id)
);
create index if not exists business_audit_scope on snote_business_private.audit(company_id,owner_id,car_id,id desc);
create table if not exists snote_business_private.requests(
 actor_id uuid not null,request_id uuid not null,company_id uuid not null,fingerprint text not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,request_id)
);
create table if not exists snote_business_private.preferences(
 company_id uuid not null references public.zc_companies(id),user_id uuid not null,revision bigint not null check(revision between 1 and 9007199254740990),
 payload jsonb not null,updated_at timestamptz not null default clock_timestamp(),primary key(company_id,user_id)
);
create table if not exists snote_business_private.evidence(
 id uuid primary key,company_id uuid not null,owner_id uuid not null,car_id text not null,cycle_id uuid not null,entry_id uuid not null,
 actor_id uuid not null,path text not null unique,mime text not null check(mime in('image/png','image/jpeg','image/webp','application/pdf')),
 file_size bigint not null check(file_size between 1 and 10485760),original_name text not null check(length(original_name)between 1 and 200),
 state text not null default'pending'check(state in('pending','ready')),created_at timestamptz not null default clock_timestamp(),completed_at timestamptz,
 foreign key(company_id,owner_id,car_id,entry_id)references snote_business_private.entries(company_id,owner_id,car_id,id),
 foreign key(company_id,owner_id,car_id,cycle_id)references snote_business_private.cycles(company_id,owner_id,car_id,id),check((state='ready')=(completed_at is not null))
);
create index if not exists business_evidence_entry on snote_business_private.evidence(company_id,owner_id,car_id,entry_id,state);
alter table snote_business_private.vehicles enable row level security;
alter table snote_business_private.cycles enable row level security;
alter table snote_business_private.entries enable row level security;
alter table snote_business_private.audit enable row level security;
alter table snote_business_private.requests enable row level security;
alter table snote_business_private.preferences enable row level security;
alter table snote_business_private.evidence enable row level security;
revoke all on all tables in schema snote_business_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema snote_business_private from public,anon,authenticated,service_role;

create or replace function snote_business_private.actor(p_company uuid)
returns uuid language plpgsql stable set search_path='' as $$
declare a uuid:=snote_private.share_actor();
begin
 if p_company is null or not exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=p_company and m.active and m.role in('admin','accountant','dealer'))then
  raise exception 'BUSINESS_FORBIDDEN' using errcode='42501';end if;
 return a;
end$$;

create or replace function snote_business_private.assert_vehicle(p_company uuid,p_owner uuid,p_car text)
returns uuid language plpgsql volatile set search_path='' as $$
declare a uuid:=snote_business_private.actor(p_company);
begin
 if p_owner is null or p_owner='00000000-0000-0000-0000-000000000000'::uuid or p_car is null or length(p_car)not between 1 and 200 or btrim(p_car)<>p_car or p_car~'[[:cntrl:]]'then raise exception 'BUSINESS_INVALID_VEHICLE'using errcode='22023';end if;
 if not exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=p_company and m.active and(m.role in('admin','accountant')or(m.role='dealer'and a=p_owner)))then raise exception 'BUSINESS_FORBIDDEN'using errcode='42501';end if;
 perform snote_private.recycle_lock(p_company);
 a:=snote_business_private.actor(p_company);
 if not exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=p_company and m.active and(m.role in('admin','accountant')or(m.role='dealer'and a=p_owner)))then raise exception 'BUSINESS_FORBIDDEN'using errcode='42501';end if;
 if snote_private.share_vehicle_owner(p_company,p_car)is distinct from p_owner then raise exception 'BUSINESS_VEHICLE_NOT_FOUND'using errcode='22023';end if;
 return a;
end$$;

create or replace function snote_business_private.exact_keys(p_value jsonb,p_allowed text[])
returns boolean language sql immutable set search_path='' as $$
 select p_value is not null and jsonb_typeof(p_value)='object'and not exists(select 1 from jsonb_object_keys(p_value)k where not(k=any(p_allowed)));
$$;

create or replace function snote_business_private.valid_date(p_value text)
returns boolean language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if p_value is null then return true;end if;
 if p_value!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then return false;end if;
 begin d:=p_value::date;exception when others then return false;end;
 return d between date'1900-01-01'and date'9999-12-31'and to_char(d,'YYYY-MM-DD')=p_value;
end$$;

create or replace function snote_business_private.is_customer_entry(p_kind text,p_details jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_kind='lead'or(p_kind='task'and p_details->>'category'in('contact','visit','contract','delivery')),false);
$$;

create or replace function snote_business_private.valid_details(p_kind text,p_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare allowed text[];key text;value jsonb;txt text;item jsonb;
begin
 allowed:=case p_kind
 when'cycle'then array['tradeType','purchaseSource','purchaseAmountWon','purchaseDate','expectedSaleWon','saleAmountWon','saleDate','contractDate','deliveryDate','legacyCostsWon','legacyCosts','legacyInterestWon','sourceSignature','costsConfirmed','settlementStatus','ownershipPercent','commissionWon','counterpartySettlementWon','notes']
 when'cash'then array['direction','purpose','referenceId','reversalOf','notes']
 when'cost'then array['category','label','sourceCostKey','refundOf','evidenceMediaId','evidenceUrl','notes']
 when'loan'then array['lender','annualRate','startDate','maturityDate','notes']
 when'loan_event'then array['loanId','eventType','annualRate','periodStart','periodEnd','notes']
 when'document'then array['documentType','label','assigneeId','evidenceMediaId','evidenceUrl','notes']
 when'transfer'then array['agency','assigneeId','evidenceMediaId','evidenceUrl','notes','receivedDate','completedDate']
 when'task'then array['category','title','assigneeId','leadId','costId','notes','mileage','handoverItems']
 when'lead'then array['name','phone','source','budgetWon','requirements','tradeIn','nextAction','assigneeId','lostReason','existingCustomerKey']
 when'appraisal'then array['saleEstimateWon','estimatedCostsWon','targetProfitWon','reserveWon','holdingDays','comparisonUrls','checkedDate','conditionNotes','resultNotes','evidenceMediaId']
 when'advertising'then array['channel','url','receivedDate','trackingSince','assigneeId','notes','priceHistory','priceChangedDate']else null end;
 if allowed is null or not coalesce(snote_business_private.exact_keys(p_value,allowed),false)or octet_length(p_value::text)>24000 then return false;end if;
 for key,value in select * from jsonb_each(p_value)loop
  if jsonb_typeof(value)='null'then continue;end if;
  txt:=value#>>'{}';
  if key in('costsConfirmed','tradeIn')then if jsonb_typeof(value)<>'boolean'then return false;end if;
  elsif key in('purchaseAmountWon','expectedSaleWon','saleAmountWon','legacyCostsWon','legacyInterestWon','commissionWon','counterpartySettlementWon','budgetWon','saleEstimateWon','estimatedCostsWon','targetProfitWon','reserveWon','mileage','holdingDays','annualRate','ownershipPercent')then
   if jsonb_typeof(value)<>'number'or txt::numeric<0 or txt::numeric>1000000000000 then return false;end if;
   if key in('annualRate','ownershipPercent')then if txt::numeric>100 or txt::numeric*10000<>trunc(txt::numeric*10000)then return false;end if;
   elsif txt::numeric<>trunc(txt::numeric)then return false;end if;
   if key='holdingDays'and txt::numeric>36500 then return false;end if;
  elsif key in('purchaseDate','saleDate','contractDate','deliveryDate','startDate','maturityDate','receivedDate','completedDate','checkedDate','trackingSince','priceChangedDate','periodStart','periodEnd')then
   if jsonb_typeof(value)<>'string'or not snote_business_private.valid_date(txt)then return false;end if;
  elsif key='legacyCosts'then
   if jsonb_typeof(value)<>'object'or(select count(*)from jsonb_object_keys(value))>160 then return false;end if;
   for item in select jsonb_build_object('key',k,'value',v)from jsonb_each(value)as e(k,v)loop
    if item->>'key'!~*'^([A-Za-z][A-Za-z0-9_]{0,79}|custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'then return false;end if;
    if jsonb_typeof(item->'value')<>'null'and(jsonb_typeof(item->'value')<>'number'or(item->>'value')::numeric not between 0 and 1000000000000 or(item->>'value')::numeric<>trunc((item->>'value')::numeric))then return false;end if;
   end loop;
  elsif key='comparisonUrls'then
   if jsonb_typeof(value)<>'array'or jsonb_array_length(value)>20 then return false;end if;
   for item in select * from jsonb_array_elements(value)loop if jsonb_typeof(item)<>'string'or length(item#>>'{}')>2048 or(item#>>'{}')!~'^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'then return false;end if;end loop;
  elsif key='priceHistory'then
   if jsonb_typeof(value)<>'array'or jsonb_array_length(value)>100 then return false;end if;
   for item in select * from jsonb_array_elements(value)loop
    if not coalesce(snote_business_private.exact_keys(item,array['date','amountWon']),false)or(select count(*)from jsonb_object_keys(item))<>2 or jsonb_typeof(item->'date')<>'string'or not snote_business_private.valid_date(item->>'date')or jsonb_typeof(item->'amountWon')<>'number'or(item->>'amountWon')::numeric not between 0 and 1000000000000 or(item->>'amountWon')::numeric<>trunc((item->>'amountWon')::numeric)then return false;end if;
   end loop;
  elsif key in('assigneeId','loanId','leadId','costId','refundOf','referenceId','reversalOf')then
   if jsonb_typeof(value)<>'string'or(txt!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'and not(key='refundOf'and txt~*'^legacy:([A-Za-z][A-Za-z0-9_]{0,79}|custom-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'))then return false;end if;
  else
   if jsonb_typeof(value)<>'string'or length(txt)>(case when key in('notes','requirements','conditionNotes','resultNotes','handoverItems')then 2000 when key in('evidenceUrl','url')then 2048 when key='sourceSignature'then 512 when key='phone'then 30 else 200 end) or txt~'[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'then return false;end if;
   if key in('evidenceUrl','url')and txt!~'^https?://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'then return false;end if;
  end if;
 end loop;
 case p_kind
 when'cycle'then return coalesce(p_value->>'tradeType'in('direct','joint','consignment','brokerage')and jsonb_typeof(p_value->'costsConfirmed')='boolean'and p_value->>'settlementStatus'in('pending','provisional','final'),false);
 when'cash'then return coalesce(p_value->>'direction'in('in','out')and p_value->>'purpose'in('sale','purchase','cost','cost_refund','purchase_refund','loan_draw','loan_repayment','loan_interest','transfer_deposit','transfer_refund','sale_refund','other'),false);
 when'loan'then return coalesce(length(btrim(p_value->>'lender'))between 1 and 100,false);
 when'loan_event'then return coalesce(p_value->>'eventType'in('draw','repay','rate','interest_invoice','fee')and p_value->>'loanId'is not null,false);
 when'cost'then return coalesce(length(btrim(p_value->>'category'))between 1 and 80 and length(btrim(p_value->>'label'))between 1 and 200,false);
 when'document'then return coalesce(p_value->>'documentType'in('registration','inspection','contract','receipt','title','insurance_history','physical_inspection','other')and length(btrim(p_value->>'label'))between 1 and 200,false);
 when'task'then return coalesce(p_value->>'category'in('contact','visit','contract','delivery','preparation','price_review','aftercare','verification','other')and length(btrim(p_value->>'title'))between 1 and 200,false);
 when'lead'then return coalesce(jsonb_typeof(p_value->'tradeIn')='boolean',false);
 when'advertising'then return coalesce(length(btrim(p_value->>'channel'))between 1 and 100,false);
 else return true;end case;
end$$;

create or replace function snote_business_private.valid_status(p_kind text,p_status text)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(case p_kind when'cash'then p_status in('planned','confirmed')when'cost'then p_status in('estimated','incurred','unconfirmed')when'loan'then p_status in('active','unconfirmed')when'loan_event'then p_status in('planned','confirmed')when'document'then p_status in('missing','received','verified','needs_action','done')when'transfer'then p_status in('not_sent','sent','received','needs_action','done')when'task'then p_status in('todo','doing','blocked','done','cancelled')when'lead'then p_status in('inquiry','visit_booked','visited','contract','delivered','on_hold','lost')when'appraisal'then p_status in('draft','reviewed','bid','won','lost','cancelled')when'advertising'then p_status in('draft','live','ended','end_unconfirmed')else false end,false);
$$;

create or replace function snote_business_private.entry_json(e snote_business_private.entries)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',e.id,'cycleId',e.cycle_id,'kind',e.kind,'status',e.status,'amountWon',e.amount_won,'effectiveDate',e.effective_date,'dueDate',e.due_date,'details',e.details||case when e.reversed_at is null then'{}'::jsonb else jsonb_build_object('reversalDate',e.reversal_date,'reversalReason',e.reversal_reason,'reversedBy',e.reversed_by,'reversedAt',e.reversed_at)end,'createdAt',e.created_at,'updatedAt',e.updated_at);
$$;

create or replace function snote_business_private.car_projection(p_company uuid,p_owner uuid,p_car text)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_object_agg(k,v),'{}'::jsonb)from public.zc_datasets d
 cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array'then d.payload else'[]'::jsonb end)c
 cross join lateral jsonb_each(c)as fields(k,v)
 where d.company_id=p_company and d.owner_id=p_owner and d.dataset='cars'and c->>'id'=p_car
 and k=any(array['id','model','plate','buy','sell','soldPrice','purchaseAt','soldAt','status','inventoryLoan','inventoryLender','inventoryStartedAt','costs','customCosts','customCostLabels','repairItems','moneyUnit']);
$$;

create or replace function snote_business_private.workspace(p_company uuid,p_owner uuid,p_car text,p_actor uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare v snote_business_private.vehicles;customer boolean:=p_actor=p_owner;
begin
 select * into v from snote_business_private.vehicles where company_id=p_company and owner_id=p_owner and car_id=p_car;
 return jsonb_build_object('apiVersion',1,'companyId',p_company,'ownerId',p_owner,'carId',p_car,'vehicleEntityId',v.vehicle_entity_id,'currentCycleId',v.current_cycle_id,'revision',coalesce(v.revision,0),
 'cycles',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'status',c.status,'details',c.details,'createdAt',c.created_at,'updatedAt',c.updated_at)order by c.sequence)from snote_business_private.cycles c where c.company_id=p_company and c.owner_id=p_owner and c.car_id=p_car),'[]'::jsonb),
 'entries',coalesce((select jsonb_agg(snote_business_private.entry_json(e)order by e.created_at,e.id)from snote_business_private.entries e where e.company_id=p_company and e.owner_id=p_owner and e.car_id=p_car and(customer or not snote_business_private.is_customer_entry(e.kind,e.details))),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'actorId',a.actor_id,'requestId',a.request_id,'operation',a.operation,'entityId',a.entity_id,'changes',a.changes,'createdAt',a.created_at)order by a.id desc)from(select * from snote_business_private.audit where company_id=p_company and owner_id=p_owner and car_id=p_car and(customer or not customer_private)order by id desc limit 50)a),'[]'::jsonb),
 'wireCar',snote_business_private.car_projection(p_company,p_owner,p_car),
 'capabilities',jsonb_build_object('canWrite',true,'customerRead',customer,'customerWrite',customer));
end$$;

create or replace function snote_business_private.preferences_value(p_company uuid,p_actor uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('revision',coalesce(p.revision,0),'payload',coalesce(p.payload,'{"noInquiryDays":7,"priceReviewDays":30,"strategyReviewDays":60,"maturityDays":7,"dueSoonDays":7}'::jsonb))
 from(values(1))seed(x)left join snote_business_private.preferences p on p.company_id=p_company and p.user_id=p_actor;
$$;

create or replace function snote_business_private.validate_links(p_company uuid,p_owner uuid,p_car text,p_cycle uuid,p_kind text,p_details jsonb,p_actor uuid)
returns void language plpgsql set search_path='' as $$
declare k text;ref snote_business_private.entries;
begin
 if p_details->>'assigneeId'is not null and not exists(select 1 from public.zc_members where company_id=p_company and user_id=(p_details->>'assigneeId')::uuid and active and role in('admin','accountant','dealer'))then raise exception 'BUSINESS_INVALID_ASSIGNEE'using errcode='22023';end if;
 if p_details->>'evidenceMediaId'is not null and not exists(select 1 from public.zc_media where company_id=p_company and car_id=p_car and id=p_details->>'evidenceMediaId'and group_name in('photos','registration','inspection1','inspection2'))and not exists(select 1 from snote_business_private.evidence f where f.company_id=p_company and f.owner_id=p_owner and f.car_id=p_car and f.cycle_id=p_cycle and f.id::text=p_details->>'evidenceMediaId'and f.state='ready'and snote_business_private.evidence_allowed(f))then raise exception 'BUSINESS_INVALID_EVIDENCE'using errcode='22023';end if;
 for k in select j.key from jsonb_each(p_details)j where j.key in('loanId','leadId','costId','refundOf','referenceId','reversalOf')and j.value<>'null'::jsonb loop
  if k='refundOf'and p_details->>k like'legacy:%'then
   if not exists(select 1 from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car and id=p_cycle and(details->'legacyCosts')?substring(p_details->>k from 8))then raise exception 'BUSINESS_INVALID_REFERENCE'using errcode='22023';end if;
   continue;
  end if;
  select * into ref from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car and cycle_id=p_cycle and id=(p_details->>k)::uuid;
  if not found or(ref.status='reversed'and k<>'reversalOf')then raise exception 'BUSINESS_INVALID_REFERENCE'using errcode='22023';end if;
  if(k='loanId'and ref.kind<>'loan')or(k='leadId'and ref.kind<>'lead')or(k in('costId','refundOf')and ref.kind<>'cost')then raise exception 'BUSINESS_INVALID_REFERENCE'using errcode='22023';end if;
  if k='referenceId'and p_kind='cash'and((p_details->>'purpose'in('cost','cost_refund')and ref.kind<>'cost')or(p_details->>'purpose'in('loan_draw','loan_repayment','loan_interest')and ref.kind not in('loan','loan_event')))then raise exception 'BUSINESS_INVALID_REFERENCE_KIND'using errcode='22023';end if;
  if k='referenceId'and p_kind='cash'and ref.kind='loan_event'and((p_details->>'purpose'='loan_draw'and ref.details->>'eventType'<>'draw')or(p_details->>'purpose'='loan_repayment'and ref.details->>'eventType'<>'repay')or(p_details->>'purpose'='loan_interest'and ref.details->>'eventType'<>'interest_invoice'))then raise exception 'BUSINESS_INVALID_REFERENCE_KIND'using errcode='22023';end if;
  if p_actor<>p_owner and snote_business_private.is_customer_entry(ref.kind,ref.details)then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
 end loop;
end$$;

create or replace function snote_business_private.assert_loan_balances(p_company uuid,p_owner uuid,p_car text,p_cycle uuid)
returns void language plpgsql set search_path='' as $$
declare loan snote_business_private.entries;event record;balance numeric;
begin
 for loan in select * from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car and cycle_id=p_cycle and kind='loan'and status<>'reversed'loop
  balance:=loan.amount_won;
  for event in select effective_date,sum(case details->>'eventType'when'draw'then amount_won when'repay'then -amount_won else 0 end)as change from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car and cycle_id=p_cycle and kind='loan_event'and status='confirmed'and details->>'loanId'=loan.id::text group by effective_date order by effective_date loop
   if loan.status<>'active'or balance is null then raise exception 'BUSINESS_LOAN_UNCONFIRMED'using errcode='22023';end if;
   if coalesce((loan.details->>'startDate')::date,loan.effective_date)is not null and event.effective_date<coalesce((loan.details->>'startDate')::date,loan.effective_date)then raise exception 'BUSINESS_LOAN_EVENT_DATE'using errcode='22023';end if;
   balance:=balance+event.change;
   if balance<0 or balance>1000000000000 then raise exception 'BUSINESS_LOAN_OVER_REPAYMENT'using errcode='22023';end if;
  end loop;
 end loop;
end$$;

create or replace function snote_business_private.assert_cost_replacements(p_cycle uuid)
returns void language plpgsql set search_path='' as $$
declare c snote_business_private.cycles;item record;
begin
 select * into c from snote_business_private.cycles where id=p_cycle;
 for item in select details->>'sourceCostKey'as key,count(*)as n from snote_business_private.entries where cycle_id=p_cycle and kind='cost'and status='incurred'and details->>'sourceCostKey'is not null group by details->>'sourceCostKey'loop
  if item.n>1 or not coalesce((c.details->'legacyCosts')?item.key,false)then raise exception 'BUSINESS_INVALID_COST_REPLACEMENT'using errcode='22023';end if;
 end loop;
end$$;

create or replace function snote_business_private.assert_refunds(p_cycle uuid)
returns void language plpgsql set search_path='' as $$
declare refund record;original numeric;cycle_details jsonb;
begin
 select details into cycle_details from snote_business_private.cycles where id=p_cycle;
 for refund in select details->>'refundOf'as source,sum(amount_won)as amount from snote_business_private.entries where cycle_id=p_cycle and kind='cost'and status='incurred'and details->>'refundOf'is not null group by details->>'refundOf'loop
  if refund.source like'legacy:%'then original:=(cycle_details->'legacyCosts'->>substring(refund.source from 8))::numeric;
  else select amount_won into original from snote_business_private.entries where id=refund.source::uuid and cycle_id=p_cycle and kind='cost'and status='incurred'and details->>'refundOf'is null;end if;
  if original is null or original<0 or refund.amount>=0 or -refund.amount>original then raise exception 'BUSINESS_REFUND_EXCEEDS_COST'using errcode='22023';end if;
 end loop;
end$$;

create or replace function snote_business_private.vehicle_read(p_company uuid,p_owner uuid,p_car_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_business_private.assert_vehicle(p_company,p_owner,p_car_id);
begin return snote_business_private.workspace(p_company,p_owner,p_car_id,a);end$$;

create or replace function snote_business_private.vehicle_write(p_company uuid,p_owner uuid,p_car_id text,p_expected_revision bigint,p_request_id uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_business_private.assert_vehicle(p_company,p_owner,p_car_id);v snote_business_private.vehicles;r snote_business_private.requests;
 c snote_business_private.cycles;old_c snote_business_private.cycles;e snote_business_private.entries;old_e snote_business_private.entries;
 op text;body jsonb;ident uuid;v_cycle_id uuid;fingerprint text;result jsonb;before_json jsonb;after_json jsonb;private_change boolean:=false;
 amount bigint;effective date;due date;entry_kind text;entry_status text;detail jsonb;reason text;when_date date;key text;
begin
 if p_expected_revision is null or p_expected_revision not between 0 and 9007199254740989 or p_request_id is null or p_command is null or jsonb_typeof(p_command)<>'object'or octet_length(p_command::text)>32000 then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
 op:=p_command->>'action';
 if op is null or op not in('start_cycle','save_entry','reverse_entry','cancel_cycle','update_cycle')then raise exception 'BUSINESS_INVALID_OPERATION'using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('snote-business-request:'||a::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('type','vehicle','company',p_company,'owner',p_owner,'car',p_car_id,'expected',p_expected_revision,'command',p_command)::text,'UTF8')),'hex');
 select * into r from snote_business_private.requests where actor_id=a and request_id=p_request_id;
 if found then if r.fingerprint<>fingerprint then raise exception 'BUSINESS_REQUEST_REUSED'using errcode='22023';end if;return r.result;end if;
 insert into snote_business_private.vehicles(company_id,owner_id,car_id)values(p_company,p_owner,p_car_id)on conflict do nothing;
 select * into v from snote_business_private.vehicles where company_id=p_company and owner_id=p_owner and car_id=p_car_id for update;
 a:=snote_business_private.assert_vehicle(p_company,p_owner,p_car_id);
 if v.revision<>p_expected_revision then raise exception 'BUSINESS_CONFLICT'using errcode='40001';end if;
 if op='start_cycle'then
  if not coalesce(snote_business_private.exact_keys(p_command,array['action','cycle']),false)then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
  body:=p_command->'cycle';
  if not coalesce(snote_business_private.exact_keys(body,array['id','status','details']),false)or jsonb_typeof(body->'id')is distinct from'string'or(body->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'or body->>'status'is distinct from'open'or not snote_business_private.valid_details('cycle',body->'details')then raise exception 'BUSINESS_INVALID_CYCLE'using errcode='22023';end if;
  if exists(select 1 from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id and status='open')then raise exception 'BUSINESS_OPEN_CYCLE_EXISTS'using errcode='22023';end if;
  if(select count(*)from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id)>=100 then raise exception 'BUSINESS_CYCLE_LIMIT'using errcode='22023';end if;
  ident:=(body->>'id')::uuid;
  if exists(select 1 from snote_business_private.cycles where id=ident)then raise exception 'BUSINESS_ID_EXISTS'using errcode='22023';end if;
  insert into snote_business_private.cycles(id,company_id,owner_id,car_id,sequence,status,details)
  select ident,p_company,p_owner,p_car_id,coalesce(max(sequence),0)+1,'open',body->'details'from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id returning * into c;
  update snote_business_private.vehicles set current_cycle_id=ident where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
  after_json:=to_jsonb(c);
 elsif op in('update_cycle','cancel_cycle')then
  if op='update_cycle'then
   if not coalesce(snote_business_private.exact_keys(p_command,array['action','id','status','details']),false)then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
  elsif not coalesce(snote_business_private.exact_keys(p_command,array['action','id','reason','date']),false)then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
  if jsonb_typeof(p_command->'id')is distinct from'string'or(p_command->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'then raise exception 'BUSINESS_INVALID_CYCLE'using errcode='22023';end if;
  ident:=(p_command->>'id')::uuid;
  select * into c from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id and id=ident for update;
  if not found then raise exception 'BUSINESS_CYCLE_NOT_FOUND'using errcode='22023';end if;
  before_json:=to_jsonb(c);old_c:=c;
  if op='cancel_cycle'then
   reason:=p_command->>'reason';
   if jsonb_typeof(p_command->'reason')is distinct from'string'or length(btrim(reason))not between 1 and 2000 or jsonb_typeof(p_command->'date')is distinct from'string'or not snote_business_private.valid_date(p_command->>'date')then raise exception 'BUSINESS_INVALID_CANCELLATION'using errcode='22023';end if;
   update snote_business_private.cycles set status='cancelled',updated_at=clock_timestamp()where id=ident returning * into c;
  else
   if c.status='cancelled'or p_command->>'status'is null or p_command->>'status'not in('open','closed')or not snote_business_private.valid_details('cycle',p_command->'details')then raise exception 'BUSINESS_INVALID_CYCLE'using errcode='22023';end if;
   if p_command->>'status'='open'and exists(select 1 from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id and status='open'and id<>ident)then raise exception 'BUSINESS_OPEN_CYCLE_EXISTS'using errcode='22023';end if;
   update snote_business_private.cycles set status=p_command->>'status',details=p_command->'details',updated_at=clock_timestamp()where id=ident returning * into c;
   perform snote_business_private.assert_cost_replacements(ident);perform snote_business_private.assert_refunds(ident);
  end if;
  update snote_business_private.vehicles set current_cycle_id=case when c.status='open'then ident when current_cycle_id=ident then null else current_cycle_id end where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
  after_json:=to_jsonb(c)||case when op='cancel_cycle'then jsonb_build_object('reason',reason,'date',p_command->>'date')else'{}'::jsonb end;
 elsif op='save_entry'then
  if not coalesce(snote_business_private.exact_keys(p_command,array['action','entry']),false)then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
  body:=p_command->'entry';
  if not coalesce(snote_business_private.exact_keys(body,array['id','cycleId','kind','status','amountWon','effectiveDate','dueDate','details']),false)or jsonb_typeof(body->'id')is distinct from'string'or(body->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'or jsonb_typeof(body->'cycleId')is distinct from'string'or(body->>'cycleId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'then raise exception 'BUSINESS_INVALID_ENTRY'using errcode='22023';end if;
  ident:=(body->>'id')::uuid;v_cycle_id:=(body->>'cycleId')::uuid;entry_kind:=body->>'kind';entry_status:=body->>'status';detail:=body->'details';
  if not snote_business_private.valid_status(entry_kind,entry_status)or not snote_business_private.valid_details(entry_kind,detail)then raise exception 'BUSINESS_INVALID_ENTRY'using errcode='22023';end if;
  private_change:=snote_business_private.is_customer_entry(entry_kind,detail);
  if private_change and a<>p_owner then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
  if body->>'amountWon'is not null then
   if jsonb_typeof(body->'amountWon')<>'number'or(body->>'amountWon')::numeric not between -1000000000000 and 1000000000000 or(body->>'amountWon')::numeric<>trunc((body->>'amountWon')::numeric)or((body->>'amountWon')::numeric<0 and not(entry_kind='cost'and detail->>'refundOf'is not null))then raise exception 'BUSINESS_INVALID_AMOUNT'using errcode='22023';end if;
   amount:=(body->>'amountWon')::bigint;
  end if;
  for key in select unnest(array['effectiveDate','dueDate'])loop if body->>key is not null and(jsonb_typeof(body->key)<>'string'or not snote_business_private.valid_date(body->>key))then raise exception 'BUSINESS_INVALID_DATE'using errcode='22023';end if;end loop;
  effective:=(body->>'effectiveDate')::date;due:=(body->>'dueDate')::date;
  select * into c from snote_business_private.cycles where company_id=p_company and owner_id=p_owner and car_id=p_car_id and id=v_cycle_id;
  if not found then raise exception 'BUSINESS_CYCLE_NOT_FOUND'using errcode='22023';end if;
  select * into old_e from snote_business_private.entries where id=ident;
  if found and(old_e.company_id<>p_company or old_e.owner_id<>p_owner or old_e.car_id<>p_car_id or old_e.cycle_id<>v_cycle_id or old_e.kind<>entry_kind)then raise exception 'BUSINESS_IMMUTABLE_IDENTITY'using errcode='42501';end if;
  if old_e.id is not null and a<>p_owner and snote_business_private.is_customer_entry(old_e.kind,old_e.details)then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
  private_change:=private_change or coalesce(snote_business_private.is_customer_entry(old_e.kind,old_e.details),false);
  if old_e.status='reversed'then raise exception 'BUSINESS_FACT_IMMUTABLE'using errcode='22023';end if;
  if old_e.id is not null and((old_e.kind in('cash','loan_event')and old_e.status='confirmed')or(old_e.kind='cost'and old_e.status='incurred'))and(old_e.status is distinct from entry_status or old_e.amount_won is distinct from amount or old_e.effective_date is distinct from effective or old_e.due_date is distinct from due or(old_e.details-array['notes','label','evidenceMediaId','evidenceUrl'])is distinct from(detail-array['notes','label','evidenceMediaId','evidenceUrl']))then raise exception 'BUSINESS_FACT_IMMUTABLE'using errcode='22023';end if;
  if entry_kind='loan'and old_e.id is not null and exists(select 1 from snote_business_private.entries where cycle_id=v_cycle_id and kind='loan_event'and status='confirmed'and details->>'loanId'=ident::text)and(old_e.amount_won is distinct from amount or old_e.effective_date is distinct from effective or(old_e.details-array['notes','maturityDate'])is distinct from(detail-array['notes','maturityDate']))then raise exception 'BUSINESS_FACT_IMMUTABLE'using errcode='22023';end if;
  if entry_kind in('cash','loan_event')and entry_status='confirmed'and(effective is null or(amount is null and not(entry_kind='loan_event'and detail->>'eventType'='rate')))then raise exception 'BUSINESS_ACTUAL_DATE_AMOUNT_REQUIRED'using errcode='22023';end if;
  if entry_kind='cost'and detail->>'refundOf'is not null and detail->>'sourceCostKey'is not null then raise exception 'BUSINESS_REFUND_REPLACEMENT_CONFLICT'using errcode='22023';end if;
  if entry_kind='cost'and detail->>'refundOf'is not null and amount is not null and amount>=0 then raise exception 'BUSINESS_INVALID_REFUND_SIGN'using errcode='22023';end if;
  if entry_kind='cost'and entry_status='incurred'and amount is null then raise exception 'BUSINESS_ACTUAL_AMOUNT_REQUIRED'using errcode='22023';end if;
  if entry_kind='loan'and entry_status='active'and amount is null then raise exception 'BUSINESS_ACTUAL_AMOUNT_REQUIRED'using errcode='22023';end if;
  if entry_kind='loan_event'then
   if detail->>'eventType'='rate'and(detail->>'annualRate'is null or amount is not null)then raise exception 'BUSINESS_INVALID_RATE_EVENT'using errcode='22023';end if;
   if detail->>'eventType'in('draw','repay')and entry_status='confirmed'and amount<=0 then raise exception 'BUSINESS_INVALID_AMOUNT'using errcode='22023';end if;
   if(detail->>'periodStart'is null)is distinct from(detail->>'periodEnd'is null)or(detail->>'periodStart')::date>=(detail->>'periodEnd')::date then raise exception 'BUSINESS_INVALID_INTEREST_PERIOD'using errcode='22023';end if;
  end if;
  if(entry_kind in('document','task')and entry_status='done'and effective is null)or(entry_kind='transfer'and entry_status='done'and effective is null and detail->>'completedDate'is null)or(entry_kind='lead'and entry_status='delivered'and effective is null)then raise exception 'BUSINESS_COMPLETION_DATE_REQUIRED'using errcode='22023';end if;
  if entry_kind not in('cash','loan','loan_event','cost','appraisal','advertising')and amount is not null then raise exception 'BUSINESS_UNEXPECTED_AMOUNT'using errcode='22023';end if;
  perform snote_business_private.validate_links(p_company,p_owner,p_car_id,v_cycle_id,entry_kind,detail,a);
  if old_e.id is null and(select count(*)from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car_id)>=2000 then raise exception 'BUSINESS_ENTRY_LIMIT'using errcode='22023';end if;
  before_json:=case when old_e.id is null then null else snote_business_private.entry_json(old_e)end;
  insert into snote_business_private.entries(id,company_id,owner_id,car_id,cycle_id,kind,status,amount_won,effective_date,due_date,details)
  values(ident,p_company,p_owner,p_car_id,v_cycle_id,entry_kind,entry_status,amount,effective,due,detail)
  on conflict(id)do update set status=excluded.status,amount_won=excluded.amount_won,effective_date=excluded.effective_date,due_date=excluded.due_date,details=excluded.details,updated_at=clock_timestamp()returning * into e;
  perform snote_business_private.assert_loan_balances(p_company,p_owner,p_car_id,v_cycle_id);perform snote_business_private.assert_cost_replacements(v_cycle_id);perform snote_business_private.assert_refunds(v_cycle_id);
  after_json:=snote_business_private.entry_json(e);
 elsif op='reverse_entry'then
  if not coalesce(snote_business_private.exact_keys(p_command,array['action','id','reason','date']),false)or jsonb_typeof(p_command->'id')is distinct from'string'or(p_command->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
  ident:=(p_command->>'id')::uuid;reason:=p_command->>'reason';
  if jsonb_typeof(p_command->'reason')is distinct from'string'or length(btrim(reason))not between 1 and 2000 or jsonb_typeof(p_command->'date')is distinct from'string'or not snote_business_private.valid_date(p_command->>'date')then raise exception 'BUSINESS_INVALID_REVERSAL'using errcode='22023';end if;
  when_date:=(p_command->>'date')::date;
  select * into e from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car_id and id=ident for update;
  if not found or e.kind not in('cash','loan','loan_event','cost')or e.status='reversed'then raise exception 'BUSINESS_INVALID_REVERSAL'using errcode='22023';end if;
  if e.effective_date is not null and when_date<e.effective_date then raise exception 'BUSINESS_INVALID_REVERSAL_DATE'using errcode='22023';end if;
  if e.kind='loan'and exists(select 1 from snote_business_private.entries where cycle_id=e.cycle_id and kind='loan_event'and status<>'reversed'and details->>'loanId'=ident::text)then raise exception 'BUSINESS_DEPENDENCY_EXISTS'using errcode='22023';end if;
  before_json:=snote_business_private.entry_json(e);
  update snote_business_private.entries set status='reversed',reversed_at=clock_timestamp(),reversal_date=when_date,reversal_reason=reason,reversed_by=a,updated_at=clock_timestamp()where id=ident returning * into e;
  perform snote_business_private.assert_loan_balances(p_company,p_owner,p_car_id,e.cycle_id);perform snote_business_private.assert_cost_replacements(e.cycle_id);perform snote_business_private.assert_refunds(e.cycle_id);
  after_json:=snote_business_private.entry_json(e);
 end if;
 update snote_business_private.vehicles set revision=revision+1,updated_at=clock_timestamp()where company_id=p_company and owner_id=p_owner and car_id=p_car_id returning * into v;
 insert into snote_business_private.audit(company_id,owner_id,car_id,actor_id,request_id,operation,entity_id,customer_private,changes)values(p_company,p_owner,p_car_id,a,p_request_id,op,ident,private_change,jsonb_build_object('before',before_json,'after',after_json));
 result:=snote_business_private.workspace(p_company,p_owner,p_car_id,a)||jsonb_build_object('requestId',p_request_id);
 insert into snote_business_private.requests(actor_id,request_id,company_id,fingerprint,result)values(a,p_request_id,p_company,fingerprint,result);
 return result;
end$$;

create or replace function snote_business_private.preferences_call(p_company uuid,p_action text,p_expected_revision bigint,p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_business_private.actor(p_company);v snote_business_private.preferences;r snote_business_private.requests;fingerprint text;result jsonb;key text;value jsonb;
begin
 if p_action='read'then return snote_business_private.preferences_value(p_company,a);end if;
 if p_action is distinct from'save'or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740989 or p_request_id is null then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
 if not snote_business_private.exact_keys(p_payload,array['noInquiryDays','priceReviewDays','strategyReviewDays','maturityDays','dueSoonDays'])or(select count(*)from jsonb_object_keys(p_payload))<>5 then raise exception 'BUSINESS_INVALID_PREFERENCES'using errcode='22023';end if;
 for key,value in select * from jsonb_each(p_payload)loop
  if jsonb_typeof(value)<>'number'or(value#>>'{}')::numeric<>trunc((value#>>'{}')::numeric)or(value#>>'{}')::numeric not between 1 and 3650 then raise exception 'BUSINESS_INVALID_PREFERENCES'using errcode='22023';end if;
 end loop;
 perform snote_private.recycle_lock(p_company);a:=snote_business_private.actor(p_company);
 perform pg_advisory_xact_lock(hashtextextended('snote-business-request:'||a::text||':'||p_request_id::text,0));
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('type','preferences','company',p_company,'expected',p_expected_revision,'payload',p_payload)::text,'UTF8')),'hex');
 select * into r from snote_business_private.requests where actor_id=a and request_id=p_request_id;
 if found then if r.fingerprint<>fingerprint then raise exception 'BUSINESS_REQUEST_REUSED'using errcode='22023';end if;return r.result;end if;
 select * into v from snote_business_private.preferences where company_id=p_company and user_id=a for update;
 if coalesce(v.revision,0)<>p_expected_revision then raise exception 'BUSINESS_CONFLICT'using errcode='40001';end if;
 insert into snote_business_private.preferences(company_id,user_id,revision,payload)values(p_company,a,p_expected_revision+1,p_payload)
 on conflict(company_id,user_id)do update set revision=excluded.revision,payload=excluded.payload,updated_at=clock_timestamp();
 result:=snote_business_private.preferences_value(p_company,a);
 insert into snote_business_private.requests(actor_id,request_id,company_id,fingerprint,result)values(a,p_request_id,p_company,fingerprint,result);
 return result;
end$$;

create or replace function snote_business_private.worklist(p_company uuid,p_scope text,p_page integer,p_page_size integer,p_query text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_business_private.actor(p_company);rows jsonb;more boolean;query text:=coalesce(p_query,'');
begin
 if p_scope is null or p_scope not in('mine','company')or p_page is null or p_page not between 1 and 100000 or p_page_size is null or p_page_size not between 1 and 50 or length(query)>200 or query~'[[:cntrl:]]'then raise exception 'BUSINESS_INVALID_REQUEST'using errcode='22023';end if;
 if p_scope='company'and not exists(select 1 from public.zc_members m where m.user_id=a and m.company_id=p_company and m.active and m.role in('admin','accountant'))then raise exception 'BUSINESS_FORBIDDEN'using errcode='42501';end if;
 with matches as(
  select v.*,snote_business_private.car_projection(v.company_id,v.owner_id,v.car_id)as car
  from snote_business_private.vehicles v where v.company_id=p_company and(p_scope='company'or v.owner_id=a)
   and snote_private.share_vehicle_owner(v.company_id,v.car_id)=v.owner_id
 ),filtered as(
  select * from matches m where query=''or position(lower(query)in lower(concat_ws(' ',car_id,car->>'model',car->>'plate')))>0
   or(m.owner_id=a and exists(select 1 from snote_business_private.entries e where e.company_id=m.company_id and e.owner_id=m.owner_id and e.car_id=m.car_id and e.kind='lead'and position(lower(query)in lower(coalesce(e.details->>'name','')))>0))
  order by updated_at desc,owner_id,car_id limit p_page_size+1 offset((p_page::bigint-1)*p_page_size)
 ),numbered as(select *,row_number()over(order by updated_at desc,owner_id,car_id)as rn from filtered)
 select coalesce(jsonb_agg(snote_business_private.workspace(company_id,owner_id,car_id,a)||jsonb_build_object('wireCar',car)order by rn)filter(where rn<=p_page_size),'[]'::jsonb),count(*)>p_page_size into rows,more from numbered;
 return jsonb_build_object('items',rows,'page',p_page,'hasMore',more,'preferences',snote_business_private.preferences_value(p_company,a));
end$$;

create or replace function snote_business_private.append_only_guard()
returns trigger language plpgsql set search_path='' as $$begin raise exception 'BUSINESS_APPEND_ONLY'using errcode='42501';end$$;

create or replace function snote_business_private.evidence_json(e snote_business_private.evidence)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',e.id,'entryId',e.entry_id,'cycleId',e.cycle_id,'bucket','snote-business-private','path',e.path,'name',e.original_name,'mime',e.mime,'size',e.file_size,'state',e.state,'createdAt',e.created_at,'completedAt',e.completed_at);
$$;
create or replace function snote_business_private.evidence_allowed(e snote_business_private.evidence)
returns boolean language plpgsql stable set search_path='' as $$
declare a uuid;entry snote_business_private.entries;
begin
 begin a:=snote_business_private.actor(e.company_id);exception when insufficient_privilege then return false;end;
 if not exists(select 1 from public.zc_members m where m.company_id=e.company_id and m.user_id=a and m.active and(m.role in('admin','accountant')or(m.role='dealer'and a=e.owner_id)))then return false;end if;
 if snote_private.share_vehicle_owner(e.company_id,e.car_id)is distinct from e.owner_id then return false;end if;
 select * into entry from snote_business_private.entries where company_id=e.company_id and owner_id=e.owner_id and car_id=e.car_id and cycle_id=e.cycle_id and id=e.entry_id;
 return found and(a=e.owner_id or not snote_business_private.is_customer_entry(entry.kind,entry.details));
end$$;
create or replace function snote_business_private.evidence_storage(p_path text,p_action text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare e snote_business_private.evidence;a uuid:=auth.uid();
begin
 if p_path is null or p_action is null or p_action not in('insert','read')then return false;end if;
 select * into e from snote_business_private.evidence where path=p_path;
 if not found or not snote_business_private.evidence_allowed(e)then return false;end if;
 if p_action='insert'then return e.actor_id=a and e.state='pending'and e.created_at>now()-interval'1 hour';end if;
 return e.state='ready'or(e.actor_id=a and e.state='pending'and e.created_at>now()-interval'1 hour');
end$$;
create or replace function snote_business_private.evidence_call(p_company uuid,p_owner uuid,p_car_id text,p_action text,p_id uuid,p_entry_id uuid,p_meta jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=snote_business_private.assert_vehicle(p_company,p_owner,p_car_id);e snote_business_private.evidence;entry snote_business_private.entries;
 entity uuid;ext text;size bigint;mime text;name text;meta jsonb;result jsonb;
begin
 if p_action is null or p_action not in('reserve','complete','read')then raise exception 'BUSINESS_INVALID_EVIDENCE_ACTION'using errcode='22023';end if;
 if p_action='read'and p_id is null then
  if p_entry_id is null then raise exception 'BUSINESS_ENTRY_REQUIRED'using errcode='22023';end if;
  select * into entry from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car_id and id=p_entry_id;
  if not found then raise exception 'BUSINESS_ENTRY_NOT_FOUND'using errcode='22023';end if;
  if a<>p_owner and snote_business_private.is_customer_entry(entry.kind,entry.details)then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(snote_business_private.evidence_json(f)order by f.created_at,f.id)from snote_business_private.evidence f where f.company_id=p_company and f.owner_id=p_owner and f.car_id=p_car_id and f.entry_id=p_entry_id and f.state='ready'),'[]'::jsonb));
 end if;
 if p_id is null then raise exception 'BUSINESS_EVIDENCE_ID_REQUIRED'using errcode='22023';end if;
 if p_action='reserve'then
  if p_entry_id is null or not coalesce(snote_business_private.exact_keys(p_meta,array['name','mime','size']),false)or(select count(*)from jsonb_object_keys(p_meta))<>3 or jsonb_typeof(p_meta->'name')is distinct from'string'or length(btrim(p_meta->>'name'))not between 1 and 200 or(p_meta->>'name')~'[[:cntrl:]]'or jsonb_typeof(p_meta->'mime')is distinct from'string'or p_meta->>'mime'not in('image/png','image/jpeg','image/webp','application/pdf')or jsonb_typeof(p_meta->'size')is distinct from'number'or(p_meta->>'size')::numeric not between 1 and 10485760 or(p_meta->>'size')::numeric<>trunc((p_meta->>'size')::numeric)then raise exception 'BUSINESS_INVALID_FILE'using errcode='22023';end if;
  select * into entry from snote_business_private.entries where company_id=p_company and owner_id=p_owner and car_id=p_car_id and id=p_entry_id;
  if not found then raise exception 'BUSINESS_ENTRY_NOT_FOUND'using errcode='22023';end if;
  if a<>p_owner and snote_business_private.is_customer_entry(entry.kind,entry.details)then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
  size:=(p_meta->>'size')::bigint;mime:=p_meta->>'mime';name:=p_meta->>'name';
  select * into e from snote_business_private.evidence where id=p_id for update;
  if found then
   if e.company_id<>p_company or e.owner_id<>p_owner or e.car_id<>p_car_id or e.entry_id<>p_entry_id or e.actor_id<>a or e.file_size<>size or e.mime<>mime or e.original_name<>name then raise exception 'BUSINESS_EVIDENCE_ID_REUSED'using errcode='22023';end if;
   if e.state='pending'and e.created_at<=now()-interval'1 hour'then raise exception 'BUSINESS_EVIDENCE_EXPIRED'using errcode='22023';end if;
   return snote_business_private.evidence_json(e);
  end if;
  if(select count(*)from snote_business_private.evidence where company_id=p_company and owner_id=p_owner and car_id=p_car_id and entry_id=p_entry_id and(state='ready'or created_at>now()-interval'1 hour'))>=20 then raise exception 'BUSINESS_EVIDENCE_LIMIT'using errcode='22023';end if;
  select vehicle_entity_id into entity from snote_business_private.vehicles where company_id=p_company and owner_id=p_owner and car_id=p_car_id;
  ext:=case mime when'image/png'then'png'when'image/jpeg'then'jpg'when'image/webp'then'webp'else'pdf'end;
  insert into snote_business_private.evidence(id,company_id,owner_id,car_id,cycle_id,entry_id,actor_id,path,mime,file_size,original_name)
  values(p_id,p_company,p_owner,p_car_id,entry.cycle_id,p_entry_id,a,p_company::text||'/'||p_owner::text||'/'||entity::text||'/'||p_id::text||'.'||ext,mime,size,name)returning * into e;
  return snote_business_private.evidence_json(e);
 end if;
 select * into e from snote_business_private.evidence where id=p_id and company_id=p_company and owner_id=p_owner and car_id=p_car_id for update;
 if not found or(p_entry_id is not null and e.entry_id<>p_entry_id)then raise exception 'BUSINESS_EVIDENCE_NOT_FOUND'using errcode='22023';end if;
 if not snote_business_private.evidence_allowed(e)then raise exception 'BUSINESS_CUSTOMER_FORBIDDEN'using errcode='42501';end if;
 if p_action='read'then
  if e.state='pending'and(e.actor_id<>a or e.created_at<=now()-interval'1 hour')then raise exception 'BUSINESS_EVIDENCE_NOT_READY'using errcode='42501';end if;
  return snote_business_private.evidence_json(e);
 end if;
 if e.actor_id<>a then raise exception 'BUSINESS_EVIDENCE_ACTOR_CHANGED'using errcode='42501';end if;
 if e.state='ready'then return snote_business_private.evidence_json(e);end if;
 if e.created_at<=now()-interval'1 hour'then raise exception 'BUSINESS_EVIDENCE_EXPIRED'using errcode='22023';end if;
 select o.metadata into meta from storage.objects o where o.bucket_id='snote-business-private'and o.name=e.path;
 if meta is null or jsonb_typeof(meta->'size')not in('number','string')or coalesce(meta->>'size','')!~'^[0-9]{1,10}$'or(meta->>'size')::bigint<>e.file_size or meta->>'mimetype'is distinct from e.mime then raise exception 'BUSINESS_FILE_NOT_VERIFIED'using errcode='22023';end if;
 update snote_business_private.evidence set state='ready',completed_at=clock_timestamp()where id=e.id returning * into e;
 select * into entry from snote_business_private.entries where id=e.entry_id;
 insert into snote_business_private.audit(company_id,owner_id,car_id,actor_id,request_id,operation,entity_id,customer_private,changes)
 values(p_company,p_owner,p_car_id,a,p_id,'evidence_complete',e.entry_id,snote_business_private.is_customer_entry(entry.kind,entry.details),jsonb_build_object('evidenceId',e.id,'name',e.original_name,'mime',e.mime,'size',e.file_size));
 return snote_business_private.evidence_json(e);
end$$;

drop trigger if exists business_audit_append_only on snote_business_private.audit;
create trigger business_audit_append_only before update or delete on snote_business_private.audit for each row execute function snote_business_private.append_only_guard();
drop trigger if exists business_request_append_only on snote_business_private.requests;
create trigger business_request_append_only before update or delete on snote_business_private.requests for each row execute function snote_business_private.append_only_guard();


create or replace function public.snote_business_vehicle_read(p_company uuid,p_owner uuid,p_car_id text)
returns jsonb language sql security invoker set search_path='' as $$select snote_business_private.vehicle_read(p_company,p_owner,p_car_id)$$;

create or replace function public.snote_business_vehicle_write(p_company uuid,p_owner uuid,p_car_id text,p_expected_revision bigint,p_request_id uuid,p_command jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_business_private.vehicle_write(p_company,p_owner,p_car_id,p_expected_revision,p_request_id,p_command)$$;

create or replace function public.snote_business_worklist(p_company uuid,p_scope text,p_page integer,p_page_size integer,p_query text)
returns jsonb language sql security invoker set search_path='' as $$select snote_business_private.worklist(p_company,p_scope,p_page,p_page_size,p_query)$$;

create or replace function public.snote_business_preferences(p_company uuid,p_action text,p_expected_revision bigint,p_request_id uuid,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_business_private.preferences_call(p_company,p_action,p_expected_revision,p_request_id,p_payload)$$;
create or replace function public.snote_business_evidence(p_company uuid,p_owner uuid,p_car_id text,p_action text,p_id uuid,p_entry_id uuid,p_meta jsonb)
returns jsonb language sql security invoker set search_path='' as $$select snote_business_private.evidence_call(p_company,p_owner,p_car_id,p_action,p_id,p_entry_id,p_meta)$$;

drop policy if exists snote_business_object_insert on storage.objects;
create policy snote_business_object_insert on storage.objects for insert to authenticated with check(bucket_id='snote-business-private'and snote_business_private.evidence_storage(name,'insert'));
drop policy if exists snote_business_object_read on storage.objects;
create policy snote_business_object_read on storage.objects for select to authenticated using(bucket_id='snote-business-private'and snote_business_private.evidence_storage(name,'read'));

revoke all on all functions in schema snote_business_private from public,anon,authenticated,service_role;
revoke all on function public.snote_business_vehicle_read(uuid,uuid,text),public.snote_business_vehicle_write(uuid,uuid,text,bigint,uuid,jsonb),public.snote_business_worklist(uuid,text,integer,integer,text),public.snote_business_preferences(uuid,text,bigint,uuid,jsonb),public.snote_business_evidence(uuid,uuid,text,text,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function snote_business_private.vehicle_read(uuid,uuid,text),snote_business_private.vehicle_write(uuid,uuid,text,bigint,uuid,jsonb),snote_business_private.worklist(uuid,text,integer,integer,text),snote_business_private.preferences_call(uuid,text,bigint,uuid,jsonb),snote_business_private.evidence_call(uuid,uuid,text,text,uuid,uuid,jsonb),snote_business_private.evidence_storage(text,text),public.snote_business_vehicle_read(uuid,uuid,text),public.snote_business_vehicle_write(uuid,uuid,text,bigint,uuid,jsonb),public.snote_business_worklist(uuid,text,integer,integer,text),public.snote_business_preferences(uuid,text,bigint,uuid,jsonb),public.snote_business_evidence(uuid,uuid,text,text,uuid,uuid,jsonb)to authenticated;
commit;
