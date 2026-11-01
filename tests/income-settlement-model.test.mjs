import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE, TEMPLATE_ID, createSource, sourceFingerprint, createDocument, normalizeDocument, calculate, parseMoney, documentFingerprint, serializePublic, draftDocument, invoiceCostSuggestions } from '../assets/income-settlement-model.js';

const car = (extra = {}) => ({ id: 'synthetic-car', ownerId: 'synthetic-owner', status: '판매완료', model: '검증용 차량', plate: '000가0000', year: 2026, purchaseAt: '2026-01-02', soldAt: '2026-02-03', buy: 100, soldPrice: 200, costs: {}, ...extra });
const document = cells => { const doc = createDocument(createSource(car())); Object.assign(doc.cells, cells); return doc; };
const formulaValues = result => Object.fromEntries(Object.keys(TEMPLATE.formulas).map(cell => [cell, result.cells[cell]]));

test('template exposes exactly 51 original formulas and 35 inputs plus company name', () => {
  assert.equal(Object.keys(TEMPLATE.formulas).length, 51); assert.equal(Object.keys(TEMPLATE.inputs).length, 36);
  assert.equal(TEMPLATE.formulas.F11, '=ROUND((D11/1.09),0)');
  assert.equal(TEMPLATE.formulas.D41, '=IF(D39+D40>0,(D39+D40),0)');
  assert.equal(TEMPLATE.formulas.H35, '=SUM(I30:I32)');
  assert.match(TEMPLATE.labels.B11, /10\/110/);
});

test('all 51 results match an independently calculated synthetic Decimal reference', () => {
  // Synthetic values, calculated separately with Python Decimal at precision 80.
  // No attachment transaction amounts, names, plates or identifiers are used.
  const doc = document({ D8: 1234567, D10: 234567, D11: 345678, D15: 1100, D16: 2200, D17: 3300, D18: 4444, D19: 5555, D20: 6666, D22: 123, D23: 678, D25: 89, D26: 90, D30: 101, D31: 202, D32: 303, D40: -404, D47: 45678, I39: 999, H51: 888 });
  const expected = { D12:654322,D28:24245,D33:13,D35:619,D38:60252,D39:569206,D41:568802,D42:17060,D43:1700,D44:550042,D48:4152,D49:41526,D50:1240,D51:120,D52:40166,E36:629458,F10:213243,F11:317136,F12:591955,F15:1000,F16:2000,F17:3000,F18:4040,F19:5050,F20:6060,F22:123,F23:678,F25:89,F26:90,F28:22130,F30:101,F31:202,F32:303,F33:13,F35:619,F8:1122334,G36:569206,H10:21324,H11:28542,H12:62367,H15:100,H16:200,H17:300,H18:404,H19:505,H20:606,H28:2115,H35:0,H8:112233,I36:60252,I38:79012 };
  const before = structuredClone(doc), result = calculate(doc);
  assert.deepEqual(formulaValues(result), expected); assert.deepEqual(doc, before);
  assert.deepEqual(result.totals, { vat:60252,purchaseIncome:568802,purchaseIncomeTax:17060,purchaseLocalTax:1700,purchaseNet:550042,brokerIncome:41526,brokerIncomeTax:1240,brokerLocalTax:120,brokerNet:40166 });
});

test('ROUND and ROUNDDOWN preserve negative values, one-won rounding and ten-won truncation toward zero', () => {
  for (const [amount, expected] of [[5,5],[6,5],[-5,-5],[-6,-5]]) assert.equal(calculate(document({ D8:amount })).cells.F8,expected);
  assert.equal(calculate(document({ D23:-99 })).cells.D33,-1);
  const negative = calculate(document({ D47:-45678 })).cells;
  assert.deepEqual([negative.D48,negative.D49,negative.D50,negative.D51,negative.D52],[-4152,-41526,-1240,-120,-40166]);
  const positive = calculate(document({ D47:45678 })).cells;
  assert.deepEqual([positive.D48,positive.D49,positive.D50,positive.D51,positive.D52],[4152,41526,1240,120,40166]);
});

