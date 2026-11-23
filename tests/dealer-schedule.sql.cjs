'use strict';
// Real isolated PostgreSQL only. All actors, sessions, schedules and financial
// fixtures are synthetic; no hosted database, provider, email or SMS is used.
// NODE_PATH=/workspace/work/deps/node_modules node tests/dealer-schedule.sql.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createOperatorFixture,OP}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE}=require('./recycle-bin-db.cjs');
const ROOT=path.join(__dirname,'..'),FILE='20261123150038_dealer_personal_schedule.sql',SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const CAPPED='72345678-9abc-4def-8123-456789abcdef';
let db,sessions,passed=0,failed=0;
const q=(sql,args=[])=>db.query(sql,args),value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0])[0];
async function createSchedulerFixture({apply=true}={}){
 const d=await createOperatorFixture(),s=new Map();
 for(const actor of[OWNER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE]){const sid=randomUUID();s.set(actor,sid);await d.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,actor]);}
 for(const actor of[OP,CAPPED]){await d.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[actor,actor+'@example.invalid']);await d.query("insert into public.zc_members(user_id,company_id,role,display_name) values($1,$2,'dealer','Synthetic scheduler')",[actor,COMPANY]);const sid=randomUUID();s.set(actor,sid);await d.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,actor]);}
 await d.query('insert into snote_operator_private.operators(user_id,active) values($1,true)',[OP]);
 if(apply)await d.exec(SQL);return{db:d,sessions:s};
}
async function as(role,actor,session,fn,extra={}){
 await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
 await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:actor||undefined,session_id:session||undefined,...extra})]);
 await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
