import test from 'node:test';
import assert from 'node:assert/strict';
import { hkdfSync } from 'node:crypto';
import { onRequest } from '../functions/api/operator.js';
import { getResidentEncryptionKeys } from '../functions/api/customer-intake.js';
import { encryptIdentityCipher, decryptIdentityCipher } from '../functions/_shared/customer-identity-codec.js';

// All Auth, PostgREST and real-object Storage endpoints are synthetic. No real
// account, session, customer, message, file or production database is modified.
const ACTOR='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const OWNER='33333333-3333-4333-8333-333333333333',RECIPIENT='44444444-4444-4444-8444-444444444444';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',DEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc',NEWCAR='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const ENV={SUPABASE_URL:'https://operator-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-server-secret-never-in-browser',CUSTOMER_INTAKE_OTP_SECRET:'fixture-resident-key-at-least-thirty-two-characters'};
const SOURCE={companyId:COMPANY,ownerId:OWNER,carId:'vehicle-source',revision:7,coversRevision:2};
const TARGET={companyId:DEST,ownerId:RECIPIENT,carId:NEWCAR};
const sourcePath=`${COMPANY}/${OWNER}/${SOURCE.carId}/photo-source.png`,targetPath=`${DEST}/${RECIPIENT}/${NEWCAR}/photo-target.png`;
const DATA=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]),RRN='9001011234567';
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const clone=value=>structuredClone(value),alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);
const scopeBody={companyId:COMPANY,ownerId:OWNER,carId:SOURCE.carId};
const planBody=()=>({action:'transfer-plan',source:SOURCE,target:{companyId:DEST,ownerId:RECIPIENT},mode:'copy',requestId:REQUEST});
async function call(body,{headers={},method='POST',env=ENV,raw}={}) {
 const request=new Request('https://s-note.example/api/operator',{method,headers:{Authorization:'Bearer '+JWT,'Content-Type':'application/json',Origin:'https://s-note.example',...headers},...(method==='GET'?{}:{body:raw??JSON.stringify(body)})});
 const response=await onRequest({request,env});
 if(!response.headers.get('Content-Type')?.includes('application/json'))return{response,status:response.status,bytes:new Uint8Array(await response.arrayBuffer())};
 return{response,status:response.status,body:await response.json()};
}
function fixture(t,extra={}) {
 const previous=globalThis.fetch;
 const state={allowed:true,sessionLive:true,calls:[],serviceCalls:[],commits:[],copies:[],audit:[],objects:new Map([[sourcePath,DATA.slice()]]),vehicle:{id:SOURCE.carId,ownerId:alias(OWNER),model:'합성 검증 차량',plate:'12가3456',buy:100,sell:150,costs:{repair:5},customUntouched:{keep:true}},customer:null,...extra};
 const media={source:{id:'photo-source',company_id:COMPANY,owner_id:OWNER,car_id:SOURCE.carId,file_path:sourcePath,group_name:'photos',mime_type:'image/png',file_size:DATA.length,original_name:'검증.png'},target:{id:'photo-target',company_id:DEST,owner_id:RECIPIENT,car_id:NEWCAR,file_path:targetPath,group_name:'photos',mime_type:'image/png',file_size:DATA.length,original_name:'검증.png'}};
 state.job={jobId:REQUEST,status:'prepared',mode:'copy',source:SOURCE,target:TARGET,vehicle:state.vehicle,customer:state.customer,media:[media],blockers:[],cover:'photo-target',...state.job};
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),body=options.body===undefined?undefined:JSON.parse(options.body),service=options.headers.apikey===ENV.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(url.origin,ENV.SUPABASE_URL);assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer '+(service?ENV.SUPABASE_SERVICE_ROLE_KEY:JWT));
  const call={url,body,options,service};state.calls.push(call);if(service){assert(state.calls.some(c=>c.url.pathname.endsWith('/snote_operator_context')),'No service action before operator context');state.serviceCalls.push(call);}
  if(state.override){const response=await state.override(call,state);if(response)return response;}
  if(url.pathname==='/auth/v1/user')return json(state.user||{id:ACTOR,email:'operator@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'},state.authStatus||200);
  if(url.pathname==='/rest/v1/rpc/snote_operator_context'){
   assert.equal(service,false);if(!state.sessionLive)return json({code:'42501',message:'private revoked session details'},403);
   return json({allowed:state.allowed,actorId:ACTOR,email:'operator@example.test',sessionId:SESSION});
  }
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1);
   if(service){assert.equal(body.p_actor,ACTOR);assert.equal(body.p_session,SESSION);}
   if(name.endsWith('_vehicles_list'))return json({items:[{...scopeBody,vehicle:state.vehicle,revision:7,coversRevision:2,hasCustomer:true,customer:{identityCipher:'private',rrn:RRN}}],total:1,page:body.p_query.page||1,pageSize:20});
   if(name==='snote_operator_vehicle_read')return json({...scopeBody,vehicle:state.vehicle,revision:state.revision||7,coversRevision:2,media:[media.source],customer:state.customer});
   if(name==='snote_operator_vehicle_save') {state.saved=body;return json({...scopeBody,vehicle:body.p_vehicle,revision:8,coversRevision:2});}
   if(name==='snote_operator_vehicle_archive'||name==='snote_operator_vehicle_restore')return json({status:name.endsWith('restore')?'restored':'archived',requestId:body.p_request_id});
   if(name==='snote_operator_transfer_prepare'){assert.equal(service,true);assert.deepEqual(body.p_source,SOURCE);assert.equal(body.p_mode,planBody().mode);return json(state.job);}
   if(name==='snote_operator_transfer_get')return json({...state.job,media:state.job.media.map(item=>({...item,copied:state.objects.get(item.target.file_path)?.length===Number(item.target.file_size)}))});
   if(name==='snote_operator_transfer_commit'){
    if(state.casConflict)return json({code:'40001',message:'sensitive original source snapshot'},409);
    assert(state.objects.has(targetPath),'Actual destination bytes must exist before SQL commit');
    state.commits.push(clone(body));state.job.status='committed';state.job.result={status:'committed',target:TARGET};
    if(state.loseCommitReply){state.loseCommitReply=false;throw Error('synthetic lost committed reply');}
    return json(state.job.result);
   }
   if(name==='snote_operator_transfer_abort'){
    if(state.job.status==='committed')return json({status:'committed',cleanupPaths:[]});
    state.job.status='aborted';return json({status:'aborted',cleanupPaths:[targetPath]});
   }
   if(name==='snote_operator_auth_prepare'){state.authPlan=body;return json({status:state.authCommitted?'committed':'prepared',userId:body.p_user});}
   if(name==='snote_operator_auth_finalize'){state.audit.push(body);state.authCommitted=body.p_success;return json({status:body.p_success?'committed':'failed'});}
   if(['snote_operator_accounts_list','snote_operator_companies_list','snote_operator_access_list'].includes(name))return json({items:[],page:1,pageSize:20,total:0});
   if(['snote_operator_account_save','snote_operator_account_state','snote_operator_company_save','snote_operator_company_state'].includes(name)){state.audit.push(body);return json({status:'saved'});}
   assert.fail('Unexpected RPC '+name);
  }
  if(url.pathname==='/auth/v1/admin/users/'+OWNER){assert.equal(service,true);assert.equal(options.method,'PUT');state.adminPatch=body;return json({id:OWNER,email:body.email||'original@example.test',user_metadata:{private:'must never leave server'}});}
  if(url.pathname==='/storage/v1/object/copy'){
   const planned=state.job.media.find(item=>item.source.file_path===body.sourceKey);
   assert(planned,'Storage copy must follow an immutable database media plan');
   assert.equal(service,true);assert.deepEqual(body,{bucketId:'zc-vehicle-private',sourceKey:planned.source.file_path,destinationKey:planned.target.file_path});
   if(state.copyFailure)return json({error:'synthetic unavailable'},503);
   if(state.objects.has(body.destinationKey))return json({statusCode:'409',error:'Duplicate'},400);
   state.objects.set(body.destinationKey,state.objects.get(body.sourceKey).slice());state.copies.push(body);
   if(state.loseCopyReply){state.loseCopyReply=false;throw Error('synthetic copy reply loss');}
   return json({Key:'zc-vehicle-private/'+targetPath});
  }
  if(url.pathname==='/storage/v1/object/zc-vehicle-private'&&options.method==='DELETE'){for(const path of body.prefixes)state.objects.delete(path);return json([]);}
  if(url.pathname.startsWith('/storage/v1/object/zc-vehicle-private/')){
   const path=decodeURIComponent(url.pathname.slice('/storage/v1/object/zc-vehicle-private/'.length));
   const data=state.objects.get(path);return data?new Response(data.slice(),{headers:{'Content-Type':'image/png'}}):json({error:'not found'},404);
  }
  assert.fail('Unexpected endpoint '+url.pathname);
 };
 t.after(()=>{globalThis.fetch=previous;});return state;
}

