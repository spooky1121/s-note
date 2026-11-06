'use strict';
// Isolated browser + actual API/AES + PostgreSQL JSON regression; synthetic identities only.
// Every browser/API outbound request is intercepted. No production Supabase, SMS, or migration access.
// Install dependencies outside this static Pages checkout (Node 22+):
//   npm install --prefix /tmp/snote-browser-tests --no-save --no-audit --no-fund @electric-sql/pglite@0.5.14 playwright
//   NODE_PATH=/tmp/snote-browser-tests/node_modules CHROMIUM_PATH=/usr/bin/chromium node tests/customer-identity.browser.cjs
// Omit CHROMIUM_PATH to use the browser installed by: playwright install chromium
// The local REST adapter enforces own actor/company scope; production RLS is not exercised.

const fs=require('node:fs');const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const path=require('node:path');const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://s-note.example';
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function bootstrap(){
 const {createFixture}=require('./recycle-bin-db.cjs');const db=await createFixture();
 await db.query('update public.zc_companies set name=case when id=$1 then $2 else $3 end,rrn_enabled=false',[COMPANY,'검증용 상사','다른 검증용 상사']);
 await db.query('update public.zc_members set company_id=$1 where user_id=$2',[OTHER_COMPANY,OTHER]);
 const cars=Array.from({length:3},(_,i)=>({id:'test-car-'+(i+1),ownerId:'cld_'+ACTOR.replaceAll('-','').slice(0,18),model:'검증용 차량 '+(i+1),plate:'000가'+String(i+1).padStart(4,'0'),year:2026,km:'10,000',color:'흰색',sell:1200,status:'판매중'}));
 await db.query('insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision) values($1,$2,$3,$4::jsonb,1)',[COMPANY,ACTOR,'cars',JSON.stringify(cars)]);
 await db.query("insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision) values($1,$2,'covers','{}',1)",[COMPANY,ACTOR]);
 await db.query('insert into public.zc_datasets(company_id,owner_id,dataset,payload,revision) values($1,$2,$3,$4::jsonb,1)',[OTHER_COMPANY,OTHER,'cars',JSON.stringify([{...cars[0],ownerId:'cld_'+OTHER.replaceAll('-','').slice(0,18)}])]);
 const file=fs.readdirSync(ROOT+'/supabase/migrations').filter(name=>name.endsWith('_scoped_recycle_bin.sql')).sort().at(-1);assert(file);await db.exec(fs.readFileSync(ROOT+'/supabase/migrations/'+file,'utf8'));
 return db;
}
async function runFixtureRpc(database,role,actor,name,args={}){
 assert(['authenticated','service_role','anon'].includes(role));assert(/^[a-z_][a-z0-9_]*$/.test(name));const keys=Object.keys(args);assert(keys.every(key=>/^[a-z_][a-z0-9_]*$/.test(key)));
 return database.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor||'']);return(await tx.query('select public.'+name+'('+keys.map((key,i)=>key+' => $'+(i+1)).join(',')+') result',keys.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]))).rows[0].result;});
}
// Synthetic JWTs carry the same actor as getSession; signatures are never sent to a real service.
const tokenFor=id=>Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')+'.fixture-signature';
const JWT=tokenFor(ACTOR),OTHER_JWT=tokenFor(OTHER);
const RAW13='0001013000000',FORMATTED13='000101-3000000',RAW10='9876543210';
const env={SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-public-key',CUSTOMER_INTAKE_OTP_SECRET:'test-identity-key-source-'.repeat(3)};
const counters={writes:[],identity:[],legacy:[],pinned:[],external:[],errors:[],casMisses:0};
let db,api,browser,source,failNextWrite=false,holdWrite=null,holdIdentity=null,holdRead=null;
const originalFetch=global.fetch;
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})}
function equality(value){return typeof value==='string'&&value.startsWith('eq.')?value.slice(3):undefined}
function ids(value){if(value?.startsWith('eq.'))return [value.slice(3)];if(value?.startsWith('in.('))return JSON.parse('['+value.slice(4,-1)+']');return null}
function rawInPayload(payload){const copy=structuredClone(payload);delete copy.identityCipher;return [RAW13,FORMATTED13,RAW10,'987-65-43210'].some(value=>JSON.stringify(copy).includes(value))}
async function serverFetch(url,options={}){
 const u=new URL(url);assert.equal(u.origin,env.SUPABASE_URL,'Unexpected actual network blocked');
 const headers=new Headers(options.headers),token=headers.get('Authorization');const actor=token==='Bearer '+JWT?ACTOR:token==='Bearer '+OTHER_JWT?OTHER:null;
 if(!actor)return response({message:'test auth required'},401);
 assert.equal(headers.get('apikey'),env.SUPABASE_PUBLISHABLE_KEY);
 if(u.pathname==='/auth/v1/user')return response({id:actor,email:'test@example.invalid'});
 const members=(await db.query('select * from public.zc_members where user_id=$1 and active=true',[actor])).rows;
 if(u.pathname==='/rest/v1/zc_members')return response(members.filter(m=>!equality(u.searchParams.get('user_id'))||m.user_id===equality(u.searchParams.get('user_id'))));
 const member=members[0];if(!member)return response([]);
 const company=equality(u.searchParams.get('company_id')),owner=equality(u.searchParams.get('owner_id'));
 if(company!==member.company_id||owner!==actor)return response([]);
 if(u.pathname==='/rest/v1/zc_datasets')return response((await db.query("select payload from public.zc_datasets where company_id=$1 and owner_id=$2 and dataset='cars'",[company,owner])).rows);
 if(u.pathname==='/rest/v1/zc_customers'){
  let rows=(await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2',[company,owner])).rows;const selected=ids(u.searchParams.get('car_id'));if(selected)rows=rows.filter(row=>selected.includes(row.car_id));
  const select=u.searchParams.get('select');if(select==='car_id')return response(rows.map(r=>({car_id:r.car_id})));if(select==='car_id,identity:payload->identityCipher')return response(rows.map(r=>({car_id:r.car_id,identity:r.payload.identityCipher??null})));
  throw Error('Unexpected identity REST selection: '+select);
 }
 throw Error('Unexpected actual network request blocked: '+u.pathname);
}
async function canonical(body){
 const {table,operation,filters={},value}=body;if(table==='zc_media')return {data:[],error:null};if(table==='zc_datasets'&&operation==='select'){let rows=(await db.query('select * from public.zc_datasets where company_id=$1',[filters.company_id||COMPANY])).rows;for(const key of['owner_id','dataset'])if(filters[key]!==undefined)rows=rows.filter(row=>row[key]===filters[key]);return{data:body.single?(rows[0]||null):rows,error:null};}if(table!=='zc_customers')throw Error('Unexpected UI table '+table);
 if(operation==='select'){
  const rows=(await db.query('select to_jsonb(c) row from public.zc_customers c where company_id=$1 and owner_id=$2',[filters.company_id||COMPANY,filters.owner_id||ACTOR])).rows.map(result=>result.row).filter(row=>filters.car_id===undefined||row.car_id===filters.car_id);
  if(holdRead&&holdRead.match(body)){const held=holdRead;holdRead=null;held.entered();await held.wait;}
  return {data:body.single?(rows[0]||null):rows,error:null};
 }
 throw Error('Customer writes must call the actual save/trash RPC, not REST '+operation);
}
async function uiRpc(body){
 const {name,args={}}=body;if(['zc_read_rrn','zc_save_rrn'].includes(name)){counters.legacy.push(name);return{data:null,error:{message:'Legacy identity RPC must not be used'}};}
 let write;if(name==='snote_customer_save'){
  assert.equal(rawInPayload(args.p_payload),false,'Plain manual identity must never enter canonical JSON');
  write={table:'zc_customers',operation:args.p_expected_updated_at===null?'insert':'update',filters:{company_id:args.p_company,owner_id:args.p_owner,car_id:args.p_car_id,updated_at:args.p_expected_updated_at},value:{company_id:args.p_company,owner_id:args.p_owner,car_id:args.p_car_id,payload:args.p_payload,updated_by:ACTOR},acknowledged:false};counters.writes.push(write);
  if(holdWrite&&holdWrite.match(write)){const held=holdWrite;holdWrite=null;held.entered();await held.wait;}
  if(failNextWrite){failNextWrite=false;return{data:null,error:{code:'XX000',message:'검증용 저장 실패'}};}
 }
 try{const data=await runFixtureRpc(db,'authenticated',ACTOR,name,args);if(write){write.acknowledged=true;write.value.updated_at=data.updatedAt;}return{data,error:null};}
 catch(error){if(error.code==='40001')counters.casMisses++;return{data:null,error:{code:error.code||'SQL_ERROR',message:error.message}};}
}
function html(){return source.replace("const NIL='00000000-0000-0000-0000-000000000000';","window.__identityState=S;\nconst NIL='00000000-0000-0000-0000-000000000000';").replace('\ninitializeAuth();','\nwindow.__identityReady=initializeAuth();');}
async function routeContext(page){
 page.on('pageerror',e=>counters.errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.context().route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());if(u.origin===env.SUPABASE_URL&&u.pathname.startsWith('/rest/v1/rpc/')){
   const headers={'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer '+JWT);assert.equal(req.headers().apikey,env.SUPABASE_PUBLISHABLE_KEY);
   const name=decodeURIComponent(u.pathname.split('/').at(-1)),args=JSON.parse(req.postData());counters.pinned.push(name);
   const result=await uiRpc({name,args});return route.fulfill({status:result.error?400:200,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});
  }if(u.origin!==ORIGIN){counters.external.push(u.origin);return route.abort()}
  if(u.pathname==='/api/customer-identity'){
   const body=JSON.parse(req.postData());counters.identity.push(structuredClone(body));
   if(holdIdentity&&holdIdentity.match(body)){const held=holdIdentity;holdIdentity=null;held.entered();await held.wait;}
   const result=await api.onRequestPost({request:new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postData()}),env});return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});
  }
  if(u.pathname==='/api/customer-intake')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'SMS fixture intentionally disabled',code:'SERVICE_UNAVAILABLE'})});
  if(u.pathname==='/__fixture/canonical')return route.fulfill({contentType:'application/json',body:JSON.stringify(await canonical(JSON.parse(req.postData())))});
  if(u.pathname==='/__fixture/rpc')return route.fulfill({contentType:'application/json',body:JSON.stringify(await uiRpc(JSON.parse(req.postData())))});
  if(u.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:html()});
  if(u.pathname.startsWith('/assets/'))return route.fulfill({path:ROOT+u.pathname});
  return route.abort();
 });
}
async function boot(page,carId='test-car-1'){
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__identityReady);await page.evaluate(()=>window.__identityReady);
 const cars=(await db.query("select payload from public.zc_datasets where owner_id=$1 and dataset='cars'",[ACTOR])).rows[0].payload;
 await page.evaluate(async({actor,company,jwt,cars:all,carId,supabaseUrl,publishable})=>{
  const alias='cld_'+actor.replace(/-/g,'').slice(0,18);await enterWorkspace({username:alias,name:'검증용 딜러',role:'dealer',company:'검증용 상사',employeeNo:'TEST',union:''});
  const S=window.__identityState;S.user={id:actor};S.company={id:company,name:'검증용 상사',rrn_enabled:false};S.members=[{user_id:actor,company_id:company,display_name:'검증용 딜러',role:'dealer',active:true}];
  const send=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json()};
  S.client={supabaseUrl,supabaseKey:publishable,auth:{getSession:async()=>({data:{session:{access_token:jwt,user:{id:actor}}},error:null})},rpc:async(name,args)=>send('/__fixture/rpc',{name,args}),from(table){
   const query={table,operation:'select',filters:{},single:false,value:null};const chain={
    select(){return chain},eq(key,value){query.filters[key]=value;return chain},is(key,value){query.filters[key]=value;return chain},order(){return chain},limit(){return chain},maybeSingle(){query.single=true;return chain},single(){query.single=true;return chain},
    update(value){query.operation='update';query.value=value;return chain},insert(value){query.operation='insert';query.value=value;return chain},upsert(value){query.operation='upsert';query.value=value;return chain},delete(){query.operation='delete';return chain},
    then(resolve,reject){return send('/__fixture/canonical',query).then(resolve,reject)}
   };return chain;
  }};S.revisions.set('cars:'+actor,1);S.revisions.set('covers:'+actor,1);S.ready=true;document.getElementById('zc-cloud-gate').hidden=true;cars=all;openVehicle(carId);await openSaleProgress();
 },{actor:ACTOR,company:COMPANY,jwt:JWT,cars,carId,supabaseUrl:env.SUPABASE_URL,publishable:env.SUPABASE_PUBLISHABLE_KEY});
}
async function fill(page,value,name='수동 검증 고객'){
 await page.locator('#zc72-name').fill(name);await page.locator('#zc72-phone').fill('01012345678');await page.locator('#zc72-address').fill('서울시 테스트로 1');await page.locator('#zc73-address-detail').fill('101호');await page.locator('#zc72-rrn').fill(value);await page.locator('#zc72-rrn').dispatchEvent('change');
}
async function saved(carId='test-car-1'){return (await db.query('select * from public.zc_customers where company_id=$1 and owner_id=$2 and car_id=$3',[COMPANY,ACTOR,carId])).rows[0]}
async function apiCall(body,jwt=JWT){const result=await api.onRequestPost({request:new Request(ORIGIN+'/api/customer-identity',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',Authorization:'Bearer '+jwt},body:JSON.stringify(body)}),env});return {status:result.status,...await result.json()}}
async function initialize(){
 db=await bootstrap();
 api=await import(pathToFileURL(ROOT+'/functions/api/customer-identity.js').href);source=fs.readFileSync(ROOT+'/index.html','utf8');global.fetch=serverFetch;
}
async function main(){
 await initialize();browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});await routeContext(page);await boot(page);
  console.log('Fixture ready: actual API, real AES, local canonical JSON database, rrn_enabled=false, no SMS/service-role bindings');
  await fill(page,RAW13);await page.locator('#zc72-print-button').click();await page.locator('#contract-overlay.open').waitFor();
  await page.waitForFunction(()=>document.getElementById('ct-buyer-id').value==='000101-3000000');
  let row=await saved();assert(row);assert.match(row.payload.identityCipher,/^smi1\.[a-f0-9]{24}\.[a-f0-9]{58}$/);assert.equal(rawInPayload(row.payload),false);assert.equal((await apiCall({action:'read',carId:'test-car-1'})).value,RAW13);
  console.log('PASS rrn_enabled=false manual13 → encrypted JSON insert → API read → full contract');
  await page.evaluate(async()=>{await closeContractPreview();await zc75WriteQueue;});
  assert.equal(await page.locator('#zc72-sale-modal').evaluate(el=>el.hidden),false,'Closing the sale contract must restore its sales dialog');
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);
  await page.evaluate(()=>closeSaleProgress());await boot(page);
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);
  await page.evaluate(()=>{closeSaleProgress();closeVehicle();navigate('users');});
  await page.waitForFunction(()=>document.querySelector('[data-customer-identity="test-car-1"]')?.textContent==='000101-*******');
  await page.locator('[data-customer-receipt="test-car-1"]').click();
  await page.locator('#zc76-receipt-overlay').waitFor({state:'visible'});
  assert.equal(await page.locator('#zc76-rrn').inputValue(),FORMATTED13);
  await page.evaluate(()=>zc76CloseReceipt());
  console.log('PASS fresh reload → full sales/customer list/receipt without legacy RRN RPC');

  await page.evaluate(async()=>{openVehicle('test-car-2');await openSaleProgress();});
  await fill(page,RAW10,'사업자 고객');await page.locator('#snote214-save-customer').click();
  await page.waitForFunction(()=>!zc72SaleLoading);
  row=await saved('test-car-2');assert.match(row.payload.identityCipher,/^smi1\.[a-f0-9]{24}\.[a-f0-9]{52}$/);
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).value,RAW10);
  const beforeFailure=row.payload.identityCipher;
  failNextWrite=true;await fill(page,RAW13,'저장실패 입력보존');await page.locator('#snote214-save-customer').click();await page.waitForFunction(()=>!zc72SaleLoading);
  assert.match(await page.locator('#zc72-error').textContent(),/저장|서버|연결/);
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);
  assert.equal(await page.locator('#zc72-name').inputValue(),'저장실패 입력보존');
  assert.equal((await saved('test-car-2')).payload.identityCipher,beforeFailure);
  await page.locator('#snote214-save-customer').click();await page.waitForFunction(()=>!zc72SaleLoading);
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).value,RAW13);
  await page.locator('#zc72-print-button').click();await page.locator('#contract-overlay.open').waitFor();
  await page.evaluate(()=>zc75WriteQueue);
  await page.evaluate(()=>{document.getElementById('ct-buyer-id').value='987-65-43210';});failNextWrite=true;
  assert.equal(await page.evaluate(()=>closeContractPreview()),false);
  assert.equal(await page.locator('#ct-buyer-id').inputValue(),'987-65-43210');
  assert(await page.locator('#contract-overlay').evaluate(el=>el.classList.contains('open')));
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).value,RAW13);
  assert.equal(await page.evaluate(()=>closeContractPreview()),true);
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).value,RAW10);
  await page.evaluate(()=>zc75WriteQueue);
  assert.equal(await page.locator('#zc72-sale-modal').evaluate(el=>el.hidden),false);
  assert.equal(await page.locator('#zc72-rrn').inputValue(),'987-65-43210','Returning sales inputs must reflect the identity saved in the document');
  await page.locator('#zc72-sale-modal .snote-sale-action[aria-label="인수증 출력"]').click();
  await page.locator('#zc76-receipt-overlay').waitFor({state:'visible'});
  assert.equal(await page.locator('#zc76-rrn').inputValue(),'987-65-43210');
  await page.evaluate(()=>{document.getElementById('zc76-rrn').value='000101-3000000';});failNextWrite=true;
  assert.equal(await page.evaluate(()=>zc76CloseReceipt()),false);
  assert.equal(await page.locator('#zc76-rrn').inputValue(),FORMATTED13);
  assert.equal(await page.locator('#zc76-receipt-overlay').evaluate(el=>el.hidden),false);
  assert.equal(await page.evaluate(()=>zc76CloseReceipt()),true);
  assert.equal(await page.locator('#zc72-sale-modal').evaluate(el=>el.hidden),false,'Closing the sale receipt must restore its sales dialog');
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).value,RAW13);
  console.log('PASS business10 roundtrip; sales/contract/receipt write failure preserves input and stays open; retry persists');

  const pageB=await browser.newPage({viewport:{width:1280,height:1000}});await routeContext(pageB);await boot(pageB);
  const hold=deferred(),entered=deferred();holdWrite={match:body=>body.operation==='update'&&body.filters.car_id==='test-car-1',entered:entered.resolve,wait:hold.promise};
  const staleGeneral=page.evaluate(async()=>{const r=await zc72ReadCar(currentUser.username,'test-car-1');r.name='다른 탭 일반 저장';try{await zc72Write(r);return null;}catch(error){return error.message;}});
  await entered.promise;
  assert.equal(await pageB.evaluate(raw=>zc80SaveRrnField(currentUser.username,'test-car-1',raw),RAW10),true);
  const replacement=(await saved()).payload.identityCipher;
  hold.resolve();assert.match(await staleGeneral,/변경|충돌|다시/);assert.equal((await saved()).payload.identityCipher,replacement);await page.evaluate(async()=>{const latest=await zc72ReadCar(currentUser.username,'test-car-1');latest.name='다른 탭 일반 저장';await zc72Write(latest);});
  row=await saved();assert.equal(row.payload.name,'다른 탭 일반 저장');assert.equal(row.payload.identityCipher,replacement);assert.equal((await apiCall({action:'read',carId:'test-car-1'})).value,RAW10);assert(counters.casMisses>=1);

  const insertHold=deferred(),insertEntered=deferred();holdWrite={match:body=>body.operation==='insert'&&body.value.car_id==='test-car-3',entered:insertEntered.resolve,wait:insertHold.promise};
  const staleInsert=page.evaluate(async()=>{try{await zc72Write({id:currentUser.username+':test-car-3',ownerId:currentUser.username,carId:'test-car-3',name:'중복 생성 재시도',createdAt:Date.now(),updatedAt:Date.now()});return null;}catch(error){return error.message;}});
  await insertEntered.promise;
  await pageB.evaluate(async raw=>{await zc72Write({id:currentUser.username+':test-car-3',ownerId:currentUser.username,carId:'test-car-3',name:'먼저 생성',rrnCipher:await zc80EncryptRrn(raw),createdAt:Date.now(),updatedAt:Date.now()});},RAW10);
  const insertedCipher=(await saved('test-car-3')).payload.identityCipher;insertHold.resolve();assert.match(await staleInsert,/변경|충돌|다시/);await page.evaluate(async()=>{const latest=await zc72ReadCar(currentUser.username,'test-car-3');latest.name='중복 생성 재시도';await zc72Write(latest);});
  assert.equal((await saved('test-car-3')).payload.identityCipher,insertedCipher);assert.equal((await apiCall({action:'read',carId:'test-car-3'})).value,RAW10);
  console.log('PASS real save RPC rejects stale timestamps and duplicate inserts; explicit fresh-read retry preserves the latest encrypted identity');
  const staleReadHold=deferred(),staleReadEntered=deferred();holdRead={match:body=>body.single&&body.filters.car_id==='test-car-3',entered:staleReadEntered.resolve,wait:staleReadHold.promise};
  const staleRead=page.evaluate(async()=>{window.__staleCustomer=await zc72ReadCar(currentUser.username,'test-car-3');});await staleReadEntered.promise;
  await pageB.evaluate(()=>zc72Delete(currentUser.username,'test-car-3'));staleReadHold.resolve();await staleRead;
  assert.match(await page.evaluate(async()=>{try{await zc72Write(window.__staleCustomer);return 'unexpected save';}catch(error){return error.message;}}),/삭제/);
  assert.match(await page.evaluate(async()=>{try{await zc72Write({...window.__staleCustomer},{requireExisting:true});return 'unexpected save';}catch(error){return error.message;}}),/삭제/);
  assert.equal(await saved('test-car-3'),undefined);
  console.log('PASS delayed read followed by other-tab deletion cannot resurrect customer through stale save');
  await pageB.close();

  const readHold=deferred(),readEntered=deferred();holdIdentity={match:body=>body.action==='read'&&body.carId==='test-car-1',entered:readEntered.resolve,wait:readHold.promise};
  await page.evaluate(()=>{openVehicle('test-car-1');window.__oldIdentityOpen=openSaleProgress();});
  await readEntered.promise;
  await page.evaluate(async()=>{openVehicle('test-car-2');await openSaleProgress();});
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);readHold.resolve();await page.evaluate(()=>window.__oldIdentityOpen);
  assert.equal(await page.locator('#zc72-rrn').inputValue(),FORMATTED13);assert.equal(await page.evaluate(()=>zc72SaleCarId),'test-car-2');
  console.log('PASS late decrypt from previous customer cannot replace current sales form');
  await page.evaluate(()=>{closeSaleProgress();closeVehicle();navigate('users');});
  await page.waitForFunction(()=>document.querySelector('[data-customer-identity="test-car-1"]')?.textContent==='987-**-*****');
  const contractHold=deferred(),contractEntered=deferred();holdIdentity={match:body=>body.action==='read'&&body.carId==='test-car-1',entered:contractEntered.resolve,wait:contractHold.promise};
  await page.evaluate(()=>{window.__contractOpen=zc75OpenSavedContract('test-car-1');});await contractEntered.promise;
  await page.evaluate(()=>{document.getElementById('ct-buyer-id').value='000101-3000000';});
  contractHold.resolve();await page.evaluate(()=>window.__contractOpen);
  assert.equal(await page.locator('#ct-buyer-id').inputValue(),FORMATTED13);
  await page.evaluate(async()=>{await closeContractPreview({discard:true});await zc75WriteQueue;});
  console.log('PASS late contract decrypt preserves edits made while retrieval is pending');

  assert.equal((await apiCall({action:'read',carId:'test-car-2'},OTHER_JWT)).value,'');
  assert.equal((await apiCall({action:'encrypt',carId:'test-car-2',value:RAW13},OTHER_JWT)).status,403);
  await db.query("update public.zc_customers set payload=jsonb_set(payload,'{identityCipher}',to_jsonb('broken'::text)),has_rrn=true where company_id=$1 and owner_id=$2 and car_id='test-car-2'",[COMPANY,ACTOR]);
  assert.equal((await apiCall({action:'read',carId:'test-car-2'})).code,'IDENTITY_DECRYPT_FAILED');
  await page.evaluate(async()=>{openVehicle('test-car-2');await openSaleProgress();});
  assert.equal(await page.locator('#zc72-rrn').inputValue(),'');
  assert.match(await page.locator('#zc72-error').textContent(),/복원하지 못/);
  await page.evaluate(()=>{closeSaleProgress();closeVehicle();navigate('users');});
  await page.waitForFunction(()=>document.querySelector('[data-customer-identity="test-car-2"]')?.textContent==='조회 실패');
  assert.deepEqual(counters.legacy,[]);
  console.log('PASS other owner denied; corrupt new cipher fails visibly without legacy fallback');
  for(const write of counters.writes.filter(write=>write.acknowledged&&write.filters.updated_at!==null)){assert.equal((await db.query('select $1::timestamptz>$2::timestamptz advanced',[write.value.updated_at,write.filters.updated_at])).rows[0].advanced,true,'Server CAS timestamps must advance with microsecond precision');}
  assert.equal(rawInPayload({storage:await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))}),false,'Plain identity must not enter browser persistent storage');
  assert.equal(await page.evaluate(async()=>{const db=await zc72OpenDb();return new Promise((resolve,reject)=>{const query=db.transaction('customers','readonly').objectStore('customers').count();query.onsuccess=()=>resolve(query.result);query.onerror=()=>reject(query.error);});}),0,'Connected customer saves must not fall back to IndexedDB');
  assert(counters.pinned.includes('snote_customer_save'),'Connected customer saves must use the actor-pinned HTTP RPC transport');
  assert(counters.pinned.includes('snote_recycle_trash_customer'),'Customer deletion must use the actor-pinned recycle RPC transport');
  assert.deepEqual(counters.external,[]);assert.deepEqual(counters.errors,[]);console.log('COUNTERS',JSON.stringify({writes:counters.writes.length,identity:counters.identity.length,legacy:counters.legacy,casMisses:counters.casMisses,pinnedRpc:counters.pinned.length}));
 }finally{await browser.close();global.fetch=originalFetch;await db.close()}
}
module.exports={bootstrapCurrent:bootstrap,runFixtureRpc};
if(require.main===module)main().catch(e=>{console.error(e.name,e.message);process.exitCode=1});