const rpc=(name,args,actor=OWNER,company=COMPANY,options={})=>as(options.role||'authenticated',actor,options.session===undefined?sessions.get(actor):options.session,()=>value('select public.snote_schedule_'+name+'('+['$1',...args.map((_,i)=>'$'+(i+2))].join(',')+')',[company,...args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x)]),options.claims||{});
const list=(month='2026-11',actor=OWNER,company=COMPANY,options)=>rpc('list',[month],actor,company,options);
const save=(event,expected=0,actor=OWNER,company=COMPANY,options)=>rpc('save',[event,expected],actor,company,options);
const remove=(id,expected,actor=OWNER,company=COMPANY,options)=>rpc('delete',[id,expected],actor,company,options);
const event=(patch={})=>({id:randomUUID(),title:'Synthetic appointment',notes:'Synthetic notes\nSecond line',eventDate:'2026-11-23',time:'09:30',completed:false,...patch});
async function denied(fn,codes=['42501'],message){await assert.rejects(fn,e=>codes.includes(e.code)&&(!message||e.message===message));}
async function test(name,fn){try{await fn();passed++;console.log('PASS',name);}catch(e){failed++;process.exitCode=1;console.error('FAIL',name,{code:e.code,message:e.message,where:e.where,stack:e.stack});}}
const definitions=()=>value("select jsonb_object_agg(n.nspname||'.'||p.proname,pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_operator_private' and p.proname in('claim_session','verified_session','actor','account_snapshot','account_version')");
async function main(){({db,sessions}=await createSchedulerFixture({apply:false}));try{
 const beforeDefs=await definitions(),beforeDatasets=await value('select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d');
 await db.exec(SQL);
 await test('migration preserves financial datasets and existing Auth/session/CAS functions',async()=>{
  assert.deepEqual(await definitions(),beforeDefs);assert.deepEqual(await value('select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d'),beforeDatasets);
 });
 await test('RLS/direct-table deny and narrowly granted invoker/definer boundaries are exact',async()=>{
  assert.equal(await value("select relrowsecurity from pg_class where oid='snote_schedule_private.events'::regclass"),true);
  for(const role of['anon','authenticated','service_role'])for(const privilege of['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(await value('select has_table_privilege($1,$2,$3)',[role,'snote_schedule_private.events',privilege]),false);
  for(const [name,sig]of[['list','uuid,text'],['save','uuid,jsonb,integer'],['delete','uuid,uuid,integer']]){const signature='public.snote_schedule_'+name+'('+sig+')';assert.equal(await value('select prosecdef from pg_proc where oid=$1::regprocedure',[signature]),false);for(const role of['anon','service_role'])assert.equal(await value('select has_function_privilege($1,$2,$3)',[role,signature,'EXECUTE']),false);assert.equal(await value('select has_function_privilege($1,$2,$3)',['authenticated',signature,'EXECUTE']),true);}
  for(const sig of['snote_schedule_private.actor(uuid)','snote_schedule_private.event_value(snote_schedule_private.events)','snote_schedule_private.validate_event(jsonb)'])assert.equal(await value('select has_function_privilege($1,$2,$3)',['authenticated',sig,'EXECUTE']),false);
  const defs=(await q("select prosecdef,proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='snote_schedule_private' and proname in('list_events','save_event','delete_event')")).rows;assert.equal(defs.length,3);assert(defs.every(x=>x.prosecdef&&x.proconfig.includes('search_path=""')));
  const probe=randomUUID();await q("insert into snote_schedule_private.events(id,company_id,owner_id,title,event_date,revision) values($1,$2,$3,'Synthetic RLS probe','2026-11-01',1)",[probe,COMPANY,OWNER]);
  await db.exec('grant select on snote_schedule_private.events to authenticated');assert.equal(await as('authenticated',OWNER,sessions.get(OWNER),()=>value('select count(*)::int from snote_schedule_private.events')),0);await db.exec('revoke select on snote_schedule_private.events from authenticated');await q('delete from snote_schedule_private.events where id=$1',[probe]);
 });
 await test('anonymous, service-role, accountants, inactive and actual operator accounts cannot use any scheduler RPC',async()=>{
  for(const call of[()=>list(),()=>save(event()),()=>remove(randomUUID(),1)])assert.equal(typeof call,'function');
  for(const actor of[ACCOUNTANT,INACTIVE,OP]){await denied(()=>list('2026-11',actor));await denied(()=>save(event(),0,actor));await denied(()=>remove(randomUUID(),1,actor));}
  for(const role of['anon','service_role'])await denied(()=>list('2026-11',OWNER,COMPANY,{role}));
  await denied(()=>list('2026-11',OWNER,COMPANY,{claims:{is_anonymous:true}}));
  await q('update snote_operator_private.operators set active=false where user_id=$1',[OP]);await denied(()=>list('2026-11',OP));
 });
 await test('missing, foreign, revoked, expired and unconfirmed Auth sessions are rejected live',async()=>{
  for(const sid of[null,'not-a-uuid',sessions.get(ADMIN),randomUUID()])await denied(()=>list('2026-11',OWNER,COMPANY,{session:sid}));
  const sid=sessions.get(OWNER);await q("update auth.sessions set not_after=clock_timestamp()-interval'1 minute' where id=$1",[sid]);await denied(()=>list());await q('update auth.sessions set not_after=null where id=$1',[sid]);
  await q('delete from auth.sessions where id=$1',[sid]);await denied(()=>list());await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,OWNER]);
  for(const [column,bad,good]of[['email_confirmed_at',null,new Date().toISOString()],['deleted_at',new Date().toISOString(),null],['banned_until',new Date(Date.now()+3600000).toISOString(),null],['is_anonymous',true,false]]){await q('update auth.users set '+column+'=$2 where id=$1',[OWNER,bad]);await denied(()=>list());await q('update auth.users set '+column+'=$2 where id=$1',[OWNER,good]);}
 });
 await test('archived accounts/companies and stale company membership fail without changing schedules',async()=>{
  await q('insert into snote_operator_private.account_state(user_id,archived) values($1,true)',[OWNER]);await denied(()=>list());await q('delete from snote_operator_private.account_state where user_id=$1',[OWNER]);
  await q('insert into snote_operator_private.company_state(company_id,archived) values($1,true)',[COMPANY]);await denied(()=>list());await q('delete from snote_operator_private.company_state where company_id=$1',[COMPANY]);
  await denied(()=>list('2026-11',OWNER,FOREIGN));await denied(()=>save(event(),0,OWNER,FOREIGN));await denied(()=>list('2026-11',OUTSIDER,COMPANY));
  await denied(()=>list('2026-11',INACTIVE,COMPANY,{claims:{user_metadata:{role:'admin',company_id:COMPANY},app_metadata:{role:'admin'}}}));
 });
 let original;
 await test('first insert returns canonical event and revision one; a lost ACK retry is a verified duplicate',async()=>{
  const input=event({title:'  Synthetic title  ',id:randomUUID().toUpperCase(),time:null});original=(await save(input)).event;assert.equal(original.title,'Synthetic title');assert.equal(original.id,input.id.toLowerCase());assert.equal(original.time,null);assert.equal(original.revision,1);assert.match(original.createdAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);assert(Date.parse(original.updatedAt)>=Date.parse(original.createdAt));
  assert.deepEqual(Object.keys(original).sort(),['id','title','notes','eventDate','time','completed','revision','createdAt','updatedAt'].sort());const again=await save(input);assert.equal(again.duplicate,true);assert.deepEqual(again.event,original);assert.equal(again.ownerId,OWNER);assert.equal(again.companyId,COMPANY);assert.equal(await value('select count(*)::int from snote_schedule_private.events where id=$1',[original.id]),1);
 });
 await test('same-company administrators and other dealers have no cross-owner schedule exception',async()=>{
  const ownerList=await list(),admin=await list('2026-11',ADMIN);assert(ownerList.events.some(x=>x.id===original.id));assert.equal(admin.events.length,0);assert.equal(admin.ownerId,ADMIN);
  const foreign=await list('2026-11',OUTSIDER,FOREIGN);assert.equal(foreign.events.length,0);
  for(const actor of[ADMIN,OUTSIDER]){const company=actor===OUTSIDER?FOREIGN:COMPANY;await denied(()=>save({...event(),id:original.id},1,actor,company),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(original.id,1,actor,company),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>save({...event(),id:original.id},0,actor,company),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');}
  await denied(()=>remove(randomUUID(),1),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>save(event(),1),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');
 });
 await test('an actual company move invalidates the old scope and cannot carry old or other dealer schedules into the new scope',async()=>{
  const other=(await save(event({title:'Other company private schedule'}),0,OUTSIDER,FOREIGN)).event;
  await q('update public.zc_members set company_id=$2 where user_id=$1',[OWNER,FOREIGN]);
  try{
   await denied(()=>list('2026-11',OWNER,COMPANY));const moved=await list('2026-11',OWNER,FOREIGN);assert.equal(moved.ownerId,OWNER);assert.equal(moved.companyId,FOREIGN);assert.equal(moved.events.length,0);
   for(const id of[original.id,other.id]){await denied(()=>save({...event(),id},1,OWNER,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(id,1,OWNER,FOREIGN),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');}
  }finally{await q('update public.zc_members set company_id=$2 where user_id=$1',[OWNER,COMPANY]);}
  assert((await list()).events.some(x=>x.id===original.id));
 });
 let updated;
 await test('CAS update increments once and only the immediately matching payload can acknowledge a lost update',async()=>{
  const input={id:original.id,title:'Updated synthetic appointment',notes:'Changed notes',eventDate:'2026-11-24',time:'23:59',completed:true};const result=await save(input,1);updated=result.event;assert.equal(result.duplicate,false);assert.equal(updated.revision,2);assert.equal(updated.time,'23:59');assert.equal(updated.completed,true);assert.equal((await save(input,1)).duplicate,true);
  await denied(()=>save({...input,title:'Stale different draft'},1),['40001']);await denied(()=>save(input,0),['40001']);
  const next={...input,notes:'Newest notes'};assert.equal((await save(next,2)).event.revision,3);await denied(()=>save(input,1),['40001']);assert.equal((await save(next,2)).duplicate,true);updated={...updated,notes:'Newest notes',revision:3};
 });
 await test('competing payloads using the same revision cannot overwrite the first successful update',async()=>{
  const p=event();const made=(await save(p)).event;
  await as('authenticated',OWNER,sessions.get(OWNER),async()=>{const args=[COMPANY,JSON.stringify({...p,title:'First competing draft'}),made.revision];const results=await Promise.allSettled([q('select public.snote_schedule_save($1,$2,$3)',args),q('select public.snote_schedule_save($1,$2,$3)',[COMPANY,JSON.stringify({...p,title:'Second competing draft'}),made.revision])]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);});
  assert.equal(await value('select revision from snote_schedule_private.events where id=$1',[p.id]),2);
 });
 await test('deletion uses a CAS tombstone, duplicate ACK is stable, and stale saves cannot resurrect that UUID',async()=>{
  await denied(()=>remove(original.id,2),['40001']);const result=await remove(original.id,3);assert.equal(result.deleted,true);assert.equal(result.revision,4);assert.equal(result.duplicate,false);const again=await remove(original.id,3);assert.equal(again.duplicate,true);assert.equal(again.revision,4);assert(!(await list()).events.some(x=>x.id===original.id));assert(await value('select deleted_at from snote_schedule_private.events where id=$1',[original.id]));
  await denied(()=>save({id:original.id,title:updated.title,notes:updated.notes,eventDate:updated.eventDate,time:updated.time,completed:updated.completed},0),['40001']);await denied(()=>save({...event(),id:original.id},3),['40001']);await denied(()=>remove(original.id,2),['40001']);
 });
 await test('strict event/month/revision validation excludes metadata, impossible dates, seconds, controls and oversized text',async()=>{
  const invalid=[{title:''},{title:'x'.repeat(101)},{title:'bad\u0001title'},{notes:'x'.repeat(2001)},{notes:'bad\u0001notes'},{eventDate:'2025-02-29'},{eventDate:'2026-04-31'},{eventDate:'0000-01-01'},{eventDate:'10000-01-01'},{eventDate:'2026-1-1'},{time:'24:00'},{time:'09:60'},{time:'9:30'},{time:'09:30:00'},{time:2},{completed:'true'},{id:'invalid'},{ownerId:ADMIN},{companyId:FOREIGN},{revision:1}];
  for(const patch of invalid)await denied(()=>save(event(patch)),['22023']);
  for(const month of[null,'2026-00','2026-13','0000-01','10000-01','2026-1',"2026-11'; drop table x; --"])await denied(()=>list(month),['22023']);
  for(const rev of[null,-1,2147483647])await denied(()=>save(event(),rev),['22023']);for(const rev of[null,0,-1,2147483647])await denied(()=>remove(randomUUID(),rev),['22023']);
  const valid=await save(event({title:'한'.repeat(100),notes:'😀'.repeat(2000),eventDate:'2000-02-29'}));assert.equal([...valid.event.notes].length,2000);const data=event();delete data.time;await denied(()=>save(data),['22023']);
 });
 await test('Sunday grid and four-digit date boundaries remain bounded with no BC or five-digit response dates',async()=>{
  const ordinary=await list('2026-11');assert.equal(ordinary.rangeStart,'2026-11-01');assert.equal(ordinary.rangeEnd,'2026-12-12');assert.equal(Object.keys(ordinary.dayCounts).length,42);assert(Object.values(ordinary.dayCounts).every(Number.isSafeInteger));
  await save(event({eventDate:'0001-01-01'}));await save(event({eventDate:'9999-12-31'}));
  const first=await list('0001-01'),last=await list('9999-12');assert.equal(first.rangeStart,'0001-01-01');assert.equal(last.rangeEnd,'9999-12-31');assert(first.events.some(x=>x.eventDate==='0001-01-01'));assert(last.events.some(x=>x.eventDate==='9999-12-31'));
  for(const result of[first,last]){assert(Object.keys(result.dayCounts).length<=42);assert(Object.keys(result.dayCounts).every(x=>/^(?!0000)\d{4}-\d\d-\d\d$/.test(x)));assert(result.events.every(x=>x.eventDate.length===10));}
 });
 await test('Korean today and UTC timestamp serialization do not depend on the database session timezone',async()=>{
  await db.exec("set time zone 'Pacific/Honolulu';set datestyle='SQL, DMY';");const result=await list();assert.equal(result.today,await value("select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD')"));const r=await save(event());assert.match(r.event.updatedAt,/Z$/);assert.equal(r.event.eventDate,'2026-11-23');await db.exec("set time zone 'UTC';set datestyle='ISO, MDY';");
 });
 await test('bounded arrays retain exact per-day/full counts and completed today events while excluding completed future/past tasks',async()=>{
  const today=await value("select to_char(clock_timestamp() at time zone 'Asia/Seoul','YYYY-MM-DD')");
  await q("insert into snote_schedule_private.events(id,company_id,owner_id,title,notes,event_date,completed,revision) select gen_random_uuid(),$1,$2,'Synthetic bounded today','',$3::date,n%2=0,1 from generate_series(1,501)n",[COMPANY,CAPPED,today]);
  for(const direction of[-1,1])await q("insert into snote_schedule_private.events(id,company_id,owner_id,title,notes,event_date,completed,revision) select gen_random_uuid(),$1,$2,'Synthetic bounded side','',$3::date+$4::integer,n>60,1 from generate_series(1,65)n",[COMPANY,CAPPED,today,direction]);
  const result=await list(today.slice(0,7),CAPPED),calendar=await value('select count(*)::int from snote_schedule_private.events where owner_id=$1 and event_date between $2::date and $3::date',[CAPPED,result.rangeStart,result.rangeEnd]);
  assert.equal(result.events.length,500);assert.equal(result.todayEvents.length,50);assert.equal(result.upcomingEvents.length,50);assert.equal(result.overdueEvents.length,50);assert.deepEqual(result.counts,{calendar,today:501,upcoming:60,overdue:60});assert.deepEqual(result.truncated,{calendar:true,today:true,upcoming:true,overdue:true});assert.equal(result.dayCounts[today],501);assert.equal(Object.values(result.dayCounts).reduce((a,b)=>a+b,0),calendar);assert.equal(await value('select count(*)::int from snote_schedule_private.events where owner_id=$1',[CAPPED]),631,'No arbitrary total-storage quota was introduced');assert(result.upcomingEvents.every(x=>!x.completed&&x.eventDate>today));assert(result.overdueEvents.every(x=>!x.completed&&x.eventDate<today));
 });
 await test('reapplying the migration preserves tombstones/data and does not change shared authorization functions',async()=>{
  const before=await value('select jsonb_agg(to_jsonb(e) order by id) from snote_schedule_private.events e');await db.exec(SQL);assert.deepEqual(await value('select jsonb_agg(to_jsonb(e) order by id) from snote_schedule_private.events e'),before);assert.deepEqual(await definitions(),beforeDefs);assert.deepEqual(await value('select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d'),beforeDatasets);
 });
 console.log(JSON.stringify({passed,failed,migration:FILE,sha256:createHash('sha256').update(SQL).digest('hex')}));
 }finally{await db.close();}}
module.exports={createSchedulerFixture,FILE,SQL,COMPANY,FOREIGN,OWNER,ADMIN,OUTSIDER,ACCOUNTANT,INACTIVE,OP,CAPPED};
if(require.main===module)main().catch(e=>{console.error({code:e.code,message:e.message,where:e.where,stack:e.stack});process.exitCode=1});
