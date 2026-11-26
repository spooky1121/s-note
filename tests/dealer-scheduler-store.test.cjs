'use strict';
// All records, accounts and RPC replies below are synthetic; no network or database is used.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const API=require('../assets/dealer-scheduler-store.js'),M=API.model;
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',COMPANY_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clone=value=>JSON.parse(JSON.stringify(value)),deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const same=(a,b)=>['id','title','notes','eventDate','endDate','recurrence','time','completed'].every(key=>a[key]===b[key]);
const stamp='2026-11-23T03:00:00.000Z';
const stored=(extra={})=>{const result={id:crypto.randomUUID(),title:'합성 일정',notes:'가상 메모',eventDate:'2026-11-23',time:'09:30',completed:false,revision:1,createdAt:stamp,updatedAt:stamp,...extra};return {...result,endDate:extra.endDate??result.eventDate,recurrence:extra.recurrence??'none'};};
function fixture(t,{factory=API,clock=Date.parse(stamp),isActive=true,onChange,timeoutMs=1000}={}){
 const f={context:{key:'scope-A:session-1',actorId:OWNER,companyId:COMPANY,role:'dealer',ready:true},active:isActive,clock,rows:new Map(),tombstones:new Map(),reads:[],saves:[],removes:[],changes:[],onRead:null,onSave:null,onRemove:null};
 const rows=c=>{const k=c.companyId+':'+c.actorId;if(!f.rows.has(k))f.rows.set(k,new Map());return f.rows.get(k);};f.currentRows=()=>rows(f.context);f.add=row=>{f.currentRows().set(row.id,clone(row));return row;};
 f.envelope=(c,month)=>{
  const range=M.monthRange(month),today=M.businessDate(f.clock),all=[...rows(c).values()].map(x=>M.event(clone(x),{stored:true}));
  const project=(records,from,to)=>M.occurrences(records,from,to).map(clone),selected=(future)=>all.filter(e=>!e.completed).flatMap(e=>{
   const duration=Math.round((Date.parse(e.endDate)-Date.parse(e.eventDate))/86400000),shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
   if(e.recurrence==='none')return future?e.eventDate>today?project([e],e.eventDate,e.endDate):[]:e.endDate<today?project([e],e.eventDate,e.endDate):[];
   const candidates=future?project([e],e.eventDate>today?e.eventDate:shift(today,1),e.eventDate>today?e.endDate:shift(today,366)):project([e],shift(today,-duration-366),shift(today,-1));
   const valid=candidates.filter(x=>future?x.occurrenceStartDate>today:x.occurrenceEndDate<today).sort((a,b)=>future?a.occurrenceStartDate.localeCompare(b.occurrenceStartDate):b.occurrenceEndDate.localeCompare(a.occurrenceEndDate));return valid.slice(0,1);
  });
  const groups={calendar:project(all,range.rangeStart,range.rangeEnd),today:project(all,today,today),upcoming:selected(true),overdue:selected(false)};
  const counts=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),truncated=Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length>(k==='calendar'?500:50)]));
  const dayCounts=Object.fromEntries(M.calendarGrid(month).filter(Boolean).map(d=>[d,groups.calendar.filter(e=>e.occurrenceStartDate<=d&&e.occurrenceEndDate>=d).length]));
  return{schemaVersion:2,companyId:c.companyId,ownerId:c.actorId,month,today,...range,events:groups.calendar.slice(0,500),todayEvents:groups.today.slice(0,50),upcomingEvents:groups.upcoming.slice(0,50),overdueEvents:groups.overdue.slice(0,50),counts,truncated,dayCounts};
 };
 f.commitSave=(c,event,expected)=>{
  assert.deepEqual(Object.keys(event).sort(),['completed','endDate','eventDate','id','notes','recurrence','time','title']);const data=rows(c),old=data.get(event.id),tomb=f.tombstones.get(c.companyId+':'+c.actorId+':'+event.id);
  if(tomb)throw{code:'SCHEDULE_EVENT_UNAVAILABLE'};
  if(old&&old.revision===expected+1&&same(old,event))return{ok:true,companyId:c.companyId,ownerId:c.actorId,event:clone(old),duplicate:true};
  if(old?old.revision!==expected:expected!==0)throw{code:'SCHEDULE_CONFLICT'};
  const saved={...clone(event),revision:expected+1,createdAt:old?.createdAt||stamp,updatedAt:stamp};data.set(saved.id,saved);return{ok:true,companyId:c.companyId,ownerId:c.actorId,event:clone(saved),duplicate:false};
 };
 f.commitRemove=(c,id,expected)=>{
  const data=rows(c),key=c.companyId+':'+c.actorId+':'+id,tomb=f.tombstones.get(key),old=data.get(id);
  if(tomb===expected+1)return{ok:true,companyId:c.companyId,ownerId:c.actorId,id,revision:tomb,deleted:true,duplicate:true};
  if(!old)throw{code:'SCHEDULE_EVENT_UNAVAILABLE'};if(old.revision!==expected)throw{code:'SCHEDULE_CONFLICT'};
  data.delete(id);f.tombstones.set(key,expected+1);return{ok:true,companyId:c.companyId,ownerId:c.actorId,id,revision:expected+1,deleted:true,duplicate:false};
 };
 f.bridge={context:()=>f.context,current:c=>!!f.context&&['key','actorId','companyId','role','ready'].every(k=>c[k]===f.context[k]),
  listMonth:async(c,month)=>{f.reads.push({context:clone(c),month});return f.onRead?f.onRead(c,month):f.envelope(c,month);},
  save:async(c,event,expected)=>{f.saves.push({context:clone(c),event:clone(event),expected});return f.onSave?f.onSave(c,event,expected):f.commitSave(c,event,expected);},
  remove:async(c,id,expected)=>{f.removes.push({context:clone(c),id,expected});return f.onRemove?f.onRemove(c,id,expected):f.commitRemove(c,id,expected);}};
 f.store=factory.create({bridge:f.bridge,context:()=>f.context,current:c=>f.bridge.current(c),isActive:()=>f.active,now:()=>f.clock,timeoutMs,onChange:s=>{f.changes.push(s);onChange?.(s,f);}});t.after(()=>f.store.destroy());return f;
}
test('KST day, strict dates, leap years, safe month arithmetic and five-week Sunday grids with complete six-week months',()=>{
 assert.equal(M.businessDate('2026-12-31T14:59:59Z'),'2026-12-31');assert.equal(M.businessDate('2026-12-31T15:00:00Z'),'2027-01-01');
 for(const day of['0001-01-01','2000-02-29','2024-02-29','9999-12-31'])assert(M.isDate(day));
 for(const day of['0000-01-01','2023-02-29','1900-02-29','2026-04-31','2026-1-01','2026-01-01T00:00:00Z',null,1])assert(!M.isDate(day));
 assert.equal(M.shiftMonth('0001-01',-1),null);assert.equal(M.shiftMonth('9999-12',1),null);assert.equal(M.shiftMonth('2026-12',1),'2027-01');assert.equal(M.shiftMonth('2026-11',Number.MAX_SAFE_INTEGER),null);assert.equal(M.shiftMonth('2026-11',NaN),null);
 const grid=M.calendarGrid('2026-11');assert.equal(grid.length,35);assert.equal(grid[0],'2026-11-01');assert.equal(grid[34],'2026-12-05');assert.equal(M.calendarGrid('2026-08').length,42);assert.equal(M.monthRange('2026-08').rangeEnd,'2026-09-05');assert.equal(M.calendarGrid('0001-01')[0],null);assert.equal(M.monthRange('0001-01').rangeStart,'0001-01-01');assert.equal(M.monthRange('9999-12').rangeEnd,'9999-12-31');
 assert.throws(()=>M.calendarGrid('10000-01'));assert.throws(()=>M.businessDate('invalid'));
});
test('new drafts use stable secure UUIDs and validate title, notes, time and revision without changing input',()=>{
 const a=API.newEvent({eventDate:'2026-11-23'}),b=API.newEvent({eventDate:'2026-11-23'});assert.notEqual(a.id,b.id);assert.match(a.id,/^[a-f0-9-]{36}$/);assert.equal(a.revision,0);
 const input=Object.freeze({...a,title:'  합성 일정  ',notes:'두 줄\n가상 메모',time:null}),before=JSON.stringify(input),canonical=M.event(input);assert.equal(canonical.title,'합성 일정');assert.equal(JSON.stringify(input),before);
 for(const change of[{title:''},{title:'가'.repeat(101)},{notes:'가'.repeat(2001)},{time:'24:00'},{time:''},{eventDate:'2026-02-30'},{revision:-1},{revision:2147483648},{title:'bad\u0000'},{notes:'\ud800'}])assert.throws(()=>M.event({...input,...change}));
});
test('reads are single-flight even under reentrant view callbacks, and snapshots are immutable',async t=>{
 let reentered;const gate=deferred(),began=deferred(),f=fixture(t,{onChange:(s,x)=>{if(s.status==='loading'&&!reentered)reentered=x.store.refresh({month:s.month});}});f.add(stored());f.onRead=async(c,m)=>{began.resolve();await gate.promise;return f.envelope(c,m);};
 const first=f.store.refresh({month:'2026-11'}),second=f.store.refresh({month:'2026-11'});assert.equal(first,second);assert.equal(first,reentered);await began.promise;assert.equal(f.reads.length,1);gate.resolve();assert((await first).ok);
 const s=f.store.snapshot();assert.equal(s.items.length,1);assert.throws(()=>{s.items[0].notes='changed';});assert.equal(f.store.snapshot().items[0].notes,'가상 메모');
});
test('month cache is short-lived, memory-only and invalidates at a Korean day boundary',async t=>{
 const f=fixture(t,{clock:Date.parse('2026-11-23T14:59:59Z')});await f.store.refresh({month:'2026-11'});await f.store.refresh({month:'2026-11'});assert.equal(f.reads.length,1);
 f.clock+=2000;await f.store.refresh({month:'2026-11'});assert.equal(f.reads.length,2);f.clock+=30001;await f.store.refresh({month:'2026-11'});assert.equal(f.reads.length,3);await f.store.refresh({month:'2026-11',force:true});assert.equal(f.reads.length,4);
});
test('an older month response cannot replace the currently selected month; each valid month can be reused',async t=>{
 const f=fixture(t),a=deferred(),b=deferred();f.add(stored({eventDate:'2026-11-05'}));f.add(stored({eventDate:'2027-01-10'}));f.onRead=async(c,m)=>{const result=f.envelope(c,m);await(m==='2026-11'?a:b).promise;return result;};
 const p=f.store.refresh({month:'2026-11'}),q=f.store.refresh({month:'2027-01'});a.resolve();await p;assert.equal(f.store.snapshot().month,'2027-01');assert.equal(f.store.snapshot().items.length,0);b.resolve();await q;assert.equal(f.store.snapshot().items[0].eventDate,'2027-01-10');await f.store.refresh({month:'2026-11'});assert.equal(f.reads.length,2);assert.equal(f.store.snapshot().items[0].eventDate,'2026-11-05');
});
test('cache eviction bounds the number of retained private months',async t=>{
 const f=fixture(t);for(let i=1;i<=7;i++)await f.store.refresh({month:'2026-'+String(i).padStart(2,'0')});await f.store.refresh({month:'2026-01'});assert.equal(f.reads.length,8);
});
test('unavailable, demo, wrong-role and incomplete scopes never send a request or create fake local records',async t=>{
 const f=fixture(t),base={...f.context};for(const context of[null,{...base,ready:false},{...base,role:'operator'},{...base,actorId:'local-demo'},{...base,companyId:''}]){
  f.context=context;assert.equal((await f.store.refresh()).ok,false);assert.equal(f.store.snapshot().key,null);assert.deepEqual(f.store.snapshot().items,[]);
 }assert.equal(f.reads.length,0);assert.equal(f.saves.length,0);
});
test('logout, same-key owner/company changes and inactive routes discard pending private results',async t=>{
 for(const change of['logout','owner','company','role','route']){
  const f=fixture(t),gate=deferred(),began=deferred();f.add(stored());f.onRead=async(c,m)=>{const result=f.envelope(c,m);began.resolve();await gate.promise;return result;};const pending=f.store.refresh({month:'2026-11'});await began.promise;
  if(change==='logout')f.context=null;else if(change==='owner')f.context={...f.context,actorId:OTHER};else if(change==='company')f.context={...f.context,companyId:COMPANY_B};else if(change==='role')f.context={...f.context,role:'admin'};else f.active=false;
  assert.deepEqual(f.store.snapshot().items,[]);gate.resolve();assert.equal((await pending).error.code,'SCHEDULE_STALE');assert.deepEqual(f.store.snapshot().items,[]);
 }
});
test('verified accountant schedules use acknowledged CRUD and retain owner/company isolation',async t=>{
 const f=fixture(t);f.context={...f.context,role:'accountant'};
 assert((await f.store.refresh({month:'2026-11'})).ok);
 const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'가상 경리 일정'};
 const saved=await f.store.upsert(draft);assert(saved.ok);assert.equal(saved.event.revision,1);assert.equal(f.saves[0].context.role,'accountant');
 const changed=await f.store.upsert({...saved.event,completed:true});assert(changed.ok);assert.equal(changed.event.revision,2);assert.equal(f.store.snapshot().items[0].completed,true);
 f.context={...f.context,actorId:OTHER};assert.deepEqual(f.store.snapshot().items,[]);assert((await f.store.refresh({month:'2026-11'})).ok);assert.deepEqual(f.store.snapshot().items,[]);
 assert.equal((await f.store.remove({id:draft.id,revision:2})).ok,false,'Another verified accountant cannot delete an event outside its owner scope');
 f.context={...f.context,actorId:OWNER,companyId:COMPANY_B};assert((await f.store.refresh({month:'2026-11'})).ok);assert.deepEqual(f.store.snapshot().items,[]);
 f.context={...f.context,companyId:COMPANY};assert((await f.store.refresh({month:'2026-11'})).ok);assert.equal(f.store.snapshot().items[0].id,draft.id);
 assert((await f.store.remove({id:draft.id,revision:2})).ok);assert.deepEqual(f.store.snapshot().items,[]);
});
test('server scope denial latches unavailable/null-key across resets until a fresh verified scope exists',async t=>{
 const f=fixture(t);f.add(stored());await f.store.refresh({month:'2026-11'});f.onRead=async()=>{throw{code:'FORBIDDEN'};};assert.equal((await f.store.refresh({force:true})).error.code,'SCHEDULE_CONTEXT_CHANGED');
 assert.equal(f.store.snapshot().key,null);assert.equal(f.store.snapshot().status,'unavailable');assert.deepEqual(f.store.snapshot().items,[]);f.store.reset();assert.equal((await f.store.refresh()).error.code,'SCHEDULE_CONTEXT_CHANGED');assert.equal(f.reads.length,2);
 f.context={...f.context,key:'scope-A:session-2'};f.onRead=null;assert((await f.store.refresh({month:'2026-11'})).ok);assert.equal(f.store.snapshot().items.length,1);
});
test('wrong-owner ACKs, inconsistent agenda, duplicate IDs and dishonest truncation never reach the view',async t=>{
 for(const corrupt of[
  r=>{r.ownerId=OTHER;},r=>{r.events.push(r.events[0]);r.counts.calendar++;},r=>{r.truncated.calendar=true;},r=>{r.dayCounts['2026-11-23']++;},r=>{r.todayEvents[0].title='contradictory copy';},r=>{r.events[0].time='25:00';}
 ]){const f=fixture(t);f.add(stored());f.onRead=async(c,m)=>{const r=clone(f.envelope(c,m));corrupt(r);return r;};assert.equal((await f.store.refresh({month:'2026-11'})).error.code,'SCHEDULE_ACK_INVALID');assert.deepEqual(f.store.snapshot().items,[]);}
});
test('bounded calendar and independent agenda preserve exact counts, truncation and dynamic dayCounts',async t=>{
 const f=fixture(t);for(let i=0;i<510;i++)f.add(stored({eventDate:i<505?'2026-11-23':'2027-01-10',title:'합성 '+i}));
 assert((await f.store.refresh({month:'2026-11'})).ok);const s=f.store.snapshot();assert.equal(s.items.length,500);assert.equal(s.agenda.today.length,50);assert.equal(s.agenda.upcoming.length,5);assert.equal(s.agenda.counts.calendar,505);assert.equal(s.agenda.truncated.calendar,true);assert.equal(s.agenda.truncated.today,true);assert.equal(s.dayCounts['2026-11-23'],505);assert.equal(Object.keys(s.dayCounts).length,35);
});
test('save waits for server ACK, emits only the eight canonical writable fields and deduplicates identical submissions',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();await f.store.refresh({month:'2026-11'});const draft=Object.freeze({...API.newEvent({eventDate:'2026-11-23'}),title:'가상 저장'}),before=JSON.stringify(draft);
 f.onSave=async(c,e,n)=>{began.resolve();await gate.promise;return f.commitSave(c,e,n);};const p=f.store.upsert(draft),q=f.store.upsert({...draft});assert.equal(p,q);await began.promise;assert.equal(f.store.snapshot().status,'saving');assert.equal(f.store.snapshot().items.length,0);assert.equal((await f.store.refresh({month:'2026-12'})).error.code,'SCHEDULE_BUSY');
 assert.equal((await f.store.upsert({...draft,title:'다른 쓰기'})).error.code,'SCHEDULE_BUSY');gate.resolve();const result=await p;assert(result.ok);assert.equal(result.event.revision,1);assert.equal(f.saves.length,1);assert.equal(f.store.snapshot().items[0].title,draft.title);assert.equal(JSON.stringify(draft),before);
});
test('a stale pre-save read cannot erase a newly acknowledged event',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();let first=true;f.onRead=async(c,m)=>{const result=f.envelope(c,m);if(first){first=false;began.resolve();await gate.promise;}return result;};const old=f.store.refresh({month:'2026-11'});await began.promise;
 const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'새 합성 일정'};assert((await f.store.upsert(draft)).ok);gate.resolve();assert.equal((await old).error.code,'SCHEDULE_STALE');assert.equal(f.store.snapshot().items[0].id,draft.id);
});
test('lost save ACK is confirmed by exact ID, payload and next revision without issuing another save',async t=>{
 const f=fixture(t);await f.store.refresh({month:'2026-11'});f.onSave=async(c,e,n)=>{f.commitSave(c,e,n);throw{code:'NETWORK',message:'untrusted synthetic text'};};
 const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'한 번만 저장'};const result=await f.store.upsert(draft);assert(result.ok);assert.equal(result.event.id,draft.id);assert.equal(f.saves.length,1);assert.equal(f.currentRows().size,1);assert.equal(f.reads.length,2,'The confirmation read doubles as the selected-month refresh');assert.equal(f.store.snapshot().uncertain,false);
});
test('uncertain save preserves the draft, blocks changed-payload replays and retries the same event ID/CAS safely',async t=>{
 const f=fixture(t);await f.store.refresh({month:'2026-11'});f.onSave=async(c,e,n)=>{f.commitSave(c,e,n);throw{code:'NETWORK'};};f.onRead=async()=>{throw{code:'NETWORK'};};const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'보존할 합성 초안'},before=JSON.stringify(draft);
 const first=await f.store.upsert(draft);assert.equal(first.ok,false);assert.equal(first.uncertain,true);assert.equal(first.eventId,draft.id);assert.equal(JSON.stringify(draft),before);assert.equal((await f.store.upsert({...draft,title:'편집을 유지'})).error.code,'SCHEDULE_UNCERTAIN_EDIT');assert.equal(f.saves.length,1);
 f.onRead=f.onSave=null;const retry=await f.store.upsert(draft);assert(retry.ok);assert.equal(f.saves.length,2);assert.equal(f.saves[0].event.id,f.saves[1].event.id);assert.equal(f.saves[0].expected,f.saves[1].expected);assert.equal(f.currentRows().size,1);
});
test('CAS conflicts refresh server state but never replace the caller draft or automatically write again',async t=>{
 const f=fixture(t),row=f.add(stored());await f.store.refresh({month:'2026-11'});const draft=Object.freeze({...f.store.snapshot().items[0],title:'유지할 사용자 편집'});f.currentRows().set(row.id,{...row,title:'다른 탭의 최신값',revision:2});
 const result=await f.store.upsert(draft);assert.equal(result.error.code,'SCHEDULE_CONFLICT');assert.equal(f.saves.length,1);assert.equal(f.store.snapshot().items[0].title,'다른 탭의 최신값');assert.equal(draft.title,'유지할 사용자 편집');assert.equal(draft.revision,1);
});
test('completion uses the same CAS save, moves agenda groups after ACK and supports another selected month',async t=>{
 const f=fixture(t),row=f.add(stored({eventDate:'2026-10-01'}));await f.store.refresh({month:'2027-01'});assert.equal(f.store.snapshot().agenda.overdue.length,1);
 const result=await f.store.upsert({...row,completed:true});assert(result.ok);assert.equal(f.saves[0].expected,1);assert.equal(f.store.snapshot().month,'2027-01');assert.equal(f.store.snapshot().agenda.overdue.length,0);assert.equal(f.currentRows().get(row.id).revision,2);
});
test('lost deletion ACK is not inferred from absence; an explicit same-ID tombstone replay confirms it',async t=>{
 const f=fixture(t),row=f.add(stored());await f.store.refresh({month:'2026-11'});f.onRemove=async(c,id,n)=>{f.commitRemove(c,id,n);throw{code:'NETWORK'};};
 const input=Object.freeze({id:row.id,revision:1}),first=await f.store.remove(input);assert.equal(first.ok,false);assert.equal(first.uncertain,true);assert.equal(f.removes.length,1);assert.equal(f.store.snapshot().items.length,0);
 f.onRemove=null;const retried=await f.store.remove(input);assert(retried.ok);assert.equal(retried.deleted,true);assert.equal(retried.revision,2);assert.equal(f.removes.length,2);assert.equal((await f.store.upsert({...row,revision:0})).error.code,'SCHEDULE_EVENT_UNAVAILABLE');assert.notEqual(f.store.snapshot().key,null,'An unavailable event is not an account denial');
});
test('scope changes during a write abort presentation and never populate the next account from a late ACK',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();await f.store.refresh({month:'2026-11'});f.onSave=async(c,e,n)=>{began.resolve();await gate.promise;return f.commitSave(c,e,n);};const pending=f.store.upsert({...API.newEvent({eventDate:'2026-11-23'}),title:'이전 계정 일정'});await began.promise;
 f.context={...f.context,key:'scope-B',actorId:OTHER};assert.deepEqual(f.store.snapshot().items,[]);gate.resolve();assert.equal((await pending).error.code,'SCHEDULE_STALE');assert.deepEqual(f.store.snapshot().items,[]);f.onSave=null;assert((await f.store.refresh({month:'2026-11'})).ok);assert.deepEqual(f.store.snapshot().items,[]);
});
test('read failures can retry, while successful writes remain acknowledged if only the follow-up read fails',async t=>{
 const f=fixture(t);f.onRead=async()=>{throw{code:'NETWORK'};};assert.equal((await f.store.refresh({month:'2026-11'})).ok,false);f.onRead=null;assert((await f.store.refresh()).ok);f.onRead=async()=>{throw{code:'NETWORK'};};
 const result=await f.store.upsert({...API.newEvent({eventDate:'2026-11-23'}),title:'서버확인 완료'});assert(result.ok);assert.equal(result.refreshError.code,'SCHEDULE_NETWORK');assert.equal(f.store.snapshot().items[0].id,result.event.id);assert.equal(f.store.snapshot().agenda,null);
});
test('server denial following an ACK clears presentation instead of re-adding the acknowledged private event',async t=>{
 const f=fixture(t);await f.store.refresh({month:'2026-11'});f.onRead=async()=>{throw{code:'CONTEXT_CHANGED'};};const result=await f.store.upsert({...API.newEvent({eventDate:'2026-11-23'}),title:'다시 표시하면 안됨'});
 assert.equal(result.ok,false);assert.equal(f.store.snapshot().key,null);assert.deepEqual(f.store.snapshot().items,[]);assert.equal((await f.store.refresh()).error.code,'SCHEDULE_CONTEXT_CHANGED');
});
test('a direct write denial latches the scope and cannot be bypassed by reset or another draft submission',async t=>{
 const f=fixture(t);f.add(stored());await f.store.refresh({month:'2026-11'});f.onSave=async()=>{throw{code:'FORBIDDEN'};};const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'서버거부 초안'};
 assert.equal((await f.store.upsert(draft)).error.code,'SCHEDULE_CONTEXT_CHANGED');assert.equal(f.store.snapshot().key,null);assert.deepEqual(f.store.snapshot().items,[]);f.store.reset();assert.equal((await f.store.upsert(draft)).error.code,'SCHEDULE_CONTEXT_CHANGED');assert.equal(f.saves.length,1);assert.equal(f.reads.length,1);
 f.context={...f.context,key:'scope-A:fresh-auth-epoch'};f.onSave=null;assert((await f.store.refresh({month:'2026-11'})).ok);assert((await f.store.upsert(draft)).ok);
});
test('bounded request deadlines permit read retry and never automatically repeat an unknown write',async t=>{
 const f=fixture(t,{timeoutMs:5});f.onRead=()=>new Promise(()=>{});assert.equal((await f.store.refresh({month:'2026-11'})).error.code,'SCHEDULE_TIMEOUT');f.onRead=null;assert((await f.store.refresh()).ok);
 const gate=deferred();f.onSave=async(c,e,n)=>{await gate.promise;return f.commitSave(c,e,n);};const draft={...API.newEvent({eventDate:'2026-11-23'}),title:'응답지연 초안'};const first=await f.store.upsert(draft);assert.equal(first.ok,false);assert.equal(first.uncertain,true);assert.equal(f.saves.length,1);assert.equal(f.currentRows().size,0);
 gate.resolve();await new Promise(setImmediate);assert.equal(f.currentRows().size,1);assert.equal(f.store.snapshot().items.length,0,'Late ACK is not allowed to silently replace the uncertain view');f.onSave=null;assert((await f.store.upsert(draft)).ok);assert.equal(f.saves.length,2);assert.equal(f.currentRows().size,1);
});
test('browser auth/reset, route leave and pagehide invalidate work without touching persistent storage',async t=>{
 const target=new EventTarget();Object.assign(target,{crypto,setTimeout,clearTimeout,localStorage:{getItem(){throw Error('Persistent access forbidden');},setItem(){throw Error('Persistent access forbidden');}},sessionStorage:{getItem(){throw Error('Persistent access forbidden');},setItem(){throw Error('Persistent access forbidden');}}});
 vm.runInNewContext(fs.readFileSync(require.resolve('../assets/dealer-scheduler-store.js'),'utf8'),{window:target,AbortController});const api=target.SnoteDealerSchedulerData;
 for(const name of['snote:auth-reset','snote:route-changed','pagehide']){
  const f=fixture(t,{factory:api}),gate=deferred(),began=deferred();f.add(stored());f.onRead=async(c,m)=>{const result=f.envelope(c,m);began.resolve();await gate.promise;return result;};const pending=f.store.refresh({month:'2026-11'});await began.promise;const event=new Event(name);if(name==='snote:route-changed')event.detail={page:'buy'};target.dispatchEvent(event);gate.resolve();assert.equal((await pending).error.code,'SCHEDULE_STALE');assert.equal(f.store.snapshot().items.length,0);f.store.destroy();assert.equal((await f.store.refresh()).error.code,'SCHEDULE_DESTROYED');
 }
});

