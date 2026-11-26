'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const M=require('../assets/accountant-business-pages.js');
const customer={id:'synthetic-sale-1',name:'가상 고객',phone:'010-1234-5678',plate:'가상번호',model:'가상 차량',soldAt:'2026-11-26',dealerName:'가상 딜러'};
const income={id:'synthetic-sale-1',plate:'가상번호',model:'가상 차량',soldAt:'2026-11-26',dealerName:'가상 딜러',reportedAmount:null,reportedDate:null,reportStatus:'unverified',savedIncomeAmount:1234567};
const documents=status=>M.documents.map(item=>({kind:item.kind,status,canUpload:false}));

test('customer projection keeps only the six requested business fields and its stable row key',()=>{
 const input={...customer,address:'SYNTHETIC_PRIVATE_ADDRESS',rrn:'SYNTHETIC_PRIVATE_ID',email:'synthetic@example.invalid'};
 const result=M.normalize('acctCustomers',{complete:true,customers:[input]});
 assert.deepEqual(result.customers[0],customer);
 assert(!JSON.stringify(result).includes('PRIVATE_'));
 assert(Object.isFrozen(result)&&Object.isFrozen(result.customers)&&Object.isFrozen(result.customers[0]));
});

test('a saved settlement amount does not become a filing amount, filing date or filed state',()=>{
 const result=M.normalize('acctDealerIncome',{complete:true,incomes:[{...income,updatedAt:'2026-11-26T00:00:00Z',incomeSettlement:{saved:true}}]}).incomes[0];
 assert.equal(result.savedIncomeAmount,1234567);
 assert.equal(result.reportedAmount,null);
 assert.equal(result.reportedDate,'');
 assert.equal(result.reportStatus,'unverified');
 assert(!Object.hasOwn(result,'updatedAt'));
});

test('explicit zero filing values and valid dates remain exact, without implicit string-to-money conversion',()=>{
 const row=M.normalize('acctDealerIncome',{complete:true,incomes:[{...income,reportedAmount:0,reportedDate:'2024-02-29',reportStatus:'reported'}]}).incomes[0];
 assert.equal(row.reportedAmount,0);assert.equal(row.reportedDate,'2024-02-29');assert.equal(row.reportStatus,'reported');
 for(const bad of ['0',NaN,Infinity,1.1,10000000000000])assert.throws(()=>M.normalize('acctDealerIncome',{complete:true,incomes:[{...income,reportedAmount:bad}]}));
});

test('unknown status and nonexistent dates cannot be presented as verified filing information',()=>{
 for(const patch of [{reportStatus:'saved'},{reportStatus:true},{reportedDate:'2026-02-29'},{reportedDate:'2026-13-01'},{soldAt:'0000-01-01'}])assert.throws(()=>M.normalize('acctDealerIncome',{complete:true,incomes:[{...income,...patch}]}));
 const row=M.normalize('acctDealerIncome',{complete:true,incomes:[{...income,savedIncomeAmount:-150000}]}).incomes[0];
 assert.equal(row.savedIncomeAmount,-150000);assert.equal(row.reportStatus,'unverified');
});

test('partial, duplicated or malformed customer data is rejected instead of silently becoming an empty success',()=>{
 for(const input of [{complete:false,customers:[customer]},{complete:true,customers:[customer,customer]},{complete:true,customers:[{...customer,name:123}]},{complete:true,customers:[{...customer,phone:'bad\u0000value'}]}])assert.throws(()=>M.normalize('acctCustomers',input));
 assert.deepEqual(M.normalize('acctCustomers',{complete:true,customers:[]}),{customers:[]});
});

test('operating documents always use the five exact labels and missing states stay distinct from unavailable',()=>{
 const result=M.normalize('acctOperations',{complete:true,documents:documents('missing')});
 assert.deepEqual(result.documents.map(row=>row.label),['사업자등록증','자동차관리사업 등록증','주주명부','법인 통장사본','대표자 신분증']);
 assert(result.documents.every(row=>row.status==='missing'&&!Object.hasOwn(row,'canUpload')));
 const unavailable=M.normalize('acctOperations',{complete:true,documents:documents('unavailable')});assert(unavailable.documents.every(row=>row.status==='unavailable'));
 assert(Object.isFrozen(result.documents[0]));
});

test('incomplete, duplicate and foreign document slots cannot masquerade as the requested company slots',()=>{
 const base=documents('missing');
 for(const rows of [base.slice(1),[base[0],base[0],...base.slice(2)],[{...base[0],kind:'companyLogo'},...base.slice(1)],[{...base[0],status:'uploaded'},...base.slice(1)]])assert.throws(()=>M.normalize('acctOperations',{complete:true,documents:rows}));
});

test('document metadata exposes neither private storage paths nor arbitrary upload permissions',()=>{
 const row={...documents('ready')[0],filename:'가상 사업자등록증.png',path:'PRIVATE_STORAGE_PATH',signedUrl:'PRIVATE_SIGNED_URL',canUpload:true};
 const result=M.normalize('acctOperations',{complete:true,documents:[row,...documents('missing').slice(1)]});
 assert.equal(result.documents[0].filename,'가상 사업자등록증.png');assert.equal(result.documents[0].status,'ready');assert(!JSON.stringify(result).includes('PRIVATE_'));
});
