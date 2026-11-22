'use strict';
// Actual index finance functions, synthetic company adapters, no browser or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function extract(start,end){const a=src.indexOf(start),b=src.indexOf(end,a);assert(a>=0&&b>a,start);return src.slice(a,b);}
const code=[
 "let ACC44_LENDER_LIMITS=[];let INVENTORY_LENDERS=[];const ZC157_FINANCE_KEY='finance-limits';const ZC182_FINANCE_KEY='finance-ledger';",
 extract('function restoreFinanceCompanies(','function persistFinanceCompanies(next){'),
 extract('let snote184FinanceSettingsState=null;','function snoteCompanyActor(){'),
 extract('function snote184FinanceEntryAllowed(','function zc182MatchVehicle('),
 extract('function financeCarRows({','/* One verified company aggregate;'),
 extract('let snote135FinanceCompanyState=null;','const ZC157_FINANCE_KEY='),
 extract('function zc182Plate(value){','function zc182WriteFinance(a){'),
 extract('function zc182ActiveStandalone({','/* 원 단위 입력·계산·표시.'),
 extract('function snote135MonthlyFinance(ctx){',"window.addEventListener('snote:inventory-finance-ready',snote135SendMonthlyFinance);")
].join('\n');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',USER='11111111-1111-4111-8111-111111111111';
const clone=value=>JSON.parse(JSON.stringify(value)),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let company=A,role='admin',ready=true,filter='all',sourceReady=false,authorityMismatch=false,fail=false;
 let loadHook=null,loads=0,builds=0;
 const client={},owners=new Set(['dealer-A','dealer-B']),events=[],messages=[],raw=new Map();
 const sources=new Map([[A,{limits:[['합성 A금융',10000,6]],ledger:[]}]]);
 const S={client,user:{id:USER},company:{id:A}};
 const companySource=()=>{if(!sources.has(company))sources.set(company,{limits:[],ledger:[]});return sources.get(company);};
 const context=()=>({key:company+':'+role,companyId:company,userId:USER,ownerAlias:'fixture-admin',role,ready,canRead:['admin','accountant'].includes(role)});
 const authority=()=>({key:company+':'+role+':authority',companyId:authorityMismatch?B:company,userId:USER,role,client:S.client});
 const listeners=new Map(),world={console,Number,Map,Set,Object,Array,JSON,Promise,S,snote220CatalogEpoch:1,SNOTE203_META:'_snote203_meta',cars:[],route:'buy',
  // This cache deliberately remains shared. It is not a confirmed server response.
  localStorage:{getItem:key=>raw.get(key)??null},
  snoteCompanyPurchaseContext:context,snotePurchaseContext:context,accountantFilter:()=>filter,inventoryLoanOf:car=>Number(car.inventoryLoan)||0,
  buildInventoryFinance:()=>builds++,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  snote216MonthlyContext:null,
  snote216MonthlyCurrent:ctx=>ctx===world.snote216MonthlyContext&&ctx.companyId===company&&ctx.userId===USER&&ready&&['admin','accountant'].includes(role),
  snote216MonthlyCheck:ctx=>{if(!world.snote216MonthlyCurrent(ctx))throw Object.assign(Error('CONTEXT_CHANGED'),{code:'CONTEXT_CHANGED'});},
  snote216MonthlyPost:message=>messages.push(clone(message))
 };
 const adopt=()=>{const data=companySource();world.__confirmedLimits=clone(data.limits);world.__confirmedLedger=clone(data.ledger);vm.runInContext('snote184CaptureFinanceSettings(__confirmedLimits);snote184CaptureFinanceLedger(__confirmedLedger);restoreFinanceCompanies(__confirmedLimits)',world);};
 world.window={
  snoteFinanceLockBridge:{context:authority,current:ctx=>ctx.companyId===company&&ctx.role===role&&ctx.userId===USER&&ctx.client===S.client},
  snoteCompanyPurchaseBridge:{
   carAllowed:car=>ready&&car.companyId===company&&owners.has(car.ownerId),
   ownerAllowed:owner=>owners.has(owner),
   financeLedgerCompany:()=>world.window.snoteInventoryFinanceLedgerBridge.company(),
   load:async ctx=>{loads++;if(loadHook)await loadHook(ctx);if(fail)throw Object.assign(Error('NETWORK'),{code:'NETWORK'});if(ctx.key===context().key&&ctx.userId===USER)adopt();}
  },
  snoteCompanyPurchaseIsReady:()=>sourceReady,
  snoteEnsureCompanyPurchase:()=>sourceReady,
  snoteRefreshCompanyPurchase:()=>{sourceReady=false;},
  addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);},
  dispatchEvent:event=>{events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);}
 };
 vm.createContext(world);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/money.js'),'utf8'),world);world.SnoteMoney=world.SnoteMoney||world.window.SnoteMoney;vm.runInContext(code,world);adopt();
 const aggregate=()=>clone(world.window.snoteInventoryFinanceAggregate());
 const ensure=()=>world.window.snoteEnsureInventoryFinanceAggregate();
 const use=async()=>{ensure();await tick();assert.equal(aggregate().ready,true);};
 return{world,events,messages,aggregate,ensure,use,
  set company(value){company=value;S.company={id:value};world.snote220CatalogEpoch++;},get company(){return company;},set role(value){role=value;},set ready(value){ready=value;},
  set filter(value){filter=value;},set sourceReady(value){sourceReady=value;},set authorityMismatch(value){authorityMismatch=value;},
  set limits(value){companySource().limits=clone(value);raw.set('finance-limits',JSON.stringify(value));},
  set ledger(value){companySource().ledger=value.map(row=>({...clone(row),moneyUnit:'KRW'}));raw.set('finance-ledger',JSON.stringify(companySource().ledger));adopt();},
  set loadHook(value){loadHook=value;},set fail(value){fail=value;},
  get loads(){return loads;},get builds(){return builds;},restore:adopt,
  replaceSharedCache({limits=[],ledger=[]}={}){raw.set('finance-limits',JSON.stringify(limits));raw.set('finance-ledger',JSON.stringify(ledger));},
  monthly(){const ctx={key:company+':monthly',companyId:company,userId:USER,mode:'cloud',initialized:true};world.snote216MonthlyContext=ctx;return ctx;}
 };
}

