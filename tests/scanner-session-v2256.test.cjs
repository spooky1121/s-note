'use strict';
// Actual browser helper in isolated realms; synthetic scopes and IDs only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto,createHash}=require('node:crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../assets/scanner-session.js'),'utf8'),PREFIX='snote:scanner-session:v1:',uuid=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0'),key=PREFIX+'a'.repeat(64);
function helper(crypto){if(arguments.length===0)crypto=webcrypto;const context={crypto,TextEncoder,Uint8Array,module:{exports:{}}};vm.runInNewContext(source,context);return context.module.exports;}
function storage(seed={}){const data=new Map(Object.entries(seed)),calls=[];return{data,calls,get length(){return data.size;},key(i){return[...data.keys()][i]??null;},getItem(name){calls.push(['get',name]);return data.get(name)??null;},setItem(name,value){calls.push(['set',name,value]);data.set(name,value);},removeItem(name){calls.push(['remove',name]);data.delete(name);}};}
const list=value=>Array.from(value);
test('scope keys use a deterministic SHA256 without exposing company, actor or session input',async()=>{
 const api=helper(),raw=JSON.stringify(['synthetic-company','synthetic-user','synthetic-session']),actual=await api.keyFor(raw);
 assert.equal(actual,PREFIX+createHash('sha256').update(raw).digest('hex'));assert.match(actual,/^snote:scanner-session:v1:[a-f0-9]{64}$/);assert(!actual.includes('synthetic'));assert.equal(await api.keyFor(raw),actual);
 for(const changed of [['other-company','synthetic-user','synthetic-session'],['synthetic-company','other-user','synthetic-session'],['synthetic-company','synthetic-user','other-session']])assert.notEqual(await api.keyFor(JSON.stringify(changed)),actual);
});
test('unavailable or invalid crypto never invents a persistable fallback identity',async()=>{
 for(const crypto of [undefined,{}, {subtle:{digest:async()=>new ArrayBuffer(4)}},{subtle:{digest:async()=>{throw Error('synthetic crypto refusal');}}}])await assert.rejects(helper(crypto).keyFor('synthetic-scope'));
 const api=helper();for(const raw of [null,{},1,'','  ','scope\nsecret','x'.repeat(8193)])await assert.rejects(api.keyFor(raw));
});
test('only hashed namespace keys can read or write browser storage',()=>{
 const api=helper(),s=storage();for(const invalid of [null,{},'synthetic-session',PREFIX,PREFIX+'A'.repeat(64),key+'x',PREFIX+'b'.repeat(63)]){assert.deepEqual(list(api.read(s,invalid)),[]);assert.deepEqual(list(api.write(s,invalid,[uuid(1)])),[]);}assert.deepEqual(s.calls,[]);
});
test('a write stores UUID references only and preserves newest-first caller order without duplicates',()=>{
 const api=helper(),s=storage(),upper='AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',unsafe={id:uuid(7),filename:'synthetic-document.png',token:'synthetic.jwt.parts'};
 const ids=list(api.write(s,key,[uuid(3),upper,uuid(3),upper.toLowerCase(),null,unsafe,1,'../private.png','00000000-0000-0000-0000-000000000000',uuid(2)]));
 assert.deepEqual(ids,[uuid(3),upper.toLowerCase(),uuid(2)]);assert.equal(s.data.get(key),JSON.stringify(ids));assert(!s.data.get(key).includes('synthetic'));assert.deepEqual(list(api.read(s,key)),ids);
});
test('session references have a bounded count and hostile input is not coerced',()=>{
 const api=helper(),s=storage(),many=Array.from({length:500},(_,i)=>uuid(500-i));assert.equal(api.LIMIT,200);assert(Object.isFrozen(api));assert.deepEqual(list(api.write(s,key,many)),many.slice(0,200));assert(s.data.get(key).length<16384);
 let coerced=false;const value={toString(){coerced=true;return uuid(1);}};assert.deepEqual(list(api.write(s,key,[value,uuid(2)])),[uuid(2)]);assert.equal(coerced,false);
 for(const invalid of [null,{},'[]',1,Array(4097).fill(uuid(1))])assert.deepEqual(list(api.write(s,key,invalid)),[]);
});
test('corrupt or oversized stored bodies fail closed without treating metadata objects as references',()=>{
 const api=helper();for(const raw of ['broken','null','true','123','"uuid"','{"ids":["'+uuid(1)+'"]}',JSON.stringify([uuid(1)])+' '.repeat(16385)])assert.deepEqual(list(api.read(storage({[key]:raw}),key)),[]);
 assert.deepEqual(list(api.read(storage({[key]:JSON.stringify([uuid(4),{},uuid(4),uuid(3)])}),key)),[uuid(4),uuid(3)]);
});
test('blocked storage permits explicit in-memory references without persisting bytes or credentials',()=>{
 const api=helper(),blocked={getItem(){throw Error('denied');},setItem(){throw Error('quota');},key(){throw Error('denied');},removeItem(){throw Error('denied');},get length(){throw Error('denied');}};
 assert.deepEqual(list(api.read(blocked,key)),[]);const memory=list(api.write(blocked,key,[uuid(2),uuid(1)]));assert.deepEqual(memory,[uuid(2),uuid(1)]);assert.equal(api.clear(blocked),0);
 for(const absent of [null,undefined,{}]){assert.deepEqual(list(api.read(absent,key)),[]);assert.deepEqual(list(api.write(absent,key,memory)),memory);assert.equal(api.clear(absent),0);}
});
test('clear removes the entire scanner-session namespace and preserves unrelated application data',()=>{
 const api=helper(),s=storage({[key]:'[]',[PREFIX+'b'.repeat(64)]:'[]',[PREFIX+'corrupted-old-key']:'private-corrupt-value','snote:other-session':'keep','different-app':'keep-too'});
 assert.equal(api.clear(s),3);assert.deepEqual([...s.data.entries()],[['snote:other-session','keep'],['different-app','keep-too']]);assert.equal(api.clear(s),0);
 const first=PREFIX+'c'.repeat(64),second=PREFIX+'d'.repeat(64),partial=storage({[first]:'[]',[second]:'[]'}),original=partial.removeItem;partial.removeItem=name=>{if(name===first)throw Error('synthetic denial');original(name);};assert.equal(api.clear(partial),1);assert(partial.data.has(first));assert(!partial.data.has(second));
});
test('separate caller realms can restore IDs while a changed login selects an empty namespace',async()=>{
 const s=storage(),first=helper(),raw=JSON.stringify(['company-A','user-A','session-A']),saved=await first.keyFor(raw);first.write(s,saved,[uuid(8),uuid(7)]);
 const nextPage=helper();assert.deepEqual(list(nextPage.read(s,await nextPage.keyFor(raw))),[uuid(8),uuid(7)]);assert.deepEqual(list(nextPage.read(s,await nextPage.keyFor(JSON.stringify(['company-A','user-A','session-B'])))),[]);nextPage.clear(s);assert.deepEqual(list(nextPage.read(s,saved)),[]);
});
