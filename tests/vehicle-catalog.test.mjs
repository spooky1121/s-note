import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';

const code=readFileSync(fileURLToPath(new URL('../assets/vehicle-catalog.js',import.meta.url)),'utf8');
const raw=readFileSync(fileURLToPath(new URL('../assets/vehicle-catalog.json',import.meta.url)),'utf8');
const data=JSON.parse(raw),hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const json=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture(text=raw,{fetch,crypto=webcrypto}={}){
 const requests=[],events=[];
 const context={TextEncoder,crypto,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document:{dispatchEvent(event){events.push(json({type:event.type,detail:event.detail}));return true;}},fetch:async(url,options)=>{requests.push({url,options});return fetch?fetch():{ok:true,text:async()=>text,json(){throw Error('Raw UTF-8 response text must be hashed before parsing');}};}};
 Object.defineProperty(context,'localStorage',{get(){throw Error('Legacy local storage must never be read');}});
 context.window=context;vm.createContext(context);vm.runInContext(code,context,{filename:'vehicle-catalog.js'});
 return{context,api:context.SnoteVehicleCatalog,requests,events};
}
const remote=(extra={})=>({dataset_version:data.catalogVersion,manifest_sha256:hash(raw),entry_count:data.records.length,entries:json(data.records),...extra});
const five=row=>JSON.stringify([row.make,row.group,row.model,row.grade,row.subgrade]);

test('classic helper waits for one fetch, verifies all 3128 IDs, hashes raw UTF-8, then announces readiness',async()=>{
 const gate=deferred(),f=fixture(raw,{fetch:()=>gate.promise});
 assert.equal(f.api.rows().length,0);assert.equal(f.api.get(data.records[0].id),null);assert.equal(f.api.version(),null);assert.deepEqual(f.events,[]);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'./assets/vehicle-catalog.json?v=2.82');assert.equal(f.requests[0].options.credentials,'same-origin');
 gate.resolve({ok:true,text:async()=>raw});assert.equal(await f.api.ready,f.api);
 assert.equal(f.api.rows().length,3128);assert.equal(new Set(f.api.rows().map(row=>row.id)).size,3128);assert.equal(f.api.version(),data.catalogVersion);assert.equal(f.api.manifestSha256(),hash(raw));
 assert.deepEqual(f.events,[{type:'snote:catalog-ready',detail:{datasetVersion:data.catalogVersion,version:data.catalogVersion,entryCount:3128,manifestSha256:hash(raw)}}]);
 vm.runInContext(code,f.context);assert.equal(f.context.SnoteVehicleCatalog,f.api);assert.equal(f.requests.length,1);assert.equal(f.events.length,1);
});

test('preserves empty grades, overseas and candidate observations without five-name collapse',async()=>{
 const {api}=fixture();await api.ready;const rows=api.rows();
 assert.equal(rows.filter(row=>row.market==='GLOBAL').length,154);assert.equal(rows.filter(row=>row.evidenceStatus==='candidate').length,6);
 assert.equal(rows.filter(row=>row.grade==='').length,data.records.filter(row=>row.grade==='').length);
 const groups=new Map();for(const row of rows){if(!groups.has(five(row)))groups.set(five(row),[]);groups.get(five(row)).push(row);}
 assert(groups.size<rows.length,'The fixture must contain rows that a five-name key would incorrectly collapse');
 let repeated=0;
 for(const group of groups.values())if(group.length>1){repeated+=group.length;assert.equal(new Set(group.map(row=>api.choiceLabel(row))).size,group.length);for(const row of group)assert.equal(api.get(row.researchId),row);}
 assert(repeated>200);
 for(const row of rows.filter(row=>row.grade===''&&row.subgrade===''))assert.match(api.choiceLabel(row),/^트림명 미기재/);
 for(const row of rows.filter(row=>row.market==='GLOBAL'))assert.match(api.choiceLabel(row),/해외 참고/);
});

test('choice labels retain explicit year, engine, fuel, options, dates and vehicle qualifiers as plain text',async()=>{
 const {api}=fixture();await api.ready;
 for(const field of ['modelYear','fuel','engine','drivetrain','transmission','optionPackage','sourcePeriod','sourcePublicationDate']){
  const row=api.rows().find(row=>row[field]);assert(row,'Fixture missing '+field);assert(api.choiceLabel(row).includes(row[field]),field+' omitted');
 }
 const battery=api.rows().find(row=>row.qualifiers.batteryKWh);assert(api.choiceLabel(battery).includes(String(battery.qualifiers.batteryKWh)));
 const motor=api.rows().find(row=>row.qualifiers.motorPowerKW);assert(api.choiceLabel(motor).includes(String(motor.qualifiers.motorPowerKW)));
 assert.equal(api.choiceLabel('missing-id'),'');
});