test('switching from a registered company to an empty or metadata-only company clears every prior limit',async()=>{
 const f=fixture();await f.use();assert.equal(f.aggregate().limit,100000000);
 f.company=B;f.limits=[];f.restore();await f.use();assert.deepEqual(f.aggregate(),{key:B+':admin:'+B+':admin:authority',ready:true,companyId:B,limit:0,used:0,remaining:0});
 f.limits=[{_snote203_meta:{prestock:{total:999}}}];f.restore();assert.equal(f.aggregate().limit,0);
 f.limits=[['현재 B금융',123,7]];f.restore();assert.equal(f.aggregate().limit,1230000);
 f.limits=[{_snote203_meta:{}}];f.restore();assert.equal(f.aggregate().limit,0);
});

test('company totals ignore UI dealer filters, retain sold outstanding principal and reject foreign/unauthorized vehicle snapshots and duplicate debt',async()=>{
 const f=fixture();f.world.cars=[
  {companyId:A,ownerId:'dealer-A',status:'판매중',plate:'12가3456',inventoryLoan:30000000},
  {companyId:A,ownerId:'dealer-B',status:'판매중',plate:'34나5678',inventoryLoan:20000000},
  {companyId:A,ownerId:'dealer-A',status:'판매완료',plate:'55다0000',inventoryLoan:90000000},
  {companyId:B,ownerId:'dealer-A',status:'판매중',plate:'66라0000',inventoryLoan:80000000},
  {companyId:A,ownerId:'outsider',status:'판매중',plate:'77마0000',inventoryLoan:70000000}
 ];
 f.ledger=[{companyId:A,dealerId:'dealer-A',plate:'12가3456',loan:30000000},{companyId:A,dealerId:'dealer-B',plate:'99사0000',loan:10000000},{companyId:B,dealerId:'dealer-A',plate:'11아0000',loan:60000000},{companyId:A,dealerId:'outsider',plate:'22자0000',loan:50000000}];
 await f.use();assert.equal(f.aggregate().used,200000000);f.filter='dealer-A';assert.equal(f.aggregate().used,200000000);f.filter='dealer-B';assert.equal(f.aggregate().used,200000000);assert.equal(f.aggregate().remaining,-100000000);
});

test('canonical company finance retains departed-dealer loans without a matching vehicle or active member',async()=>{
 const f=fixture();f.ledger=[
  {dealerId:'departed-no-car',plate:'12가9001',loan:25000000},
  {companyId:A,dealerId:'another-departed-no-car',plate:'12가9002',loan:50000000},
  {companyId:B,dealerId:'departed-no-car',plate:'12가9003',loan:90000000}
 ];await f.use();assert.equal(f.aggregate().used,75000000);assert.equal(f.aggregate().remaining,25000000);f.filter='dealer-A';assert.equal(f.aggregate().used,75000000,'dealer selection cannot erase real company liabilities');
});

test('loading, network failure and unauthorized roles remain unready rather than successful zero totals',async()=>{
 const f=fixture();let resolve;f.loadHook=()=>new Promise(r=>{resolve=r;});assert.equal(f.ensure(),false);assert.equal(f.aggregate().ready,false);assert.equal(f.loads,1);f.ensure();assert.equal(f.loads,1,'single in-flight company load');resolve();await tick();assert.equal(f.aggregate().ready,true);
 f.company=B;f.fail=true;f.ensure();await tick();assert.equal(f.aggregate().ready,false);assert.equal(f.loads,2);const ctx=f.monthly();f.world.route='monthly';const data=clone(f.world.snote135MonthlyFinance(ctx));assert.equal(data.ready,false);for(const field of['limit','used','remaining'])assert.equal(field in data,false);
 for(const role of['dealer','operator']){f.role=role;assert.equal(f.ensure(),false);assert.equal(f.aggregate().ready,false);}
});

