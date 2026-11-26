'use strict';
// Synthetic metadata, files and viewer callbacks only. No browser, HTTP or DB.
const assert=require('node:assert/strict'),test=require('node:test');
const API=require('../assets/contract-registration-store.js');
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',COMPANY_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',UPLOADER='33333333-3333-4333-8333-333333333333';
const MEDIA='44444444-4444-4444-8444-444444444444',MEDIA_B='55555555-5555-4555-8555-555555555555';
const OWNER=OTHER,CAR='synthetic-car';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
// One-pixel synthetic images, generated for MIME/magic tests rather than product use.
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyGiiiuw5D/9k=','base64');
const WEBP=Buffer.from('UklGRjAAAABXRUJQVlA4ICQAAABQAQCdASoBAAEAAUAmJQBOgC6gAP762j/F3YjjJ4dVU9ffoAA=','base64');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const target=(extra={})=>({ownerId:OWNER,id:CAR,...extra});
const media=(extra={})=>({id:MEDIA,company_id:COMPANY,owner_id:UPLOADER,car_id:CAR,group_name:'registration',file_path:[COMPANY,UPLOADER,encodeURIComponent(CAR),encodeURIComponent(MEDIA)+'.png'].join('/'),original_name:'가상 자동차등록증.png',mime_type:'image/png',file_size:PNG.length,created_at:'2026-11-26T01:00:00.000Z',...extra});
function fixture(t,{timeoutMs=1000,observeViewer=false}={}){
 const f={context:{key:'registration-company-user-session',companyId:COMPANY,userId:USER,role:'accountant',ready:true,client:{},actor:{}},allowed:true,rows:[media()],complete:true,reads:[],downloads:[],viewers:[],created:[],revoked:[],anchors:[],closeCalls:0,viewerState:null,onRead:null,onDownload:null,onViewer:null,onResolve:null};
 f.observers=[];f.zoomImage={src:'blob:foreign-current'};
 f.mutateImage=(src,{deliver=true}={})=>{f.zoomImage.src=src;for(const observer of f.observers.filter(item=>item.active)){observer.records.push({type:'attributes',attributeName:'src',target:f.zoomImage});if(deliver)observer.callback(observer.takeRecords(),observer);}};
 class Observer{constructor(callback){this.callback=callback;this.records=[];this.active=false;f.observers.push(this);}observe(element){assert.equal(element,f.zoomImage);this.active=true;}takeRecords(){return this.records.splice(0);}disconnect(){this.active=false;this.records=[];}}
 f.current=c=>!!c&&f.allowed&&!!f.context&&['key','companyId','userId','role','ready','client','actor'].every(key=>c[key]===f.context[key]);
 const document={getElementById:id=>observeViewer&&id==='zoom-image'?f.zoomImage:null,body:{append(anchor){anchor.attached=true;}},createElement(tag){assert.equal(tag,'a');const a={href:'',download:'',attached:false,click(){f.anchors.push({href:this.href,download:this.download});},remove(){this.attached=false;}};return a;}};
 const openViewer=async options=>{f.viewers.push(options);f.viewerState={kind:'registration',src:options.src};if(observeViewer)f.mutateImage(options.src);return f.onViewer?f.onViewer(options):true;};
 openViewer.close=()=>{f.closeCalls++;f.viewerState=null;};
 f.store=API.create({context:()=>f.context,current:f.current,resolveVehicle:(c,value)=>f.onResolve?f.onResolve(c,value):value?.ownerId===OWNER&&value?.id===CAR?{...target(),ambiguous:false}:null,
  readMetadata:async c=>{f.reads.push(c);return f.onRead?f.onRead(c):{rows:f.rows,complete:f.complete};},
  download:async(c,row)=>{f.downloads.push({context:c,row});return f.onDownload?f.onDownload(c,row):new Blob([PNG],{type:'image/png'});},openViewer,
  createObjectURL:blob=>{const url='blob:synthetic-registration-'+(f.created.length+1);f.created.push({url,blob});return url;},revokeObjectURL:url=>f.revoked.push(url),document,timeoutMs,
  MutationObserver:observeViewer?Observer:undefined,closeViewer:()=>{f.closeCalls++;f.viewerState=null;}});
 t.after(()=>f.store.reset());return f;
}
const status=f=>f.store.registration(f.context,target());
const prepare=f=>f.store.prepareRegistrations(f.context,[target()]);
async function noPublishedURL(f){assert.equal(status(f).status==='ready',false);f.store.reset();for(const item of f.created)assert(f.revoked.includes(item.url),'Reset must revoke every created object URL');}

