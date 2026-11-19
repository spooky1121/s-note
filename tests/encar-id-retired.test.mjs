import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as oldLookup } from '../functions/api/encar.js';
import { onRequest as oldPrice } from '../functions/api/encar-auto-price.js';

test('retired lookup and auto-price endpoints perform no search, capture or write',async()=>{
 const original=globalThis.fetch;let requests=0;globalThis.fetch=()=>{requests++;throw Error('Retired endpoints cannot make requests');};
 try{for(const handler of[oldLookup,oldPrice])for(const method of['GET','POST']){
  const response=await handler({request:new Request('https://s-note.example/api/retired',{method,...(method==='POST'?{body:JSON.stringify({plate:'12가3456',candidateIds:['43000001']})}:{})}),env:{}});
  assert.equal(response.status,410);const body=await response.json();assert.equal(body.code,'LOOKUP_REPLACED');assert.equal(Object.hasOwn(body,'listings'),false);assert.equal(Object.hasOwn(body,'priceWon'),false);assert.match(response.headers.get('Cache-Control'),/no-store/);
 }assert.equal(requests,0);}finally{globalThis.fetch=original;}
});