test('all source status codes use Korean display labels while stored context and four XJ engine-only rows remain exact',async()=>{
 const {api}=fixture();await api.ready;const checked=new Map();
 for(const field of ['availability','trimStatus','launchStatus']){
  const values=new Set(data.records.map(row=>row[field]).filter(Boolean));checked.set(field,values.size);
  for(const row of api.rows().filter(row=>row[field])){assert.equal(api.choiceLabel(row).includes(row[field]),false,field+' internal code leaked: '+row[field]);assert.equal(api.reference(row)[field],row[field]);}
 }
 assert.deepEqual([...checked],[['availability',12],['trimStatus',2],['launchStatus',2]]);
 const engineOnly=api.rows().filter(row=>row.model==='뉴 XJ'&&row.recordType==='published_powertrain_option');assert.equal(engineOnly.length,4);
 for(const row of engineOnly){assert.equal(row.grade,'');assert.match(api.choiceLabel(row),/^트림명 미기재/);assert.match(api.choiceLabel(row),/동력계 선택 자료/);assert.match(api.choiceLabel(row),/엔진 선택만 공개/);assert.equal(api.reference(row).recordType,'published_powertrain_option');}
});

test('snapshots are caller-sortable while deeply frozen records and ID lookup stay pristine',async()=>{
 const {api}=fixture();await api.ready;const first=api.rows()[0],snapshot=api.rows();snapshot.reverse();snapshot.pop();
 assert.equal(api.rows().length,3128);assert.equal(api.rows()[0],first);assert.equal(api.record(first.id),first);
 assert(Object.isFrozen(first));assert(Object.isFrozen(first.qualifiers));
 assert.throws(()=>{first.grade='tampered';},TypeError);assert.throws(()=>{first.qualifiers.injected='tampered';},TypeError);
 assert.equal(api.get('unrecognized'),null);assert.equal(api.get({id:first.id,researchId:'research-'+'f'.repeat(24)}),null);
 assert.equal(api.get({...first,grade:'forged display text'}),first);
});

test('saved references preserve complete conditions and correction pointers without copying large evidence bodies',async()=>{
 const {api}=fixture();await api.ready;
 const ids=[data.records.find(row=>Object.keys(row.savedSourceConditions).length),data.records.find(row=>row.sourceCorrections),data.records.find(row=>row.market==='GLOBAL')].map(row=>row.id);
 for(const id of ids){
  const row=api.get(id),reference=api.reference(row);assert.equal(reference.datasetVersion,data.catalogVersion);assert.equal(reference.researchId,id);
  for(const field of ['make','group','model','grade','subgrade','market','modelYear','fuel','engine','drivetrain','transmission','source','evidenceStatus','sourceUrl','qualifiers','recordType','sourcePeriod','sourcePublicationDate','optionPackage','sourceRecordRef','savedSourceConditions'])assert.deepEqual(json(reference[field]),json(row[field]),field);
  if(row.sourceCorrections)assert.deepEqual(json(reference.sourceCorrections),json(row.sourceCorrections));
  assert.equal(Object.hasOwn(reference,'evidence'),false);assert.equal(Object.hasOwn(reference,'sourceRecord'),false);
  reference.qualifiers.injected='caller-only';assert.equal(api.reference(id).qualifiers.injected,undefined);
  reference.savedSourceConditions.injected='caller-only';assert.equal(api.get(id).savedSourceConditions.injected,undefined);
  assert.doesNotThrow(()=>JSON.stringify(reference));
 }
 assert.equal(api.reference('missing'),null);
});

test('invalid or old static catalogs reject readiness and never expose legacy/partial rows',async()=>{
 const variants=[
  value=>{value.schemaVersion=2;},value=>{value.counts.records--;},value=>{value.records.pop();},
  value=>{value.records[1].id=value.records[0].id;value.records[1].researchId=value.records[0].researchId;},
  value=>{value.records[0].id='legacy-company-row';},value=>{value.records[0].model_year='forged';},
  value=>{value.records[0].grade=null;},value=>{value.counts.byMarket.GLOBAL--;},
  value=>{value.selectionPolicy.mode='merge_legacy_catalog';}
 ];
 for(const mutate of variants){const value=json(data);mutate(value);const f=fixture(JSON.stringify(value));await assert.rejects(f.api.ready);assert.equal(f.api.rows().length,0);assert.equal(f.api.version(),null);assert.deepEqual(f.events,[]);}
 const unavailable=fixture(raw,{fetch:async()=>{throw Error('offline');}});await assert.rejects(unavailable.api.ready,{code:'CATALOG_LOAD_FAILED'});assert.equal(unavailable.api.rows().length,0);
 const insecure=fixture(raw,{crypto:{}});await assert.rejects(insecure.api.ready,{code:'CATALOG_INTEGRITY_UNAVAILABLE'});assert.equal(insecure.api.rows().length,0);
});