test('metadata preparation is lazy and accepts a registration uploaded by a different authorized member',async t=>{
 const f=fixture(t);assert.equal(status(f).status,'unknown');assert.equal(f.reads.length,0);assert.equal(f.downloads.length,0);
 assert.equal(await prepare(f),true);assert.equal(status(f).status,'registered');assert.equal(f.reads.length,1);assert.equal(f.downloads.length,0);assert.equal(f.created.length,0);assert.equal(f.viewers.length,0);
 assert.notEqual(f.rows[0].owner_id,USER);assert.notEqual(f.rows[0].owner_id,OWNER);
});
test('a complete empty listing means missing; a partial empty listing remains unknown',async t=>{
 const complete=fixture(t);complete.rows=[];assert.equal(await prepare(complete),true);assert.equal(status(complete).status,'missing');
 const partial=fixture(t);partial.rows=[];partial.complete=false;assert.equal(await prepare(partial),true);assert.equal(status(partial).status,'unknown');
 const present=fixture(t);present.complete=false;await prepare(present);assert.equal(status(present).status,'registered');
});
test('missing authorization and invalid targets perform no metadata, file or viewer calls',async t=>{
 for(const kind of['no-context','not-ready','not-current','unknown-target']){
  const f=fixture(t),ctx=f.context;let value=target();if(kind==='no-context')f.context=null;else if(kind==='not-ready')f.context={...ctx,ready:false};else if(kind==='not-current')f.allowed=false;else value=target({id:'not-an-authorized-car'});
  assert.equal(await f.store.prepareRegistrations(f.context,[value]),false);assert.equal(await f.store.openRegistration(f.context,value,null),false);
  assert.equal(f.reads.length,0,kind);assert.equal(f.downloads.length,0,kind);assert.equal(f.viewers.length,0,kind);
 }
});
test('a raw vehicle ID collision stays ambiguous even when a requested owner is supplied',async t=>{
 const f=fixture(t);f.onResolve=()=>({...target(),ambiguous:true});assert.equal(status(f).status,'ambiguous');await prepare(f);assert.equal(status(f).status,'ambiguous');assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.downloads.length,0);assert.equal(f.viewers.length,0);
});
test('metadata reads coalesce and successful preparations do not refetch on each render',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();f.onRead=async()=>{began.resolve();await gate.promise;return{rows:f.rows,complete:true};};
 const a=prepare(f),b=prepare(f);await began.promise;assert.equal(f.reads.length,1);gate.resolve();assert.deepEqual(await Promise.all([a,b]),[true,true]);await prepare(f);assert.equal(f.reads.length,1);assert.equal(status(f).status,'registered');
});
test('two first-use opens share metadata and file work instead of replacing the first valid intent',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();f.onRead=async()=>{began.resolve();await gate.promise;return{rows:f.rows,complete:true};};
 const a=f.store.openRegistration(f.context,target(),null),b=f.store.openRegistration(f.context,target(),null);await began.promise;assert.equal(f.reads.length,1);gate.resolve();assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(f.downloads.length,1);assert.equal(f.created.length,1);assert.equal(f.viewers.length,1);
});
test('failed metadata reads may retry and never invent a missing or registered document',async t=>{
 const f=fixture(t);f.onRead=async()=>{throw Error('SYNTHETIC_METADATA_UNAVAILABLE');};assert.equal(await prepare(f),false);assert(!['registered','ready','missing'].includes(status(f).status));
 f.onRead=null;assert.equal(await prepare(f),true);assert.equal(f.reads.length,2);assert.equal(status(f).status,'registered');
});
test('metadata from an old company, user, role or client/actor identity cannot reach the next scope',async t=>{
 for(const change of['logout','companyId','userId','role','client','actor','key']){
  const f=fixture(t),gate=deferred(),began=deferred(),old=f.context;f.onRead=async()=>{began.resolve();await gate.promise;return{rows:f.rows,complete:true};};const pending=prepare(f);await began.promise;
  if(change==='logout')f.context=null;else f.context={...old,[change]:change==='companyId'?COMPANY_B:change==='userId'?OTHER:change==='role'?'admin':change==='key'?'another-session':{}};
  gate.resolve();assert.equal(await pending,false,change);assert(!['registered','ready'].includes(f.store.registration(old,target()).status),change);assert.equal(f.downloads.length,0);assert.equal(f.created.length,0);
 }
});
test('unsafe media paths, foreign company rows, non-registration data and unsupported metadata cannot be opened',async t=>{
 const invalid=[
  {company_id:COMPANY_B},{group_name:'photo'},{owner_id:'not-a-user-id'},
  {file_path:'https://outside.example.invalid/registration.png'},{file_path:'/'+media().file_path},{file_path:media().file_path+'?token=private'},
  {file_path:[COMPANY,UPLOADER,'..',MEDIA+'.png'].join('/')},{file_path:[COMPANY,UPLOADER,CAR,MEDIA+'.png','extra'].join('/')},
  {file_path:[COMPANY,UPLOADER,'different-car',MEDIA+'.png'].join('/')},{file_path:[COMPANY,OTHER,CAR,MEDIA+'.png'].join('/')},
  {file_path:[COMPANY,UPLOADER,CAR,MEDIA_B+'.png'].join('/')},{file_path:[COMPANY,UPLOADER,CAR,MEDIA+'.svg'].join('/')},
  {mime_type:'image/svg+xml'},{mime_type:'text/html'},{mime_type:'image/jpeg'},{file_size:0},{file_size:26214401},{file_size:'68'}
 ];
 for(const bad of invalid){const f=fixture(t);f.rows=[media(bad)];await prepare(f);assert(!['registered','ready'].includes(status(f).status),JSON.stringify(bad));assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.downloads.length,0);assert.equal(f.viewers.length,0);}
});
test('malformed metadata envelopes and conflicting duplicate media IDs do not become registered documents',async t=>{
 for(const envelope of[{rows:null,complete:true},{rows:[],complete:'true'},{rows:[]},null]){const f=fixture(t);f.onRead=async()=>envelope;assert.equal(await prepare(f),false);assert(!['missing','registered','ready'].includes(status(f).status));assert.equal(f.downloads.length,0);}
 const f=fixture(t),otherCar='another-synthetic-car';f.rows=[media(),media({car_id:otherCar,file_path:[COMPANY,UPLOADER,otherCar,MEDIA+'.png'].join('/')})];await prepare(f);assert.equal(status(f).status,'unknown');assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.downloads.length,0);
});
test('the newest valid registration is chosen from metadata order without downloading older files',async t=>{
 const f=fixture(t),newer=media({id:MEDIA_B,created_at:'2026-11-26T02:00:00.000Z',file_path:[COMPANY,UPLOADER,CAR,MEDIA_B+'.png'].join('/')});f.rows=[media(),newer];await prepare(f);assert.equal(f.downloads.length,0);assert.equal(await f.store.openRegistration(f.context,target(),null),true);assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].row.id,MEDIA_B);
});
test('encoded vehicle and media identifiers are matched by exact safe path components',async t=>{
 const f=fixture(t),carId='synthetic 차량',id='synthetic media';const value=target({id:carId});f.onResolve=(c,v)=>v?.ownerId===OWNER&&v?.id===carId?{...value,ambiguous:false}:null;
 f.rows=[media({id,car_id:carId,file_path:[COMPANY,UPLOADER,encodeURIComponent(carId),encodeURIComponent(id)+'.png'].join('/')})];assert.equal(await f.store.prepareRegistrations(f.context,[value]),true);assert.equal(f.store.registration(f.context,value).status,'registered');assert.equal(await f.store.openRegistration(f.context,value,null),true);assert.equal(f.downloads.length,1);
});
test('opening a validated PNG creates one original URL, passes the existing viewer a live guard and provides a download',async t=>{
 const f=fixture(t);await prepare(f);const origin={name:'synthetic origin'};assert.equal(await f.store.openRegistration(f.context,target(),origin),true);assert.equal(f.downloads.length,1);assert.equal(f.created.length,1);
 const state=status(f),options=f.viewers[0];assert.equal(state.status,'ready');assert.equal(state.thumbnail,f.created[0].url);assert.equal(options.src,state.thumbnail);assert.equal(options.origin,origin);assert.equal(options.isCurrent(),true);assert.match(options.alt,/등록증/);assert.equal(typeof options.download,'function');await options.download();assert.equal(f.anchors.length,1);assert.equal(f.anchors[0].href,options.src);assert.equal(f.anchors[0].download,'가상 자동차등록증.png');
});
test('JPEG jpg/jpeg, PNG and WebP registrations retain the permitted MIME and original image bytes',async t=>{
 for(const[type,extension,bytes]of[['image/jpeg','jpg',JPEG],['image/jpeg','jpeg',JPEG],['image/png','png',PNG],['image/webp','webp',WEBP]]){
  const f=fixture(t);f.rows=[media({mime_type:type,file_size:bytes.length,file_path:[COMPANY,UPLOADER,CAR,MEDIA+'.'+extension].join('/')})];f.onDownload=async()=>new Blob([bytes],{type});await prepare(f);assert.equal(status(f).status,'registered');assert.equal(await f.store.openRegistration(f.context,target(),null),true);assert.equal(f.created[0].blob.type,type);assert.deepEqual(Buffer.from(await f.created[0].blob.arrayBuffer()),bytes);
 }
});
test('valid metadata MIME and length never substitute for the actual JPEG, PNG or WebP signature',async t=>{
 for(const[type,extension,bytes]of[['image/jpeg','jpg',JPEG],['image/png','png',PNG],['image/webp','webp',WEBP]]){
  const f=fixture(t);f.rows=[media({mime_type:type,file_size:bytes.length,file_path:[COMPANY,UPLOADER,CAR,MEDIA+'.'+extension].join('/')})];f.onDownload=async()=>new Blob([Buffer.alloc(bytes.length,60)],{type});await prepare(f);assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.created.length,0);assert.equal(f.viewers.length,0);
 }
});
test('concurrent and later opens reuse the validated file while each viewer call retains a current guard',async t=>{
 const f=fixture(t),gate=deferred(),began=deferred();await prepare(f);f.onDownload=async()=>{began.resolve();await gate.promise;return new Blob([PNG],{type:'image/png'});};
 const a=f.store.openRegistration(f.context,target(),null),b=f.store.openRegistration(f.context,target(),null);await began.promise;assert.equal(f.downloads.length,1);gate.resolve();const opened=await Promise.all([a,b]);assert(opened.every(Boolean));assert.equal(f.created.length,1);await f.store.openRegistration(f.context,target(),null);assert.equal(f.downloads.length,1);assert.equal(f.viewers.at(-1).isCurrent(),true);assert(f.viewers.slice(0,-1).every(v=>v.isCurrent()===false),'A later open invalidates old viewer leases');
});
test('download failures and corrupt Blob responses fail closed and allow a valid retry',async t=>{
 const failures=[()=>{throw Error('SYNTHETIC_FILE_UNAVAILABLE');},()=>new Blob([PNG],{type:'image/jpeg'}),()=>new Blob([PNG.subarray(0,12)],{type:'image/png'}),()=>new Blob([Buffer.alloc(PNG.length,60)],{type:'image/png'}),()=>({size:PNG.length,type:'image/png',arrayBuffer:async()=>PNG.buffer})];
 for(const fail of failures){const f=fixture(t);await prepare(f);f.onDownload=async()=>fail();assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.viewers.length,0);await noPublishedURL(f);f.onDownload=null;assert.equal(await f.store.openRegistration(f.context,target(),null),true);assert.equal(status(f).status,'ready');assert.equal(f.downloads.length,2);}
});
test('a UI that is already stale cannot begin reading or downloading a private registration',async t=>{
 const f=fixture(t);assert.equal(await f.store.openRegistration(f.context,target(),null,()=>false),false);assert.equal(f.reads.length,0);assert.equal(f.downloads.length,0);assert.equal(f.created.length,0);assert.equal(f.viewers.length,0);
});
test('missing, partial or failed metadata releases the unsuccessful open observer without touching another viewer',async t=>{
 for(const reason of['missing','partial','read-error']){
  const f=fixture(t,{observeViewer:true});f.rows=[];f.complete=reason!=='partial';if(reason==='read-error')f.onRead=async()=>{throw Error('SYNTHETIC_METADATA_ERROR');};f.viewerState={kind:'foreign',src:'blob:foreign-current'};
  assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert(f.observers.length>0);assert(f.observers.every(observer=>!observer.active),'An unsuccessful open must disconnect its own observer');assert.equal(f.viewers.length,0);assert.equal(f.closeCalls,0);assert.deepEqual(f.viewerState,{kind:'foreign',src:'blob:foreign-current'});
 }
});
test('late metadata and file responses obey a closed UI guard and reset releases private image bytes',async t=>{
 for(const phase of['metadata','download']){
  const f=fixture(t),gate=deferred(),began=deferred();let active=true;
  if(phase==='metadata')f.onRead=async()=>{began.resolve();await gate.promise;return{rows:f.rows,complete:true};};else{await prepare(f);f.onDownload=async()=>{began.resolve();await gate.promise;return new Blob([PNG],{type:'image/png'});};}
  const pending=f.store.openRegistration(f.context,target(),null,()=>active);await began.promise;active=false;gate.resolve();assert.equal(await pending,false,phase);assert.equal(f.viewers.length,0,phase);await noPublishedURL(f);
 }
});
test('scope changes during a file download never show another account the old registration',async t=>{
 for(const change of['userId','companyId','role','client','actor','logout']){
  const f=fixture(t),gate=deferred(),began=deferred(),old=f.context;await prepare(f);f.onDownload=async()=>{began.resolve();await gate.promise;return new Blob([PNG],{type:'image/png'});};const pending=f.store.openRegistration(old,target(),null);await began.promise;f.context=change==='logout'?null:{...old,[change]:change==='userId'?OTHER:change==='companyId'?COMPANY_B:change==='role'?'dealer':{}};gate.resolve();assert.equal(await pending,false,change);assert.equal(f.viewers.length,0);assert(!['registered','ready'].includes(f.store.registration(old,target()).status));for(const item of f.created)assert(f.revoked.includes(item.url));
 }
});
test('another feature replacing the viewer during metadata loading is never overwritten, including a same-src assignment',async t=>{
 for(const sameSource of[false,true])for(const deliver of[false,true]){
  const f=fixture(t,{observeViewer:true}),gate=deferred(),began=deferred(),foreign=sameSource?'blob:foreign-current':'blob:foreign-new';f.onRead=async()=>{began.resolve();await gate.promise;return{rows:f.rows,complete:true};};const pending=f.store.openRegistration(f.context,target(),null);await began.promise;
  assert(f.observers.some(observer=>observer.active),'Viewer replacement stays observed during the metadata await');f.viewerState={kind:'foreign',src:foreign};f.mutateImage(foreign,{deliver});gate.resolve();assert.equal(await pending,false);assert.equal(f.viewers.length,0);assert.deepEqual(f.viewerState,{kind:'foreign',src:foreign});assert.equal(f.closeCalls,0);if(deliver)assert.equal(f.downloads.length,0);f.store.reset();for(const item of f.created)assert(f.revoked.includes(item.url));
 }
});
test('a viewer that rejects or becomes stale cannot mark the thumbnail ready',async t=>{
 const rejected=fixture(t);await prepare(rejected);rejected.onViewer=async()=>false;assert.equal(await rejected.store.openRegistration(rejected.context,target(),null),false);assert.notEqual(status(rejected).status,'ready');
 const late=fixture(t),gate=deferred(),began=deferred();await prepare(late);let active=true;late.onViewer=async()=>{began.resolve();await gate.promise;return true;};const pending=late.store.openRegistration(late.context,target(),null,()=>active);await began.promise;active=false;gate.resolve();assert.equal(await pending,false);assert.equal(late.viewers[0].isCurrent(),false);await noPublishedURL(late);
});
test('reset revokes prepared image URLs and invalidates old viewer/download callbacks without closing a foreign viewer',async t=>{
 const f=fixture(t);await prepare(f);await f.store.openRegistration(f.context,target(),null);const options=f.viewers[0],url=options.src;f.viewerState={kind:'foreign',src:'blob:another-feature-image'};f.store.reset();assert(f.revoked.includes(url));assert.equal(options.isCurrent(),false);await options.download();assert.equal(f.anchors.length,0);assert.equal(f.closeCalls,0);assert.deepEqual(f.viewerState,{kind:'foreign',src:'blob:another-feature-image'});assert.notEqual(status(f).status,'ready');
});
test('forced metadata refresh removes a deleted registration and releases its cached thumbnail',async t=>{
 const f=fixture(t);await prepare(f);await f.store.openRegistration(f.context,target(),null);const url=status(f).thumbnail;f.rows=[];assert.equal(await f.store.prepareRegistrations(f.context,[target()],{force:true}),true);assert.equal(f.reads.length,2);assert.equal(status(f).status,'missing');assert(f.revoked.includes(url));assert.equal(await f.store.openRegistration(f.context,target(),null),false);assert.equal(f.downloads.length,1);
});
test('a timed-out metadata read can be retried without accepting its eventual stale response',async t=>{
 const f=fixture(t,{timeoutMs:15}),gate=deferred();f.onRead=async()=>{await gate.promise;return{rows:[media({id:MEDIA_B,file_path:[COMPANY,UPLOADER,CAR,MEDIA_B+'.png'].join('/')})],complete:true};};assert.equal(await prepare(f),false);f.onRead=null;assert.equal(await prepare(f),true);gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(status(f).status,'registered');await f.store.openRegistration(f.context,target(),null);assert.equal(f.downloads[0].row.id,MEDIA);
});
