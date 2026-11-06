'use strict';
// NODE_PATH=/workspace/work/deps/node_modules node tests/profile-avatar-db.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite();await db.waitReady;try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,role text,aud text,banned_until timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;
 create table public.zc_companies(id uuid primary key,name text not null);
 create table public.zc_members(user_id uuid primary key references auth.users(id),company_id uuid references public.zc_companies(id),role text not null,display_name text not null,active boolean default true);
 create table public.zc_audit(company_id uuid,actor_id uuid,entity text,item_key text,action text);
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 create policy existing_other_read on storage.objects for select to authenticated using(bucket_id='zc-vehicle-private');
 create policy existing_other_insert on storage.objects for insert to authenticated with check(bucket_id='zc-vehicle-private');
 create policy existing_other_delete on storage.objects for delete to authenticated using(bucket_id='zc-vehicle-private');
 insert into storage.buckets(id,name,public)values('zc-vehicle-private','zc-vehicle-private',false);`);
 const file=fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_private_profile_avatar.sql')).sort().at(-1);assert(file);
 const sql=fs.readFileSync(path.join('supabase/migrations',file),'utf8');await db.exec(sql);await db.exec(sql);
 const results=await db.exec(fs.readFileSync('tests/profile-avatar.rollback.sql','utf8'));
 assert(results.some(r=>r.rows?.some(row=>row.avatar_verified===true&&row.avatar_test_rows_absent===true)));
 for(const table of['auth.users','public.zc_companies','public.zc_members','public.zc_audit','storage.objects','snote_private.profile_avatars'])assert.equal((await db.query('select count(*)::int n from '+table)).rows[0].n,0);
 console.log('PASS profile-avatar migration idempotency, own-only storage ACL/RLS, immutable file CAS/idempotent retries, metadata bounds, current-reference protection, all roles/account changes and rollback');
}finally{await db.close()}})().catch(error=>{console.error(error);process.exitCode=1});
