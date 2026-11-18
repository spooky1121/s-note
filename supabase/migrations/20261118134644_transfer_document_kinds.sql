-- Keep the original 39 legal-form fields unchanged. Document kind is immutable
-- metadata so a purchase stamp layout can never silently become a sale layout.
begin;

-- PostgreSQL supplies the constant default to existing rows without a row UPDATE:
-- their payload, author, revision and timestamps remain exactly as recorded.
alter table snote_transfer_private.drafts
 add column if not exists document_kind text not null default 'purchase'
 constraint transfer_drafts_document_kind_check check(document_kind in('purchase','sale'));
create index if not exists transfer_document_drafts_kind_recent_idx
 on snote_transfer_private.drafts(company_id,document_kind,updated_at desc,id desc);
grant insert(document_kind) on snote_transfer_private.drafts to authenticated;
revoke update(document_kind) on snote_transfer_private.drafts from public,anon,authenticated,service_role;

create or replace function snote_transfer_private.assert_document_kind(p_document_kind text)
returns void language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_document_kind is null or p_document_kind not in('purchase','sale') then
  raise exception 'TRANSFER_DOCUMENT_INVALID_KIND' using errcode='22023';
 end if;
end$$;

create or replace function snote_transfer_private.guard_draft()
returns trigger language plpgsql security invoker set search_path='' as $$
declare actor uuid;stamp timestamptz;
begin
 actor:=snote_transfer_private.assert_company(new.company_id);
 if tg_op='UPDATE' then
  if new.document_kind is distinct from old.document_kind
   or new.company_id is distinct from old.company_id or new.id is distinct from old.id
   or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
   raise exception 'TRANSFER_CONTRACT_IMMUTABLE_IDENTITY' using errcode='42501';
  end if;
  if old.revision=9007199254740991 or new.revision is distinct from old.revision+1 then
   raise exception 'TRANSFER_CONTRACT_CONFLICT' using errcode='40001';
  end if;
 elsif new.revision is distinct from 1::bigint then
  raise exception 'TRANSFER_CONTRACT_INVALID_REVISION' using errcode='22023';
 end if;
 if (new.car_owner_id is null) is distinct from (new.car_id is null) then
  raise exception 'TRANSFER_CONTRACT_INVALID_CAR' using errcode='22023';
 end if;
 if new.car_id is not null then
  if new.car_owner_id='00000000-0000-0000-0000-000000000000'::uuid
   or char_length(new.car_id) not between 1 and 200 or btrim(new.car_id)<>new.car_id or new.car_id~'[[:cntrl:]]' then
   raise exception 'TRANSFER_CONTRACT_INVALID_CAR' using errcode='22023';
  end if;
  -- Share the existing company-car archival serialization without granting any
  -- UPDATE privilege on zc_datasets to the accounting reader.
  perform pg_advisory_xact_lock(hashtextextended('snote-recycle:'||new.company_id::text,0));
  if (select count(*) from public.zc_datasets d
   cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end) c
   where d.company_id=new.company_id and d.dataset='cars' and d.owner_id=new.car_owner_id and c->>'id'=new.car_id)<>1 then
   raise exception 'TRANSFER_CONTRACT_CAR_NOT_FOUND' using errcode='22023';
  end if;
 end if;
 stamp:=clock_timestamp();
 if tg_op='INSERT' then new.created_by:=actor;new.created_at:=stamp;end if;
 new.updated_by:=actor;new.updated_at:=stamp;
 return new;
end$$;

create or replace function snote_transfer_private.record_json(p_row snote_transfer_private.drafts)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'carOwnerId',p_row.car_owner_id,'carId',p_row.car_id,
  'revision',p_row.revision,'payload',p_row.payload,'updatedAt',p_row.updated_at,'documentKind',p_row.document_kind);
$$;

