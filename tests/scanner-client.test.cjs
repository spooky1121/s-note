const test=require('node:test'),assert=require('node:assert/strict');
const {create,record,cursor,MAX_BYTES}=require('../assets/scanner-client.js');
const company='11111111-1111-4111-8111-111111111111',uuid=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0'),requestId=uuid(999),context={key:'actor/company/session'};
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0]),file=new File([bytes],'sample.png',{type:'image/png'});
const item=(n=1,patch={})=>({id:uuid(n),revision:1,filename:file.name,mimeType:file.type,size:file.size,createdAt:'2026-11-26T12:00:00.123456Z',updatedAt:'2026-11-26T12:00:00.123456Z',...patch});
const envelope=items=>({ok:true,companyId:company,items,nextCursor:null}),ack=(row=item())=>({ok:true,companyId:company,item:row,duplicate:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(request){let active=true;const calls=[],urls=[],revoked=[],opened=[],clicked=[];const document={body:{append(){}},createElement(){return{href:'',download:'',click(){clicked.push({href:this.href,name:this.download});},remove(){}};}};
 const client=create({current:()=>active,companyId:()=>company,request:async(c,v,check)=>{calls.push(v);return request(c,v,check);},createURL:()=>{const url='blob:scan-'+urls.length;urls.push(url);return url;},revokeURL:url=>revoked.push(url),document,openViewer:async value=>{opened.push(value);return true;}});
 return {client,calls,urls,revoked,opened,clicked,invalidate(){active=false;}};
}
test('metadata preserves six-digit fractional timestamps and exact pagination cursor',async()=>{
 const rows=Array.from({length:30},(_,i)=>item(100-i)),tail=rows.at(-1),next={createdAt:tail.createdAt,id:tail.id};const f=fixture(async(_c,value)=>value.cursor?envelope([item(70)]):{...envelope(rows),nextCursor:next});
 const first=await f.client.list(context);assert.deepEqual(first.nextCursor,next);assert.equal(first.nextCursor.createdAt,'2026-11-26T12:00:00.123456Z');const second=await f.client.list(context,{cursor:first.nextCursor});assert.equal(second.items[0].id,uuid(70));assert.deepEqual(f.calls[1].cursor,next);assert(f.calls.every(row=>row.action==='list'));
});
test('invalid dates, reversed microseconds, unsafe files and cursor shapes are rejected',()=>{
 for(const patch of [{createdAt:'2026-02-30T00:00:00.000000Z'},{createdAt:'2026-11-26T12:00:00.123457Z'},{revision:2},{size:MAX_BYTES+1},{filename:'../scan.png'},{filename:'x'.repeat(181)},{mimeType:'image/svg+xml'}])assert.throws(()=>record(item(1,patch)));
 assert.throws(()=>cursor({createdAt:item().createdAt,id:uuid(1),extra:true}));
});
test('shared reads use one request and failed reads can be retried',async()=>{
 const hold=deferred();let count=0;const f=fixture(async()=>{count++;return count===1?hold.promise:envelope([]);});const a=f.client.list(context),b=f.client.list(context);assert.equal(count,1);hold.reject(Error('offline'));await Promise.all([assert.rejects(a),assert.rejects(b)]);await f.client.list(context);assert.equal(count,2);
});
test('foreign envelopes, duplicate/out-of-order rows and forged next cursors fail closed',async()=>{
 for(const data of [{...envelope([]),companyId:uuid(7)},envelope([item(),item()]),envelope([item(1),item(2)]),{...envelope([item()]),nextCursor:{createdAt:item().createdAt,id:uuid(1)}}])await assert.rejects(fixture(async()=>data).client.list(context));
});
test('canonical upload ACK is saved and a repeated request retains its original identity',async()=>{
 const f=fixture(async(_c,value)=>value.action==='upload'?{...ack(),duplicate:f.calls.length>1}:envelope([]));const input={requestId,file};const saved=await f.client.upload(context,input),again=await f.client.upload(context,input);assert.equal(saved.item.id,uuid(1));assert.equal(again.duplicate,true);assert.equal(f.calls[0].requestId,f.calls[1].requestId);assert.equal(f.calls[0].file,file);
});
test('malformed post-save envelopes and ACK records remain uncertain',async()=>{
 for(const data of [{...ack(),companyId:uuid(7)},ack(item(1,{size:file.size+1})),ack(item(1,{filename:'other.png'})),{...ack(),duplicate:'yes'},ack(item(1,{createdAt:'broken'}))])await assert.rejects(fixture(async()=>data).client.upload(context,{requestId,file}),error=>error.uncertain===true);
});
test('definite rejections and auth-before-send failures do not become unknown saves',async()=>{
 for(const error of [Object.assign(Error('bad'),{code:'INVALID_REQUEST'}),Object.assign(Error('offline auth'),{code:'NETWORK',uncertain:false})])await assert.rejects(fixture(async()=>{throw error;}).client.upload(context,{requestId,file}),e=>e.uncertain===false);
 const f=fixture(async()=>ack());await assert.rejects(f.client.upload(context,{requestId,file:new File(['x'],'bad.svg',{type:'image/svg+xml'})}),e=>e.uncertain===false);assert.equal(f.calls.length,0);
});
test('mutation serialization and list version prevent delayed reads erasing a saved image',async()=>{
 const hold=deferred(),uploadHold=deferred();const f=fixture(async(_c,value)=>value.action==='list'?hold.promise:uploadHold.promise);const list=f.client.list(context),upload=f.client.upload(context,{requestId,file});await assert.rejects(f.client.upload(context,{requestId:uuid(998),file}),e=>e.code==='BUSY'&&e.uncertain===false);uploadHold.resolve(ack());await upload;hold.resolve(envelope([]));await assert.rejects(list,/SCANNER_STALE/);
});
test('metadata remains byte-lazy and explicit preview validates and revokes its URL',async()=>{
 const f=fixture(async(_c,value)=>value.action==='read'?file:envelope([item()]));await f.client.list(context);assert.equal(f.calls.length,1);assert(await f.client.open(context,item(),null));assert.equal(f.calls[1].action,'read');assert(f.opened[0].isCurrent());f.client.reset();assert(!f.opened[0].isCurrent());assert.deepEqual(f.revoked,f.urls);
});
test('download keeps a MIME-consistent filename and reset clears temporary URLs',async()=>{
 const row=item(1,{filename:'scan.html'}),f=fixture(async(_c,value)=>value.action==='read'?file:envelope([row]));await f.client.list(context);assert(await f.client.download(context,row));assert.equal(f.clicked[0].name,'scan.html.png');f.client.reset();assert.deepEqual(f.revoked,f.urls);
});
test('forged image bytes and late UI/actor responses cannot create a visible URL',async()=>{
 for(const mode of ['magic','actor','ui']){let valid=true;const f=fixture(async(_c,value)=>{if(value.action!=='read')return envelope([item()]);if(mode==='actor')f.invalidate();if(mode==='ui')valid=false;return mode==='magic'?new Blob([new Uint8Array(bytes.length)],{type:'image/png'}):file;});await f.client.list(context);await assert.rejects(f.client.open(context,item(),null,()=>valid));assert.equal(f.urls.length,0);}
});
test('delete requires a verified tombstone ACK and cannot revive a retired upload ACK',async()=>{
 const f=fixture(async(_c,value)=>value.action==='list'?envelope([item()]):value.action==='delete'?{ok:true,companyId:company,id:uuid(1),revision:2,deleted:true,duplicate:false}:ack());await f.client.list(context);await f.client.remove(context,{id:uuid(1),expectedRevision:1,requestId});await assert.rejects(f.client.open(context,item(),null),/CONFLICT/);await assert.rejects(f.client.upload(context,{requestId:uuid(998),file}),e=>e.code==='CONFLICT'&&e.uncertain===false);
 const broken=fixture(async(_c,value)=>value.action==='list'?envelope([item()]):{ok:true,companyId:company,id:uuid(1),revision:2,deleted:false,duplicate:false});await broken.client.list(context);await assert.rejects(broken.client.remove(context,{id:uuid(1),expectedRevision:1,requestId}),e=>e.uncertain===true);
});