test('server acceptance requires current version, raw-document hash and exact ID/payload set',async()=>{
 const {api}=fixture();await api.ready;const before=json(api.rows());
 const valid=remote();valid.entries.reverse();valid.entries=valid.entries.map(row=>Object.fromEntries(Object.entries(row).reverse()));
 const accepted=await api.refreshFromServer(async()=>valid,'valid-account-session');assert.equal(accepted.source,'server-verified');assert.equal(accepted.entryCount,3128);assert.deepEqual(json(api.rows()),before);
 const badVariants=[
  x=>{x.dataset_version='old-catalog';},x=>{x.manifest_sha256='0'.repeat(64);},x=>{x.entry_count--;},x=>{x.entries.pop();},
  x=>{x.entries[1]=json(x.entries[0]);},x=>{x.entries[0].id='unknown';x.entries[0].researchId='unknown';},
  x=>{x.entries[0].fuel='different fuel';},x=>{x.entries[0].qualifiers.unreviewedChoice=['AWD','RWD'];},
  x=>{const row=x.entries.find(row=>Object.keys(row.qualifiers).length===0);assert(row);row.qualifiers=new Date('2026-11-07T00:00:00Z');},
  x=>{delete x.entries[0].savedSourceConditions;}
 ];
 for(let i=0;i<badVariants.length;i++){const payload=remote();badVariants[i](payload);await assert.rejects(api.refreshFromServer(async()=>payload,'bad-'+i),{code:'CATALOG_SERVER_MISMATCH'});assert.deepEqual(json(api.rows()),before);}
});

test('raw JSON formatting is part of manifest identity, independent of parsed payload/source archive hash',async()=>{
 const spaced='\n'+raw+'\n',{api}=fixture(spaced);await api.ready;
 assert.equal(api.manifestSha256(),hash(spaced));assert.notEqual(api.manifestSha256(),hash(raw));assert.notEqual(api.manifestSha256(),data.source.sha256);
 await assert.rejects(api.refreshFromServer(async()=>remote()),{code:'CATALOG_SERVER_MISMATCH'});
 const verified=await api.refreshFromServer(async()=>remote({manifest_sha256:hash(spaced)}));assert.equal(verified.entryCount,3128);
});

test('context-key refreshes coalesce, cache successes, separate account sessions and retry failures',async()=>{
 const {api}=fixture();await api.ready;const gate=deferred();let readsA=0,readsB=0;
 const a=api.refreshFromServer(async()=>{readsA++;return gate.promise;},'account-a:session-1');
 const duplicate=api.refreshFromServer(async()=>{throw Error('same-key duplicate reader must not run');},'account-a:session-1');assert.equal(a,duplicate);
 const b=api.refreshFromServer(async()=>{readsB++;return remote();},'account-b:session-1');await b;assert.equal(readsA,1);assert.equal(readsB,1);
 gate.resolve(remote());await a;await api.refreshFromServer(async()=>{throw Error('success cache should avoid a second download');},'account-a:session-1');assert.equal(readsA,1);
 let attempts=0;await assert.rejects(api.refreshFromServer(async()=>{attempts++;throw Error('synthetic RPC timeout');},'account-a:session-2'));
 await api.refreshFromServer(async()=>{attempts++;return remote();},'account-a:session-2');assert.equal(attempts,2);assert.equal(api.rows().length,3128);
 await assert.rejects(api.refreshFromServer(null),{code:'CATALOG_INVALID_READER'});await assert.rejects(api.refreshFromServer(async()=>remote(),''),{code:'CATALOG_INVALID_CONTEXT'});
});

test('reader-identity refresh coalesces without a context key and rejected older responses cannot replace static rows',async()=>{
 const {api}=fixture();await api.ready;const gate=deferred();let calls=0;const reader=async()=>{calls++;return gate.promise;};
 const first=api.refreshFromServer(reader),again=api.refreshFromServer(reader);assert.equal(first,again);await Promise.resolve();assert.equal(calls,1);gate.resolve(remote());await first;await api.refreshFromServer(reader);assert.equal(calls,1);
 const old=deferred(),oldRead=api.refreshFromServer(()=>old.promise,'old-session');const original=api.get(data.records[0].id);
 await api.refreshFromServer(async()=>remote(),'new-session');const poisoned=remote();poisoned.entries[0].savedSourceConditions.injected='older-response';old.resolve(poisoned);await assert.rejects(oldRead,{code:'CATALOG_SERVER_MISMATCH'});
 assert.equal(api.get(original.id),original);assert.equal(api.reference(original).savedSourceConditions.injected,undefined);
});