test('signed loss is added exactly as the original IF formula and purchasing income alone has a zero floor', () => {
  const base = document({ D8:1100,D10:0,D11:0,D31:null });
  const amount = calculate(base).cells.D39;
  for (const [loss, expected] of [[-amount,0],[-amount-1,0],[-amount+1,1],[100,amount+100]]) {
    const value = structuredClone(base); value.cells.D40=loss; const result=calculate(value); assert.equal(result.cells.D41,expected);
    if (!expected) assert.deepEqual([result.cells.D42,result.cells.D43,result.cells.D44],[0,0,0]);
  }
  assert(calculate(document({ D40:100 })).warnings.some(message=>message.includes('D40')));
});

test('merged non-anchor references stay blank zero and unrelated manual amounts never enter formulas', () => {
  const original=document({D30:100,D31:200,D32:300,I39:0,H51:0}), changed=structuredClone(original);
  changed.cells.I39=999999;changed.cells.H51=-888888;
  assert.deepEqual(formulaValues(calculate(changed)),formulaValues(calculate(original)));
  assert.equal(calculate(changed).cells.H35,0);assert.equal(calculate(changed).cells.F35,600);
});

test('null inputs stay distinguishable from zero while Excel formula references use zero', () => {
  const doc=createDocument(createSource(car({buy:null,soldPrice:null,costs:{}}))),result=calculate(doc);
  assert.equal(result.cells.D8,null);assert.equal(result.cells.D11,null);assert.equal(result.cells.D10,0);
  assert(Object.values(formulaValues(result)).every(value=>value===0));
  assert(result.warnings.some(message=>message.includes('실제 판매금액')));assert(result.warnings.some(message=>message.includes('매입금액')));
});

test('money parser accepts only bounded whole-won amounts with explicit numeric formatting', () => {
  for (const [raw,expected] of [[null,null],['',null],[' ',null],[0,0],[-0,0],['0',0],['-0',0],['1,234',1234],['₩ 1,234원',1234],['-₩1,234',-1234],['(1,234)',-1234],['＋１，２３４',1234],['9,999,999,999,999',9999999999999]]) assert.equal(parseMoney(raw),expected);
  for (const raw of [undefined,true,{},[],NaN,Infinity,1.5,'1.0','1.5','1e3','0x10','1만원','1 000','1,23','1_000','--1','(-1)','abc100','100abc','10000000000000',Number.MAX_SAFE_INTEGER]) assert.throws(()=>parseMoney(raw),{code:'VALIDATION_ERROR'});
});

test('source converts manwon exactly with half-away-from-zero, without sale asking-price fallback', () => {
  for (const [raw,expected] of [[0,0],[0.00005,1],[-0.00005,-1],[0.000049,0],[-0.000049,0],[1.23456,12346],[3.33335,33334]]) assert.equal(createSource(car({buy:raw})).buyWon,expected);
  const missing=createSource(car({buy:undefined,soldPrice:undefined,sell:99999}));assert.equal(missing.buyWon,null);assert.equal(missing.soldWon,null);assert(missing.warnings.length>=2);
  assert.equal(createSource(car({soldPrice:0,sell:99999})).soldWon,0);
  for(const bad of [Infinity,NaN,'unknown',true,1e100]) assert.equal(createSource(car({buy:bad})).buyWon,null);
  assert.equal(createSource(car({year:20260})).year,'');
});

