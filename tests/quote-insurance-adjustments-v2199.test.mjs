import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual quote formatter/calculation section with synthetic DOM fields.
const source=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('let quoteCarId=null;'),end=source.indexOf('let snote95DocumentLogoReady=',start);
assert(start>=0&&end>start,'Actual quote calculation section must be available');
const code=source.slice(start,end);
const fees=['quote-stamp','quote-insurance','quote-platefee','quote-sellingfee','quote-fee'];
function fixture(price=10000000,values={},deductions=[]){
 const nodes=new Map([...fees,...['quote-car-price','quote-acquisition','quote-bond','quote-transfer-subtotal','quote-grand-total','quote-bank-car','quote-bank-transfer']].map(id=>[id,{value:values[id]??'',textContent:''}]));
 const context=vm.createContext({$:id=>nodes.get(id),SnoteQuoteCostEditor:{isDeduction:id=>deductions.includes(id)}});vm.runInContext(code+'\nfunction setQuotePrice(value){quoteVehiclePrice=value;}',context);context.setQuotePrice(price);
 return{get:id=>nodes.get(id),set:(id,value)=>{nodes.get(id).value=value;},update:()=>context.updateQuoteTotals(),read:id=>context.quoteReadInput(id),format:value=>context.quoteComma(value)};
}
test('signed plate adjustment reduces transfer subtotal, total and transfer bank amount together',()=>{
 const f=fixture(10000000,{'quote-insurance':'100000','quote-platefee':'-50000'});f.update();
 assert.equal(f.get('quote-insurance').value,'100,000');assert.equal(f.get('quote-platefee').value,'-50,000');
 assert.equal(f.get('quote-transfer-subtotal').textContent,'866,727');assert.equal(f.get('quote-grand-total').textContent,'10,866,727');
 assert.equal(f.get('quote-bank-transfer').textContent,'866,727');assert.equal(f.get('quote-bank-car').textContent,'10,000,000');
});
test('an adjustment greater than other costs remains a deduction rather than being clamped',()=>{
 const f=fixture(0,{'quote-platefee':'-10000'});f.update();
 assert.equal(f.get('quote-transfer-subtotal').textContent,'-2,364');assert.equal(f.get('quote-grand-total').textContent,'-2,364');assert.equal(f.get('quote-bank-transfer').textContent,'-2,364');
});
test('negative zero is normalized in displayed totals without changing existing precision',()=>{
 const f=fixture(12000004,{'quote-insurance':'123456','quote-sellingfee':'440000','quote-platefee':'-1542002'});f.update();
 assert.equal(f.get('quote-transfer-subtotal').textContent,'0');assert.equal(f.get('quote-bank-transfer').textContent,'0');assert.equal(f.get('quote-grand-total').textContent,'12,000,004');assert.equal(f.format(-0.22),'0');
});
test('the editable plate field retains lone minus and negative-zero prefixes',()=>{
 const f=fixture();f.set('quote-platefee','-');f.update();assert.equal(f.get('quote-platefee').value,'-');assert.equal(f.read('quote-platefee'),0);
 f.set('quote-platefee','-0');f.update();assert.equal(f.get('quote-platefee').value,'-0');
 f.set('quote-platefee','-05');f.update();assert.equal(f.get('quote-platefee').value,'-5');assert.equal(f.read('quote-platefee'),-5);
});
test('Unicode minus and explicit deductions are accepted for all five editable manual fees',()=>{
 const f=fixture(10000000,{'quote-platefee':'−1,234','quote-insurance':'-2,000','quote-stamp':'-300','quote-sellingfee':'-400','quote-fee':'-500'});f.update();
 assert.equal(f.get('quote-platefee').value,'-1,234');assert.equal(f.read('quote-platefee'),-1234);
 for(const[id,value]of[['quote-insurance','-2,000'],['quote-stamp','-300'],['quote-sellingfee','-400'],['quote-fee','-500']])assert.equal(f.get(id).value,value);
 assert.equal(f.get('quote-transfer-subtotal').textContent,'812,293');assert.equal(f.get('quote-bank-transfer').textContent,'812,293');assert.equal(f.get('quote-grand-total').textContent,'10,812,293');
});
test('named discount/remission fees subtract positive input without changing automatic tax or bond formulas',()=>{
 const f=fixture(10000000,{'quote-insurance':'20000','quote-fee':'30000'},['quote-insurance','quote-fee']);f.update();
 assert.equal(f.get('quote-insurance').value,'-20,000');assert.equal(f.get('quote-fee').value,'-30,000');assert.equal(f.get('quote-acquisition').textContent,'700,000');assert.equal(f.get('quote-bond').textContent,'116,727');assert.equal(f.get('quote-transfer-subtotal').textContent,'766,727');assert.equal(f.get('quote-grand-total').textContent,'10,766,727');assert.equal(f.get('quote-bank-transfer').textContent,'766,727');
 for(let i=0;i<5;i++)f.update();assert.equal(f.get('quote-insurance').value,'-20,000');assert.equal(f.get('quote-fee').value,'-30,000');
});
test('the supported thirteen-digit plate adjustment and repeated recalculation stay stable',()=>{
 const f=fixture(10000000,{'quote-platefee':'-12345678901234','quote-insurance':'123456'});f.update();
 assert.equal(f.get('quote-platefee').value,'-1,234,567,890,123');assert.equal(f.read('quote-platefee'),-1234567890123);
 const before=[f.get('quote-transfer-subtotal').textContent,f.get('quote-grand-total').textContent,f.get('quote-bank-transfer').textContent];
 for(let i=0;i<10;i++)f.update();assert.deepEqual([f.get('quote-transfer-subtotal').textContent,f.get('quote-grand-total').textContent,f.get('quote-bank-transfer').textContent],before);assert.equal(f.get('quote-insurance').value,'123,456');
});
