'use strict';
// Actual branding migrations and committed company/owner policies, synthetic tenants only.
// NODE_PATH=/workspace/work/deps/node_modules node tests/company-office-stamp.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const ROOT=path.resolve(__dirname,'..'),BASELINE=JSON.parse(/const BASELINE=(.*);\n/.exec(fs.readFileSync(path.join(__dirname,'recycle-bin-db.cjs'),'utf8'))[1]);
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',ADMIN='11111111-1111-4111-8111-111111111111',DEALER='22222222-2222-4222-8222-222222222222',ACCOUNTANT='33333333-3333-4333-8333-333333333333',OUTSIDER='44444444-4444-4444-8444-444444444444',INACTIVE='55555555-5555-4555-8555-555555555555',OTHER_ADMIN='66666666-6666-4666-8666-666666666666';
const quote=value=>'"'+value.replaceAll('"','""')+'"';
(async()=>{const db=new PGlite();await db.waitReady;let groups=0;const pass=text=>{groups++;console.log('PASS '+text);};try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.zc_companies(id uuid primary key,name text not null);
 create table public.zc_members(user_id uuid primary key,company_id uuid references public.zc_companies(id),role text not null,active boolean not null);
 create table public.zc_media(company_id uuid not null,owner_id uuid not null,id text not null,car_id text not null,file_path text not null,original_name text not null,mime_type text not null,file_size bigint not null,group_name text not null,meta jsonb not null default '{}',primary key(company_id,owner_id,id));
 create table storage.buckets(id text primary key,public boolean not null);
 create table storage.objects(bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb not null default '{}',primary key(bucket_id,name));
 alter table public.zc_media enable row level security;alter table storage.objects enable row level security;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 grant select on public.zc_members to authenticated;
 grant select,insert,delete on public.zc_media,storage.objects to authenticated,anon;
 insert into storage.buckets values('zc-vehicle-private',false),('unrelated-private',false);
 insert into public.zc_companies values('${COMPANY}','Synthetic company A'),('${FOREIGN}','Synthetic company B');
 insert into public.zc_members values('${ADMIN}','${COMPANY}','admin',true),('${DEALER}','${COMPANY}','dealer',true),('${ACCOUNTANT}','${COMPANY}','accountant',true),('${OUTSIDER}','${FOREIGN}','dealer',true),('${INACTIVE}','${COMPANY}','admin',false),('${OTHER_ADMIN}','${FOREIGN}','admin',true);`);
 await db.exec(BASELINE.functions.find(row=>row.name==='zc_is_member').definition);
 // These are the existing permissive policies, not permissive test substitutes.
 for(const policy of BASELINE.policies.filter(row=>row.permissive==='PERMISSIVE'&&((row.schema==='public'&&row.table==='zc_media')||(row.schema==='storage'&&row.table==='objects'&&row.name!=='snote_shared_vehicle_file_read')))){
  await db.exec('create policy '+quote(policy.name)+' on '+quote(policy.schema)+'.'+quote(policy.table)+' for '+policy.command+' to '+policy.roles.map(quote).join(',')+(policy.using?' using('+policy.using+')':'')+(policy.check?' with check('+policy.check+')':''));
 }
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/202610240002_company_branding.sql'),'utf8'));
 const migration=fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(file=>file.endsWith('_company_office_stamp.sql')).sort().at(-1);assert(migration,'Office-stamp migration must exist');
 const sql=fs.readFileSync(path.join(ROOT,'supabase/migrations',migration),'utf8');assert(sql.includes('companyOfficeStamp'),'Office-stamp migration must be ready');
 const catalog=async()=>({grants:(await db.query("select table_schema,table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema in('public','storage') order by 1,2,3,4")).rows,storagePolicies:(await db.query("select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='storage' order by policyname")).rows});
 const before=await catalog();await db.exec(sql);await db.exec(sql);assert.deepEqual(await catalog(),before,'Migration preserves existing grants and storage policies');assert.equal((await db.query("select public from storage.buckets where id='zc-vehicle-private'")).rows[0].public,false);
 pass('migration is repeatable and preserves existing grants, private buckets and storage policies');
 const actor=async(id,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+quote(role));};
 const record=(id,kind='companyOfficeStamp',owner=ADMIN,company=COMPANY,extra={})=>({company_id:company,owner_id:owner,id,car_id:'company-brand',file_path:[company,owner,'branding',id+'.png'].join('/'),original_name:'synthetic.png',mime_type:'image/png',file_size:123,group_name:kind,...extra});
 const insert=row=>db.query('insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[row.company_id,row.owner_id,row.id,row.car_id,row.file_path,row.original_name,row.mime_type,row.file_size,row.group_name]);
 const store=row=>db.query("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1)",[row.file_path]);
 const denied=async(action,code='42501')=>{let error;try{await action();}catch(value){error=value;}assert(error,'Operation must be rejected');assert.equal(error.code,code,error.message);};
 const count=async(table,where='',args=[])=>Number((await db.query('select count(*)::integer as n from '+table+(where?' where '+where:''),args)).rows[0].n);
 await actor(ADMIN);const originals=[];
 for(const [id,kind]of[['round-original','companyStamp'],['logo-original','companyLogo'],['office-original','companyOfficeStamp']]){const row=record(id,kind);await store(row);await insert(row);originals.push(row);}
 assert.equal(await count('public.zc_media'),3);assert.equal(await count('storage.objects'),3);
 pass('company administrator can register separate round seal, logo and office stamp in the private company path');
 for(const [id,label]of[[DEALER,'dealer'],[ACCOUNTANT,'accountant']]){
  await actor(id);assert.equal(await count('public.zc_media'),3);assert.equal(await count('storage.objects'),3);
  const row=record(label+'-forbidden','companyOfficeStamp',id);await denied(()=>insert(row));await denied(()=>store(row));
  assert.equal((await db.query("delete from public.zc_media where group_name='companyOfficeStamp' returning id")).rows.length,0);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[originals[2].file_path])).rows.length,0);
  await denied(()=>db.query("update public.zc_media set original_name='forbidden.png' where group_name='companyOfficeStamp'"));
 }
 pass('same-company dealer and accountant can read all branding but cannot upload, delete or update office-stamp metadata/files');
 for(const [id,role]of[[OUTSIDER,'authenticated'],[OTHER_ADMIN,'authenticated'],[INACTIVE,'authenticated'],['','anon']]){
  await actor(id,role);assert.equal(await count('public.zc_media'),0);assert.equal(await count('storage.objects'),0);
  const row=record('forbidden-'+(id||'anon'),'companyOfficeStamp',id||DEALER);await denied(()=>insert(row));await denied(()=>store(row));
  assert.equal((await db.query('delete from public.zc_media returning id')).rows.length,0);assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
 }
 pass('foreign-company dealer/admin, inactive member and anonymous actors cannot read or change the company assets');
 await actor(OTHER_ADMIN);const foreign=record('foreign-office','companyOfficeStamp',OTHER_ADMIN,FOREIGN);await store(foreign);await insert(foreign);assert.equal(await count('public.zc_media'),1);assert.equal(await count('storage.objects'),1);
 await actor(ADMIN);assert.equal(await count('public.zc_media'),3);assert.equal(await count('storage.objects'),3);
 await denied(()=>insert(record('spoofed-owner','companyOfficeStamp',DEALER)));await denied(()=>store(record('spoofed-storage','companyOfficeStamp',DEALER)));
 pass('each administrator is limited to their own company and upload ownership');
 const invalid=[{car_id:'vehicle-id'},{file_size:0},{file_size:3145729},{mime_type:'image/svg+xml'},{file_path:'https://example.invalid/private.png'},{file_path:FOREIGN+'/'+ADMIN+'/branding/invalid.png'},{file_path:COMPANY+'/'+DEALER+'/branding/invalid.png'},{id:'nested/id'},{id:''},{file_path:COMPANY+'/'+ADMIN+'/branding/wrong-extension.jpg'},{group_name:'companyOfficeStampUnknown'}];
 for(let i=0;i<invalid.length;i++)await denied(()=>insert(record('invalid-'+i,'companyOfficeStamp',ADMIN,COMPANY,invalid[i])),'23514');
 for(const [id,type,ext,size]of[['upper-png','image/png','png',3145728],['jpeg','image/jpeg','jpg',1],['webp','image/webp','webp',3]]){const row=record('valid-'+id,'companyOfficeStamp',ADMIN,COMPANY,{mime_type:type,file_size:size});row.file_path=[COMPANY,ADMIN,'branding',row.id+'.'+ext].join('/');await insert(row);assert.equal((await db.query('delete from public.zc_media where id=$1 returning id',[row.id])).rows.length,1);}
 pass('office-stamp constraints reject invalid company/owner paths, MIME, sizes, names and car scopes while accepting image bounds');
 // Branding restrictions remain neutral for existing non-branding owner paths.
 await actor(DEALER);const vehicle=record('vehicle-photo','photos',DEALER,COMPANY,{car_id:'synthetic-car',file_path:[COMPANY,DEALER,'synthetic-car','vehicle-photo.png'].join('/')});await store(vehicle);await insert(vehicle);
 assert.equal((await db.query('delete from public.zc_media where id=$1 returning id',[vehicle.id])).rows.length,1);assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[vehicle.file_path])).rows.length,1);
 pass('branding guards preserve the existing permissive vehicle-owner media and storage policies');
 await actor(ADMIN);assert.equal((await db.query("delete from public.zc_media where group_name='companyOfficeStamp' returning id")).rows.length,1);assert.equal((await db.query('delete from storage.objects where name=$1 returning name',[originals[2].file_path])).rows.length,1);
 assert.deepEqual((await db.query('select id,group_name from public.zc_media order by id')).rows,[{id:'logo-original',group_name:'companyLogo'},{id:'round-original',group_name:'companyStamp'}]);
 await actor(OTHER_ADMIN);assert.equal(await count('public.zc_media'),1);assert.equal(await count('storage.objects'),1);
 pass('office-stamp deletion preserves the existing round seal, logo and other-company office stamp');
 console.log(groups+' company office stamp PostgreSQL groups passed; synthetic local PGlite only. Storage API file transport and concurrent sessions are outside this SQL test.');
 }finally{await db.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
