'use strict';
// Synthetic companies only. These tests never contact an external service.
const assert=require('node:assert/strict'),{test}=require('node:test'),vm=require('node:vm');
const {readFileSync}=require('node:fs'),{join}=require('node:path');
const html=readFileSync(join(__dirname,'..','index.html'),'utf8');
function sourceFunction(name){
 const found=html.match(new RegExp('^function '+name+'\\([^\\n]*\\n[\\s\\S]*?^}\\s*$','m'));
 assert(found,'Missing implementation '+name);return found[0];
}
const clone=x=>JSON.parse(JSON.stringify(x));
const saved={total:8500000,bank:'가상 은행',account:'TEST-ACCOUNT-A',holder:'가상 상사 A'};
function fixture(){
 const store=new Map(),writes=[],fields=new Map(),member={role:'admin'};
 const client={},user={id:'synthetic-user-a'},S={company:{id:'synthetic-company-a'},user,client,ready:true,loading:false};
 const state={S,member,fields,store,writes};
 const sandbox={S,window:{},snote220CatalogEpoch:1,SNOTE203_META:'_snote203_meta',ZC157_FINANCE_KEY:'test-finance',console:{warn(){}},
  isSnoteAdmin:()=>member.role==='admin',
  snoteCompanyPurchaseContext:()=>({companyId:S.company?.id,ready:S.ready&&!S.loading,role:member.role,canRead:['admin','accountant'].includes(member.role)}),
  localStorage:{getItem:key=>store.get(key)??null,setItem(key,value){writes.push({key,value});store.set(key,value);vm.runInContext('if(snote184FinanceSettingsCurrent())snote184CaptureFinanceSettings(JSON.parse(localStorage.getItem(ZC157_FINANCE_KEY)))',context);}},
  ACC44_LENDER_LIMITS:[['가상 금융사',10000000,3]],SnoteMoney:{legacy:x=>x},toast(){},
  $:id=>{if(!fields.has(id))fields.set(id,{value:'',innerHTML:''});return fields.get(id);},
  prestockDisplayRows:rows=>rows,todayLocal:()=> '2026-11-22',prestockTableRow:()=>'',prestockMobileRow:()=>'',prestockMoreMarkup:()=>'',esc:x=>x,
  prestockAllRows:()=>[],normalizePrestockPlate:x=>x,prestockFormatWon:x=>Number(x).toLocaleString('ko-KR')
 };
 const context=vm.createContext(sandbox);
 vm.runInContext('let snote184FinanceSettingsState=null;'+[
  'prestockLedgerReady','snote184FinanceSettingsCurrent','snote184CaptureFinanceSettings','snote203Meta','snote203PrestockConfig','snote203WriteMeta','snote203FillBank','prestockSums','prestockSection'
 ].map(sourceFunction).join('\n')+'\n'+html.match(/^window\.snotePrestockSettingsBridge=Object\.freeze\(\{[\s\S]*?^\}\);/m)[0],context);
 state.context=context;state.sandbox=sandbox;
 state.adopt=rows=>{sandbox.__rows=rows;vm.runInContext('snote184CaptureFinanceSettings(__rows)',context);};
 state.config=()=>clone(sandbox.snote203PrestockConfig());state.meta=()=>clone(sandbox.snote203Meta());
 state.write=patch=>sandbox.snote203WriteMeta(patch);
 return state;
}
const wire=value=>[['가상 금융사',10000000,3],{_snote203_meta:{prestock:clone(value),unrelated:{preserve:true}}}];
test('no confirmed settings means unconfigured fields and unknown balance, including stale legacy storage',()=>{
 const f=fixture();f.store.set('test-finance',JSON.stringify(wire(saved)));
 assert.deepEqual(f.config(),{total:null,bank:'',account:'',holder:''});
 assert.equal(f.sandbox.prestockSums().balance,null);
 assert.match(f.sandbox.prestockSection(),/id="ps-bank-account"[^>]*>미확인/);
 assert.match(f.sandbox.prestockSection(),/id="ps-balance">미확인/);
 f.sandbox.snote203FillBank();for(const id of ['total','name','account','holder'])assert.equal(f.fields.get('snote203-bank-'+id).value,'');
 assert.equal(f.writes.length,0);
});
test('verified stored values and metadata stay intact and a real zero remains configured',()=>{
 const f=fixture(),rows=wire(saved);f.adopt(rows);assert.deepEqual(f.config(),saved);assert.deepEqual(rows,wire(saved));
 assert.deepEqual(f.meta().unrelated,{preserve:true});f.sandbox.snote203FillBank();assert.equal(f.fields.get('snote203-bank-total').value,'8,500,000');
 f.adopt(wire({...saved,total:0}));assert.equal(f.config().total,0);assert.equal(f.sandbox.prestockSums().balance,0);
 assert.equal(f.writes.length,0);
});
test('another company tab cannot replace the active company snapshot or its lenders during a settings save',()=>{
 const f=fixture();f.adopt(wire(saved));
 f.store.set('test-finance',JSON.stringify([['다른 상사 금융사',1,1],{_snote203_meta:{prestock:{...saved,account:'FOREIGN-ACCOUNT'}}}]));
 assert.deepEqual(f.config(),saved);
 assert.equal(f.write({prestock:{...saved,total:9000000}}),true);
 const written=JSON.parse(f.writes[0].value);assert.equal(written[0][0],'가상 금융사');assert.equal(written[1]._snote203_meta.prestock.total,9000000);
 assert.deepEqual(written[1]._snote203_meta.unrelated,{preserve:true});assert.equal(f.config().total,9000000);
});
test('company, user, client, readiness and role changes fail closed before any read or write',()=>{
 for(const change of [f=>f.S.company={id:'synthetic-company-b'},f=>f.S.user={id:'synthetic-user-b'},f=>f.S.client={},f=>f.S.ready=false,f=>f.S.loading=true,f=>f.member.role='dealer']){
  const f=fixture();f.adopt(wire(saved));change(f);
  assert.deepEqual(f.config(),{total:null,bank:'',account:'',holder:''});assert.equal(f.write({prestock:saved}),false);assert.equal(f.writes.length,0);
 }
 const f=fixture();f.adopt(wire(saved));f.member.role='accountant';assert.deepEqual(f.config(),saved);assert.equal(f.write({prestock:saved}),false);assert.equal(f.writes.length,0);
});
test('company switch stays unconfigured until the new company dataset is confirmed',()=>{
 const f=fixture();f.adopt(wire(saved));f.S.company={id:'synthetic-company-b'};assert.equal(f.config().total,null);
 f.adopt([]);assert.deepEqual(f.config(),{total:null,bank:'',account:'',holder:''});
 const companyB={...saved,total:2600000,account:'TEST-ACCOUNT-B',holder:'가상 상사 B'};f.adopt(wire(companyB));assert.deepEqual(f.config(),companyB);
});
test('the real hydration and local write paths maintain the company-bound snapshot',()=>{
 const hydrate=html.slice(html.indexOf('async function restoreDatasets(){'),html.indexOf('async function prepareLegacyAccount('));
 assert(hydrate.includes('snote184FinanceSettingsState=null;'));
 assert(hydrate.includes("if(dataset==='finance_limits')financeSettings="));
 assert(hydrate.includes('snote184CaptureFinanceSettings(financeSettings);'));
 assert(hydrate.lastIndexOf("if(!current())throw Error('CONTEXT_CHANGED');")<hydrate.indexOf('snote184CaptureFinanceSettings(financeSettings);'));
 const setter=html.match(/^Storage\.prototype\.setItem=function.*$/m)[0];
 assert(setter.includes("entry.ds==='finance_limits'&&snote184FinanceSettingsCurrent()"));
});


test('confirmed absent bank settings differ from an unconfirmed setting snapshot',()=>{
 const f=fixture();assert.equal(f.sandbox.prestockSums().settingsReady,false);assert.match(f.sandbox.prestockSection(),/id="ps-bank-account"[^>]*>미확인/);
 f.adopt([]);assert.equal(f.sandbox.prestockSums().settingsReady,true);assert.match(f.sandbox.prestockSection(),/id="ps-bank-account"[^>]*>미설정/);
});
