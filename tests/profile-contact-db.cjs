'use strict';
// NODE_PATH=/workspace/work/deps/node_modules node tests/profile-contact-db.cjs
const fs=require('node:fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();await db.waitReady;try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create table auth.users(id uuid primary key,email text,role text,aud text,raw_user_meta_data jsonb default '{}',banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;
 create table public.zc_companies(id uuid primary key,name text not null,rrn_enabled boolean default false,business_address text not null default '',business_address_detail text not null default '');
 create table public.zc_members(user_id uuid primary key references auth.users(id),company_id uuid not null references public.zc_companies(id),role text not null,display_name text not null,phone text default '',active boolean default true);
 create table public.zc_audit(company_id uuid,actor_id uuid,entity text,item_key text,action text);
 alter table public.zc_members enable row level security;alter table public.zc_companies enable row level security;
 create function public.zc_is_member(c uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.zc_members where user_id=auth.uid() and company_id=c and active)$$;
 create policy zc_members_read on public.zc_members for select to authenticated using(user_id=auth.uid() or public.zc_is_member(company_id));
 create policy zc_companies_read on public.zc_companies for select to authenticated using(public.zc_is_member(id));
 grant select on public.zc_members,public.zc_companies to authenticated;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261106113504_personal_profile_editor.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/20261106131154_verified_profile_contact.sql','utf8');await db.exec(migration);await db.exec(migration);
 const results=await db.exec(fs.readFileSync('tests/profile-contact.rollback.sql','utf8'));
 assert(results.some(r=>r.rows?.some(row=>String(row.result||'').startsWith('PASS'))));
 for(const t of['auth.users','public.zc_companies','public.zc_members','public.zc_audit','snote_private.member_profiles','snote_private.profile_phone_challenges','snote_private.profile_phone_sends'])assert.equal((await db.query('select count(*)::int n from '+t)).rows[0].n,0,t+' residue');
 console.log('PASS verified profile contacts: private ACL/RLS, service-only OTP, normal-save bypass denied, server company address, metadata/invalid legacy handling, send limits, delivery uncertainty, CAS, attempts, expiry, one-time phone-only mutation, acknowledgement replay and full rollback');
}finally{await db.close()}})().catch(error=>{console.error(error.message,error.code,error.where||'',error.position||'');process.exitCode=1});
