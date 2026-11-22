'use strict';
// Actual shipped shared-row completeness helper. Every reply is synthetic;
// no network, browser, database or operating configuration is used.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{join}=require('node:path');
const html=readFileSync(join(__dirname,'../index.html'),'utf8');
const start=html.indexOf('async function snote184CompleteFinancialRows('),end=html.indexOf('function snoteIdleCanonical(',start);
assert(start>=0&&end>start,'The actual completeness helper must be present');
const shipped=html.slice(start,end),NIL='00000000-0000-0000-0000-000000000000';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',FOREIGN='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OWNER='11111111-1111-4111-8111-111111111111';
const DATASETS=['finance','finance_limits','prestock'],copy=value=>JSON.parse(JSON.stringify(value));
const shared=(dataset,payload=[{id:'synthetic-'+dataset}])=>({company_id:COMPANY,dataset,owner_id:NIL,payload,revision:7});
function fixture({role='admin',server=DATASETS.map(dataset=>shared(dataset)),error=null,readHook=null,override=null}={}){
 let current=true,activeRole=role;const queries=[];
 const scope={company:COMPANY,client:{from(table){assert.equal(table,'zc_datasets');const filters={},query={table,filters};queries.push(query);const chain={select(fields){query.fields=fields;return chain;},eq(key,value){filters[key]=value;return chain;},async maybeSingle(){if(readHook)await readHook({scope,filters,query});if(override)return override({scope,filters,query});const found=server.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));assert(found.length<=1,'Synthetic backend enforces the same unique shared-row key');return{data:copy(found[0]??null),error};}};return chain;}}};
 const context={NIL,Promise,Array,Number,Error,snoteCompanyActor:()=>activeRole?{role:activeRole}:null};vm.createContext(context);vm.runInContext(shipped,context);
 return{scope,queries,run:rows=>context.snote184CompleteFinancialRows(scope,rows,()=>current),set current(value){current=value;},set role(value){activeRole=value;}};
}
function exactQueries(f,expected){assert.deepEqual(f.queries.map(q=>q.filters.dataset).sort(),[...expected].sort());for(const query of f.queries){assert.deepEqual(query.filters,{company_id:COMPANY,dataset:query.filters.dataset,owner_id:NIL});assert.equal(query.fields,'company_id,dataset,owner_id,payload,revision');}}

test('bulk-row cap omissions recover each existing financial body from its exact authorized shared key',async()=>{
 const f=fixture(),bulk=[{company_id:COMPANY,dataset:'cars',owner_id:OWNER,payload:[],revision:3}],original=copy(bulk);
 const rows=await f.run(bulk);assert.deepEqual(copy(rows),[...bulk,...DATASETS.map(dataset=>shared(dataset))]);assert.deepEqual(bulk,original);exactQueries(f,DATASETS);
});
test('already returned financial rows are preserved without redundant lookups',async()=>{
 const f=fixture(),bulk=DATASETS.map(dataset=>shared(dataset));const rows=await f.run(bulk);assert.deepEqual(copy(rows),bulk);assert.equal(f.queries.length,0);assert.equal(rows[0],bulk[0],'The helper does not reinterpret a known body');
});
test('only the missing body is confirmed while existing bulk bodies retain their exact wire payload and metadata',async()=>{
 const finance=shared('finance',[{id:'synthetic-debt',loan:350.125,metadata:{retain:true}}]);
 const settings=shared('finance_limits',[['가상 금융',1000,3],{_synthetic_meta:{retain:true}}]);
 const f=fixture(),rows=await f.run([finance,settings]);assert.deepEqual(copy(rows.slice(0,2)),[finance,settings]);exactQueries(f,['prestock']);
});
test('explicit null confirms a genuinely missing row instead of borrowing a cached default',async()=>{
 const f=fixture({server:[]}),bulk=[];const rows=await f.run(bulk);assert.deepEqual(copy(rows),[]);exactQueries(f,DATASETS);assert.deepEqual(bulk,[]);
});
test('shared-read denial roles do not probe financial bodies',async()=>{
 for(const role of ['dealer','operator',null]){const f=fixture({role}),bulk=[{dataset:'cars'}];const rows=await f.run(bulk);assert.equal(rows,bulk);assert.equal(f.queries.length,0);}
});
test('accountants confirm missing authorized financial bodies with the same exact scope as administrators',async()=>{
 const f=fixture({role:'accountant'}),rows=await f.run([]);assert.equal(rows.length,3);exactQueries(f,DATASETS);
});
test('a failed missing-row lookup rejects the whole read instead of inventing an empty body',async()=>{
 const failure=Object.assign(Error('SYNTHETIC_READ_FAILED'),{code:'SYNTHETIC_READ_FAILED'}),f=fixture({error:failure}),bulk=[shared('finance')];
 await assert.rejects(f.run(bulk),error=>error===failure);assert.deepEqual(bulk,[shared('finance')]);exactQueries(f,['finance_limits','prestock']);
});
test('malformed or foreign lookup responses cannot become a verified company body',async()=>{
 for(const patch of [{company_id:FOREIGN},{owner_id:OWNER},{dataset:'monthly'},{revision:-1},{revision:1.5},{payload:{}},{payload:null}]){
  const f=fixture({override:({filters})=>({data:{...shared(filters.dataset),...patch},error:null})});await assert.rejects(f.run([]),/SHARED_FINANCE_RESPONSE_INVALID/);
 }
 for(const data of [undefined,[],false]){const f=fixture({override:()=>({data,error:null})});await assert.rejects(f.run([]),/SHARED_FINANCE_RESPONSE_INVALID/);}
});
test('malformed or duplicate canonical bulk financial rows are rejected before a missing-row query',async()=>{
 for(const patch of [{company_id:FOREIGN},{owner_id:OWNER},{owner_id:null},{payload:{}},{payload:null},{revision:-1},{revision:1.25}]){
  const f=fixture(),bulk=[{...shared('finance'),...patch}];await assert.rejects(f.run(bulk),/SHARED_FINANCE_RESPONSE_INVALID/);assert.equal(f.queries.length,0);
 }
 for(const dataset of DATASETS){const f=fixture(),bulk=[shared(dataset),shared(dataset)];await assert.rejects(f.run(bulk),/SHARED_FINANCE_RESPONSE_INVALID/);assert.equal(f.queries.length,0);}
});

test('a response arriving after the actor or company scope changes is discarded',async()=>{
 let release;const held=new Promise(resolve=>release=resolve),f=fixture({readHook:()=>held}),pending=f.run([]);await Promise.resolve();f.current=false;release();await assert.rejects(pending,/CONTEXT_CHANGED/);exactQueries(f,DATASETS);
});
test('the final current check also fences a fully returned bulk read',async()=>{
 const f=fixture();f.current=false;await assert.rejects(f.run(DATASETS.map(dataset=>shared(dataset))),/CONTEXT_CHANGED/);assert.equal(f.queries.length,0);
});