test('operator gate requires verified Auth AND the strict live-session allowlist before any service key use',async t=>{
 for(const mutation of [{allowed:false,user:{id:ACTOR,user_metadata:{operator:true,role:'admin'}}},{sessionLive:false},{authStatus:401,user:{error:'expired'}},{user:{id:ACTOR,is_anonymous:true}}]){
  const s=fixture(t,mutation),r=await call({action:'accounts'});assert([401,403].includes(r.status));assert.equal(s.serviceCalls.length,0);assert(!JSON.stringify(r.body).includes('private revoked'));
 }
});
test('same-origin POST, bearer shape, request type and configuration fail closed without privileged traffic',async t=>{
 const s=fixture(t);
 for(const options of [{method:'GET'},{headers:{Origin:'https://foreign.invalid'}},{headers:{Authorization:''}},{headers:{'Sec-Fetch-Site':'cross-site'}},{headers:{'Content-Type':'text/plain'}},{raw:'{broken'},{env:{...ENV,SUPABASE_SERVICE_ROLE_KEY:''}}]){const r=await call({action:'context'},options);assert(r.status>=400);}
 assert.equal(s.serviceCalls.length,0);assert.equal(s.calls.length,0);
});
test('context and list preserve pagination and KRW while suppressing customer, encrypted and plaintext resident identifiers',async t=>{
 const s=fixture(t,{vehicle:{id:SOURCE.carId,model:'합성 차량',buy:100,costs:{repair:5},identityCipher:'smi1.private',incomeSettlement:{privateCipher:'isi1.private'},customerSnapshot:{name:'private'},extra:'확인 '+RRN}});
 let r=await call({action:'context'});assert.equal(r.body.allowed,true);assert.equal(r.body.actorId,ACTOR);assert.match(r.response.headers.get('Cache-Control'),/no-store.*private/);
 r=await call({action:'vehicles',query:{query:'합성',page:2,sort:'model',direction:'asc'}});assert.equal(r.status,200);assert.equal(r.body.page,2);assert.equal(r.body.pageSize,20);assert.equal(r.body.items[0].vehicle.buy,1000000);assert.equal(r.body.items[0].vehicle.costs.repair,50000);
 const text=JSON.stringify(r.body);for(const hidden of [RRN,'smi1.private','isi1.private','customerSnapshot',ENV.SUPABASE_SERVICE_ROLE_KEY])assert(!text.includes(hidden),hidden);
 assert.equal(s.serviceCalls.length,0,'List RPC uses the authenticated operator JWT');
});
test('vehicle editing merges only validated KRW changes and preserves private source, sibling costs and classification',async t=>{
 const original={id:SOURCE.carId,ownerId:alias(OWNER),model:'원래 차명',plate:'12가3456',buy:100,sell:150,costs:{repair:5,polish:2},identityCipher:'smi1.untouched',taxonomyCatalogRef:{researchId:'original'},customerSnapshot:{signature:{type:'source'}}};
 const s=fixture(t,{vehicle:original});const r=await call({action:'vehicle-save',...scopeBody,expected:7,patch:{buy:1234567,costs:{polish:10000}},moneyUnit:'KRW',requestId:REQUEST});
 assert.equal(r.status,200);const saved=s.saved.p_vehicle;assert.equal(saved.buy,1234567);assert.equal(saved.sell,1500000);assert.equal(saved.costs.repair,50000);assert.equal(saved.costs.polish,10000);assert.equal(saved.moneyUnit,'KRW');assert.deepEqual(saved.taxonomyCatalogRef,original.taxonomyCatalogRef);assert.deepEqual(saved.customerSnapshot,original.customerSnapshot);assert.equal(saved.identityCipher,original.identityCipher);
 assert(!JSON.stringify(r.body).includes('untouched'));assert(!JSON.stringify(r.body).includes('customerSnapshot'));
});
test('invalid owner/cipher/float patches and stale revisions never invoke the privileged write RPC',async t=>{
 for(const patch of [{ownerId:RECIPIENT},{identityCipher:'replace'},{buy:1.5},{costs:{private:1}},{repairItems:[{memo:'x',amount:-1}]},{year:9999}]){
  const s=fixture(t),r=await call({action:'vehicle-save',...scopeBody,expected:7,patch,moneyUnit:'KRW',requestId:REQUEST});assert.equal(r.status,400);assert.equal(s.saved,undefined);
 }
 const s=fixture(t,{revision:8}),r=await call({action:'vehicle-save',...scopeBody,expected:7,patch:{model:'변경'},moneyUnit:'KRW',requestId:REQUEST});assert.equal(r.status,409);assert.equal(s.saved,undefined);
});
test('custom cost values and labels remain KRW on legacy vehicles and accept only bounded stable IDs',async t=>{
 const id='custom-'+REQUEST,s=fixture(t,{vehicle:{id:SOURCE.carId,model:'비용 검증',buy:100,customCosts:{[id]:12345},customCostLabels:{[id]:'별도 비용'}}});
 let r=await call({action:'vehicle-detail',...scopeBody});assert.equal(r.body.vehicle.buy,1000000);assert.equal(r.body.vehicle.customCosts[id],12345);assert.equal(r.body.vehicle.customCostLabels[id],'별도 비용');
 r=await call({action:'vehicle-save',...scopeBody,expected:7,patch:{customCosts:{[id]:45678},customCostLabels:{[id]:'추가 비용'}},moneyUnit:'KRW',requestId:REQUEST});assert.equal(r.status,200);assert.equal(s.saved.p_vehicle.customCosts[id],45678);assert.equal(s.saved.p_vehicle.customCostLabels[id],'추가 비용');
 for(const patch of [{customCosts:{bad:1}},{customCosts:{[id]:1.5}},{customCostLabels:{[id]:'길'.repeat(25)}}]){r=await call({action:'vehicle-save',...scopeBody,expected:7,patch,moneyUnit:'KRW',requestId:REQUEST});assert.equal(r.status,400);}
});
test('editing one custom cost retains orphan labels/amounts from previous owners within the 128-entry vehicle limit',async t=>{
 const ids=Array.from({length:64},(_,i)=>'custom-00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
 const s=fixture(t,{vehicle:{id:SOURCE.carId,model:'여러 소유자 비용',customCosts:Object.fromEntries(ids.map((id,i)=>[id,i+1000])),customCostLabels:Object.fromEntries(ids.map((id,i)=>[id,'기존 비용 '+i]))}});
 const r=await call({action:'vehicle-save',...scopeBody,expected:7,patch:{customCosts:{[ids[0]]:9999},customCostLabels:{[ids[0]]:'변경 비용'}},moneyUnit:'KRW',requestId:REQUEST});assert.equal(r.status,200);assert.equal(Object.keys(s.saved.p_vehicle.customCosts).length,64);assert.equal(s.saved.p_vehicle.customCosts[ids[63]],1063);assert.equal(s.saved.p_vehicle.customCostLabels[ids[63]],'기존 비용 63');assert.equal(s.saved.p_vehicle.customCosts[ids[0]],9999);
 const tooMany=Object.fromEntries(Array.from({length:129},(_,i)=>['custom-00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),1]));const denied=await call({action:'vehicle-save',...scopeBody,expected:7,patch:{customCosts:tooMany},moneyUnit:'KRW',requestId:REQUEST});assert.equal(denied.status,400);
});
test('media reads are scoped to exact recorded objects and return binary contents without a service key or public URL',async t=>{
 const s=fixture(t);const r=await call({action:'media-file',...scopeBody,mediaId:'photo-source'});assert.equal(r.status,200);assert.deepEqual(r.bytes,DATA);assert.equal(r.response.headers.get('Content-Type'),'image/png');assert.match(r.response.headers.get('Cache-Control'),/private/);
 const bad=await call({action:'media-file',...scopeBody,mediaId:'arbitrary-path'});assert.equal(bad.status,400);assert(s.calls.every(c=>c.url.origin===ENV.SUPABASE_URL));
});
test('accountant-uploaded documents and encoded vehicle IDs keep their exact object keys during view and transfer',async t=>{
 const carId='합성 차량/1',path=`${COMPANY}/${ACTOR}/${encodeURIComponent(carId)}/document.png`,s=fixture(t);
 const media={...s.job.media[0].source,owner_id:ACTOR,car_id:carId,file_path:path,group_name:'registration'};
 s.objects.set(path,DATA.slice());s.job.source={...SOURCE,carId};s.job.vehicle={...s.vehicle,id:carId};s.job.media[0].source=media;
 s.override=call=>call.url.pathname.endsWith('/snote_operator_vehicle_read')?json({vehicle:s.job.vehicle,revision:7,media:[media]}):null;
 let r=await call({action:'media-file',...scopeBody,carId,mediaId:media.id});assert.equal(r.status,200);assert.deepEqual(r.bytes,DATA);
 r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);assert.deepEqual(s.objects.get(targetPath),DATA);assert(s.objects.has(path));assert.equal(s.copies[0].sourceKey,path);
});
test('transfer plan exposes counts/policy only; actual Storage bytes are copied before atomic commit and retries are idempotent',async t=>{
 const s=fixture(t,{customer:{company_id:COMPANY,owner_id:OWNER,car_id:SOURCE.carId,payload:{name:'private customer',signature:{points:[[1,2],[3,4]]}}}});
 let r=await call(planBody());assert.equal(r.status,200);assert.equal(r.body.mode,'copy');assert.equal(r.body.mediaCount,1);assert.equal(r.body.hasCustomer,true);assert.equal(r.body.policy.intakeLinks,false);assert(!JSON.stringify(r.body).includes('private customer'));assert(!JSON.stringify(r.body).includes(sourcePath));
 r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);assert.equal(r.body.status,'committed');assert.deepEqual(s.objects.get(targetPath),DATA);assert.deepEqual(s.objects.get(sourcePath),DATA);assert.equal(s.copies.length,1);assert.equal(s.commits.length,1);
 r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.body.duplicate,true);assert.equal(s.copies.length,1);assert.equal(s.commits.length,1);
});
test('lost copy acknowledgement verifies actual bytes; an unrelated destination object never becomes a committed transfer',async t=>{
 let s=fixture(t,{loseCopyReply:true});let r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);assert.equal(s.commits.length,1);assert(s.calls.filter(c=>c.options.method==='GET'&&c.url.pathname.startsWith('/storage/')).length===2);
 s=fixture(t);s.objects.set(targetPath,new Uint8Array([9,9,9]));r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,409);assert.equal(s.commits.length,0);assert.deepEqual(s.objects.get(sourcePath),DATA);
});
test('lost SQL acknowledgement retains committed files, and retry resolves the committed request without duplication',async t=>{
 const s=fixture(t,{loseCommitReply:true});let r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,502);assert(s.objects.has(targetPath));assert.equal(s.commits.length,1);
 r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);assert.equal(r.body.duplicate,true);assert.equal(s.commits.length,1);assert.equal(s.copies.length,1);
 r=await call({action:'transfer-cancel',requestId:REQUEST});assert.equal(r.body.status,'committed');assert(s.objects.has(targetPath));
});
test('large transfers continue in bounded batches, skip durable copied objects and commit only after every real file exists',async t=>{
 const s=fixture(t),base=clone(s.job.media[0]);
 s.job.media=Array.from({length:20},(_,i)=>({source:{...base.source,id:'source-'+i,file_path:sourcePath.replace('photo-source','source-'+i)},target:{...base.target,id:'target-'+i,file_path:targetPath.replace('photo-target','target-'+i)}}));
 for(const item of s.job.media)s.objects.set(item.source.file_path,DATA.slice());
 // The synthetic commit checks every staged destination, not a metadata count.
 s.override=(entry,state)=>{if(entry.url.pathname.endsWith('/snote_operator_transfer_commit')){assert(state.job.media.every(item=>state.objects.has(item.target.file_path)));state.commits.push(entry.body);state.job.status='committed';return json({status:'committed',target:TARGET});}};
 let responses=0,remaining=20;
 for(;;){const before=s.calls.length,r=await call({action:'transfer-commit',requestId:REQUEST});responses++;assert.equal(r.status,200);assert(s.calls.length-before<=50,'Each request stays below the Worker subrequest limit');if(r.body.status==='committed')break;assert.equal(r.body.continue,true);assert(r.body.remaining<remaining);remaining=r.body.remaining;assert.equal(s.commits.length,0);}
 assert.equal(responses,4);assert.equal(s.copies.length,20);assert.equal(s.commits.length,1);assert(s.job.media.every(item=>s.objects.has(item.source.file_path)));
});
test('CAS rejection preserves the source and leaves only recoverable staging; explicit cancel removes only staged destination',async t=>{
 const s=fixture(t,{casConflict:true});let r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,409);assert.equal(s.commits.length,0);assert(s.objects.has(sourcePath));assert(s.objects.has(targetPath));
 r=await call({action:'transfer-cancel',requestId:REQUEST});assert.equal(r.status,200);assert.equal(r.body.status,'aborted');assert.equal(r.body.cleanupPending,false);assert(!s.objects.has(targetPath));assert(s.objects.has(sourcePath));
});
test('a late Storage copy after another window cancels is cleaned without publishing or deleting the source',async t=>{
 const s=fixture(t,{override(entry,state){if(entry.url.pathname==='/storage/v1/object/copy'){state.job.status='aborted';state.objects.set(targetPath,DATA.slice());return json({Key:targetPath});}}});
 const r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,409);assert.equal(s.commits.length,0);assert(s.objects.has(sourcePath));assert(!s.objects.has(targetPath));
});
test('a successful-looking Storage response without a durable object cannot loop or reach SQL commit',async t=>{
 const s=fixture(t,{override(entry){if(entry.url.pathname==='/storage/v1/object/copy')return json({Key:targetPath});}});
 const r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,502);assert.equal(s.commits.length,0);assert.equal(s.calls.filter(c=>c.url.pathname.endsWith('/snote_operator_transfer_commit')).length,0);assert(!s.objects.has(targetPath));
});
test('cancel treats only an exactly absent scoped job as clean, preserving other validation and permission errors',async t=>{
 let s=fixture(t,{override(entry){if(entry.url.pathname.endsWith('/snote_operator_transfer_abort'))return json({code:'22023',message:'TRANSFER_NOT_FOUND'},400);}});
 let r=await call({action:'transfer-cancel',requestId:REQUEST});assert.equal(r.status,200);assert.equal(r.body.missing,true);assert.equal(r.body.status,'aborted');assert.equal(r.body.cleanupPending,false);assert.equal(s.calls.filter(c=>c.url.pathname.startsWith('/storage/')).length,0);
 s=fixture(t,{override(entry){if(entry.url.pathname.endsWith('/snote_operator_transfer_abort'))return json({code:'22023',message:'INVALID_TRANSFER'},400);}});r=await call({action:'transfer-cancel',requestId:REQUEST});assert.equal(r.status,400);assert.equal(r.body.ok,false);
 s=fixture(t,{allowed:false});r=await call({action:'transfer-cancel',requestId:REQUEST});assert.equal(r.status,403);assert.equal(r.body.ok,false);assert.equal(s.serviceCalls.length,0);
});
test('blocked transfer, unsafe paths and revoked sessions cannot reach Storage copy or database commit',async t=>{
 let s=fixture(t,{job:{blockers:['TARGET_RRN_KEY_REQUIRED']}});let r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,409);assert.equal(s.copies.length,0);assert.equal(s.commits.length,0);
 s=fixture(t);s.job.media[0].target.file_path=`${DEST}/${RECIPIENT}/${NEWCAR}/../escape.png`;r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,502);assert.equal(s.copies.length,0);
 s=fixture(t,{override(call,state){if(call.url.pathname.endsWith('/snote_operator_transfer_get')){state.sessionLive=false;return json(state.job);}}});r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,403);assert.equal(s.copies.length,0);assert.equal(s.commits.length,0);
});
async function incomeCipher(raw,scope){
 const resident=await getResidentEncryptionKeys(ENV),key=Buffer.from(hkdfSync('sha256',resident.key,Buffer.from('snote-income-settlement:identity:v1:hkdf-salt'),Buffer.from('snote-income-settlement:broker-identity:v1:aes-256-gcm'),32));
 const iv=crypto.getRandomValues(new Uint8Array(12)),aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const aad=new TextEncoder().encode('snote-income-settlement:broker-identity:v1:'+JSON.stringify([scope.companyId,scope.ownerId,scope.carId]));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},aes,new TextEncoder().encode(raw));return'isi1.'+Buffer.from(iv).toString('hex')+'.'+Buffer.from(encrypted).toString('hex');
}
async function decryptIncome(envelope,scope){
 const resident=await getResidentEncryptionKeys(ENV),raw=Buffer.from(hkdfSync('sha256',resident.key,Buffer.from('snote-income-settlement:identity:v1:hkdf-salt'),Buffer.from('snote-income-settlement:broker-identity:v1:aes-256-gcm'),32));
 const[,iv,bytes]=envelope.split('.'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
 const aad=new TextEncoder().encode('snote-income-settlement:broker-identity:v1:'+JSON.stringify([scope.companyId,scope.ownerId,scope.carId]));
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'hex'),additionalData:aad,tagLength:128},key,Buffer.from(bytes,'hex')));
}
test('canonical customer and income identities are re-encrypted for destination AAD while original signatures remain intact',async t=>{
 const keys=await getResidentEncryptionKeys(ENV),original=await encryptIdentityCipher(keys,{company:COMPANY,owner:OWNER},SOURCE.carId,RRN),income=await incomeCipher(RRN,SOURCE);
 const signature={type:'strokes',width:400,height:120,strokes:[[[1,2],[3,4]]]},s=fixture(t,{vehicle:{id:SOURCE.carId,ownerId:alias(OWNER),identityCipher:original,customerSnapshot:{identityCipher:original},incomeSettlement:{privateCipher:income}},customer:{company_id:COMPANY,owner_id:OWNER,car_id:SOURCE.carId,payload:{name:'합성 고객',identityCipher:original,signature,signedAt:'2026-11-01T00:00:00Z'}}});
 const r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);const saved=s.commits[0];assert.notEqual(saved.p_vehicle.identityCipher,original);assert.notEqual(saved.p_vehicle.incomeSettlement.privateCipher,income);
 assert.equal(await decryptIdentityCipher(keys,{company:DEST,owner:RECIPIENT},NEWCAR,saved.p_customer.identityCipher),RRN);assert.equal(await decryptIncome(saved.p_vehicle.incomeSettlement.privateCipher,TARGET),RRN);
 await assert.rejects(decryptIdentityCipher(keys,{company:COMPANY,owner:OWNER},SOURCE.carId,saved.p_customer.identityCipher));
 assert.deepEqual(saved.p_customer.signature,signature);assert.equal(saved.p_customer.signedAt,'2026-11-01T00:00:00Z');assert(!JSON.stringify(r.body).includes(RRN));assert(!JSON.stringify(r.body).includes('identityCipher'));
});
test('a canonical customer owned by another dealer uses that row owner for source AAD',async t=>{
 const keys=await getResidentEncryptionKeys(ENV),cipher=await encryptIdentityCipher(keys,{company:COMPANY,owner:ACTOR},SOURCE.carId,RRN);
 const s=fixture(t,{customer:{company_id:COMPANY,owner_id:ACTOR,car_id:SOURCE.carId,payload:{identityCipher:cipher}}});const r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,200);assert.equal(await decryptIdentityCipher(keys,{company:DEST,owner:RECIPIENT},NEWCAR,s.commits[0].p_customer.identityCipher),RRN);
});
test('missing encryption configuration never copies files, drops an identity or claims a completed transfer',async t=>{
 const keys=await getResidentEncryptionKeys(ENV),cipher=await encryptIdentityCipher(keys,{company:COMPANY,owner:OWNER},SOURCE.carId,RRN),s=fixture(t,{vehicle:{id:SOURCE.carId,identityCipher:cipher}});
 const r=await call({action:'transfer-commit',requestId:REQUEST},{env:{...ENV,CUSTOMER_INTAKE_OTP_SECRET:''}});assert.equal(r.status,503);assert.equal(r.body.code,'TRANSFER_ENCRYPTION_REQUIRED');assert.equal(s.copies.length,0);assert.equal(s.commits.length,0);assert(s.objects.has(sourcePath));
});
test('unknown legacy identity envelopes cannot silently copy an unusable private identifier',async t=>{
 for(const fields of [{identityCipher:'unrecognized-envelope'},{privateCipher:'unrecognized-envelope'},{rrnCipher:{iv:'old-browser-key',data:'encrypted'}},{snapshot:{rrn_cipher:'legacy'}}]){
  const s=fixture(t,{vehicle:{id:SOURCE.carId,...fields}}),r=await call({action:'transfer-commit',requestId:REQUEST});assert.equal(r.status,503);assert.equal(r.body.code,'TRANSFER_ENCRYPTION_REQUIRED');assert.equal(s.copies.length,0);assert.equal(s.commits.length,0);assert(s.objects.has(sourcePath));
 }
});
test('Auth changes call Admin API only after a durable scoped plan, never store a password in SQL/audit, and require final ACK',async t=>{
 const s=fixture(t),password='synthetic-password-42',r=await call({action:'auth-update',userId:OWNER,expected:'expected-account-fingerprint',requestId:REQUEST,email:'NEW@example.test',password});
 assert.equal(r.status,200);assert.deepEqual(s.adminPatch,{email:'new@example.test',password});assert.deepEqual(s.authPlan.p_fields,['email','password']);assert.match(s.authPlan.p_fingerprint,/^[a-f0-9]{64}$/);assert.equal(s.authPlan.p_email,'new@example.test');
 const sql=JSON.stringify(s.calls.filter(c=>c.url.pathname.startsWith('/rest/')).map(c=>c.body));assert(!sql.includes(password));assert(!JSON.stringify(r.body).includes(password));assert(!JSON.stringify(r.body).includes(ENV.SUPABASE_SERVICE_ROLE_KEY));assert.equal(s.audit[0].p_success,true);assert.deepEqual(s.audit[0].p_auth_result,{id:OWNER,email:'new@example.test'});
 const again=await call({action:'auth-update',userId:OWNER,expected:'expected-account-fingerprint',requestId:REQUEST,email:'NEW@example.test',password});assert.equal(again.body.duplicate,true);assert.equal(s.calls.filter(c=>c.url.pathname.startsWith('/auth/v1/admin')).length,1);
});
test('revocation between Auth planning and privileged mutation prevents the Admin API call',async t=>{
 const s=fixture(t,{override(call,state){if(call.url.pathname.endsWith('/snote_operator_auth_prepare')){state.sessionLive=false;return json({status:'prepared',userId:OWNER});}}});const r=await call({action:'auth-update',userId:OWNER,expected:'expected',requestId:REQUEST,password:'synthetic-password-42'});assert.equal(r.status,403);assert.equal(s.adminPatch,undefined);
});
test('account/company/archive endpoints retain their scoped CAS/request IDs and reject passwords outside Admin Auth',async t=>{
 const s=fixture(t);
 for(const body of [
  {action:'account-save',userId:OWNER,expected:'account-version',patch:{displayName:'합성 이름',companyId:COMPANY,role:'dealer'}},
  {action:'account-state',userId:OWNER,expected:'account-version',active:false},
  {action:'company-save',companyId:COMPANY,expected:'company-version',patch:{name:'합성 상사',address:'합성 주소'}},
  {action:'company-state',companyId:COMPANY,expected:'company-version',active:false},
  {action:'vehicle-archive',...scopeBody,expected:7,expectedCovers:2},
  {action:'vehicle-restore',companyId:COMPANY,entryId:NEWCAR}
 ]){const r=await call({...body,requestId:REQUEST});assert.equal(r.status,200);const saved=s.calls.at(-1).body;assert.equal(saved.p_request_id,REQUEST);assert.equal(s.calls.at(-1).service,false,'Ordinary checked operator writes use the actor JWT');}
 const before=s.calls.length;let r=await call({action:'account-save',userId:OWNER,expected:'version',patch:{password:'never-forward-this-password'},requestId:REQUEST});assert.equal(r.status,400);assert.equal(s.calls.length,before+2);assert(!JSON.stringify(s.calls.map(c=>c.body)).includes('never-forward-this-password'));
 r=await call({action:'company-save',companyId:COMPANY,expected:'version',patch:{serviceRoleKey:'must-not-forward'},requestId:REQUEST});assert.equal(r.status,400);assert(!JSON.stringify(s.calls.map(c=>c.body)).includes('must-not-forward'));
});
test('internal SQL failures never become user validation claims or expose query details',async t=>{
 fixture(t,{override(entry){if(entry.url.pathname.endsWith('/snote_operator_vehicles_list'))return json({code:'42702',message:'sensitive internal SQL column details'},400);}});
 const r=await call({action:'vehicles'});assert.equal(r.status,502);assert.equal(r.body.code,'NETWORK');assert(!JSON.stringify(r.body).includes('42702'));assert(!JSON.stringify(r.body).includes('sensitive'));
});