test('source is a known-field projection and never reuses existing tax, margin, loan principal or customer identity', () => {
  const source=createSource(car({margin:999,inventoryLoan:5000,costs:{bodywork:1,polish:2,advertising:3,purchaseFee:4,purchaseOther:5,repair:6,acquisitionTax:7,incomeTax:8,inventoryInterest:9},customer:{rrn:'0001013000000'},incomeSettlement:{privateCipher:'not-source'}}),{dealerName:'검증 담당',companyName:'검증 상사',ownerId:'verified-owner'});
  assert.equal(source.ownerId,'verified-owner');assert.equal(source.acquisitionTaxWon,70000);
  assert.deepEqual(source.costSuggestions.map(value=>[value.key,value.amountWon]),[['bodywork',10000],['polish',20000],['advertising',30000],['purchaseFee',40000],['purchaseOther',50000],['repair',60000]]);
  assert.deepEqual(source.unmapped.map(value=>[value.key,value.amountWon]),[['inventoryInterest',90000],['incomeTax',80000]]);
  assert.equal(JSON.stringify(source).includes('0001013000000'),false);assert.equal(Object.hasOwn(source,'margin'),false);assert.equal(Object.hasOwn(source,'inventoryLoan'),false);assert.equal(Object.hasOwn(source,'incomeSettlement'),false);
  const doc=createDocument(source);assert.equal(doc.cells.D31,70000);assert.equal(doc.cells.D47,null);assert.equal(doc.cells.H49,'');assert.equal(doc.cells.H50,'');
  for(let row=15;row<=20;row++){assert.equal(doc.cells['B'+row],'');assert.equal(doc.cells['D'+row],null);}
});

test('repair items are summed once, suppress legacy repair even for empty arrays, and invalid amounts are not partially summed', () => {
  const amount=source=>source.costSuggestions.find(value=>value.key==='repair')?.amountWon;
  assert.equal(amount(createSource(car({repairItems:[{amount:1.2},{amount:2.3}],costs:{repair:999}}))),35000);
  assert.equal(amount(createSource(car({costs:{repair:3.5}}))),35000);
  assert.equal(amount(createSource(car({repairItems:[],costs:{repair:999}}))),undefined);
  const invalid=createSource(car({repairItems:[{amount:1},{amount:NaN}],costs:{repair:999}}));assert.equal(amount(invalid),undefined);assert(invalid.warnings.some(message=>message.includes('수리비')));
  assert.equal(amount(createSource(car({repairItems:[{amount:0.000025},{amount:0.000025}]}))),1,'Sum exact manwon amounts then round the aggregate once');
});

test('new document maps only matching source fields and defaults purchase to D11 by explicit user choice', () => {
  const source=createSource(car({buy:12.34,soldPrice:56.78,costs:{acquisitionTax:.9,bodywork:4}}),{dealerName:'검증 담당',companyName:'검증 상사'}),doc=createDocument(source);
  assert.equal(doc.templateVersion,TEMPLATE_ID);assert.equal(doc.type,'snote-income-settlement');assert.equal(doc.purchaseKind,'recycled');
  assert.deepEqual([doc.cells.C2,doc.cells.C3,doc.cells.F3,doc.cells.J3,doc.cells.C4,doc.cells.F4,doc.cells.G2],['검증 담당','검증용 차량','000가0000','2026','2026-01-02','2026-02-03','검증 상사']);
  assert.deepEqual([doc.cells.D8,doc.cells.D10,doc.cells.D11,doc.cells.D31],[567800,0,123400,9000]);
  assert.equal(doc.cells.J4,'');assert.equal(doc.cells.D15,null);assert.deepEqual(doc.overrides,[]);
});

test('purchase-kind metadata never silently clears explicit money inputs or manual overrides', () => {
  const doc=document({D10:100,D11:200});doc.purchaseKind='manual';doc.overrides=['D11','D10','D11'];
  const normalized=normalizeDocument(doc);assert.deepEqual([normalized.cells.D10,normalized.cells.D11],[100,200]);assert.deepEqual(normalized.overrides,['D10','D11']);
  assert(calculate(normalized).warnings.some(message=>message.includes('중복')));
});

