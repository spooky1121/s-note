'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const bytes=require('../assets/byte-format.js');
test('byte thresholds use 1024 and display only B through TB',()=>{
 const samples=[[0,'0 B'],[1,'1 B'],[1023,'1,023 B'],[1024,'1 KB'],[1024**2,'1 MB'],[1024**3,'1 GB'],[1024**4,'1 TB'],[1024**5,'1,024 TB']];
 for(const [value,expected]of samples)assert.equal(bytes.format(value),expected);
});
test('fractional units show at most two decimals and trim trailing zeros',()=>{
 for(const [value,expected]of[[1536,'1.5 KB'],[2.25*1024**2,'2.25 MB'],[2078,'2.03 KB'],[2048,'2 KB'],[0.25,'0.25 B']])assert.equal(bytes.format(value),expected);
});
test('unit selection remains tied to the actual threshold before rounding',()=>{
 assert.equal(bytes.format(1024**2-1),'1,024 KB');assert.equal(bytes.format(1024**2),'1 MB');
 assert.equal(bytes.exact(1024**2-1),'1,048,575 B');
});
test('unknowns and invalid sizes never become a fabricated zero',()=>{
 for(const value of[null,undefined,'',false,'1024',{},[],NaN,Infinity,-Infinity,-1]){assert.equal(bytes.format(value),'—');assert.equal(bytes.exact(value),null);}
 assert.equal(bytes.format(-0),'0 B');
});
test('only raw byte units are eligible, leaving counts and already-scaled quantities untouched',()=>{
 for(const value of['B','byte','bytes','BYTES','바이트',' B '])assert.equal(bytes.isByteUnit(value),true);
 for(const value of['b','KB','MB','GB','TB','건','원','ms','requests','count','',null,undefined])assert.equal(bytes.isByteUnit(value),false);
});
test('exact byte labels preserve the original measurement for tooltips',()=>{
 assert.equal(bytes.exact(1234567),'1,234,567 B');assert.equal(bytes.exact(0),'0 B');assert.equal(bytes.exact(.25),'0.25 B');
 assert.equal(bytes.format(Number.MAX_SAFE_INTEGER),'8,192 TB');assert.equal(bytes.exact(Number.MAX_SAFE_INTEGER),'9,007,199,254,740,991 B');
});
