'use strict';
// Isolated real PostgreSQL (PGlite) with synthetic users, sessions and schedules.
// NODE_PATH=/workspace/work/deps/node_modules node tests/accountant-schedule.sql.cjs
// No hosted database, operational data, Auth configuration or provider is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createSchedulerFixture,COMPANY,FOREIGN,OWNER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE,OP}=require('./dealer-schedule.sql.cjs');
const FILE='20261126105413_accountant_personal_schedule.sql',SQL=fs.readFileSync(path.join(__dirname,'../supabase/migrations',FILE),'utf8');
const OTHER_ACCOUNTANT='88888888-8888-4888-8888-888888888888';
let db,sessions,passed=0,failed=0;const checks=[];
const q=(sql,args=[])=>db.query(sql,args),value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function as(role,actor,session,fn,extra={}){
 await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
 await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:actor||undefined,session_id:session||undefined,...extra})]);
 await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
const rpc=(name,args,actor=ACCOUNTANT,company=COMPANY,options={})=>as(options.role||'authenticated',actor,options.session===undefined?sessions.get(actor):options.session,()=>value('select public.snote_schedule_'+name+'('+['$1',...args.map((_,i)=>'$'+(i+2))].join(',')+')',[company,...args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x)]),options.claims||{});
const list=(month='2026-11',actor=ACCOUNTANT,company=COMPANY,options)=>rpc('list',[month],actor,company,options);
const save=(event,expected=0,actor=ACCOUNTANT,company=COMPANY,options)=>rpc('save',[event,expected],actor,company,options);
const remove=(id,expected=1,actor=ACCOUNTANT,company=COMPANY,options)=>rpc('delete',[id,expected],actor,company,options);
const event=(patch={})=>({id:randomUUID(),title:'Synthetic accounting appointment',notes:'Synthetic private notes',eventDate:'2026-11-26',time:'09:30',completed:false,...patch});
async function denied(fn,codes=['42501'],message){await assert.rejects(fn,e=>codes.includes(e.code)&&(!message||e.message===message));}
async function blockedActor(actor=ACCOUNTANT,company=COMPANY,options={}){await denied(()=>list('2026-11',actor,company,options));await denied(()=>save(event(),0,actor,company,options));await denied(()=>remove(randomUUID(),1,actor,company,options));}
async function test(name,fn){try{await fn();passed++;checks.push({name,passed:true});console.log('PASS',name);}catch(e){failed++;checks.push({name,passed:false,code:e.code,message:e.message});process.exitCode=1;console.error('FAIL',name,{code:e.code,message:e.message,where:e.where,stack:e.stack});}}
const dataSnapshot=()=>value("select jsonb_build_object('events',(select jsonb_agg(to_jsonb(e) order by id) from snote_schedule_private.events e),'datasets',(select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d),'members',(select jsonb_agg(to_jsonb(m) order by user_id) from public.zc_members m),'users',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),'sessions',(select jsonb_agg(to_jsonb(s) order by id) from auth.sessions s))");
const functionSnapshot=()=>value("select jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','snote_schedule_private','snote_operator_private')");
const boundarySnapshot=()=>value("select jsonb_build_object('schema',(select jsonb_build_object('owner',nspowner,'acl',nspacl) from pg_namespace where nspname='snote_schedule_private'),'table',(select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) from pg_class where oid='snote_schedule_private.events'::regclass),'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in('public','snote_schedule_private'))) ");
async function main(){({db,sessions}=await createSchedulerFixture());try{
 await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[OTHER_ACCOUNTANT,'accountant-peer@example.invalid']);await q("insert into public.zc_members(user_id,company_id,role,display_name) values($1,$2,'accountant','Synthetic accountant peer')",[OTHER_ACCOUNTANT,COMPANY]);const sid=randomUUID();sessions.set(OTHER_ACCOUNTANT,sid);await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,OTHER_ACCOUNTANT]);
 const ownerEvent=(await save(event({title:'Dealer private appointment'}),0,OWNER)).event,adminEvent=(await save(event({title:'Admin private appointment'}),0,ADMIN)).event,foreignEvent=(await save(event({title:'Foreign private appointment'}),0,OUTSIDER,FOREIGN)).event;
 const tombstone=(await save(event({title:'Preserved old tombstone'}),0,OWNER)).event;await remove(tombstone.id,1,OWNER);
 await test('the prior migration rejects accountants before the explicit follow-up is applied',async()=>blockedActor());
 const beforeData=await dataSnapshot(),beforeFunctions=await functionSnapshot(),beforeBoundaries=await boundarySnapshot();
 await db.exec(SQL);
 await test('only the actor role predicate changes; OID/owner/ACL/security/search_path and all other functions remain exact',async()=>{
  const after=await functionSnapshot(),keys=Object.keys(beforeFunctions);assert.deepEqual(Object.keys(after).sort(),keys.sort());let actorChanges=0;
  for(const key of keys){if(key.startsWith('snote_schedule_private.actor(')){actorChanges++;const expected=structuredClone(beforeFunctions[key]);assert(expected.definition.includes("m.role in('admin','dealer')"));expected.definition=expected.definition.replace("m.role in('admin','dealer')","m.role in('admin','dealer','accountant')");assert.deepEqual(after[key],expected);}else assert.deepEqual(after[key],beforeFunctions[key],key);}
  assert.equal(actorChanges,1);assert.deepEqual(await boundarySnapshot(),beforeBoundaries);assert.deepEqual(await dataSnapshot(),beforeData);
 });
 await test('private table/RLS/direct function denial and the existing authenticated RPC grants are unchanged',async()=>{
  for(const role of['anon','authenticated','service_role'])for(const privilege of['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await value('select has_table_privilege($1,$2,$3)',[role,'snote_schedule_private.events',privilege]),false);
  for(const [name,sig]of[['list','uuid,text'],['save','uuid,jsonb,integer'],['delete','uuid,uuid,integer']]){const signature='public.snote_schedule_'+name+'('+sig+')';assert.equal(await value('select prosecdef from pg_proc where oid=$1::regprocedure',[signature]),false);for(const role of['anon','service_role'])assert.equal(await value('select has_function_privilege($1,$2,$3)',[role,signature,'EXECUTE']),false);assert.equal(await value('select has_function_privilege($1,$2,$3)',['authenticated',signature,'EXECUTE']),true);}
  assert.equal(await value("select has_function_privilege('authenticated','snote_schedule_private.actor(uuid)','EXECUTE')"),false);await denied(()=>as('authenticated',ACCOUNTANT,sessions.get(ACCOUNTANT),()=>q('select * from snote_schedule_private.events')));
 });
 let own,peer;
 await test('an active accountant creates, lists and reads only their own canonical schedule',async()=>{
  own=(await save(event({title:'  Accounting private appointment  '}))).event;peer=(await save(event({title:'Accountant peer appointment'}),0,OTHER_ACCOUNTANT)).event;
  assert.equal(own.title,'Accounting private appointment');assert.equal(own.revision,1);assert.deepEqual(Object.keys(own).sort(),['id','title','notes','eventDate','time','completed','revision','createdAt','updatedAt'].sort());
  const data=await list();assert.equal(data.ownerId,ACCOUNTANT);assert.equal(data.companyId,COMPANY);assert.deepEqual(data.events.map(x=>x.id),[own.id]);assert(!JSON.stringify(data).includes(peer.id));assert(!JSON.stringify(data).includes(ownerEvent.id));assert(!JSON.stringify(data).includes(adminEvent.id));assert(!JSON.stringify(data).includes(foreignEvent.id));
 });
 await test('same-company accountants, dealers and administrators cannot read, update, delete or recreate each other UUIDs',async()=>{
  const actors=[[ACCOUNTANT,own],[OTHER_ACCOUNTANT,peer],[OWNER,ownerEvent],[ADMIN,adminEvent]];
  for(const[actor,mine]of actors){const data=await list('2026-11',actor);assert(data.events.some(x=>x.id===mine.id));for(const[other,theirs]of actors)if(actor!==other){assert(!data.events.some(x=>x.id===theirs.id));await denied(()=>save({...event(),id:theirs.id},theirs.revision,actor),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>save({...event(),id:theirs.id},0,actor),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(theirs.id,theirs.revision,actor),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');}}
 });
 await test('a foreign company cannot expose any accountant schedule through list or known event UUID',async()=>{
  await blockedActor(ACCOUNTANT,FOREIGN);await blockedActor(OUTSIDER,COMPANY);
  const data=await list('2026-11',OUTSIDER,FOREIGN);assert(!data.events.some(x=>x.id===own.id));await denied(()=>save({...event(),id:own.id},1,OUTSIDER,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(own.id,1,OUTSIDER,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>save({...event(),id:foreignEvent.id},1),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');
 });
 let current;
 await test('accountant duplicate ACKs and CAS reject competing stale payloads without lost updates',async()=>{
  const input={id:own.id,title:own.title,notes:own.notes,eventDate:own.eventDate,time:own.time,completed:own.completed};assert.equal((await save(input,0)).duplicate,true);
  const update={...input,title:'Updated accounting appointment',completed:true};const result=await save(update,1);current=result.event;assert.equal(current.revision,2);assert.equal(result.duplicate,false);assert.equal((await save(update,1)).duplicate,true);await denied(()=>save({...update,title:'Stale accounting draft'},1),['40001']);assert.equal((await list()).events.find(x=>x.id===own.id).title,update.title);
  const next={...update,notes:'Newest accounting note'};current=(await save(next,2)).event;assert.equal(current.revision,3);await denied(()=>save(update,1),['40001']);
 });
 await test('a company move rejects the old scope and cannot carry the same person or another owner events into the new scope',async()=>{
  await q('update public.zc_members set company_id=$2 where user_id=$1',[ACCOUNTANT,FOREIGN]);try{await blockedActor(ACCOUNTANT,COMPANY);const moved=await list('2026-11',ACCOUNTANT,FOREIGN);assert.deepEqual(moved.events,[]);for(const id of[own.id,foreignEvent.id]){await denied(()=>save({...event(),id},1,ACCOUNTANT,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(id,1,ACCOUNTANT,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');}}finally{await q('update public.zc_members set company_id=$2 where user_id=$1',[ACCOUNTANT,COMPANY]);}assert((await list()).events.some(x=>x.id===own.id));
 });
 await test('inactive, unsupported-role and archived accountants/companies fail all RPCs without granting from claims',async()=>{
  await q('update public.zc_members set active=false where user_id=$1',[ACCOUNTANT]);try{await blockedActor();await blockedActor(ACCOUNTANT,COMPANY,{claims:{user_metadata:{role:'admin',company_id:COMPANY},app_metadata:{role:'admin'}}});}finally{await q('update public.zc_members set active=true where user_id=$1',[ACCOUNTANT]);}
  await q("update public.zc_members set role='unsupported' where user_id=$1",[ACCOUNTANT]);try{await blockedActor();}finally{await q("update public.zc_members set role='accountant' where user_id=$1",[ACCOUNTANT]);}
  for(const [table,column,id]of[['account_state','user_id',ACCOUNTANT],['company_state','company_id',COMPANY]]){await q('insert into snote_operator_private.'+table+'('+column+',archived) values($1,true)',[id]);try{await blockedActor();}finally{await q('delete from snote_operator_private.'+table+' where '+column+'=$1',[id]);}}
  await blockedActor(INACTIVE);
 });
 await test('an actual operator remains excluded even when their member role is accountant and operator active is false',async()=>{
  await q("update public.zc_members set role='accountant' where user_id=$1",[OP]);for(const active of[true,false]){await q('update snote_operator_private.operators set active=$2 where user_id=$1',[OP,active]);await blockedActor(OP);}await q("update public.zc_members set role='dealer' where user_id=$1",[OP]);
 });
 await test('accountant live-session checks reject missing, malformed, foreign, revoked and expired sessions for all RPCs',async()=>{
  for(const session of[null,'not-a-uuid',randomUUID(),sessions.get(ADMIN)])await blockedActor(ACCOUNTANT,COMPANY,{session});
  const id=sessions.get(ACCOUNTANT);await q("update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=$1",[id]);try{await blockedActor();}finally{await q('update auth.sessions set not_after=null where id=$1',[id]);}
  await q('delete from auth.sessions where id=$1',[id]);try{await blockedActor();}finally{await q('insert into auth.sessions(id,user_id) values($1,$2)',[id,ACCOUNTANT]);}
  for(const role of['anon','service_role'])await blockedActor(ACCOUNTANT,COMPANY,{role});await blockedActor(ACCOUNTANT,COMPANY,{claims:{is_anonymous:true}});
 });
 await test('unconfirmed, deleted, banned and anonymous accountants cannot regain schedule access',async()=>{
  for(const [column,bad,good]of[['email_confirmed_at',null,new Date().toISOString()],['deleted_at',new Date().toISOString(),null],['banned_until',new Date(Date.now()+3600000).toISOString(),null],['is_anonymous',true,false]]){await q('update auth.users set '+column+'=$2 where id=$1',[ACCOUNTANT,bad]);try{await blockedActor();}finally{await q('update auth.users set '+column+'=$2 where id=$1',[ACCOUNTANT,good]);}}
 });
 await test('accountant deletion remains an idempotent CAS tombstone and stale writes cannot resurrect it',async()=>{
  await denied(()=>remove(own.id,2),['40001']);const removed=await remove(own.id,3);assert.equal(removed.deleted,true);assert.equal(removed.duplicate,false);assert.equal(removed.revision,4);const again=await remove(own.id,3);assert.equal(again.duplicate,true);assert.equal(again.revision,4);assert(!(await list()).events.some(x=>x.id===own.id));assert(await value('select deleted_at from snote_schedule_private.events where id=$1',[own.id]));await denied(()=>save({...event(),id:own.id},0),['40001']);await denied(()=>save({...event(),id:own.id},3),['40001']);
 });
 await test('accountants retain strict date/payload validation and their private month/today/upcoming counts',async()=>{
  for(const patch of[{eventDate:'2025-02-29'},{eventDate:'2026-04-31'},{eventDate:'0000-01-01'},{time:'24:00'},{time:'09:30:01'},{title:''},{title:'x'.repeat(101)},{notes:'x'.repeat(2001)},{companyId:FOREIGN},{ownerId:ADMIN},{revision:1}])await denied(()=>save(event(patch)),['22023']);
  const today=await value("select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD')"),future=await value("select to_char((clock_timestamp() at time zone 'Asia/Seoul')::date+1,'YYYY-MM-DD')");await save(event({eventDate:today}));await save(event({eventDate:future}));await save(event({eventDate:today}),0,OTHER_ACCOUNTANT);const data=await list(today.slice(0,7));assert.equal(data.todayEvents.length,1);assert.equal(data.counts.today,1);assert.equal(data.upcomingEvents.length,1);assert.equal(data.counts.upcoming,1);assert.equal(data.dayCounts[today],1);assert.equal(data.ownerId,ACCOUNTANT);
 });
 await test('reapplying the follow-up preserves all schedule rows/tombstones and unrelated datasets/functions/boundaries',async()=>{
  const data=await dataSnapshot(),functions=await functionSnapshot();await db.exec(SQL);assert.deepEqual(await dataSnapshot(),data);assert.deepEqual(await functionSnapshot(),functions);assert.deepEqual(await boundarySnapshot(),beforeBoundaries);assert.deepEqual((await dataSnapshot()).datasets,beforeData.datasets);
 });
 const result={ok:failed===0,version:'2.238',isolatedPostgres:true,operatingReads:0,operatingWrites:0,migration:FILE,migrationSHA256:createHash('sha256').update(SQL).digest('hex'),passed,failed,checks,documentation:['https://supabase.com/docs/guides/database/functions','https://supabase.com/docs/guides/database/postgres/row-level-security'],limitations:['PGlite provides isolated real PostgreSQL semantics; hosted concurrency and production schema drift must be checked separately.','Changelog HTTP fetch was blocked by the environment gateway (403); current official function/RLS documentation was read with the connected documentation tool.']};const output=process.env.SNOTE_ACCOUNTANT_SCHEDULE_SQL_RESULT;if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');}console.log(JSON.stringify({passed,failed,migration:FILE,sha256:result.migrationSHA256}));
 }finally{await db.close();}}
module.exports={FILE,SQL};
if(require.main===module)main().catch(error=>{console.error({code:error.code,message:error.message,where:error.where,stack:error.stack});process.exitCode=1;});
