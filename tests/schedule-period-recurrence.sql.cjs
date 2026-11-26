'use strict';
// Isolated real PostgreSQL semantics and synthetic schedules only. No hosted access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID,createHash}=require('node:crypto');
const {createSchedulerFixture,OWNER,ADMIN,ACCOUNTANT,OUTSIDER,COMPANY,FOREIGN}=require('./dealer-schedule.sql.cjs');
const Data=require('../assets/dealer-scheduler-store.js'),M=Data.model;
const ROOT=path.join(__dirname,'..'),FILE='20261126151240_personal_schedule_period_recurrence.sql',SQL=fs.readFileSync(path.join(ROOT,'supabase/migrations',FILE),'utf8');
const QUOTA='e2440000-0000-4000-8000-000000000500';let db,sessions,passed=0,failed=0;const checks=[];
const q=(s,a=[])=>db.query(s,a),value=async(s,a=[])=>Object.values((await q(s,a)).rows[0])[0];
async function as(actor,fn,company=COMPANY,{role='authenticated',session,claims={}}={}){
 await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,sub:actor||undefined,session_id:session===undefined?sessions.get(actor):session,...claims})]);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}
}
const rpc=(name,args=[],actor=OWNER,company=COMPANY,options)=>as(actor,()=>value('select public.snote_schedule_'+name+'('+['$1',...args.map((_,i)=>'$'+(i+2))].join(',')+')',[company,...args.map(x=>x&&typeof x==='object'?JSON.stringify(x):x)]),company,options);
const list=(month,actor=OWNER,company=COMPANY,options)=>rpc('list_v2',[month],actor,company,options),legacyList=(month,actor=OWNER)=>rpc('list',[month],actor);
const save=(e,rev=0,actor=OWNER,company=COMPANY,options)=>rpc('save',[e,rev],actor,company,options),remove=(id,rev,actor=OWNER,company=COMPANY,options)=>rpc('delete',[id,rev],actor,company,options);
const event=(patch={})=>{const e={id:randomUUID(),title:'Synthetic period',notes:'Synthetic private period notes',eventDate:'2026-01-30',time:'09:30',completed:false,...patch};return {...e,endDate:patch.endDate??e.eventDate,recurrence:patch.recurrence??'none'};};
const legacy=e=>Object.fromEntries(['id','title','notes','eventDate','time','completed'].map(k=>[k,e[k]]));
async function denied(fn,codes=['42501'],message){await assert.rejects(fn,e=>codes.includes(e.code)&&(!message||e.message===message));}
async function test(name,fn){try{await fn();passed++;checks.push({name,passed:true});console.log('PASS',name);}catch(e){failed++;checks.push({name,passed:false,code:e.code,message:e.message});process.exitCode=1;console.error('FAIL',name,{code:e.code,message:e.message,where:e.where,stack:e.stack});}}
const rowData=()=>value("select coalesce(jsonb_agg(to_jsonb(e)-array['end_date','recurrence'] order by id),'[]'::jsonb) from snote_schedule_private.events e");
const definitions=()=>value("select jsonb_object_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object('oid',p.oid,'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','snote_schedule_private','snote_operator_private')");
const boundary=()=>value("select jsonb_build_object('table',(select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'force',relforcerowsecurity) from pg_class where oid='snote_schedule_private.events'::regclass),'schema',(select jsonb_build_object('owner',nspowner,'acl',nspacl) from pg_namespace where nspname='snote_schedule_private'),'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname),'[]'::jsonb) from pg_policies p where schemaname in('public','snote_schedule_private'))) ");
async function consume(raw,actor=OWNER){const context={key:'sql-integrated-model',actorId:actor,companyId:raw.companyId,role:[ACCOUNTANT,QUOTA].includes(actor)?'accountant':'dealer',ready:true},store=Data.create({context:()=>context,current:c=>c===context||c.key===context.key,bridge:{context:()=>context,current:c=>c.key===context.key,listMonth:()=>raw},now:()=>Date.parse(raw.today+'T03:00:00Z')});try{const result=await store.refresh({month:raw.month});assert.equal(result.ok,true,JSON.stringify(result));return store.snapshot();}finally{store.destroy();}}
async function main(){({db,sessions}=await createSchedulerFixture());try{
 await db.exec(fs.readFileSync(path.join(ROOT,'supabase/migrations/20261126105413_accountant_personal_schedule.sql'),'utf8'));
 const oldInput=event({title:'Legacy preserved source',eventDate:'2026-11-23'}),old=(await save(legacy(oldInput))).event,tomb=(await save(legacy(event({eventDate:'2026-11-24'})))).event;await remove(tomb.id,1);
 const beforeRows=await rowData(),beforeDefs=await definitions(),beforeBoundary=await boundary(),beforeData=await value('select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d');
 await db.exec(SQL);
 await test('additive migration preserves every legacy row/tombstone and unchanged actor, live-session, list-v1, delete and grants',async()=>{
  assert.deepEqual(await rowData(),beforeRows);assert.deepEqual(await boundary(),beforeBoundary);assert.deepEqual(await value('select jsonb_agg(to_jsonb(d) order by company_id,owner_id,dataset) from public.zc_datasets d'),beforeData);
  const after=await definitions(),changed=['snote_schedule_private.event_value(','snote_schedule_private.validate_event(','snote_schedule_private.save_event('];
  for(const[key,v]of Object.entries(beforeDefs)){if(changed.some(p=>key.startsWith(p))){for(const field of ['oid','owner','acl','definer','config'])assert.deepEqual(after[key][field],v[field],key+field);}else assert.deepEqual(after[key],v,key);}
  assert.equal(Object.keys(after).length-Object.keys(beforeDefs).length,5);const r=(await legacyList('2026-11')).events.find(e=>e.id===old.id);assert.equal(r.endDate,r.eventDate);assert.equal(r.recurrence,'none');assert.equal((await legacyList('2026-11')).rangeEnd,'2026-12-12');
 });
 await test('new v2 public invoker/private guarded entrypoint is narrow and projection helpers have no direct grants',async()=>{
  assert.equal(await value("select prosecdef from pg_proc where oid='public.snote_schedule_list_v2(uuid,text)'::regprocedure"),false);
  assert.equal(await value("select prosecdef from pg_proc where oid='snote_schedule_private.list_events_v2(uuid,text)'::regprocedure"),true);
  for(const sig of ['public.snote_schedule_list_v2(uuid,text)','snote_schedule_private.list_events_v2(uuid,text)']){assert.equal(await value('select has_function_privilege($1,$2,$3)',['authenticated',sig,'EXECUTE']),true);for(const role of ['anon','service_role'])assert.equal(await value('select has_function_privilege($1,$2,$3)',[role,sig,'EXECUTE']),false);}
  for(const sig of ['snote_schedule_private.repeat_date(date,text,integer)','snote_schedule_private.occurrences(snote_schedule_private.events,date,date)','snote_schedule_private.occurrence_value(snote_schedule_private.events,date,date)'])assert.equal(await value('select has_function_privilege($1,$2,$3)',['authenticated',sig,'EXECUTE']),false);
  for(const role of ['anon','authenticated','service_role'])for(const perm of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal(await value('select has_table_privilege($1,$2,$3)',[role,'snote_schedule_private.events',perm]),false);
 });
 await test('calendar v2 shares the five/six-week range with the browser while legacy v1 stays 42 cells',async()=>{
  for(const month of ['0001-01','2024-02','2026-08','2026-11','9999-12']){const r=await list(month);assert.equal(r.schemaVersion,2);assert.deepEqual({rangeStart:r.rangeStart,rangeEnd:r.rangeEnd},M.monthRange(month));assert.equal(Object.keys(r.dayCounts).length,M.calendarGrid(month).filter(Boolean).length);await consume(r);}
  assert.equal(Object.keys((await list('2026-11')).dayCounts).length,35);assert.equal(Object.keys((await list('2026-08')).dayCounts).length,42);assert.equal(Object.keys((await legacyList('2026-11')).dayCounts).length,42);
 });
 let period,daily,weekly,monthly,yearly;
 await test('an inclusive period crosses months as one source with exact overlap day counts',async()=>{
  period=(await save(event({eventDate:'2026-01-30',endDate:'2026-02-02'}))).event;const r=await list('2026-02'),rows=r.events.filter(e=>e.id===period.id);assert.equal(rows.length,1);assert.equal(rows[0].eventDate,'2026-01-30');assert.equal(rows[0].endDate,'2026-02-02');assert.equal(rows[0].occurrenceStartDate,'2026-01-30');assert.equal(rows[0].occurrenceEndDate,'2026-02-02');assert.equal(r.dayCounts['2026-02-01'],1);assert.equal(r.dayCounts['2026-02-02'],1);assert.equal(await value('select count(*)::int from snote_schedule_private.events where id=$1',[period.id]),1);await consume(r);
 });
 await test('daily periods return stable occurrence IDs, keep duration and never materialize future rows',async()=>{
  daily=(await save(event({eventDate:'2026-02-26',endDate:'2026-02-27',recurrence:'daily'}))).event;const r=await list('2026-02'),rows=r.events.filter(e=>e.id===daily.id);assert.deepEqual(rows.map(e=>e.occurrenceStartDate),['2026-02-26','2026-02-27','2026-02-28','2026-03-01','2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07']);assert.equal(new Set(rows.map(e=>e.occurrenceId)).size,10);assert(rows.every(e=>e.seriesId===daily.id&&e.eventDate==='2026-02-26'&&Date.parse(e.occurrenceEndDate)-Date.parse(e.occurrenceStartDate)===86400000));assert.equal(await value('select count(*)::int from snote_schedule_private.events where id=$1',[daily.id]),1);await consume(r);
 });
 await test('weekly repeats span inclusive multi-day intervals without dropping the previous-month overlap',async()=>{
  weekly=(await save(event({eventDate:'2026-01-30',endDate:'2026-02-01',recurrence:'weekly'}))).event;const rows=(await list('2026-02')).events.filter(e=>e.id===weekly.id);assert.deepEqual(rows.map(e=>e.occurrenceStartDate),['2026-01-30','2026-02-06','2026-02-13','2026-02-20','2026-02-27','2026-03-06']);assert(rows.every(e=>Date.parse(e.occurrenceEndDate)-Date.parse(e.occurrenceStartDate)===2*86400000));
 });
 await test('monthly day 31 clamps to each month end without drifting its anchor and retains source duration',async()=>{
  monthly=(await save(event({eventDate:'2026-01-31',endDate:'2026-02-01',recurrence:'monthly'}))).event;
  assert.deepEqual((await list('2026-02')).events.filter(e=>e.id===monthly.id).map(e=>[e.occurrenceStartDate,e.occurrenceEndDate]),[['2026-01-31','2026-02-01'],['2026-02-28','2026-03-01']]);
  const march=(await list('2026-03')).events.filter(e=>e.id===monthly.id);assert(march.some(e=>e.occurrenceStartDate==='2026-03-31'&&e.occurrenceEndDate==='2026-04-01'));
  assert((await list('2026-04')).events.some(e=>e.id===monthly.id&&e.occurrenceStartDate==='2026-04-30'&&e.occurrenceEndDate==='2026-05-01'));
 });
 await test('yearly leap-day repeats clamp in non-leap years and return to February 29 in leap years',async()=>{
  yearly=(await save(event({eventDate:'2024-02-29',endDate:'2024-03-01',recurrence:'yearly'}))).event;
  assert.deepEqual((await list('2025-02')).events.filter(e=>e.id===yearly.id).map(e=>[e.occurrenceStartDate,e.occurrenceEndDate]),[['2025-02-28','2025-03-01']]);assert((await list('2028-02')).events.some(e=>e.id===yearly.id&&e.occurrenceStartDate==='2028-02-29'));
 });
 await test('canonical save retries, stale CAS and whole-series delete retain exact source and tombstone semantics',async()=>{
  const input=event({eventDate:'2026-05-31',endDate:'2026-06-02',recurrence:'monthly'}),first=await save(input);assert.equal((await save(input)).duplicate,true);const update={...input,title:'Updated entire source series'},changed=await save(update,1);assert.equal(changed.event.revision,2);assert.equal((await save(update,1)).duplicate,true);await denied(()=>save({...update,title:'Stale'},1),['40001']);assert((await list('2026-11')).events.filter(e=>e.id===first.event.id).every(e=>e.title===update.title&&e.revision===2));const gone=await remove(first.event.id,2);assert.equal(gone.revision,3);assert.equal((await remove(first.event.id,2)).duplicate,true);assert(!(await list('2026-11')).events.some(e=>e.id===first.event.id));await denied(()=>save(update,0),['40001']);
 });
 await test('old single-date payloads remain supported but cannot silently downgrade an extended series',async()=>{
  const original=event({eventDate:'2026-06-01'}),created=await save(legacy(original));assert.equal(created.event.endDate,'2026-06-01');assert.equal(created.event.recurrence,'none');const moved=await save(legacy({...original,eventDate:'2026-06-03'}),1);assert.equal(moved.event.endDate,'2026-06-03');
  await denied(()=>save(legacy(monthly),monthly.revision),['22023'],'SCHEDULE_CLIENT_UPDATE_REQUIRED');await denied(()=>save(legacy(period),period.revision),['22023'],'SCHEDULE_CLIENT_UPDATE_REQUIRED');
 });
 await test('accountants, dealers, administrators and foreign companies never gain another owner series',async()=>{
  const own=(await save(event({eventDate:'2026-11-01',recurrence:'weekly'}),0,ACCOUNTANT)).event;
  for(const actor of [OWNER,ADMIN]){assert(!(await list('2026-11',actor)).events.some(e=>e.id===own.id));await denied(()=>save(event({id:own.id,recurrence:'daily'}),1,actor),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');await denied(()=>remove(own.id,1,actor),['42501'],'SCHEDULE_EVENT_UNAVAILABLE');}
  assert(!(await list('2026-11',ACCOUNTANT)).events.some(e=>e.id===monthly.id));await denied(()=>list('2026-11',ACCOUNTANT,FOREIGN));await denied(()=>list('2026-11',OUTSIDER,COMPANY));await denied(()=>save(event({id:own.id}),0,OUTSIDER,FOREIGN));
 });
 await test('live-session, anonymous, inactive and archived boundaries still protect the new read and existing writes',async()=>{
  for(const options of [{role:'anon'},{role:'service_role'},{session:null},{session:randomUUID()},{claims:{is_anonymous:true}}])await denied(()=>list('2026-11',OWNER,COMPANY,options));
  await q('update public.zc_members set active=false where user_id=$1',[ACCOUNTANT]);try{await denied(()=>list('2026-11',ACCOUNTANT));await denied(()=>save(event(),0,ACCOUNTANT));}finally{await q('update public.zc_members set active=true where user_id=$1',[ACCOUNTANT]);}
  await q('insert into snote_operator_private.company_state(company_id,archived) values($1,true)',[COMPANY]);try{await denied(()=>list('2026-11'));}finally{await q('delete from snote_operator_private.company_state where company_id=$1',[COMPANY]);}
 });
 await test('strict dates, enum, repeat-duration, payload and revision bounds reject invalid or forged source writes',async()=>{
  for(const patch of [{endDate:'2026-01-29'},{endDate:'2026-02-30'},{endDate:1},{recurrence:null},{recurrence:'hourly'},{eventDate:'2024-01-01',endDate:'2025-01-01',recurrence:'daily'},{occurrenceId:'forged'},{seriesId:OWNER}])await denied(()=>save({...event(),...patch}),['22023']);
  assert((await save(event({eventDate:'2020-01-01',endDate:'2030-12-31'}))).ok);assert((await save(event({eventDate:'2024-01-01',endDate:'2024-12-31',recurrence:'yearly'}))).ok);await denied(()=>save(event(),2147483647),['22023']);
 });
 await test('ongoing periods appear today and recurring agendas select only the next/last occurrence per series',async()=>{
  const today=await value("select to_char((clock_timestamp() at time zone 'Asia/Seoul')::date,'YYYY-MM-DD')"),date=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10),source=(await save(event({eventDate:date(today,-2),endDate:date(today,2),recurrence:'weekly'}))).event,r=await list(today.slice(0,7));
  assert(r.todayEvents.some(e=>e.id===source.id&&e.occurrenceStartDate===date(today,-2)&&e.occurrenceEndDate===date(today,2)));assert.equal(r.upcomingEvents.filter(e=>e.id===source.id).length,1);assert.equal(r.upcomingEvents.find(e=>e.id===source.id).occurrenceStartDate,date(today,5));assert.equal(r.overdueEvents.filter(e=>e.id===source.id).length,0);await consume(r);
 });
 await test('recurring quota is owner-local and projected truncation reports exact counts without generating rows',async()=>{
  await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())',[QUOTA,'quota-synthetic@example.invalid']);await q("insert into public.zc_members(user_id,company_id,role,display_name) values($1,$2,'accountant','Synthetic repeat quota')",[QUOTA,COMPANY]);const sid=randomUUID();sessions.set(QUOTA,sid);await q('insert into auth.sessions(id,user_id) values($1,$2)',[sid,QUOTA]);
  await q("insert into snote_schedule_private.events(id,company_id,owner_id,title,event_date,end_date,recurrence,revision) select md5('synthetic-recurring-'||g)::uuid,$1,$2,'Synthetic bounded repeat',date'2026-11-01',date'2026-11-01','daily',1 from generate_series(1,500)g",[COMPANY,QUOTA]);
  await denied(()=>save(event({eventDate:'2026-11-01',recurrence:'weekly'}),0,QUOTA),['22023'],'SCHEDULE_LIMIT');assert((await save(event(),0,QUOTA)).ok);
  const r=await list('2026-11',QUOTA);assert.equal(r.events.length,500);assert.equal(r.counts.calendar,17500);assert.equal(r.truncated.calendar,true);assert.equal(r.dayCounts['2026-11-23'],500);assert.equal(await value('select count(*)::int from snote_schedule_private.events where owner_id=$1',[QUOTA]),501);await consume(r,QUOTA);
 });
 await test('reapplying the additive migration preserves all source rows, tombstones, helper definitions and boundaries',async()=>{
  const rows=await value("select jsonb_agg(to_jsonb(e) order by id) from snote_schedule_private.events e"),defs=await definitions(),bounds=await boundary();await db.exec(SQL);assert.deepEqual(await value("select jsonb_agg(to_jsonb(e) order by id) from snote_schedule_private.events e"),rows);assert.deepEqual(await definitions(),defs);assert.deepEqual(await boundary(),bounds);
 });
 const result={ok:failed===0,version:'2.244',isolatedPostgres:true,operatingReads:0,operatingWrites:0,migration:FILE,migrationSHA256:createHash('sha256').update(SQL).digest('hex'),passed,failed,checks,semantics:{endDate:'inclusive',recurrence:['none','daily','weekly','monthly','yearly'],monthEnd:'clamp to last day, keep original anchor',duration:'fixed inclusive day span',repeatDurationMaxDays:366,repeatSeriesPerOwner:500,calendarMaxOccurrences:500,agendaMaxOccurrences:50,upcoming:'next occurrence per incomplete series',overdue:'latest fully ended occurrence per incomplete series',legacyList:'unchanged 42-cell v1',listV2:'35 cells or 42 when required'},documentation:['https://supabase.com/docs/guides/database/functions'],limitations:['Only isolated PostgreSQL fixtures; hosted application and schema verification belongs to root.','Official changelog fetch returned HTTP403; current database function documentation was consulted.']};const file=process.env.SNOTE_SCHEDULE_PERIOD_SQL_RESULT||'/workspace/work/calendar-accountant-v2244/calendar-data/sql-results.json';fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed,failed,migration:FILE,sha256:result.migrationSHA256}));
 }finally{await db.close();}}
if(require.main===module)main().catch(e=>{console.error({code:e.code,message:e.message,where:e.where,stack:e.stack});process.exitCode=1});
module.exports={FILE,SQL};
