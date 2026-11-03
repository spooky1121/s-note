import test from 'node:test';import assert from 'node:assert/strict';
import '../assets/inventory-interest.js';
import {createSource,createDocument,calculate} from '../assets/income-settlement-model.js';
const I=globalThis.SnoteInventoryInterest,rates=[['검증금융',100000,6]];
const car=(extra={})=>({id:'interest-test',status:'판매중',purchaseAt:'2026-01-01',inventoryLoan:1000,inventoryLender:'검증금융',buy:1000,soldPrice:1500,...extra});
test('daily interest rounds once to won, respects elapsed calendar days and leap day',()=>{
 assert.equal(I.calculate(car(),rates,{today:'2026-02-01'}).amountWon,50959);
 assert.equal(I.calculate(car(),rates,{today:'2026-01-01'}).amountWon,0);
 assert.equal(I.calculate(car({purchaseAt:'2024-02-28'}),rates,{today:'2024-03-01'}).days,2);
 assert.equal(I.calculate(car(),rates,{today:'2027-01-01'}).amountWon,600000);
});
test('missing rates differ from explicit zero; invalid dates and principals fail without invented interest',()=>{
 for(const row of [[],[['검증금융',100000]],[['검증금융',100000,null]],[['검증금융',100000,'']]])assert.equal(I.calculate(car(),row,{today:'2026-02-01'}).ready,false);
 assert.equal(I.calculate(car(),[['검증금융',100000,0]],{today:'2026-02-01'}).amountWon,0);
 for(const value of [{purchaseAt:'2026-02-30'},{purchaseAt:'2027-01-01'},{inventoryLoan:-1},{inventoryLoan:Infinity}])assert.equal(I.calculate(car(value),rates,{today:'2026-02-01'}).ready,false);
 assert.equal(I.calculate(car({inventoryLoan:0,purchaseAt:''}),[]).amountWon,0);
});
test('sold cars stop on sold date and saved interest rate stays frozen until principal or dates change',()=>{
 const sold=car({status:'판매완료',soldAt:'2026-02-01'});sold.inventoryInterestSnapshot=I.snapshot(sold,rates);
 assert.equal(I.calculate(sold,[['검증금융',100000,12]],{today:'2026-12-01'}).amountWon,50959);
 assert.equal(I.calculate({...sold,inventoryLoan:2000},rates).amountWon,101918);
 assert.equal(I.calculate({...sold,soldAt:'2026-02-02'},rates).days,32);
});
test('income settlement deducts interest once in cost and profit without adding an invoice VAT claim',()=>{
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01'}),{lenders:rates});assert.equal(source.inventoryInterestWon,50959);
 const doc=createDocument(source);doc.cells.D15=11000;
 const plain=calculate(doc),withInterest=calculate(doc,source);
 assert.equal(withInterest.cells.D28,plain.cells.D28+50959);assert.equal(withInterest.cells.E36,plain.cells.E36-50959);
 assert.equal(withInterest.cells.D39,plain.cells.D39-50959);assert.equal(withInterest.cells.H28,plain.cells.H28);assert.equal(withInterest.totals.vat,plain.totals.vat);
 assert(withInterest.totals.purchaseNet<plain.totals.purchaseNet);
 assert.equal(calculate(doc,source).cells.D28,withInterest.cells.D28);assert(!source.unmapped.some(x=>x.key==='inventoryInterest'));
});
test('missing basis retains legacy interest and reports warning; no loan contributes zero',()=>{
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01',costs:{inventoryInterest:1.2345}}));assert.equal(source.inventoryInterestWon,12345);assert(source.warnings.some(x=>x.includes('기존 재고 이자')));
 assert.equal(createSource(car({inventoryLoan:0,costs:{inventoryInterest:4}})).inventoryInterestWon,0);
});
test('printed settlement uses the same interest-adjusted cost and explicit interest note',async()=>{
 const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);const {JSDOM}=require('./encar/node_modules/jsdom');const {buildPrintSnapshot}=await import('../assets/income-settlement-print.js');
 const source=createSource(car({status:'판매완료',soldAt:'2026-02-01'}),{lenders:rates}),doc=createDocument(source),dom=new JSDOM('<!doctype html><html><body></body></html>');
 const fragment=buildPrintSnapshot(doc,{source,domDocument:dom.window.document});dom.window.document.body.append(fragment);
 assert.match(dom.window.document.querySelector('.print-footer').textContent,/재고금융 이자 50,959원 포함/);
 assert.equal(Number(dom.window.document.querySelector('[data-cell-address="D28"]').textContent.replaceAll(',','')),50959);dom.window.close();
});