test('five-week grids expand to six only when required and never omit a day of the requested month',()=>{
 for(const year of [1,2024,2025,2026,9999])for(let month=1;month<=12;month++){
  const key=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0'),grid=M.calendarGrid(key);assert([35,42].includes(grid.length));
  const last=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31][month-1],actual=[];for(let d=1;d<=last;d++){const day=key+'-'+String(d).padStart(2,'0');assert.equal(grid.filter(x=>x===day).length,1);actual.push(day);}
  assert(M.monthRange(key).rangeStart<=actual[0]&&M.monthRange(key).rangeEnd>=actual.at(-1));
 }
 assert.equal(M.calendarGrid('2026-08').length,42);assert.equal(M.calendarGrid('2026-11').length,35);
});
test('inclusive periods retain source dates and overlap month boundaries without creating fake source records',()=>{
 const series=stored({eventDate:'2026-01-30',endDate:'2026-02-02'}),before=JSON.stringify(series),list=M.occurrences([series],'2026-02-01','2026-03-07');
 assert.equal(list.length,1);assert.equal(list[0].eventDate,'2026-01-30');assert.equal(list[0].endDate,'2026-02-02');assert.equal(list[0].occurrenceStartDate,'2026-01-30');assert.equal(list[0].occurrenceEndDate,'2026-02-02');assert.equal(list[0].seriesId,series.id);assert.equal(list[0].occurrenceId,series.id+'@2026-01-30');assert.equal(JSON.stringify(series),before);assert(Object.isFrozen(list)&&Object.isFrozen(list[0]));
 assert.equal(M.occurrences([stored({eventDate:'2020-01-01',endDate:'2030-12-31'})],'2026-11-01','2026-12-05').length,1);
});
test('daily and weekly periods project only bounded intersections while preserving each duration',()=>{
 const daily=stored({eventDate:'2026-02-26',endDate:'2026-02-27',recurrence:'daily'}),days=M.occurrences([daily],'2026-02-26','2026-03-02');
 assert.deepEqual(days.map(e=>e.occurrenceStartDate),['2026-02-26','2026-02-27','2026-02-28','2026-03-01','2026-03-02']);assert.equal(new Set(days.map(e=>e.occurrenceId)).size,5);assert(days.every(e=>e.id===daily.id&&Date.parse(e.occurrenceEndDate)-Date.parse(e.occurrenceStartDate)===86400000));
 const weekly=stored({eventDate:'2026-01-30',endDate:'2026-02-01',recurrence:'weekly'});
 assert.deepEqual(M.occurrences([weekly],'2026-02-01','2026-03-07').map(e=>e.occurrenceStartDate),['2026-01-30','2026-02-06','2026-02-13','2026-02-20','2026-02-27','2026-03-06']);
});
test('month-end and leap-day repeats clamp to the target month end without drifting the source anchor',()=>{
 const monthly=stored({eventDate:'2026-01-31',endDate:'2026-02-01',recurrence:'monthly'}),rows=M.occurrences([monthly],'2026-02-01','2026-04-30');
 assert.deepEqual(rows.map(e=>[e.occurrenceStartDate,e.occurrenceEndDate]),[['2026-01-31','2026-02-01'],['2026-02-28','2026-03-01'],['2026-03-31','2026-04-01'],['2026-04-30','2026-05-01']]);
 const yearly=stored({eventDate:'2024-02-29',endDate:'2024-03-01',recurrence:'yearly'});
 assert.deepEqual(M.occurrences([yearly],'2025-02-01','2025-03-01').map(e=>[e.occurrenceStartDate,e.occurrenceEndDate]),[['2025-02-28','2025-03-01']]);
 assert.equal(M.occurrences([yearly],'2028-02-01','2028-03-01')[0].occurrenceStartDate,'2028-02-29');
});
test('period and recurrence validation keeps legacy defaults, rejects reversed/invalid ranges and bounds only repeat spans',()=>{
 const legacy=stored();delete legacy.endDate;delete legacy.recurrence;const normal=M.event(legacy,{stored:true});assert.equal(normal.endDate,normal.eventDate);assert.equal(normal.recurrence,'none');
 for(const patch of [{endDate:'2026-11-22'},{endDate:'2026-02-30'},{recurrence:'hourly'},{recurrence:1},{eventDate:'2024-01-01',endDate:'2025-01-01',recurrence:'daily'}])assert.throws(()=>M.event(stored(patch),{stored:true}));
 assert.equal(M.event(stored({eventDate:'2024-01-01',endDate:'2024-12-31',recurrence:'yearly'}),{stored:true}).recurrence,'yearly');assert.equal(M.occurrences([stored({eventDate:'9999-12-30',endDate:'9999-12-31',recurrence:'daily'})],'9999-12-30','9999-12-31').length,1);
});
test('projected occurrence ACKs preserve one canonical series and whole-series edits/deletes use its UUID and revision',async t=>{
 const f=fixture(t),series=f.add(stored({eventDate:'2026-10-31',endDate:'2026-11-01',recurrence:'monthly'}));assert((await f.store.refresh({month:'2026-11'})).ok);const rows=f.store.snapshot().items;assert.equal(rows.length,2);assert(rows.every(e=>e.id===series.id));assert.equal(new Set(rows.map(e=>e.occurrenceId)).size,2);
 const changed=await f.store.upsert({...rows[1],title:'원본 시리즈 전체 수정'});assert(changed.ok);assert.equal(changed.event.eventDate,'2026-10-31');assert.equal(changed.event.endDate,'2026-11-01');assert(f.store.snapshot().items.every(e=>e.title==='원본 시리즈 전체 수정'&&e.revision===2));assert(!Object.hasOwn(f.saves[0].event,'occurrenceId'));
 assert((await f.store.remove({id:series.id,revision:2})).ok);assert.equal(f.store.snapshot().items.length,0);assert.equal(f.removes[0].id,series.id);
});
test('period day counts may exceed occurrence count but forged spans, duplicate occurrence IDs and contradictory source copies are rejected',async t=>{
 const f=fixture(t),series=f.add(stored({eventDate:'2026-11-20',endDate:'2026-11-25'}));assert((await f.store.refresh({month:'2026-11'})).ok);let view=f.store.snapshot();assert.equal(view.agenda.counts.calendar,1);assert.equal(Object.values(view.dayCounts).reduce((a,b)=>a+b,0),6);assert.equal(view.agenda.today[0].occurrenceStartDate,'2026-11-20');
 for(const mutate of [r=>{r.events[0].occurrenceEndDate='2026-11-26';},r=>{r.events[0].seriesId=OTHER;},r=>{r.events[0].occurrenceId=series.id+'@2026-11-21';},r=>{r.dayCounts['2026-11-25']=0;},r=>{r.todayEvents[0].revision++;}]){
  f.onRead=(c,m)=>{const raw=f.envelope(c,m);mutate(raw);return raw;};assert.equal((await f.store.refresh({month:'2026-11',force:true})).error.code,'SCHEDULE_ACK_INVALID');
 }
});
test('a lost recurring save ACK reconciles the canonical source rather than creating occurrence rows',async t=>{
 const f=fixture(t);await f.store.refresh({month:'2026-11'});f.onSave=(c,row,expected)=>{f.commitSave(c,row,expected);throw Error('Synthetic lost series response');};
 const desired={...API.newEvent({eventDate:'2025-01-31',endDate:'2025-02-01',recurrence:'monthly'}),title:'응답 유실 반복 원본'};const saved=await f.store.upsert(desired);assert(saved.ok);assert.equal(saved.event.id,desired.id);assert.equal(saved.event.revision,1);assert.equal(f.saves.length,1);assert.equal(f.currentRows().size,1);assert(f.store.snapshot().items.some(e=>e.occurrenceStartDate==='2026-11-30'));
});