test('late company reads cannot mark a new account/company scope ready and disagreement between authorities is rejected',async()=>{
 const f=fixture();let resolve;f.loadHook=()=>new Promise(r=>{resolve=r;});f.ensure();f.company=B;resolve();await tick();assert.equal(f.aggregate().ready,false);f.loadHook=null;await f.use();assert.equal(f.aggregate().companyId,B);f.authorityMismatch=true;f.company=A;assert.equal(f.aggregate().ready,false);assert.equal(f.ensure(),false);
});

test('accountants reuse the canonical company-ready gate and aggregate getters never trigger network loads',()=>{
 const f=fixture();f.role='accountant';assert.equal(f.ensure(),false);assert.equal(f.aggregate().ready,false);assert.equal(f.loads,0);f.sourceReady=true;assert.equal(f.ensure(),true);assert.equal(f.aggregate().ready,true);for(let i=0;i<50;i++)f.aggregate();assert.equal(f.loads,0);f.ready=false;assert.equal(f.aggregate().ready,false);
});

test('monthly preparation loads finance only for the visible monthly route and deduplicates identical parent messages',async()=>{
 const f=fixture(),ctx=f.monthly();const initial=clone(f.world.snote135MonthlyFinance(ctx));assert.equal(initial.ready,false);assert.equal(f.loads,0,'hidden iframe INIT cannot start a company load');f.world.route='monthly';f.world.snote135MonthlyFinance(ctx);await tick();assert.equal(f.loads,1);f.world.snote135SendMonthlyFinance();f.world.snote135SendMonthlyFinance();assert.equal(f.messages.length,1);assert.equal(f.messages[0].type,'SNOTE_MONTHLY_WORKBOOK_FINANCE');assert.equal(f.messages[0].contextKey,ctx.key);assert.equal(f.messages[0].inventoryFinance.ready,true);
 f.limits=[['합성 A금융',20000,6]];f.restore();f.world.snote135SendMonthlyFinance();assert.equal(f.messages.length,2);assert.equal(f.messages[1].inventoryFinance.limit,200000000);f.company=B;f.world.snote135SendMonthlyFinance();assert.equal(f.messages.length,2,'old iframe cannot receive another company aggregate');
});

test('unsafe totals stay unknown and valid over-limit inventory retains its negative remaining balance',async()=>{
 const f=fixture();f.limits=[['합성 A금융',1,6]];f.restore();f.world.cars=[{companyId:A,ownerId:'dealer-A',plate:'12가3456',status:'판매중',inventoryLoan:20000}];await f.use();assert.equal(f.aggregate().remaining,-10000);f.world.cars[0].inventoryLoan=Number.MAX_SAFE_INTEGER+2;assert.equal(f.aggregate().ready,false);
});

test('foreign shared-cache replacement cannot change a confirmed company limit or legacy departed-dealer debt',async()=>{
 const f=fixture();f.ledger=[{dealerId:'departed-no-car',plate:'12가9001',loan:25000000}];await f.use();
 f.replaceSharedCache({limits:[['다른 상사 금융',90000,8]],ledger:[{dealerId:'foreign-departed',plate:'12가9999',loan:99000000,moneyUnit:'KRW'}]});
 f.world.restoreFinanceCompanies();assert.equal(f.aggregate().limit,100000000);assert.equal(f.aggregate().used,25000000);
 assert.equal(f.world.zc182ActiveStandalone({allDealers:true})[0].dealerId,'departed-no-car');
 const rows=f.world.window.snoteInventoryFinanceLedgerBridge.rows();rows[0].loan=0;assert.equal(f.aggregate().used,25000000,'Callers receive copies of the verified body');
 f.world.S.user={id:USER};assert.equal(f.world.window.snoteInventoryFinanceLedgerBridge.rows(),null,'A new actor object cannot reuse the previous financial body');assert.equal(f.world.window.snotePrestockSettingsBridge.rows(),null);
});

test('confirmed car readiness cannot turn missing financial snapshots into successful zero or stale totals',async()=>{
 const f=fixture();f.ledger=[{dealerId:'departed-no-car',plate:'12가9001',loan:25000000}];await f.use();
 assert.equal(f.aggregate().used,25000000);assert.equal(f.aggregate().limit,100000000);
 vm.runInContext('snote184FinanceLedgerState=null;',f.world);assert.equal(f.aggregate().ready,false,'A lost ledger snapshot is unknown, even after a successful company-car read');
 const ctx=f.monthly();f.world.route='monthly';let monthly=clone(f.world.snote135MonthlyFinance(ctx));assert.equal(monthly.ready,false);for(const field of ['limit','used','remaining'])assert.equal(field in monthly,false);
 f.restore();assert.equal(f.aggregate().ready,true);assert.equal(f.aggregate().used,25000000);
 vm.runInContext('snote184FinanceSettingsState=null;',f.world);assert.equal(f.aggregate().ready,false,'An unavailable settings body cannot expose the previous lender limit as current');
 monthly=clone(f.world.snote135MonthlyFinance(ctx));assert.equal(monthly.ready,false);for(const field of ['limit','used','remaining'])assert.equal(field in monthly,false);
 f.restore();assert.equal(f.aggregate().ready,true);assert.equal(f.aggregate().limit,100000000);
});
