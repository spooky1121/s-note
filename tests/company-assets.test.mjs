import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../assets/company-assets.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const blob=(type='image/png',size=12)=>new Blob([new Uint8Array(size)],{type});
function harness(){
 const world={};vm.runInNewContext(source,world);let active={companyId:'company-A',userId:'user-A',client:{},actor:{}},number=0;
 const rows=new Map(),events=[],calls={records:0,download:0,decode:0};
 const row=(kind='companyStamp',path='first.png',extra={})=>({company_id:active.companyId,owner_id:'owner-A',group_name:kind,file_path:active.companyId+'/owner-A/branding/'+path,mime_type:'image/png',file_size:12,...extra});
 rows.set('companyStamp',[row()]);rows.set('companyLogo',[row('companyLogo')]);rows.set('companyOfficeStamp',[row('companyOfficeStamp','office.png')]);
 const hooks={records:async kind=>{calls.records++;return rows.get(kind);},download:async record=>{calls.download++;return blob(record.mime_type,record.file_size);},decode:async url=>{calls.decode++;events.push(['decode',url]);}};
 const api=world.SnoteCompanyAssets.create({context:()=>active,records:(...args)=>hooks.records(...args),download:(...args)=>hooks.download(...args),decode:(...args)=>hooks.decode(...args),createURL:value=>{const url='blob:test-'+(++number);events.push(['create',url,value.type]);return url;},revokeURL:url=>events.push(['revoke',url]),onClear:(kind,url)=>events.push(['clear',kind,url])});
 return {api,hooks,rows,row,events,calls,get active(){return active;},set active(value){active=value;}};
}
test('factory is inert and invalid kinds/options cannot fetch branding',async()=>{
 const h=harness();assert.deepEqual(h.calls,{records:0,download:0,decode:0});assert.equal(h.api.snapshot('companyStamp').status,'idle');
 assert.throws(()=>h.api.load('avatar'),/ASSET_KIND_INVALID/);assert.throws(()=>h.api.invalidate('unknown'),/ASSET_KIND_INVALID/);assert.equal(h.calls.records,0);
 const world={};vm.runInNewContext(source,world);assert.throws(()=>world.SnoteCompanyAssets.create({}),/ASSET_OPTIONS_INVALID/);
});
test('all context identifiers and object references are required before any fetch',async()=>{
 for(const key of ['companyId','userId','client','actor']){const h=harness();h.active={...h.active,[key]:null};assert.equal(await h.api.load('companyStamp'),null);assert.equal(h.calls.records,0);assert.equal(h.api.snapshot('companyStamp').status,'idle');}
});
test('same-scope callers share one pending metadata/download/decode operation',async()=>{
 const h=harness(),record=deferred(),decoded=deferred();h.hooks.records=async()=>{h.calls.records++;return record.promise;};h.hooks.decode=async()=>{h.calls.decode++;return decoded.promise;};
 const first=h.api.load('companyStamp'),second=h.api.load('companyStamp');assert.equal(first,second);await tick();assert.equal(h.calls.records,1);record.resolve([h.row()]);await tick();assert.equal(h.calls.download,1);assert.equal(h.api.snapshot('companyStamp').status,'loading');assert.equal(h.api.snapshot('companyStamp').url,null);
 decoded.resolve();assert.equal(await first,'blob:test-1');assert.equal(await second,'blob:test-1');assert.equal(h.api.snapshot('companyStamp').status,'ready');
});
test('every later load checks current metadata but reuses a decoded URL for the same path',async()=>{
 const h=harness();const first=await h.api.load('companyStamp');assert.equal(await h.api.load('companyStamp'),first);assert.equal(h.calls.records,2);assert.equal(h.calls.download,1);assert.equal(h.calls.decode,1);assert.equal(h.events.filter(x=>x[0]==='revoke').length,0);
});
test('replacement clears consumers before revocation and publishes only after decoding',async()=>{
 const h=harness(),old=await h.api.load('companyStamp'),decoded=deferred();h.events.length=0;h.rows.set('companyStamp',[h.row('companyStamp','replacement.png')]);h.hooks.decode=()=>decoded.promise;
 const pending=h.api.load('companyStamp');await tick();assert.deepEqual(h.events.slice(0,2),[['clear','companyStamp',old],['revoke',old]]);assert.equal(h.api.snapshot('companyStamp').url,null);assert.equal(h.api.snapshot('companyStamp').status,'loading');
 decoded.resolve();assert.equal(await pending,'blob:test-2');assert.equal(h.api.snapshot('companyStamp').path,h.row('companyStamp','replacement.png').file_path);
});
test('missing latest asset removes an old image and never falls back to another record',async()=>{
 const h=harness(),url=await h.api.load('companyLogo');h.events.length=0;h.rows.set('companyLogo',[]);assert.equal(await h.api.load('companyLogo'),null);assert.equal(h.api.snapshot('companyLogo').status,'missing');assert.deepEqual(h.events,[['clear','companyLogo',url],['revoke',url]]);
 h.rows.set('companyLogo',[h.row('companyLogo','bad.png',{company_id:'foreign-company'}),h.row('companyLogo')]);await assert.rejects(h.api.load('companyLogo'),/ASSET_METADATA_INVALID/);assert.equal(h.calls.download,1);
});
test('latest metadata is restricted to its company, kind, owner branding prefix and safe image bounds',async()=>{
 const invalid=[{company_id:'other'},{group_name:'photos'},{owner_id:'../owner'},{file_path:'company-A/foreign/branding/first.png'},{file_path:'company-A/owner-A/branding/../first.png'},{file_path:'company-A/owner-A/branding/nested/first.png'},{file_path:'company-A/owner-A/branding/%2e%2e.png'},{file_path:'company-A/owner-A/branding/first.png?x=1'},{file_path:'https://outside/first.png'},{file_path:'company-A/owner-A/branding/first\\.png'},{mime_type:'image/svg+xml'},{mime_type:'text/html'},{file_size:0},{file_size:3*1024*1024+1},{file_size:12.5}];
 for(const extra of invalid){const h=harness();h.rows.set('companyStamp',[h.row('companyStamp','first.png',extra)]);await assert.rejects(h.api.load('companyStamp'),/^Error: ASSET_/);assert.equal(h.calls.download,0);assert.equal(h.api.snapshot('companyStamp').status,'error');}
});
test('a company image may have been uploaded by another member of that same company',async()=>{
 const h=harness();h.rows.set('companyStamp',[h.row('companyStamp','admin.png',{owner_id:'other-admin',file_path:'company-A/other-admin/branding/admin.png'})]);assert.equal(await h.api.load('companyStamp'),'blob:test-1');
});
test('PNG, JPEG and WEBP decode successfully, including the exact upload size limit',async()=>{
 for(const type of ['image/png','image/jpeg','image/webp']){const h=harness();h.rows.set('companyLogo',[h.row('companyLogo','image.bin',{mime_type:type,file_size:3*1024*1024})]);assert.equal(await h.api.load('companyLogo'),'blob:test-1');assert.equal(h.events.find(x=>x[0]==='create')[2],type);assert.equal(h.calls.decode,1);}
});
test('untyped/octet-stream blobs use trusted metadata MIME while other MIME/size mismatches reject',async()=>{
 for(const type of ['','application/octet-stream']){const h=harness();h.hooks.download=async()=>blob(type);assert.equal(await h.api.load('companyLogo'),'blob:test-1');assert.equal(h.events.find(x=>x[0]==='create')[2],'image/png');}
 for(const value of [blob('text/html'),blob('image/webp'),blob('image/png',0),blob('image/png',13),{},null]){const h=harness();h.hooks.download=async()=>value;await assert.rejects(h.api.load('companyLogo'),/^Error: ASSET_/);assert.equal(h.events.some(x=>x[0]==='create'),false);}
});
test('decode failures revoke unpublished URLs and leave no previous cached image',async()=>{
 const h=harness(),old=await h.api.load('companyStamp');h.events.length=0;h.rows.set('companyStamp',[h.row('companyStamp','new.png')]);h.hooks.decode=async()=>{throw new Error('private remote bytes');};
 await assert.rejects(h.api.load('companyStamp'),/ASSET_DECODE_FAILED/);assert.equal(h.api.snapshot('companyStamp').status,'error');assert.equal(h.api.snapshot('companyStamp').url,null);assert.deepEqual(h.events.filter(x=>x[0]==='revoke'),[['revoke',old],['revoke','blob:test-2']]);
});
test('metadata/download failures clear cached data and expose only fixed error codes',async()=>{
 for(const action of ['records','download']){const h=harness(),old=await h.api.load('companyLogo');h.events.length=0;h.rows.set('companyLogo',[h.row('companyLogo','new.png')]);h.hooks[action]=async()=>{throw new Error('secret path/token');};
  await assert.rejects(h.api.load('companyLogo'),error=>error.code===`ASSET_${action==='records'?'RECORDS':'DOWNLOAD'}_FAILED`&&!error.message.includes('secret'));assert.equal(h.api.snapshot('companyLogo').url,null);assert.equal(h.api.snapshot('companyLogo').status,'error');assert.deepEqual(h.events.filter(x=>x[0]==='revoke'),[['revoke',old]]);assert.equal(h.events[0][0],'clear');
 }
});
test('a metadata lookup completing for a previous company cannot start a download',async()=>{
 const h=harness(),hold=deferred(),old=h.row();h.hooks.records=()=>hold.promise;const pending=h.api.load('companyStamp');await tick();h.active={...h.active,companyId:'company-B'};hold.resolve([old]);assert.equal(await pending,null);assert.equal(h.calls.download,0);assert.equal(h.api.snapshot('companyStamp').companyId,'company-B');assert.equal(h.api.snapshot('companyStamp').url,null);
});
test('a download completing after account switch cannot create a URL',async()=>{
 const h=harness(),hold=deferred();h.hooks.download=()=>hold.promise;const pending=h.api.load('companyLogo');await tick();h.active={...h.active,userId:'user-B'};hold.resolve(blob());assert.equal(await pending,null);assert.equal(h.events.some(x=>x[0]==='create'),false);
});
test('client or actor identity replacement invalidates an otherwise identical scope',async()=>{
 for(const key of ['client','actor']){const h=harness(),url=await h.api.load('companyLogo');h.events.length=0;h.active={...h.active,[key]:{}};assert.equal(h.api.snapshot('companyLogo').url,null);assert.deepEqual(h.events.slice(0,2),[['clear','companyStamp',null],['clear','companyLogo',url]]);assert.deepEqual(h.events[2],['revoke',url]);}
});
test('late decode after scope change revokes its unpublished URL without publishing',async()=>{
 const h=harness(),hold=deferred();h.hooks.decode=()=>hold.promise;const pending=h.api.load('companyStamp');await tick();assert.equal(h.api.snapshot('companyStamp').url,null);h.active={...h.active,userId:'user-B'};hold.resolve();assert.equal(await pending,null);assert.equal(h.api.snapshot('companyStamp').url,null);assert.equal(h.events.filter(x=>x[0]==='revoke'&&x[1]==='blob:test-1').length,1);
});
test('invalidating one kind cancels only that pending kind and leaves the other decoded URL alive',async()=>{
 const h=harness(),logo=await h.api.load('companyLogo'),hold=deferred();h.hooks.decode=()=>hold.promise;const pending=h.api.load('companyStamp');await tick();h.api.invalidate('companyStamp');hold.resolve();assert.equal(await pending,null);assert.equal(h.api.snapshot('companyStamp').status,'idle');assert.equal(h.api.snapshot('companyLogo').url,logo);assert.equal(h.events.some(x=>x[0]==='revoke'&&x[1]===logo),false);
});
test('reset clears all three kinds before revocation and an old promise cannot overwrite a new load',async()=>{
 const h=harness(),stamp=await h.api.load('companyStamp'),logo=await h.api.load('companyLogo'),office=await h.api.load('companyOfficeStamp');h.events.length=0;h.api.reset();assert.deepEqual(h.events,[['clear','companyStamp',stamp],['revoke',stamp],['clear','companyLogo',logo],['revoke',logo],['clear','companyOfficeStamp',office],['revoke',office]]);
 const hold=deferred();h.hooks.decode=()=>hold.promise;const old=h.api.load('companyLogo');await tick();const unpublished=h.events.filter(event=>event[0]==='create').at(-1)[1];h.api.reset();h.hooks.decode=async()=>{};const fresh=await h.api.load('companyLogo');hold.resolve();assert.equal(await old,null);assert.equal(h.api.snapshot('companyLogo').url,fresh);assert.notEqual(fresh,unpublished);
});
test('a stale request rejection cannot clear or fail a newly loaded company image',async()=>{
 const h=harness(),hold=deferred();h.hooks.records=()=>hold.promise;const old=h.api.load('companyLogo');await tick();h.active={...h.active,userId:'user-B'};h.hooks.records=async()=>[h.row('companyLogo')];const fresh=await h.api.load('companyLogo');hold.reject(new Error('old secret'));assert.equal(await old,null);assert.equal(h.api.snapshot('companyLogo').url,fresh);assert.equal(h.api.snapshot('companyLogo').status,'ready');
});
test('office stamp has an independent private asset and replacement preserves the round seal and logo',async()=>{
 const h=harness(),stamp=await h.api.load('companyStamp'),logo=await h.api.load('companyLogo'),office=await h.api.load('companyOfficeStamp');
 assert.equal(h.api.snapshot('companyOfficeStamp').path,'company-A/owner-A/branding/office.png');assert.notEqual(office,stamp);assert.notEqual(office,logo);
 h.events.length=0;h.rows.set('companyOfficeStamp',[h.row('companyOfficeStamp','office-replacement.png')]);h.api.invalidate('companyOfficeStamp');const replacement=await h.api.load('companyOfficeStamp');
 assert.notEqual(replacement,office);assert.equal(h.api.snapshot('companyStamp').url,stamp);assert.equal(h.api.snapshot('companyLogo').url,logo);assert.deepEqual(h.events.filter(event=>event[0]==='revoke'),[['revoke',office]]);
});
test('missing office stamp stays missing even when a round seal is registered',async()=>{
 const h=harness(),stamp=await h.api.load('companyStamp');h.rows.set('companyOfficeStamp',[]);assert.equal(await h.api.load('companyOfficeStamp'),null);assert.equal(h.api.snapshot('companyOfficeStamp').status,'missing');assert.equal(h.api.snapshot('companyStamp').url,stamp);assert.equal(h.calls.download,1);
});
test('office stamp rejects another company and another branding kind before downloading',async()=>{
 for(const extra of [{company_id:'company-B'},{group_name:'companyStamp'},{group_name:'companyLogo'}]){const h=harness();h.rows.set('companyOfficeStamp',[h.row('companyOfficeStamp','office.png',extra)]);await assert.rejects(h.api.load('companyOfficeStamp'),/ASSET_METADATA_INVALID/);assert.equal(h.calls.download,0);}
});
test('office stamp late decode is revoked after switching company without exposing its image',async()=>{
 const h=harness(),hold=deferred();h.hooks.decode=()=>hold.promise;const pending=h.api.load('companyOfficeStamp');await tick();h.active={...h.active,companyId:'company-B'};hold.resolve();assert.equal(await pending,null);assert.equal(h.api.snapshot('companyOfficeStamp').companyId,'company-B');assert.equal(h.api.snapshot('companyOfficeStamp').url,null);assert.deepEqual(h.events.filter(event=>event[0]==='revoke'),[['revoke','blob:test-1']]);
});
