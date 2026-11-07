import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { onRequest } from '../functions/api/operator.js';
import { getResidentEncryptionKeys } from '../functions/api/customer-intake.js';
import { encryptIdentityCipher, decryptIdentityCipher } from '../functions/_shared/customer-identity-codec.js';

// Exercise the actual worker against the actual PostgreSQL migration/RLS/tenant
// recycle guards. Auth HTTP and S3 bytes are synthetic; no network or live data.
// NODE_PATH=/workspace/work/deps/node_modules node --test tests/operator-api.sql.integration.test.mjs
const require=createRequire(import.meta.url);
const {createOperatorFixture,OP,OP_SESSION}=require('./operator-core.sql.cjs');
const {COMPANY,FOREIGN,OWNER,UPLOADER,OUTSIDER,ADMIN}=require('./recycle-bin-db.cjs');
const ENV={SUPABASE_URL:'https://operator-sql-fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SERVICE_ROLE_KEY:'server-fixture-secret',CUSTOMER_INTAKE_OTP_SECRET:'synthetic-identity-secret-at-least-thirty-two-characters'};
const JWT='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJl';
const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18),BODY=new Uint8Array([137,80,78,71,13,10,26,10,8,6,7,5]);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const scalar=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];

test('actual API + actual SQL copy cross-owner media/customer/costs, move to recoverable archive, restore and revoke access',async t=>{
 const db=await createOperatorFixture(),originalFetch=globalThis.fetch,objects=new Map(),calls=[];
 let actor=OP,session=OP_SESSION;
 t.after(async()=>{globalThis.fetch=originalFetch;await db.close();});
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[OP,'operator@example.invalid']);
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[OP_SESSION,OP]);
 await db.query("insert into snote_operator_private.operators(user_id,active,reason) values($1,true,'Synthetic explicit owner authorization')",[OP]);
 const carId='합성 이관/차량',custom='custom-'+randomUUID(),keys=await getResidentEncryptionKeys(ENV);
 const vehicleCipher=await encryptIdentityCipher(keys,{company:COMPANY,owner:OWNER},carId,'9001011234567');
 const customerCipher=await encryptIdentityCipher(keys,{company:COMPANY,owner:UPLOADER},carId,'9001011234567');
 const signature={type:'strokes',width:400,height:120,strokes:[[[1,2],[3,4]]]},source={id:carId,ownerId:alias(OWNER),model:'합성 검증 차량',plate:'12가3456',year:2026,status:'판매중',buy:100,sell:150,costs:{repair:5},customCosts:{[custom]:12345},customCostLabels:{[custom]:'이관 비용'},identityCipher:vehicleCipher,customerSnapshot:{identityCipher:vehicleCipher,signature}};
 const photo='source-photo',filePath=`${COMPANY}/${UPLOADER}/${encodeURIComponent(carId)}/${photo}.png`;
 await db.query("insert into public.zc_datasets(company_id,dataset,owner_id,payload,revision,updated_by) values($1,'cars',$2,$3::jsonb,7,$2),($1,'covers',$2,$4::jsonb,2,$2)",[COMPANY,OWNER,JSON.stringify([source]),JSON.stringify({[carId]:photo})]);
 await db.query("select set_config('snote.recycle_internal','1',false)");
 await db.query('insert into public.zc_customers(company_id,owner_id,car_id,payload,has_rrn,updated_by) values($1,$2,$3,$4::jsonb,true,$2)',[COMPANY,UPLOADER,carId,JSON.stringify({id:alias(UPLOADER)+':'+carId,ownerId:alias(UPLOADER),carId,name:'합성 고객',identityCipher:customerCipher,signature,signedAt:'2026-11-01T00:00:00Z'})]);
 await db.query('insert into public.zc_media(company_id,owner_id,id,car_id,file_path,original_name,mime_type,file_size,group_name) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[COMPANY,UPLOADER,photo,carId,filePath,'합성.png','image/png',BODY.length,'photos']);
 await db.query("select set_config('snote.recycle_internal','',false)");
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private',$1,$2::jsonb)",[filePath,JSON.stringify({mimetype:'image/png',size:BODY.length})]);objects.set(filePath,BODY.slice());
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input),body=options.body===undefined?undefined:JSON.parse(options.body),service=options.headers.apikey===ENV.SUPABASE_SERVICE_ROLE_KEY;calls.push({path:url.pathname,body,service});assert.equal(url.origin,ENV.SUPABASE_URL);assert.equal(options.redirect,'manual');
  if(url.pathname==='/auth/v1/user')return json({id:actor,email:actor+'@example.invalid'});
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1);assert.match(name,/^snote_operator_[a-z_]+$/);const entries=Object.entries(body);for(const[key]of entries)assert.match(key,/^p_[a-z_]+$/);
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[service?'':actor]);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:service?'service_role':'authenticated',sub:service?undefined:actor,session_id:service?undefined:session,is_anonymous:false})]);await db.exec('set role '+(service?'service_role':'authenticated'));
   try {const data=await scalar(db,'select public.'+name+'('+entries.map(([key],i)=>key+' => $'+(i+1)).join(',')+')',entries.map(([,value])=>value!==null&&typeof value==='object'&&!Array.isArray(value)?JSON.stringify(value):value));return json(data);}
   catch(error){calls.at(-1).sqlError={code:error.code,message:error.message,where:error.where};return json({code:error.code,message:error.message},error.code==='42501'?403:error.code==='40001'?409:400);}
   finally{await db.exec('reset role');}
  }
  if(url.pathname==='/auth/v1/admin/users/'+OWNER){assert(service);assert.equal(options.method,'PUT');await db.query('update auth.users set email=$1 where id=$2',[body.email,OWNER]);return json({id:OWNER,email:body.email});}
  if(url.pathname==='/storage/v1/object/copy'){
   assert(service);assert(objects.has(body.sourceKey));assert(!objects.has(body.destinationKey));objects.set(body.destinationKey,objects.get(body.sourceKey).slice());
   await db.query("insert into storage.objects(bucket_id,name,metadata) values('zc-vehicle-private',$1,$2::jsonb)",[body.destinationKey,JSON.stringify({mimetype:'image/png',size:BODY.length})]);return json({Key:'zc-vehicle-private/'+body.destinationKey});
  }
  if(url.pathname.startsWith('/storage/v1/object/zc-vehicle-private/')){const key=decodeURIComponent(url.pathname.slice('/storage/v1/object/zc-vehicle-private/'.length));assert(service);assert(objects.has(key));return new Response(objects.get(key).slice(),{headers:{'Content-Type':'image/png'}});}
  assert.fail('Unexpected endpoint '+url.pathname);
 };
 async function call(action,body={}){const response=await onRequest({env:ENV,request:new Request('https://s-note.example/api/operator',{method:'POST',headers:{Authorization:'Bearer '+JWT,Origin:'https://s-note.example','Content-Type':'application/json'},body:JSON.stringify({action,...body})})});const data=await response.json();assert.equal(response.status,200,JSON.stringify({action,...data,sqlErrors:calls.filter(c=>c.sqlError).map(c=>({path:c.path,...c.sqlError}))}));return data;}
 let result=await call('vehicle-detail',{companyId:COMPANY,ownerId:OWNER,carId});assert.equal(result.vehicle.buy,1000000);assert.equal(result.vehicle.customCosts[custom],12345);assert.equal(result.media.length,1);assert(!JSON.stringify(result).includes('identityCipher'));assert(!JSON.stringify(result).includes('9001011234567'));
 const copyId=randomUUID(),plan=await call('transfer-plan',{requestId:copyId,mode:'copy',source:{companyId:COMPANY,ownerId:OWNER,carId,revision:result.revision,coversRevision:result.coversRevision},target:{companyId:FOREIGN,ownerId:OUTSIDER}});assert.deepEqual(plan.blockers,[]);
 result=await call('transfer-commit',{requestId:copyId});assert.equal(result.status,'committed');const copiedId=result.target.carId;
 const copied=await scalar(db,"select x from public.zc_datasets d cross join lateral jsonb_array_elements(d.payload)x where d.company_id=$1 and d.owner_id=$2 and d.dataset='cars' and x->>'id'=$3",[FOREIGN,OUTSIDER,copiedId]);assert.equal(copied.ownerId,alias(OUTSIDER));assert.deepEqual(copied.customCosts,source.customCosts);assert.deepEqual(copied.customCostLabels,source.customCostLabels);assert.deepEqual(copied.customerSnapshot.signature,signature);
 const customer=await scalar(db,'select payload from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[FOREIGN,OUTSIDER,copiedId]);assert.equal(await decryptIdentityCipher(keys,{company:FOREIGN,owner:OUTSIDER},copiedId,customer.identityCipher),'9001011234567');assert.equal(await decryptIdentityCipher(keys,{company:FOREIGN,owner:OUTSIDER},copiedId,copied.identityCipher),'9001011234567');assert.equal(customer.carId,copiedId);assert.equal(customer.ownerId,alias(OUTSIDER));assert.deepEqual(customer.signature,signature);
 const newFile=await scalar(db,'select file_path from public.zc_media where company_id=$1 and owner_id=$2 and car_id=$3',[FOREIGN,OUTSIDER,copiedId]);assert.deepEqual(objects.get(newFile),BODY);assert.deepEqual(objects.get(filePath),BODY);
 result=await call('transfer-commit',{requestId:copyId});assert.equal(result.duplicate,true);assert.equal(await scalar(db,"select jsonb_array_length(payload) from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[FOREIGN,OUTSIDER]),1);
 const read=await call('vehicle-detail',{companyId:FOREIGN,ownerId:OUTSIDER,carId:copiedId});result=await call('vehicle-save',{companyId:FOREIGN,ownerId:OUTSIDER,carId:copiedId,expected:read.revision,moneyUnit:'KRW',requestId:randomUUID(),patch:{buy:1234567,customCosts:{[custom]:98765}}});assert.equal(result.vehicle.buy,1234567);assert.equal(result.vehicle.customCosts[custom],98765);
 const original=await call('vehicle-detail',{companyId:COMPANY,ownerId:OWNER,carId}),moveId=randomUUID();await call('transfer-plan',{requestId:moveId,mode:'move',source:{companyId:COMPANY,ownerId:OWNER,carId,revision:original.revision,coversRevision:original.coversRevision},target:{companyId:FOREIGN,ownerId:OUTSIDER}});
 result=await call('transfer-commit',{requestId:moveId});assert.equal(result.status,'committed');assert.equal(result.mode,'move');assert(result.recycleId);assert.equal(await scalar(db,"select jsonb_array_length(payload) from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]),0);assert(objects.has(filePath));
 await call('vehicle-restore',{companyId:COMPANY,entryId:result.recycleId,requestId:randomUUID()});assert.equal(await scalar(db,"select jsonb_array_length(payload) from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]),1);
 const accounts=await call('accounts',{query:{page:1,sort:'displayName',direction:'asc',status:'all'}}),owner=accounts.items.find(row=>row.userId===OWNER);assert(owner);
 const updated=await call('account-save',{userId:OWNER,expected:owner.version,requestId:randomUUID(),patch:{displayName:'합성 새 이름',phone:'01012345678',address:'합성 관리 주소'}});assert.equal(updated.account.displayName,'합성 새 이름');assert.notEqual(updated.account.version,owner.version);
 const auth=await call('auth-update',{userId:OWNER,expected:updated.account.version,requestId:randomUUID(),email:'changed@example.invalid',password:'synthetic-password-not-saved-in-sql'});assert.equal(auth.status,'committed');assert.equal(auth.account.email,'changed@example.invalid');assert.notEqual(auth.account.version,updated.account.version);
 const audit=await scalar(db,'select jsonb_agg(to_jsonb(a))::text from snote_operator_private.audit_log a');assert(!audit.includes('synthetic-password-not-saved-in-sql'));
 const companies=await call('companies',{query:{page:1,sort:'name',direction:'asc',status:'all'}}),company=companies.items.find(row=>row.companyId===COMPANY);assert(company);
 const changed=await call('company-save',{companyId:COMPANY,expected:company.version,requestId:randomUUID(),patch:{name:'합성 변경 상사'}});assert.equal(changed.company.name,'합성 변경 상사');
 const archived=await call('company-state',{companyId:COMPANY,expected:changed.company.version,requestId:randomUUID(),active:false});assert.equal(archived.company.archived,true);
 const restored=await call('company-state',{companyId:COMPANY,expected:archived.company.version,requestId:randomUUID(),active:true});assert.equal(restored.company.archived,false);
 const refreshedOwner=(await call('accounts',{query:{page:1,sort:'displayName',direction:'asc',status:'all'}})).items.find(row=>row.userId===OWNER);
 const accountArchived=await call('account-state',{userId:OWNER,expected:refreshedOwner.version,requestId:randomUUID(),active:false});assert.equal(accountArchived.account.archived,true);assert.equal(await scalar(db,"select jsonb_array_length(payload) from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[COMPANY,OWNER]),1);
 const accountRestored=await call('account-state',{userId:OWNER,expected:accountArchived.account.version,requestId:randomUUID(),active:true});assert.equal(accountRestored.account.archived,false);
 actor=ADMIN;session=randomUUID();await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,ADMIN]);const privilegedBefore=calls.filter(c=>c.service).length;
 const denied=await onRequest({env:ENV,request:new Request('https://s-note.example/api/operator',{method:'POST',headers:{Authorization:'Bearer '+JWT,Origin:'https://s-note.example','Content-Type':'application/json'},body:JSON.stringify({action:'vehicles'})})});assert.equal(denied.status,403);assert.equal(calls.filter(c=>c.service).length,privilegedBefore);
 actor=OP;session=OP_SESSION;await db.query('delete from auth.sessions where id=$1',[OP_SESSION]);const revoked=await onRequest({env:ENV,request:new Request('https://s-note.example/api/operator',{method:'POST',headers:{Authorization:'Bearer '+JWT,'Content-Type':'application/json'},body:JSON.stringify({action:'companies'})})});assert.equal(revoked.status,403);
});
