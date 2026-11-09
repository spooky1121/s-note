import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import '../assets/money.js';
import '../assets/inventory-interest.js';
import '../assets/custom-cost-model.js';

const require=createRequire(import.meta.url),dashboard=require('../assets/home-dashboard.js');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const M=globalThis.SnoteMoney,I=globalThis.SnoteInventoryInterest,rates=[['검증금융',100000,6]];
function between(start,end){const a=html.indexOf(start),b=html.indexOf(end,a+start.length);assert(a>=0&&b>a,'real app helper exists: '+start);return html.slice(a,b);}
function fixture(rows){
 const context=vm.createContext({cars:rows,ACC44_LENDER_LIMITS:rates,SnoteCustomCosts:globalThis.SnoteCustomCosts,SnoteInventoryInterest:{calculate:(car,lenders)=>I.calculate(car,lenders,{today:'2026-02-01'})}});
 const constants=html.split('\n').filter(line=>line.startsWith('const COST_FIELDS=')||line.startsWith('const DIRECT_COST_KEYS=')).join('\n');
 vm.runInContext(constants+'\n'+between('function normalizeRepairItems(c){','function snote238VehicleIcon(')+'\n'+between('function snote239Interest(car){','function snote239DetailInterest(')+'\n'+between('function normalizeCosts(c){','function inventoryLoanOf(')+'\n'+between('function inventoryLoanOf(c){','function inventoryInvestmentOf(')+'\n'+between('function inventoryInvestmentOf(c){','function inventoryFinanceTotals(')+'\n'+between('function inventoryFinanceTotals(){','function '),context);
 return context;
}
const wire=()=>({id:'stock',ownerId:'owner',status:'판매중',purchaseAt:'2026-01-01',inventoryStartedAt:'2026-01-15',inventoryLoan:1000,inventoryLender:'검증금융',buy:1000,sell:1500,costs:{bodywork:2,inventoryInterest:99,repair:1},repairItems:[{memo:'기존 정비',amount:1}]});

test('explicit start date reaches detail costs, landed cost, finance equity and dashboard margins exactly once',()=>{
 const car=M.car(wire()),context=fixture([car]),costs=context.normalizeCosts(car),totals=context.totals(car.buy,car.sell,costs);
 assert.equal(costs.inventoryInterest,27945);assert.equal(totals.direct,57945);assert.equal(totals.landed,10057945);assert.equal(totals.margin,4942055);
 assert.equal(context.inventoryInvestmentOf(car),10057945);assert.equal(context.inventoryFinanceTotals().cashInvestment,57945);
 const rows=[{...car,inventoryCost:context.inventoryInvestmentOf(car),margin:totals.margin},{id:'sold',status:'판매완료',soldAt:'2026-02-01',inventoryCost:99999999,inventoryLoan:99999999,margin:0}];
 const summary=dashboard.summarize(rows,'2026-02');assert.equal(summary.totalInvestment,10057945);assert.equal(summary.inventoryCapital,10000000);assert.equal(summary.cash,57945);assert.equal(summary.inventoryMargin,4942055);
 assert.equal(car.costs.inventoryInterest,990000,'Live calculations do not rewrite an unrelated stored manual-cost field');
});

test('unconfigured start dates preserve purchase-day accrual and changing only start date changes all live totals',()=>{
 const value=wire();delete value.inventoryStartedAt;const car=M.car(value),context=fixture([car]);
 const before=context.normalizeCosts(car).inventoryInterest;assert.equal(before,50959);
 car.inventoryStartedAt='2026-01-15';assert.equal(context.normalizeCosts(car).inventoryInterest,27945);
 assert.equal(before-context.normalizeCosts(car).inventoryInterest,23014);assert.equal(context.inventoryFinanceTotals().inventoryTotal,10057945);
});

test('per-vehicle start date and native-won snapshot survive repeated legacy dataset read/save cycles',()=>{
 let car=M.car(wire());car.status='판매완료';car.soldAt='2026-02-01';car.inventoryInterestSnapshot=I.snapshot(car,rates);
 for(let n=0;n<20;n++){
  car=M.car(JSON.parse(JSON.stringify(M.storeCar(car))));assert.equal(car.inventoryStartedAt,'2026-01-15');assert.equal(car.inventoryLoan,10000000);
  assert.equal(car.inventoryInterestSnapshot.amountWon,27945);assert.equal(I.calculate(car,[['검증금융',100000,12]]).amountWon,27945);
 }
});
