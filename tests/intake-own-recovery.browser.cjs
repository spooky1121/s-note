'use strict';
// Actual sale/intake UI. Every account, API response and server acknowledgement
// is synthetic; no production database or SMS provider is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.INTAKE_RECOVERY_ARTIFACT_DIR||'/tmp/snote-intake-own-recovery';fs.mkdirSync(OUT,{recursive:true});
const ORIGIN='https://encar-smoke.example',PHONE='01055556666',SOURCE='assets/snote-customer-intake.js',results=[];
const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',SOURCE))).digest('hex');
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const send=p=>p.getByRole('button',{name:'입력 링크 문자 보내기',exact:true});
const retry=p=>p.getByRole('button',{name:'다시 확인',exact:true});
async function setup(width,mode='pending',pending=false){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page,state={mode,ack:['ready','read-denied'].includes(mode),flushes:0,calls:[],rrnAllowed:false};
 const old={id:'44444444-4444-4444-8444-444444444444',phone:PHONE,status:'pending',deliveryStatus:'sent',createdAt:'2026-11-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',submittedAt:null,revokedAt:null};
 await p.exposeFunction('__recoveryFlushAck',()=>{state.flushes++;if(state.mode==='pending'||state.mode==='ready')state.ack=true;});
 await f.context.route(ORIGIN+'/api/customer-intake',async route=>{
  const request=route.request(),body=JSON.parse(request.postData());state.calls.push(body);assert.equal(request.method(),'POST');assert.match(request.headers().authorization||'',/^Bearer \S+$/);
  assert(!['owner','ownerId','sender','from','senderPhone'].some(key=>Object.hasOwn(body,key)),'Client cannot assert another owner or sender');
  if(state.mode==='setup')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'SERVER_SETUP_REQUIRED'})});
  if(!state.ack||state.mode==='denied')return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'FORBIDDEN'})});
  if(body.action==='list')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:mode==='read-denied'?[{...old,status:'submitted',submittedAt:'2026-11-02T00:00:00Z',hasRrn:true,submission:{name:'자동 확인 합성 고객',phone:PHONE,addressBase:'합성 주소',sameAddress:true}}]:pending?[old]:[]})});
  if(body.action==='read-rrn')return route.fulfill({status:state.rrnAllowed?200:403,contentType:'application/json',body:JSON.stringify(state.rrnAllowed?{ok:true,rrn:'9001011234567'}:{code:'FORBIDDEN'})});
  assert.equal(body.action,'create');assert.equal(body.carId,'encar-car-1');assert.equal(body.phone,PHONE);
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,request:{...old,id:'55555555-5555-4555-8555-555555555555'},link:ORIGIN+'/customer.html#'+'a'.repeat(64)})});
 });
 await p.evaluate(async()=>{
  window.__recoveryNotices=[];window.addEventListener('snote:message-open',event=>__recoveryNotices.push(event.detail));
  const cloud=window.zc86Cloud;
  window.zc86Cloud=Object.create(cloud,{flush:{value:async()=>{const saved=await cloud.flush();if(saved?.ok===true)await __recoveryFlushAck();return saved;}}});
  await openSaleProgress();
 });
 return{f,p,state};
}
async function inlineError(p){
 await p.locator('.snote-intake-message.is-error:not([hidden])').waitFor();
 assert.equal(await retry(p).isVisible(),true,'A failed background read offers explicit recovery');
 assert.doesNotMatch(await p.locator('#snote-intake-panel').innerText(),/본인 담당 차량만/,'Failure does not incorrectly declare a foreign vehicle');
 assert.equal(await p.evaluate(()=>__recoveryNotices.filter(row=>row.kind==='notify'&&row.tone==='error').length),0,'Background errors do not open error popups');
}
async function unchanged(p){assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Intake recovery cannot rewrite fixture vehicle data');}
async function ready(p){await p.waitForFunction(()=>!document.querySelector('.snote-intake-button.is-primary').disabled&&document.querySelector('.snote-intake-message')?.textContent==='요청 내역을 확인했습니다.');}
async function explicitRetry(width){
 const {f,p,state}=await setup(width);
 try{
  await inlineError(p);assert.equal(await send(p).isEnabled(),true,'A first list403 does not permanently lock the save/revalidate action');
  await p.locator('#zc72-name').fill('수정한 가상 고객');const initial=state.calls.length;
  await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await frames(p);assert.equal(state.calls.length,initial,'A failed background read waits for explicit retry');
  await retry(p).click();await ready(p);assert.equal(state.flushes,1);assert.equal(state.calls.filter(row=>row.action==='create').length,0,'Retry verifies access without sending');
  assert.equal(await p.locator('#zc72-name').inputValue(),'수정한 가상 고객');assert.equal(await retry(p).isHidden(),true);
  await p.locator('#snote-intake-phone').fill(PHONE);await send(p).click();await p.waitForFunction(()=>document.querySelector('.snote-intake-message').textContent.includes('문자 접수가 완료되었습니다.'));
  assert.equal(state.calls.filter(row=>row.action==='create').length,1);await unchanged(p);await p.screenshot({path:path.join(OUT,'recovered-'+width+'.png')});
  await p.evaluate(()=>closeSaleProgress());await finish(f);results.push({width,case:'initial403 then save ACK and explicit recheck recover without modifying the draft',passed:true});console.log('PASS explicit own recovery '+width);
 }catch(error){await f.context.close();throw error;}
}
async function sendPreflight(width){
 const {f,p,state}=await setup(width,'pending',true);
 try{
  await inlineError(p);await p.locator('#snote-intake-phone').fill(PHONE);
  f.answerConfirm(false,/새 링크를 보내면 이전에 보낸 입력 대기 링크는 취소됩니다/);await send(p).click();await frames(p);
  await p.waitForFunction(()=>document.querySelectorAll('.snote-intake-request').length===1&&!document.querySelector('.snote-intake-button.is-primary').disabled);
  assert.equal(state.flushes,1,'Sending after a failed read first saves and revalidates');assert.equal(state.calls.filter(row=>row.action==='list').length,2);
  assert.equal(state.calls.filter(row=>row.action==='create').length,0,'Cancel keeps the prior pending invitation and sends nothing');
  f.answerConfirm(true,/새 링크를 보내면 이전에 보낸 입력 대기 링크는 취소됩니다/);await send(p).click();await p.waitForFunction(()=>document.querySelector('.snote-intake-message').textContent.includes('문자 접수가 완료되었습니다.'));
  assert.equal(state.calls.filter(row=>row.action==='create').length,1);await unchanged(p);await p.evaluate(()=>closeSaleProgress());await finish(f);results.push({width,case:'send revalidates a failed initial read and retains pending-link replacement confirmation',passed:true});console.log('PASS own send preflight '+width);
 }catch(error){await f.context.close();throw error;}
}
async function denied(width){
 const {f,p,state}=await setup(width,'denied');
 try{
  await inlineError(p);await p.locator('#snote-intake-phone').fill(PHONE);await send(p).click();await p.waitForFunction(()=>!document.querySelector('.snote-intake-button.is-primary').disabled);await inlineError(p);
  assert.equal(state.calls.filter(row=>row.action==='create').length,0,'Persistent denial never reaches invitation creation or SMS');
  await p.evaluate(async()=>{await closeSaleProgress();await openSaleProgress();});await inlineError(p);
  await retry(p).click();await p.waitForFunction(()=>!document.getElementById('snote-intake-retry').disabled);await inlineError(p);
  assert.equal(state.calls.filter(row=>row.action==='create').length,0);await unchanged(p);await p.evaluate(()=>closeSaleProgress());await finish(f);results.push({width,case:'persistent403 remains inline across reopen and recheck; authorization cannot be bypassed',passed:true});console.log('PASS denied own request '+width);
 }catch(error){await f.context.close();throw error;}
}
async function setupRecovery(){
 const {f,p,state}=await setup(390,'setup');
 try{await inlineError(p);assert.equal(await send(p).isDisabled(),true,'Setup errors still block sending');state.mode='pending';await retry(p).click();await ready(p);assert.equal(await send(p).isEnabled(),true);assert.equal(state.calls.filter(row=>row.action==='create').length,0);await unchanged(p);await p.evaluate(()=>closeSaleProgress());await finish(f);results.push({width:390,case:'setup failure stays inline and an explicit recheck restores controls after recovery',passed:true});console.log('PASS setup recovery');}
 catch(error){await f.context.close();throw error;}
}
async function automaticReadRecovery(){
 const {f,p,state}=await setup(390,'read-denied');
 try{
  await p.locator('.snote-intake-message.is-error:not([hidden])').waitFor();
  assert.equal(state.calls.filter(row=>row.action==='read-rrn').length,1);
  assert.equal(await p.evaluate(()=>__recoveryNotices.filter(row=>row.kind==='notify'&&row.tone==='error').length),0,'Automatic submitted-info restoration does not open error popups');
  assert.equal(await p.locator('#zc72-name').inputValue(),'','A failed private-data read preserves the current form');
  const load=p.getByRole('button',{name:'입력정보 불러오기',exact:true});await load.click();
  await p.waitForFunction(()=>__recoveryNotices.some(row=>row.kind==='notify'&&row.tone==='error'));
  assert.equal(state.calls.filter(row=>row.action==='read-rrn').length,2,'Explicit load retries through the same authorized API');
  assert.equal(await p.locator('#zc72-name').inputValue(),'','A denied manual read also preserves the form');
  state.rrnAllowed=true;await load.click();await p.waitForFunction(()=>document.getElementById('zc72-name').value==='자동 확인 합성 고객');
  assert.equal(state.calls.filter(row=>row.action==='read-rrn').length,3);assert.equal(state.calls.filter(row=>row.action==='create').length,0);await unchanged(p);await p.evaluate(()=>closeSaleProgress());await finish(f);
  results.push({width:390,case:'automatic submitted-info403 stays inline; explicit load keeps failure feedback and later recovers',passed:true});console.log('PASS automatic read recovery');
 }catch(error){await f.context.close();throw error;}
}
(async()=>{const before=hash(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of[1440,390]){await explicitRetry(width);await sendPreflight(width);await denied(width);}await setupRecovery();await automaticReadRecovery();assert.equal(hash(),before,'Product source remains unchanged during verification');
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({passed:results.length===8,sourceHash:before,syntheticOnly:true,operatingReads:0,operatingWrites:0,smsSent:0,results},null,2)+'\n');}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
