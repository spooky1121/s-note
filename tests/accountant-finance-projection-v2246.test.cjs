const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const body=source.slice(source.indexOf('function snote246FinanceLenders('),source.indexOf('window.snoteInventoryFinanceAggregate=()=>'));
const project=(limits,stat,limit,used)=>Function('ACC44_LENDER_LIMITS','inventoryLoanOf',body+';return snote246FinanceLenders;')(limits,car=>car.inventoryLoan)(stat,limit,used);
test('lender cards preserve canonical sold-unpaid and standalone amounts while grouping names',()=>{
 const rows=[{inventoryLender:' A ',inventoryLoan:3500000,status:'판매완료'},{inventoryLender:'A',inventoryLoan:1000000,status:'계약중'},{inventoryLender:'Unregistered',inventoryLoan:500000},{inventoryLender:'',inventoryLoan:100000}];
 const result=project([['A',10000000],[' B ',20000000],['A',5000000]],{rows,unmatched:[{lender:'B',loan:2000000}]},35000000,7100000);
 assert.deepEqual(result,[{name:'A',registered:true,limit:15000000,used:4500000},{name:'B',registered:true,limit:20000000,used:2000000},{name:'Unregistered',registered:false,limit:null,used:500000},{name:null,registered:false,limit:null,used:100000}]);
});
test('malformed usage lender names retain their full amount as unspecified',()=>{
 const result=project([],{rows:[{inventoryLender:'x'.repeat(121),inventoryLoan:3500000},{inventoryLender:'bad\nname',inventoryLoan:500000}],unmatched:[]},0,4000000);
 assert.deepEqual(result,[{name:null,registered:false,limit:null,used:4000000}]);
});
test('inconsistent or unsafe lender projections remain unknown',()=>{
 for(const [limits,stat,limit,used] of [[[['A',1]],{rows:[],unmatched:[]},2,0],[[['',1]],{rows:[],unmatched:[]},1,0],[[['A',-1]],{rows:[],unmatched:[]},-1,0],[[],{rows:[{inventoryLoan:NaN}],unmatched:[]},0,0],[[],{rows:[],unmatched:[]},0,1]])assert.equal(project(limits,stat,limit,used),null);
 assert.deepEqual(project([],{rows:[],unmatched:[]},0,0),[]);
});
