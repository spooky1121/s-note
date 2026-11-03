import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const {PGlite}=require('@electric-sql/pglite');
const root=new URL('../',import.meta.url),original=fs.readFileSync(new URL('supabase/migrations/202611010001_customer_intake.sql',root),'utf8');const start=original.indexOf('create or replace function snote_intake_private.lock_actor_car('),end=original.indexOf('$function$;',start)+12,baseline=original.slice(start,end);
const migration=fs.readFileSync(new URL('supabase/migrations/20261103140147_customer_intake_won_precision.sql',root),'utf8');
const owner='11111111-1111-4111-8111-111111111111',company='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='22222222-2222-4222-8222-222222222222';
test('actual intake function accepts one-won prices after migration and retains company/owner/status gates and ACL',async()=>{
 const db=new PGlite();await db.waitReady;try{
 await db.exec('create schema snote_intake_private;create table public.zc_members(user_id uuid,company_id uuid,active boolean,role text);create table public.zc_datasets(company_id uuid,owner_id uuid,dataset text,payload jsonb);');await db.exec(baseline);
 await db.query('insert into public.zc_members values($1,$2,true,$3)',[owner,company,'dealer']);await db.query('insert into public.zc_datasets values($1,$2,$3,$4::jsonb)',[company,owner,'cars',JSON.stringify([{id:'unit-car',model:'합성 차량',plate:'12가3456',sell:2300.0001,status:'판매중'}])]);
 const read=async(o=owner,c=company,sold=false)=>(await db.query('select snote_intake_private.lock_actor_car($1,$2,$3,$4) as car',[o,c,'unit-car',sold])).rows[0].car;
 const metadata=async()=>(await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='snote_intake_private.lock_actor_car(uuid,uuid,text,boolean)'::regprocedure")).rows[0];
 const before=await metadata();assert.equal((await read()).sell,null,'The old two-decimal wire validator drops a one-won price');await db.exec(migration);await db.exec(migration);assert.deepEqual(await metadata(),before);assert.equal((await read()).sell,2300.0001);
 assert.equal(Math.round((await read()).sell*10000),23000001);assert.equal(await read(other),null);assert.equal(await read(owner,other),null);
 await db.query("update public.zc_members set active=false");assert.equal(await read(),null);await db.query('update public.zc_members set active=true');
 await db.query("update public.zc_datasets set payload=jsonb_set(payload,'{0,status}','\"판매완료\"')");assert.equal(await read(),null);assert.equal((await read(owner,company,true)).sell,2300.0001);
 await db.query("update public.zc_datasets set payload=jsonb_set(payload,'{0,sell}','2300.00001')");assert.equal((await read(owner,company,true)).sell,null,'Sub-won wire values remain invalid');
 }finally{await db.close();}
});