create or replace function public.snote_transfer_document_list(p_expected_company_id uuid,p_document_kind text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 perform snote_transfer_private.assert_document_kind(p_document_kind);
 select coalesce(jsonb_agg(snote_transfer_private.record_json(d) order by d.updated_at desc,d.id desc),'[]'::jsonb)
  into result from snote_transfer_private.drafts d
  where d.company_id=p_expected_company_id and d.document_kind=p_document_kind;
 return result;
end$$;

create or replace function public.snote_transfer_document_read(p_id uuid,p_expected_company_id uuid,p_document_kind text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare row snote_transfer_private.drafts;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 perform snote_transfer_private.assert_document_kind(p_document_kind);
 select * into row from snote_transfer_private.drafts d
  where d.company_id=p_expected_company_id and d.id=p_id and d.document_kind=p_document_kind;
 if not found then return null;end if;
 return snote_transfer_private.record_json(row);
end$$;

create or replace function public.snote_transfer_document_save(
 p_expected_company_id uuid,p_id uuid,p_car_owner_id uuid,p_car_id text,p_expected_revision bigint,p_payload jsonb,p_document_kind text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare row snote_transfer_private.drafts;
begin
 perform snote_transfer_private.assert_company(p_expected_company_id);
 perform snote_transfer_private.assert_document_kind(p_document_kind);
 if p_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991 then
  raise exception 'TRANSFER_CONTRACT_INVALID_REVISION' using errcode='22023';
 end if;
 perform snote_transfer_private.valid_payload(p_payload);
 if p_expected_revision=0 then
  insert into snote_transfer_private.drafts(company_id,id,car_owner_id,car_id,payload,revision,document_kind)
   values(p_expected_company_id,p_id,p_car_owner_id,p_car_id,p_payload,1,p_document_kind)
   on conflict(company_id,id) do nothing returning * into row;
 else
  update snote_transfer_private.drafts d set car_owner_id=p_car_owner_id,car_id=p_car_id,payload=p_payload,revision=d.revision+1
   where d.company_id=p_expected_company_id and d.id=p_id and d.revision=p_expected_revision
    and d.document_kind=p_document_kind
   returning * into row;
 end if;
 if not found then raise exception 'TRANSFER_CONTRACT_CONFLICT' using errcode='40001';end if;
 return snote_transfer_private.record_json(row);
end$$;

-- v2.132 and older clients always print a purchase layout. Keep their APIs
-- purchase-only even if they receive a sale UUID from a stale link or cache.
create or replace function public.snote_transfer_contract_list(p_expected_company_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.snote_transfer_document_list(p_expected_company_id,'purchase');
$$;
create or replace function public.snote_transfer_contract_read(p_id uuid,p_expected_company_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.snote_transfer_document_read(p_id,p_expected_company_id,'purchase');
$$;
create or replace function public.snote_transfer_contract_save(
 p_expected_company_id uuid,p_id uuid,p_car_owner_id uuid,p_car_id text,p_expected_revision bigint,p_payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select public.snote_transfer_document_save(p_expected_company_id,p_id,p_car_owner_id,p_car_id,p_expected_revision,p_payload,'purchase');
$$;

revoke all on function snote_transfer_private.assert_document_kind(text),
 public.snote_transfer_document_list(uuid,text),public.snote_transfer_document_read(uuid,uuid,text),
 public.snote_transfer_document_save(uuid,uuid,uuid,text,bigint,jsonb,text)
 from public,anon,authenticated,service_role;
grant execute on function snote_transfer_private.assert_document_kind(text),
 public.snote_transfer_document_list(uuid,text),public.snote_transfer_document_read(uuid,uuid,text),
 public.snote_transfer_document_save(uuid,uuid,uuid,text,bigint,jsonb,text) to authenticated;

-- Replaced functions retain their existing authenticated-only ACLs. No changes
-- to membership, draft RLS, payload validation, company images or Storage rules.
notify pgrst,'reload schema';
commit;
