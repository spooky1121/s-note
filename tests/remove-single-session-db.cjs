'use strict';
// A disposable PGlite PostgreSQL fixture. No live project or credentials.
// NODE_PATH=/workspace/work/deps/node_modules node tests/remove-single-session-db.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createOperatorFixture}=require('./operator-core.sql.cjs');
const {OWNER,COMPANY,OUTSIDER,FOREIGN}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..');
const INSTALL=fs.readFileSync(path.join(ROOT,'supabase/migrations/20261109161432_single_active_account_session.sql'),'utf8');
const FILE=fs.readdirSync(path.join(ROOT,'supabase/migrations')).find(f=>f.endsWith('_remove_single_active_account_session.sql'));
assert(FILE);const REMOVE=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const A='a0000000-0000-4000-8000-000000000001',B='b0000000-0000-4000-8000-000000000002';
let db,passed=0;
const q=(sql,args=[])=>db.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function group(name,fn){await fn();passed++;console.log('PASS',name);}
async function snapshot(){
 const tables=(await q("select schemaname,tablename from pg_tables where schemaname in('public','storage','auth') and tablename<>'snote_session_signals' order by schemaname,tablename")).rows;
 const rows={};
 for(const t of tables){const table='"'+t.schemaname+'"."'+t.tablename+'"';rows[t.schemaname+'.'+t.tablename]=await val('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,\'[]\')) from '+table+' t');}
 const policies=(await q("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where policyname not in('snote_primary_session_guard','snote_primary_session_storage','snote_session_signal_own') order by schemaname,tablename,policyname")).rows;
 const grants=(await q("select table_schema,table_name,grantee,privilege_type,is_grantable from information_schema.role_table_grants where table_schema in('public','storage','auth') and table_name<>'snote_session_signals' order by table_schema,table_name,grantee,privilege_type")).rows;
 return {rows,policies,grants,operator:await val("select pg_get_functiondef('snote_operator_private.verified_session(uuid,uuid)'::regprocedure)")};
}
async function as(sid,fn){
 await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[OWNER,JSON.stringify({role:'authenticated',sub:OWNER,session_id:sid,is_anonymous:false})]);
 await db.exec('set role authenticated');try{return await fn();}finally{await db.exec('reset role');}
}
async function main(){
 db=await createOperatorFixture();
 try{
  await db.exec('create role authenticator;create publication supabase_realtime;');
  await q("insert into auth.sessions(id,user_id,created_at) values($1,$3,'2026-01-01'),($2,$3,'2026-01-02')",[A,B,OWNER]);
  await q("insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision) values($1,'cars',$2,'[{\"id\":\"synthetic-owned-car\"}]',1),($3,'cars',$4,'[{\"id\":\"synthetic-foreign-car\"}]',1)",[COMPANY,OWNER,FOREIGN,OUTSIDER]);
  await q("insert into storage.objects(bucket_id,name) values('zc-vehicle-private',$1),('zc-vehicle-private',$2)",[COMPANY+'/'+OWNER+'/test.jpg',FOREIGN+'/'+OUTSIDER+'/test.jpg']);
  const before=await snapshot();
  await db.exec(INSTALL);
  await q("insert into snote_session_private.primary_sessions(user_id,session_id,session_created_at,generation) values($1,$2,'2026-01-02',1)",[OWNER,B]);
  await q('insert into snote_session_private.pending_claims(session_id,user_id) values($1,$2)',[A,OWNER]);
  await group('fixture recreates the old losing-session restriction',async()=>{
   assert.equal(await as(A,()=>val('select snote_session_private.is_current()')),false);
   assert.equal(await as(B,()=>val('select snote_session_private.is_current()')),true);
   assert.equal(await as(A,()=>val('select count(*)::int from public.zc_datasets')),0);
   assert((await as(B,()=>val('select count(*)::int from public.zc_datasets')))>0);
  });
  await db.exec(REMOVE);
  await group('all original Auth, business, Storage rows, policies and grants are unchanged',async()=>{
   assert.deepEqual(await snapshot(),before);
  });
  await group('both same-account sessions read their authorized data and operator helper accepts both live sessions',async()=>{
   const counts=[];
   for(const sid of[A,B]){
    counts.push(await as(sid,()=>val('select count(*)::int from public.zc_datasets')));
    assert.equal(await val('select count(*)::int from snote_operator_private.verified_session($1,$2)',[OWNER,sid]),1);
   }
   assert(counts[0]>0);assert.equal(counts[0],counts[1]);
   assert.equal(counts[0],1,'Original company/owner RLS still excludes the foreign record');
   for(const sid of[A,B])assert.equal(await as(sid,()=>val('select count(*)::int from storage.objects')),1,'Storage still excludes the foreign company');
  });
  await group('feature hook, policies, RPCs, publication membership and private schema are removed',async()=>{
   assert.equal(await val("select count(*)::int from pg_db_role_setting s cross join lateral unnest(s.setconfig) c(setting) where c.setting like 'pgrst.db_pre_request=%'"),0);
   assert.equal(await val("select count(*)::int from pg_policies where policyname in('snote_primary_session_guard','snote_primary_session_storage','snote_session_signal_own')"),0);
   assert.equal(await val("select to_regprocedure('public.snote_session_status()') is null and to_regprocedure('public.snote_session_claim(boolean,bigint)') is null"),true);
   assert.equal(await val("select count(*)::int from pg_namespace where nspname='snote_session_private'"),0);
   assert.equal(await val("select count(*)::int from pg_publication_tables where pubname='supabase_realtime' and tablename='snote_session_signals'"),0);
  });
  await group('removal is replayable without changing original authorization or records',async()=>{
   await db.exec(REMOVE);assert.deepEqual(await snapshot(),before);
  });
  await group('an independently changed request hook aborts removal without replacing that hook',async()=>{
   await db.exec("alter role authenticator set pgrst.db_pre_request='public.independent_hook'");
   await assert.rejects(db.exec(REMOVE),e=>e.code==='55000');await db.exec('rollback');
   assert.equal(await val("select exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) c(setting) where c.setting='pgrst.db_pre_request=public.independent_hook')"),true);
   assert.deepEqual(await snapshot(),before);
   await db.exec('alter role authenticator reset pgrst.db_pre_request');
  });
  console.log(JSON.stringify({passed,failed:0,syntheticOnly:true,migration:FILE,productionChanges:false}));
 }finally{await db.close();}
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