test('normalization rejects extra/read-only cells, unsafe schema, wrong dates, identity and text lengths with cell errors', () => {
  const invalid=[value=>value.cells.F8=1,value=>value.cells.A1='overwrite title',value=>value.extra=true,value=>value.version=2,value=>value.templateVersion='other',value=>value.purchaseKind='guessed',value=>value.overrides=['F8'],value=>value.cells.D8='1.5',value=>value.cells.C4='2026-02-31',value=>value.cells.H50='000101-300000',value=>value.cells.H50=1234567890123,value=>value.cells.C3='x'.repeat(201),value=>value.cells.J4='x'.repeat(301)];
  for(const mutate of invalid){const doc=document({});mutate(doc);assert.throws(()=>normalizeDocument(doc),{code:'VALIDATION_ERROR'});}
  const doc=document({D8:'bad'});assert.throws(()=>normalizeDocument(doc),error=>error.code==='VALIDATION_ERROR'&&error.cell==='D8');
  assert.equal(normalizeDocument(document({C4:'2024-02-29'})).cells.C4,'2024-02-29');
  assert.equal(normalizeDocument(document({J4:'첫 줄\n다음 줄'})).cells.J4,'첫 줄\n다음 줄');
  const safe=normalizeDocument(document({H50:'000101-3000000'}));assert.equal(safe.cells.H50,'0001013000000');
});

test('public serialization and local drafts exclude H50 without changing the authorized live document', () => {
  const doc=document({H50:'000101-3000000',H49:'검증 담당'}),before=structuredClone(doc);
  for(const serialize of [serializePublic,draftDocument]){const result=serialize(doc);assert.equal(result.cells.H50,'');assert.equal(JSON.stringify(result).includes('000101'),false);assert.equal(result.cells.H49,'검증 담당');}
  assert.deepEqual(doc,before);assert.equal(normalizeDocument(doc).cells.H50,'0001013000000');
});

test('fingerprints sort object keys, retain exact stored metadata and distinguish source changes', async () => {
  assert.equal(await documentFingerprint(null),null);assert.equal(await documentFingerprint(undefined),null);
  assert.equal(await documentFingerprint({z:2,a:{b:1,c:0}}),await documentFingerprint({a:{c:0,b:1},z:2}));
  assert.notEqual(await documentFingerprint({document:serializePublic(document({})),privateCipher:'one'}),await documentFingerprint({document:serializePublic(document({})),privateCipher:'two'}));
  const first=createSource(car()),same=createSource(car({unrelatedCustomer:'not copied',inventoryLoan:999})),changed=createSource(car({soldPrice:201}));
  assert.equal(await sourceFingerprint(first),await sourceFingerprint(same));assert.notEqual(await sourceFingerprint(first),await sourceFingerprint(changed));assert.match(await sourceFingerprint(first),/^[a-f0-9]{64}$/);
});

test('invoice suggestions are detached optional references, not automatic VAT-backed expense rows', () => {
  const source=createSource(car({costs:{polish:1.5}})),doc=createDocument(source),suggestions=invoiceCostSuggestions(source);
  assert.deepEqual(suggestions,[{key:'polish',label:'차량광택비용',amountWon:15000}]);suggestions[0].amountWon=0;assert.equal(source.costSuggestions[0].amountWon,15000);
  assert.equal(doc.cells.D15,null);assert.equal(calculate(doc).cells.H15,0);
});

test('bounded extreme input stays exact and all formula results remain safe integer numbers', () => {
  const doc=document({});for(const [cell,input]of Object.entries(TEMPLATE.inputs))if(input.kind==='money')doc.cells[cell]=cell==='D8'?9999999999999:-9999999999999;
  const result=calculate(doc);assert(Object.values(formulaValues(result)).every(Number.isSafeInteger));assert.equal(result.cells.H35,0);assert.equal(typeof result.cells.I36,'number');
});

test('formula text is never accepted as an input expression or executed from text fields', () => {
  const doc=document({J4:'globalThis.__incomeFormulaExecuted=true',B15:'=SUM(1,2)'});calculate(doc);assert.equal(globalThis.__incomeFormulaExecuted,undefined);
  assert.throws(()=>parseMoney('=SUM(1,2)'),{code:'VALIDATION_ERROR'});doc.cells.F8='globalThis.__incomeFormulaExecuted=true';assert.throws(()=>calculate(doc),{code:'VALIDATION_ERROR'});
});