test('support inbox, message history, read receipts and replies retain the operator JWT and exact text without service traffic',async t=>{
 const seen=[],text='첫 줄\n다음 줄 <script>문자 그대로</script>';
 const s=fixture(t,{override(entry){if(entry.url.pathname.includes('/snote_operator_support_')){seen.push(entry);return json({unreadTotal:3,items:[],messages:[],message:{text}});}}});
 const cases=[
  [{action:'support-unread'},'support_unread',{}],
  [{action:'support-threads',query:{page:2,status:'unread',query:'합성'}},'support_threads',{p_query:{page:2,status:'unread',query:'합성'}}],
  [{action:'support-thread',conversationId:REQUEST,limit:50,before:17},'support_messages',{p_conversation_id:REQUEST,p_limit:50,p_before:17}],
  [{action:'support-read',conversationId:REQUEST,messageIds:[NEWCAR]},'support_read',{p_conversation_id:REQUEST,p_message_ids:[NEWCAR]}],
  [{action:'support-reply',conversationId:REQUEST,requestId:NEWCAR,text:' '+text+' '},'support_reply',{p_conversation_id:REQUEST,p_text:text,p_request_id:NEWCAR}]
 ];
 for(const [body,name,args]of cases){const r=await call(body);assert.equal(r.status,200);assert.equal(r.body.message.text,text);const entry=seen.at(-1);assert.equal(entry.url.pathname,'/rest/v1/rpc/snote_operator_'+name);assert.deepEqual(entry.body,args);assert.equal(entry.service,false);}
 assert.equal(s.serviceCalls.length,0);
});
test('support requests reject malformed read sets, unbounded paging and injected identities before any support RPC',async t=>{
 const s=fixture(t),invalid=[
  {action:'support-unread',userId:OWNER},
  {action:'support-threads',query:{page:0}},
  {action:'support-threads',query:{status:'other'}},
  {action:'support-thread',conversationId:REQUEST,limit:101},
  {action:'support-thread',conversationId:REQUEST,before:-1},
  {action:'support-read',conversationId:REQUEST,messageIds:[NEWCAR,NEWCAR]},
  {action:'support-read',conversationId:REQUEST,messageIds:['not-a-uuid']},
  {action:'support-reply',conversationId:REQUEST,requestId:NEWCAR,text:'\u0000'},
  {action:'support-reply',conversationId:REQUEST,requestId:NEWCAR,text:'x'.repeat(2001)},
  {action:'support-reply',conversationId:REQUEST,requestId:NEWCAR,text:'valid',actorId:OWNER}
 ];
 for(const body of invalid){const r=await call(body);assert.equal(r.status,400);assert.equal(r.body.code,'INVALID_REQUEST');}
 assert.equal(s.calls.filter(c=>c.url.pathname.includes('/snote_operator_support_')).length,0);assert.equal(s.serviceCalls.length,0);
});
test('a tenant administrator cannot read support messages or unread counts without platform authority',async t=>{
 const s=fixture(t,{allowed:false});for(const action of['support-unread','support-thread','support-reply']){const r=await call({action,conversationId:REQUEST,requestId:NEWCAR,text:'합성'});assert.equal(r.status,403);}
 assert.equal(s.calls.filter(c=>c.url.pathname.includes('/snote_operator_support_')).length,0);assert.equal(s.serviceCalls.length,0);
});
