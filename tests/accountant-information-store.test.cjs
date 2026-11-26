'use strict';
// Synthetic records and scoped RPC doubles only. No customer data, network or database is used.
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const API=require('../assets/accountant-information-store.js'),M=API.model;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const stamp='2026-11-26T12:00:00.000Z',clone=value=>structuredClone(value),deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const group=(patch={})=>({id:crypto.randomUUID(),name:'합성 거래처',revision:1,createdAt:stamp,updatedAt:stamp,...patch});
const contact=(patch={})=>({id:crypto.randomUUID(),name:'가상 연락처',phone:'010-1234-5678',groupId:null,memo:'가상 메모',revision:1,createdAt:stamp,updatedAt:stamp,...patch});
const account=(patch={})=>({id:crypto.randomUUID(),bankName:'가상 은행',accountNumber:'000-1234567',memo:'합성 계좌',revision:1,createdAt:stamp,updatedAt:stamp,...patch});
const error=code=>Object.assign(Error(code),{code});
function fixture(t,{factory=API,onChange,timeoutMs=1000}={}){
 const f={context:{key:'company-A:actor-A:session-1',actorId:A,companyId:COMPANY,role:'accountant',ready:true},active:true,clock:Date.parse(stamp),companies:new Map(),tombstones:new Map(),reads:[],saves:[],removes:[],changes:[],onRead:null,onSave:null,onRemove:null};
 const pinned=new WeakMap(),rowSet=c=>{if(!f.companies.has(c.companyId))f.companies.set(c.companyId,{groups:new Map(),contacts:new Map(),accounts:new Map()});return f.companies.get(c.companyId);};
 f.rows=()=>rowSet(f.context);f.add=(type,row)=>{f.rows()[type].set(row.id,clone(row));return row;};
 f.envelope=c=>{const sets=rowSet(c),data=Object.fromEntries(['groups','contacts','accounts'].map(type=>[type,[...sets[type].values()].map(clone)]));return {ok:true,companyId:c.companyId,...data,counts:Object.fromEntries(Object.entries(data).map(([type,rows])=>[type,rows.length])),complete:true};};
 f.commitSave=(c,type,record,expected)=>{
  assert.deepEqual(Object.keys(record).sort(),({groups:['id','name'],contacts:['groupId','id','memo','name','phone'],accounts:['accountNumber','bankName','id','memo']})[type]);
  const rows=rowSet(c),old=rows[type].get(record.id),key=c.companyId+':'+type+':'+record.id;
  if(f.tombstones.has(key))throw error('INFORMATION_CONFLICT');
  if(old&&old.revision===expected+1&&Object.entries(record).every(([k,v])=>old[k]===v))return {ok:true,companyId:c.companyId,kind:type,record:clone(old),duplicate:true};
  if(old?old.revision!==expected:expected!==0)throw error('INFORMATION_CONFLICT');
  if(type==='groups'&&[...rows.groups.values()].some(row=>row.id!==record.id&&row.name.toLowerCase()===record.name.toLowerCase()))throw error('INFORMATION_GROUP_EXISTS');
  if(type==='contacts'&&record.groupId!==null&&!rows.groups.has(record.groupId))throw error('INFORMATION_GROUP_UNAVAILABLE');
  const saved={...clone(record),revision:expected+1,createdAt:old?.createdAt||stamp,updatedAt:stamp};rows[type].set(record.id,saved);return {ok:true,companyId:c.companyId,kind:type,record:clone(saved),duplicate:false};
 };
 f.commitRemove=(c,type,id,expected)=>{
  const rows=rowSet(c),old=rows[type].get(id),key=c.companyId+':'+type+':'+id,tomb=f.tombstones.get(key);
  if(tomb===expected+1)return {ok:true,companyId:c.companyId,kind:type,id,revision:tomb,deleted:true,duplicate:true};
  if(!old)throw error('INFORMATION_RECORD_UNAVAILABLE');if(old.revision!==expected)throw error('INFORMATION_CONFLICT');
  if(type==='groups'&&[...rows.contacts.values()].some(row=>row.groupId===id))throw error('INFORMATION_GROUP_IN_USE');
  rows[type].delete(id);f.tombstones.set(key,expected+1);return {ok:true,companyId:c.companyId,kind:type,id,revision:expected+1,deleted:true,duplicate:false};
 };
 f.bridge={context(){if(f.context&&!pinned.has(f.context))pinned.set(f.context,clone(f.context));return f.context;},current(c){const p=pinned.get(c);return !!p&&!!f.context&&['key','actorId','companyId','role','ready'].every(k=>p[k]===f.context[k]);},
  list:async c=>{assert(pinned.has(c),'Bridge must receive the original opaque context object');f.reads.push(clone(c));return f.onRead?f.onRead(c):f.envelope(c);},
  save:async(c,type,record,expected)=>{assert(pinned.has(c));f.saves.push({context:clone(c),type,record:clone(record),expected});return f.onSave?f.onSave(c,type,record,expected):f.commitSave(c,type,record,expected);},
  remove:async(c,type,id,expected)=>{assert(pinned.has(c));f.removes.push({context:clone(c),type,id,expected});return f.onRemove?f.onRemove(c,type,id,expected):f.commitRemove(c,type,id,expected);}};
 f.options={bridge:f.bridge,isActive:()=>f.active,now:()=>f.clock,timeoutMs,onChange:s=>{f.changes.push(s);onChange?.(s,f);}};f.store=factory.create(f.options);t.after(()=>f.store.destroy());return f;
}
test('drafts use secure stable IDs, retain account leading zeroes and do not mutate caller values',()=>{
 const first=API.newRecord('accounts',{bankName:'가상 은행',accountNumber:'000-1234567',memo:'가상'}),second=API.newRecord('accounts');
 assert.notEqual(first.id,second.id);assert.equal(first.revision,0);assert.equal(first.accountNumber,'000-1234567');
 const input=Object.freeze({...first,bankName:'  가상 은행  ',memo:'첫 줄\n둘째 줄\t메모'}),before=JSON.stringify(input),canonical=M.record('accounts',input);
 assert.equal(canonical.bankName,'가상 은행');assert.equal(canonical.memo,input.memo);assert.equal(canonical.accountNumber,first.accountNumber);assert.equal(JSON.stringify(input),before);
 assert.equal(M.record('groups',{...API.newRecord('groups'),name:'\u00a0그룹\u00a0'}).name,'\u00a0그룹\u00a0','Canonical trimming matches SQL btrim ASCII space');
 assert.throws(()=>API.newRecord('unknown'));assert.throws(()=>API.newRecord('contacts',{id:'00000000-0000-0000-0000-000000000000'}));
});
test('invalid input, forbidden controls, excessive Unicode lengths and unsafe revisions are rejected',()=>{
 const draft={...API.newRecord('contacts'),name:'가상 사용자',phone:'+82 (10) 1234-5678',groupId:null,memo:''};assert.equal(M.record('contacts',draft).phone,draft.phone);
 for(const patch of[{name:''},{name:'가'.repeat(101)},{name:'bad\u0000'},{name:'\ud800'},{phone:'abc010'},{phone:'123456'},{phone:'1'.repeat(21)},{phone:'++82 1012345678'},{memo:'가'.repeat(2001)},{memo:'bad\u000b'},{groupId:undefined},{groupId:'not-a-group'},{revision:-1},{revision:2147483648}])assert.throws(()=>M.record('contacts',{...draft,...patch}));
 for(const number of['12345','1'.repeat(41),'123456abcdef','123456/789'])assert.throws(()=>M.record('accounts',{...API.newRecord('accounts'),bankName:'가상 은행',accountNumber:number}));
 assert.throws(()=>M.record('groups',{...API.newRecord('groups'),name:'가'.repeat(61)}));
});
test('stored timestamps reject impossible dates, reversed clocks and unexpected fields',()=>{
 for(const patch of[{createdAt:'2026-02-30T01:00:00.000Z'},{updatedAt:'2026-11-26T24:00:00.000Z'},{updatedAt:'2026-11-25T12:00:00.000Z'},{secret:'not-allowed'}])assert.throws(()=>M.record('contacts',{...contact(),...patch},{stored:true}));
 assert.equal(M.record('contacts',contact(),{stored:true}).revision,1);
});
test('one shared read survives reentrant UI callbacks and publishes an immutable complete snapshot',async t=>{
 const held=deferred(),started=deferred();let reentered;
 const f=fixture(t,{onChange:(s,x)=>{if(s.status==='loading'&&!reentered)reentered=x.store.refresh();}}),g=f.add('groups',group());f.add('contacts',contact({groupId:g.id}));f.add('accounts',account());
 f.onRead=async c=>{started.resolve();await held.promise;return f.envelope(c);};const first=f.store.refresh(),second=f.store.refresh();assert.equal(first,second);assert.equal(first,reentered);await started.promise;assert.equal(f.reads.length,1);assert.equal(f.store.snapshot().contacts.length,0);
 held.resolve();assert((await first).ok);const s=f.store.snapshot();assert.equal(s.contacts[0].groupId,g.id);assert.equal(s.groups.length,1);assert.equal(s.accounts.length,1);assert.throws(()=>{s.contacts[0].memo='changed';});assert.equal(f.store.snapshot().contacts[0].memo,'가상 메모');
});
test('failed initial reads can retry and memory cache honors force, expiry and clock rollback',async t=>{
 const f=fixture(t);f.onRead=async()=>{throw error('NETWORK');};assert.equal((await f.store.refresh()).error.code,'INFORMATION_NETWORK');assert.equal(f.store.snapshot().status,'error');
 f.onRead=null;assert((await f.store.refresh()).ok);assert.equal(f.reads.length,2);await f.store.refresh();assert.equal(f.reads.length,2);
 f.clock+=30001;await f.store.refresh();assert.equal(f.reads.length,3);await f.store.refresh({force:true});assert.equal(f.reads.length,4);f.clock-=50000;await f.store.refresh();assert.equal(f.reads.length,5);
});
test('unready, demo, wrong-role, nil and invalid scopes never send requests or fabricate data',async t=>{
 const f=fixture(t),base=f.context;for(const c of[null,{...base,ready:false},{...base,role:'dealer'},{...base,role:'operator'},{...base,actorId:'local-demo'},{...base,companyId:'00000000-0000-0000-0000-000000000000'},{...base,key:'bad\u0000'}]){f.context=c;assert.equal((await f.store.refresh()).ok,false);assert.equal(f.store.snapshot().key,null);assert.deepEqual(f.store.snapshot().contacts,[]);}assert.equal(f.reads.length,0);assert.equal(f.saves.length,0);
});
test('incomplete, contradictory and cross-company list replies never reach the view',async t=>{
 const corruptions=[r=>{r.companyId=OTHER;},r=>{r.complete=false;},r=>{r.counts.contacts++;},r=>{r.contacts.push(r.contacts[0]);r.counts.contacts++;},r=>{r.contacts[0].groupId=crypto.randomUUID();},r=>{r.accounts[0].accountNumber='not-an-account';},r=>{r.counts.groups=501;},r=>{r.counts.contacts=5001;},r=>{r.counts.accounts=2001;},r=>{r.groups[0].revision=0;},r=>{r.contacts[0].createdAt='2026-02-30T12:00:00.000Z';}];
 for(const corrupt of corruptions){const f=fixture(t),g=f.add('groups',group());f.add('contacts',contact({groupId:g.id}));f.add('accounts',account());f.onRead=async c=>{const r=f.envelope(c);corrupt(r);return r;};assert.equal((await f.store.refresh()).error.code,'INFORMATION_ACK_INVALID');assert.equal(f.store.snapshot().contacts.length,0);assert.equal(f.store.snapshot().groups.length,0);assert.equal(f.store.snapshot().accounts.length,0);}
});
test('logout, company, actor, role, client and route changes fence delayed reads even with the same key',async t=>{
 for(const change of['logout','company','actor','role','client','route','in-place-company']){
  const f=fixture(t),held=deferred(),started=deferred();f.add('contacts',contact());f.onRead=async c=>{const r=f.envelope(c);started.resolve();await held.promise;return r;};const pending=f.store.refresh();await started.promise;
  if(change==='logout')f.context=null;else if(change==='company')f.context={...f.context,companyId:OTHER};else if(change==='actor')f.context={...f.context,actorId:B};else if(change==='role')f.context={...f.context,role:'admin'};else if(change==='client')f.options.bridge={...f.bridge};else if(change==='route')f.active=false;else f.context.companyId=OTHER;
  assert.equal(f.store.snapshot().contacts.length,0);held.resolve();assert.equal((await pending).error.code,'INFORMATION_STALE');assert.equal(f.store.snapshot().contacts.length,0);
 }
});
test('same-company managers share records but another company receives no previous snapshot',async t=>{
 const f=fixture(t),g=f.add('groups',group());f.add('contacts',contact({groupId:g.id}));await f.store.refresh();
 f.context={...f.context,key:'company-A:actor-B:session-2',actorId:B,role:'admin'};assert.equal(f.store.snapshot().contacts.length,0);assert((await f.store.refresh()).ok);assert.equal(f.store.snapshot().contacts.length,1);
 f.context={...f.context,key:'company-B:actor-B:session-3',companyId:OTHER};assert.equal(f.store.snapshot().contacts.length,0);assert((await f.store.refresh()).ok);assert.equal(f.store.snapshot().groups.length,0);assert.equal(f.store.snapshot().contacts.length,0);
});
test('scope denial latches until a new verified context and sanitized root error aliases are honored',async t=>{
 const f=fixture(t);f.add('contacts',contact());await f.store.refresh();f.onRead=async()=>{throw {code:'INFORMATION_FORBIDDEN',message:'untrusted customer text'};};assert.equal((await f.store.refresh({force:true})).error.code,'INFORMATION_CONTEXT_CHANGED');assert.equal(f.store.snapshot().key,null);f.store.reset();assert.equal((await f.store.refresh()).error.code,'INFORMATION_CONTEXT_CHANGED');assert.equal(f.reads.length,2);
 f.context={...f.context,key:'company-A:actor-A:session-2'};f.onRead=async()=>{throw {code:'INFORMATION_SETUP_REQUIRED'};};assert.equal((await f.store.refresh()).error.code,'INFORMATION_UNAVAILABLE');f.onRead=async()=>{throw {code:'INFORMATION_INVALID_RESPONSE'};};assert.equal((await f.store.refresh()).error.code,'INFORMATION_ACK_INVALID');f.onRead=null;assert((await f.store.refresh()).ok);
});
test('writes require an initial complete snapshot and invalid values do not invoke a mutation',async t=>{
 const f=fixture(t),draft={...f.store.newRecord('groups'),name:'합성 그룹'};assert.equal((await f.store.save('groups',draft)).error.code,'INFORMATION_UNAVAILABLE');await f.store.refresh();
 assert.equal((await f.store.save('contacts',{...f.store.newRecord('contacts'),name:'가상',phone:'bad'})).error.code,'INFORMATION_INVALID_RECORD');assert.equal((await f.store.remove('groups',{id:draft.id,revision:0})).error.code,'INFORMATION_INVALID_REVISION');assert.equal(f.saves.length,0);assert.equal(f.removes.length,0);
});
test('save waits for full ACK, deduplicates identical submissions and preserves leading account zeroes',async t=>{
 const f=fixture(t),held=deferred(),started=deferred();await f.store.refresh();const draft=Object.freeze({...f.store.newRecord('accounts'),bankName:'가상 은행',accountNumber:'000-1234567',memo:'합성 메모'}),before=JSON.stringify(draft);
 f.onSave=async(c,k,r,n)=>{started.resolve();await held.promise;return f.commitSave(c,k,r,n);};const p=f.store.save('accounts',draft),q=f.store.saveAccount(draft,0);assert.equal(p,q);await started.promise;assert.equal(f.store.snapshot().accounts.length,0);assert.equal(f.store.snapshot().busy,true);assert.equal((await f.store.refresh()).error.code,'INFORMATION_BUSY');assert.equal((await f.store.saveAccount({...draft,memo:'다른 값'},0)).error.code,'INFORMATION_BUSY');
 held.resolve();const result=await p;assert(result.ok);assert.equal(result.record.revision,1);assert.equal(result.record.accountNumber,'000-1234567');assert.equal(f.store.snapshot().accounts[0].accountNumber,draft.accountNumber);assert.equal(f.saves.length,1);assert.equal(f.store.snapshot().busy,false);assert.equal(JSON.stringify(draft),before);
});
test('a delayed pre-save read cannot erase a newer acknowledged record',async t=>{
 const f=fixture(t);await f.store.refresh();const held=deferred(),started=deferred();let first=true;f.onRead=async c=>{const r=f.envelope(c);if(first){first=false;started.resolve();await held.promise;}return r;};const old=f.store.refresh({force:true});await started.promise;
 const result=await f.store.saveGroup({...f.store.newRecord('groups'),name:'새 합성 그룹'});assert(result.ok);held.resolve();assert.equal((await old).error.code,'INFORMATION_STALE');assert.equal(f.store.snapshot().groups[0].name,'새 합성 그룹');
});
test('group create, assignment, rename, ungroup and deletion retain validated relationships',async t=>{
 const f=fixture(t);await f.store.refresh();const a=await f.store.saveGroup({...f.store.newRecord('groups'),name:'가상 금융사'});assert(a.ok);
 const b=await f.store.saveContact({...f.store.newRecord('contacts'),name:'가상 담당자',phone:'02-123-4567',groupId:a.record.id,memo:'상담\n가상 메모'});assert(b.ok);assert.equal(f.store.snapshot().contacts[0].groupId,a.record.id);
 assert.equal((await f.store.removeGroup(a.record.id,1)).error.code,'INFORMATION_GROUP_IN_USE');assert.equal(f.store.snapshot().groups.length,1);
 const renamed=await f.store.saveGroup({...a.record,name:'가상 정비소'});assert(renamed.ok);assert.equal(f.store.snapshot().groups[0].name,'가상 정비소');assert.equal(f.store.snapshot().contacts[0].groupId,a.record.id);
 assert((await f.store.saveContact({...b.record,groupId:null})).ok);assert((await f.store.removeGroup(a.record.id,2)).ok);assert.equal(f.store.snapshot().groups.length,0);assert.equal(f.store.snapshot().contacts[0].groupId,null);
});
test('group and record errors do not revoke the whole verified company context',async t=>{
 const f=fixture(t);await f.store.refresh();const draft={...f.store.newRecord('contacts'),name:'가상',phone:'010-1111-2222',groupId:crypto.randomUUID()};assert.equal((await f.store.saveContact(draft)).error.code,'INFORMATION_GROUP_UNAVAILABLE');assert.notEqual(f.store.snapshot().key,null);
 const missing=await f.store.removeAccount(crypto.randomUUID(),1);assert.equal(missing.error.code,'INFORMATION_RECORD_UNAVAILABLE');assert.notEqual(f.store.snapshot().key,null);
 f.onSave=async()=>{throw {code:'23505',message:'INFORMATION_GROUP_EXISTS'};};const duplicate=await f.store.saveGroup({...f.store.newRecord('groups'),name:'가상 중복'});assert.equal(duplicate.error.code,'INFORMATION_GROUP_EXISTS');assert.notEqual(f.store.snapshot().key,null);
});
test('CAS conflicts refresh authoritative data while leaving the caller draft unchanged',async t=>{
 const f=fixture(t),row=f.add('contacts',contact());await f.store.refresh();const draft=Object.freeze({...row,memo:'사용자 미저장 초안'});f.rows().contacts.set(row.id,{...row,memo:'다른 경리의 최신값',revision:2});
 const result=await f.store.saveContact(draft);assert.equal(result.error.code,'INFORMATION_CONFLICT');assert.equal(f.saves.length,1);assert.equal(f.store.snapshot().contacts[0].memo,'다른 경리의 최신값');assert.equal(draft.memo,'사용자 미저장 초안');assert.equal(draft.revision,1);
});
test('forged ACK fields, scope, kind or revision never become successful saved records',async t=>{
 for(const corrupt of[r=>{r.companyId=OTHER;},r=>{r.kind='accounts';},r=>{r.record.revision=9;},r=>{r.record.name='다른 값';},r=>{r.record.updatedAt='invalid';},r=>{r.duplicate='yes';}]){
  const f=fixture(t);await f.store.refresh();f.onSave=async(c,k,r,n)=>{const ack={ok:true,companyId:c.companyId,kind:k,record:{...r,revision:n+1,createdAt:stamp,updatedAt:stamp},duplicate:false};corrupt(ack);return ack;};const result=await f.store.saveGroup({...f.store.newRecord('groups'),name:'가상'});assert.equal(result.ok,false);assert.equal(result.error.code,'INFORMATION_ACK_INVALID');assert.equal(f.store.snapshot().groups.length,0);
 }
});
test('a lost save ACK reconciles only the exact ID, payload and next revision without saving again',async t=>{
 const f=fixture(t);await f.store.refresh();f.onSave=async(c,k,r,n)=>{f.commitSave(c,k,r,n);throw {code:'NETWORK',message:'untrusted error text'};};const draft={...f.store.newRecord('groups'),name:'한 번만 저장'};
 const result=await f.store.saveGroup(draft);assert(result.ok);assert.equal(result.record.id,draft.id);assert.equal(result.record.revision,1);assert.equal(f.saves.length,1);assert.equal(f.rows().groups.size,1);assert.equal(f.reads.length,2);assert.equal(f.store.snapshot().uncertain,false);
});
test('uncertain saves retain stable IDs, block changed-payload replays and recover by idempotent retry',async t=>{
 const f=fixture(t);await f.store.refresh();f.onSave=async(c,k,r,n)=>{f.commitSave(c,k,r,n);throw error('NETWORK');};f.onRead=async()=>{throw error('NETWORK');};const draft=Object.freeze({...f.store.newRecord('groups'),name:'가상 보존 초안'}),before=JSON.stringify(draft);
 const first=await f.store.saveGroup(draft);assert.equal(first.ok,false);assert.equal(first.uncertain,true);assert.equal(f.store.snapshot().uncertain,true);assert.equal((await f.store.saveGroup({...draft,name:'다른 초안'})).error.code,'INFORMATION_UNCERTAIN_EDIT');assert.equal(f.saves.length,1);assert.equal(JSON.stringify(draft),before);
 f.onSave=f.onRead=null;const retry=await f.store.saveGroup(draft);assert(retry.ok);assert.equal(f.saves.length,2);assert.deepEqual(f.saves[0].record,f.saves[1].record);assert.equal(f.rows().groups.size,1);assert.equal(f.store.snapshot().uncertain,false);
});
test('uncertainty on one record survives successful edits to another record',async t=>{
 const f=fixture(t),existing=f.add('accounts',account());await f.store.refresh();const draft={...f.store.newRecord('groups'),name:'불확실 합성 그룹'};f.onSave=async(c,k,r,n)=>{f.commitSave(c,k,r,n);throw error('NETWORK');};f.onRead=async()=>{throw error('NETWORK');};assert.equal((await f.store.saveGroup(draft)).uncertain,true);
 f.onRead=f.onSave=null;assert((await f.store.saveAccount({...existing,memo:'다른 계좌 수정'})).ok);assert.equal(f.store.snapshot().uncertain,true);assert.equal((await f.store.saveGroup({...draft,name:'다른 불확실 값'})).error.code,'INFORMATION_UNCERTAIN_EDIT');assert((await f.store.saveGroup(draft)).ok);assert.equal(f.store.snapshot().uncertain,false);
});
test('newer explicitly read revisions can be edited after a save whose original ACK was lost',async t=>{
 const f=fixture(t),row=f.add('accounts',account());await f.store.refresh();f.onSave=async(c,k,r,n)=>{f.commitSave(c,k,r,n);throw error('NETWORK');};f.onRead=async()=>{throw error('NETWORK');};assert.equal((await f.store.saveAccount({...row,memo:'가상 첫 수정'})).uncertain,true);
 f.onSave=f.onRead=null;await f.store.refresh({force:true});const latest=f.store.snapshot().accounts[0];assert.equal(latest.revision,2);const next=await f.store.saveAccount({...latest,memo:'확인한 최신값의 후속 수정'});assert(next.ok);assert.equal(next.record.revision,3);assert.equal(f.store.snapshot().uncertain,false);
});
test('deletion requires a matching full tombstone ACK; absence alone cannot confirm an uncertain delete',async t=>{
 const f=fixture(t),row=f.add('contacts',contact());await f.store.refresh();f.onRemove=async(c,k,id,n)=>{f.commitRemove(c,k,id,n);throw error('NETWORK');};const first=await f.store.removeContact(row.id,1);assert.equal(first.ok,false);assert.equal(first.uncertain,true);assert.equal(f.store.snapshot().contacts.length,0);
 f.onRemove=null;const retry=await f.store.removeContact(row.id,1);assert(retry.ok);assert.equal(retry.deleted,true);assert.equal(retry.revision,2);assert.equal(f.removes.length,2);assert.equal(f.store.snapshot().uncertain,false);
});
test('malformed deletion ACKs cannot remove an existing visible row',async t=>{
 const f=fixture(t),row=f.add('accounts',account());await f.store.refresh();f.onRemove=async(c,k,id,n)=>({ok:true,companyId:c.companyId,kind:k,id:crypto.randomUUID(),revision:n+1,deleted:true,duplicate:false});const result=await f.store.removeAccount(row.id,1);assert.equal(result.ok,false);assert.equal(result.error.code,'INFORMATION_ACK_INVALID');assert.equal(f.store.snapshot().accounts.length,1);
});
test('a verified write remains acknowledged if follow-up refresh fails, without inventing unrelated changes',async t=>{
 const f=fixture(t),row=f.add('accounts',account());await f.store.refresh();f.onRead=async()=>{throw error('NETWORK');};const result=await f.store.saveAccount({...row,memo:'ACK로 확인된 가상 메모'});assert(result.ok);assert.equal(result.refreshError.code,'INFORMATION_NETWORK');assert.equal(f.store.snapshot().accounts[0].memo,'ACK로 확인된 가상 메모');assert.equal(f.store.snapshot().status,'error');
});
test('a fallback group deletion cannot leave dangling contact-group relationships',async t=>{
 const f=fixture(t),g=f.add('groups',group()),c=f.add('contacts',contact({groupId:g.id}));await f.store.refresh();f.rows().contacts.set(c.id,{...c,groupId:null,revision:2});f.onRead=async()=>{throw error('NETWORK');};const result=await f.store.removeGroup(g.id,1);assert(result.ok);assert.equal(f.store.snapshot().loaded,false);assert.deepEqual(f.store.snapshot().groups,[]);assert.deepEqual(f.store.snapshot().contacts,[]);
});
test('late mutation ACKs cannot populate another actor, company, role or inactive route',async t=>{
 for(const change of['actor','company','role','route']){
  const f=fixture(t),held=deferred(),started=deferred();await f.store.refresh();f.onSave=async(c,k,r,n)=>{started.resolve();await held.promise;return f.commitSave(c,k,r,n);};const pending=f.store.saveGroup({...f.store.newRecord('groups'),name:'이전 문맥의 합성 그룹'});await started.promise;
  if(change==='actor')f.context={...f.context,actorId:B};else if(change==='company')f.context={...f.context,companyId:OTHER};else if(change==='role')f.context={...f.context,role:'admin'};else f.active=false;assert.equal(f.store.snapshot().groups.length,0);held.resolve();assert.equal((await pending).error.code,'INFORMATION_STALE');assert.equal(f.store.snapshot().groups.length,0);
 }
});
test('timeouts and unknown server text return bounded sanitized errors and permit later reads',async t=>{
 const f=fixture(t,{timeoutMs:5}),held=deferred();f.onRead=async()=>{await held.promise;return f.envelope(f.context);};const timed=await f.store.refresh();assert.equal(timed.error.code,'INFORMATION_TIMEOUT');held.resolve();f.onRead=async()=>{throw {code:'UNTRUSTED_CUSTOM_CODE',message:'customer name phone token'};};const bad=await f.store.refresh();assert.deepEqual(bad,{ok:false,error:{code:'INFORMATION_NETWORK'}});f.onRead=null;assert((await f.store.refresh()).ok);
});
test('browser lifecycle clears private snapshots, removes listeners and never uses browser storage',async t=>{
 const source=fs.readFileSync(require.resolve('../assets/accountant-information-store.js'),'utf8'),events=new EventTarget(),win={crypto:crypto,setTimeout,clearTimeout,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events)};
 Object.defineProperty(win,'localStorage',{get(){throw Error('Business data must not use localStorage');}});Object.defineProperty(win,'sessionStorage',{get(){throw Error('Business data must not use sessionStorage');}});
 vm.runInNewContext(source,{window:win,globalThis:win,AbortController,Uint8Array,URL,Map,Set,Date,Error,Object,Array,JSON,Number,String,RegExp,Promise});const f=fixture(t,{factory:win.SnoteAccountantInformationData});f.add('contacts',contact());await f.store.refresh();assert.equal(f.store.snapshot().contacts.length,1);
 f.context=null;events.dispatchEvent(new Event('snote:auth-reset'));assert.equal(f.store.snapshot().key,null);assert.equal(f.store.snapshot().contacts.length,0);f.store.destroy();events.dispatchEvent(new Event('pagehide'));assert.equal((await f.store.refresh()).error.code,'INFORMATION_DESTROYED');assert.equal(f.store.snapshot().contacts.length,0);
});
