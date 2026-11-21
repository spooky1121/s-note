'use strict';
// Actual sale modal and intake client with synthetic account-specific sessions/API only.
// No live account, customer, provider or database request is made.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.INTAKE_ACCOUNT_ARTIFACT_DIR||'/workspace/work/intake-v2164/client';fs.mkdirSync(OUT,{recursive:true});
const ORIGIN='https://encar-smoke.example',RECIPIENT='01055556666';
const ACTORS=[{id:'11111111-1111-4111-8111-111111111111',email:'first-dealer@example.invalid',phone:'01011112222'},
 {id:'22222222-2222-4222-8222-222222222222',email:'second-dealer@example.invalid',phone:'01033334444'}];
const jwt=id=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic';
const results=[];
async function setup(actor,width=1440,mode='ok'){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page,calls=[];
 await f.context.route(ORIGIN+'/api/customer-intake',async route=>{
  const req=route.request(),body=JSON.parse(req.postData());calls.push(body);
  assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer '+jwt(actor.id));
  assert(!['sender','from','email','dealerPhone','senderPhone'].some(key=>Object.hasOwn(body,key)),'Client must not derive sender from dealer profile');
  if(mode==='setup-failure')return route.fulfill({status:503,contentType:'application/json',body:'{"code":"SERVER_SETUP_REQUIRED","error":"synthetic setup failure"}'});
  if(body.action==='list')return route.fulfill({contentType:'application/json',body:'{"ok":true,"requests":[]}'});
  assert.equal(body.action,'create');assert.deepEqual(Object.keys(body).sort(),['action','carId','phone']);assert.equal(body.carId,'encar-car-1');assert.equal(body.phone,RECIPIENT);
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,request:{id:'44444444-4444-4444-8444-444444444444',deliveryStatus:'sent',expiresAt:'2099-01-01T00:00:00Z',car:{model:'합성 계정별 차량',plate:'12가3456'}},link:ORIGIN+'/customer.html#'+'a'.repeat(43)})});
 });
 await p.evaluate(async actor=>{
  const S=__encarFixtureState,alias='cld_'+actor.id.replaceAll('-','').slice(0,18);
  S.user={id:actor.id,email:actor.email};S.members=[{user_id:actor.id,company_id:S.company.id,role:'dealer',active:true,display_name:'합성 담당 딜러'}];
  __encarFixtureSession={...__encarFixtureSession,access_token:actor.token,user:S.user};
  currentUser={...currentUser,username:alias,email:actor.email,phone:actor.phone,name:'합성 담당 딜러',role:'dealer'};
  cars[0].ownerId=alias;cars[0].status='판매중';activeCarId=cars[0].id;
  await openSaleProgress();
 },{...actor,token:jwt(actor.id)});
 return{f,p,calls};
}
async function sends(actor,width){
 const {f,p,calls}=await setup(actor,width);
 try{
  const send=p.getByRole('button',{name:'입력 링크 문자 보내기',exact:true});await send.waitFor();await p.waitForFunction(()=>!document.querySelector('.snote-intake-button.is-primary').disabled);
  await p.locator('#snote-intake-phone').fill(RECIPIENT);await send.click();
  await p.waitForFunction(()=>document.querySelector('.snote-intake-message').textContent.includes('문자 접수가 완료되었습니다.'));
  assert.equal(calls.filter(c=>c.action==='create').length,1);assert(calls.some(c=>c.action==='list'));
  assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Sending an invitation must not rewrite vehicle data');
  await p.screenshot({path:path.join(OUT,'success-'+width+'-'+actor.id.slice(0,8)+'.png')});
  results.push({kind:'account-specific session and own vehicle send',width,actor:actor.id,profilePhoneUsedAsSender:false,passed:true});
  await p.evaluate(()=>closeSaleProgress());await finish(f);console.log('PASS own dealer invitation '+actor.id.slice(0,8)+' '+width);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'-'+actor.id.slice(0,8)+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function failureAndOwnership(){
 const {f,p,calls}=await setup(ACTORS[1],390,'setup-failure');
 try{
  await p.waitForFunction(()=>document.querySelector('.snote-intake-message')?.textContent.includes('Cloudflare 운영 환경의 서버 키'));
  assert.equal(await p.getByRole('button',{name:'입력 링크 문자 보내기',exact:true}).isDisabled(),true);assert.equal(calls.filter(c=>c.action==='create').length,0);
  assert.match(await p.locator('.snote-intake-message').innerText(),/서버의 Supabase 연결 설정/);
  const before=calls.length;
  await p.evaluate(()=>{window.snoteIntakeClose();cars[0].ownerId='cld_foreign-dealer';window.snoteIntakeOpen();});
  assert.match(await p.locator('#snote-intake-panel').innerText(),/본인 담당 차량만/);assert.equal(calls.length,before);
  results.push({kind:'setup-failure mapping and foreign vehicle denial',passed:true});await p.evaluate(()=>closeSaleProgress());await finish(f);console.log('PASS configuration failure and foreign owner guard');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of[1440,390])for(const actor of ACTORS)await sends(actor,width);await failureAndOwnership();
 fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({passed:true,syntheticOnly:true,results},null,2)+'\n');
}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
