'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const source=html.slice(html.indexOf('async function snote235ReturnToSale('),html.indexOf('function snote222ContractSignatureContext('));
function fixture(overrides={}){
 const actor={},target={kind:'contract',actor,car:'car-1',view:3,route:'inventory'};let opened=0;
 const context={snote235SaleReturn:target,currentUser:actor,activeCarId:'car-1',route:'inventory',cars:[{id:'car-1'}],canManageCar:()=>true,$:()=>({classList:{add(){}},setAttribute(){}}),openSaleProgress:async()=>{opened++},...overrides};
 vm.createContext(context);vm.runInContext(source,context);
 return {context,target,actor,opened:()=>opened,run:(options={})=>context.snote235ReturnToSale('contract',actor,'car-1',3,options)};
}
test('document close returns once to its originating sale dialog',async()=>{const f=fixture();assert.equal(await f.run(),true);assert.equal(f.opened(),1);assert.equal(await f.run(),false);assert.equal(f.opened(),1)});
test('discard for navigation never reopens the sales dialog',async()=>{const f=fixture();assert.equal(await f.run({discard:true}),false);assert.equal(f.context.snote235SaleReturn,null);assert.equal(f.opened(),0)});
for(const [label,change] of [['account',{currentUser:{}}],['car',{activeCarId:'car-2'}],['route',{route:'users'}],['access',{canManageCar:()=>false}]])test('stale '+label+' context cannot reopen sales',async()=>{const f=fixture(change);assert.equal(await f.run(),false);assert.equal(f.opened(),0)});
test('direct document opens and mismatched document sessions cannot return to an earlier sale',async()=>{const f=fixture();f.target.view=4;assert.equal(await f.run(),false);f.context.snote235SaleReturn={...f.target,view:3,kind:'receipt'};assert.equal(await f.run(),false);f.context.snote235SaleReturn=null;assert.equal(await f.run(),false);assert.equal(f.opened(),0)});
