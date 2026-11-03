-- Server-only delivery claims. No document bytes or complete phone numbers are stored here.
create table if not exists public.snote_document_mms (
 company_id uuid not null,
 actor_id uuid not null,
 owner_id uuid not null,
 car_id text not null check (char_length(car_id) between 1 and 200),
 request_id uuid not null,
 media_id text not null check (char_length(media_id) between 1 and 200),
 document_group text not null check (document_group in ('registration','inspection1','inspection2')),
 payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
 recipient_last4 text not null check (recipient_last4 ~ '^[0-9]{4}$'),
 status text not null default 'pending' check (status in ('pending','sending','accepted','failed','unknown')),
 provider_message_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(actor_id,request_id)
);
alter table public.snote_document_mms enable row level security;
revoke all on table public.snote_document_mms from public,anon,authenticated;
grant select,insert,update on table public.snote_document_mms to service_role;
create index if not exists snote_document_mms_actor_created on public.snote_document_mms(actor_id,created_at desc);
create or replace function public.snote_document_mms_claim(p_company uuid,p_actor uuid,p_owner uuid,p_car text,p_request uuid,p_media text,p_group text,p_hash text,p_last4 text)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare prior public.snote_document_mms%rowtype;
begin
 if p_company is null or p_actor is null or p_owner is null or p_request is null or p_car is null or char_length(p_car) not between 1 and 200 or p_media is null or char_length(p_media) not between 1 and 200 or p_group is null or p_group not in ('registration','inspection1','inspection2') or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_last4 is null or p_last4 !~ '^[0-9]{4}$' then raise exception 'Invalid document MMS claim'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snote-document-mms:'||p_actor::text,0));
 select * into prior from public.snote_document_mms where actor_id=p_actor and request_id=p_request;
 if found then
  if prior.payload_hash<>p_hash or prior.company_id<>p_company or prior.owner_id<>p_owner or prior.car_id<>p_car or prior.media_id<>p_media or prior.document_group<>p_group or prior.recipient_last4<>p_last4 then return jsonb_build_object('error','CONFLICT'); end if;
  return jsonb_build_object('claimed',false,'status',prior.status,'requestId',prior.request_id);
 end if;
 select * into prior from public.snote_document_mms where actor_id=p_actor and company_id=p_company and payload_hash=p_hash and status in ('pending','sending','accepted','unknown') and created_at>now()-interval '5 minutes' order by created_at desc limit 1;
 if found then return jsonb_build_object('claimed',false,'status',prior.status,'requestId',prior.request_id); end if;
 if (select count(*) from public.snote_document_mms where actor_id=p_actor and created_at>now()-interval '1 minute')>=20 or (select count(*) from public.snote_document_mms where actor_id=p_actor and created_at>now()-interval '1 hour')>=200 then return jsonb_build_object('error','RATE_LIMITED'); end if;
 insert into public.snote_document_mms(company_id,actor_id,owner_id,car_id,request_id,media_id,document_group,payload_hash,recipient_last4) values(p_company,p_actor,p_owner,p_car,p_request,p_media,p_group,p_hash,p_last4);
 return jsonb_build_object('claimed',true,'status','pending','requestId',p_request);
end;
$function$;
revoke all on function public.snote_document_mms_claim(uuid,uuid,uuid,text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.snote_document_mms_claim(uuid,uuid,uuid,text,uuid,text,text,text,text) to service_role;
