'use strict';
// Actual login/signup app, synthetic Auth/RPC and local attachments. No production requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('./encar/node_modules/playwright');
const {backend,boot,constants} = require('./normal-login.browser.cjs');
const ROOT=path.resolve(__dirname,'..');
const OUT=process.env.SNOTE_SIGNUP_ARTIFACT_DIR||'/workspace/work/signup-v2189';
const WIDTHS=(process.env.SNOTE_SIGNUP_WIDTHS||'1440,390').split(',').map(Number);
const PASSWORD='SyntheticSignup!123';
const COMPANY='합성 신규 상사', PHONE='01011223344', EMAIL='new-account@example.invalid';
const COMPANY_DUPLICATE='등록되어 있는 상사입니다. 채팅으로 문의 부탁드립니다';
const CONTACT_DUPLICATE='가입된 이메일 또는 휴대번 입니다.';
const PREFIX='#snote-registration-';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const hashes=()=>Object.fromEntries(['index.html','assets/signup-registration.js','assets/signup-registration.css','assets/design-settings-office.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
fs.mkdirSync(OUT,{recursive:true});
const results=[];
function deferred(){let resolve;return{promise:new Promise(done=>resolve=done),resolve:value=>resolve(value)};}
async function checkPopup(p,text){const dialog=p.locator('#snote-message-dialog[open]');await dialog.waitFor({state:'visible'});assert.equal(await dialog.locator('#snote-message-copy').textContent(),text);await dialog.locator('[data-message-accept]').click();await dialog.waitFor({state:'hidden'});}
async function setup(browser,width=1440){
  const state=backend();state.user.email=EMAIL;const originalAuth=state.auth;state.auth=(label,input)=>originalAuth(label,{...input,password:input.password===PASSWORD?constants.PASSWORD:input.password});
  const ordinaryFrom=state.from,ordinaryRpc=state.rpc;
  const signup={checks:[],posts:[],setSessions:[],authSignups:0,status:'pending',checkAvailable:true,holdCheck:null,member:false,kind:'dealer',completeCalls:0,profile:null};
  state.from=(label,input)=>{
    if(input.table==='zc_members'&&!signup.member){state.reads.push({label,table:input.table,filters:input.filters});return{data:input.single?null:[],error:null};}
    const result=ordinaryFrom(label,input);
    if(input.table==='zc_members'&&result.data){const role=signup.kind==='representative'?'admin':'dealer';if(Array.isArray(result.data))result.data=result.data.map(row=>({...row,role}));else result.data={...result.data,role};}
    if(input.table==='zc_companies'&&result.data){if(Array.isArray(result.data))result.data=result.data.map(row=>({...row,name:COMPANY}));else result.data={...result.data,name:COMPANY};}
    return result;
  };
  state.rpc=(label,input)=>{
    assert(!['zc_bootstrap_company','auth.signUp'].includes(input.name),'New signup cannot use editable metadata/legacy bootstrap');
    if(input.name==='snote_registration_complete'){state.rpcCalls.push({label,name:input.name});signup.completeCalls++;signup.member=true;return{data:{ok:true,companyId:constants.COMPANY,userId:constants.USER,role:signup.kind==='representative'?'admin':'dealer'},error:null};}
    return ordinaryRpc(label,input);
  };
  const f=await boot(browser,state,'signup-'+width,{width}),p=f.page;
  await p.exposeFunction('__signupSetSession',tokens=>{signup.setSessions.push(tokens);const session=[...state.sessions.values()].find(entry=>entry.session.access_token===tokens.access_token)?.session;assert(session,'setSession must receive the exact API-issued synthetic session');return structuredClone(session);});
  await p.evaluate(()=>{
    const original=window.__normalFactory;
    window.__normalFactory=(...args)=>{
      const client=original(...args),c=__normalSdk.clients.at(-1),opts=c.options||{};
      client.auth.signUp=async()=>{throw Error('Forbidden direct browser signup');};
      client.auth.setSession=async tokens=>{const session=await __signupSetSession(tokens);c.session=session;const store=opts.storage||localStorage,key=opts.storageKey||'sb-'+new URL(args[0]).hostname.split('.')[0]+'-auth-token';store.setItem(key,JSON.stringify(session));c.callback?.('SIGNED_IN',session);return{data:{user:session.user,session},error:null};};
      return client;
    };
  });
  await p.route('**/api/registration',async route=>{
    const request=route.request();assert.equal(request.method(),'POST');const contentType=request.headers()['content-type']||'';
    if(contentType.startsWith('application/json')){
      const body=request.postDataJSON();assert.deepEqual(Object.keys(body).sort(),['action','companyName']);assert.equal(body.action,'check-company');signup.checks.push(body);const held=signup.holdCheck;if(held){held.arrive?.();await held.promise;}
      return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,available:signup.checkAvailable})});
    }
    assert(contentType.startsWith('multipart/form-data'),'Signup sends the actual two files as multipart');
    const form=await new Request(request.url(),{method:'POST',headers:request.headers(),body:request.postDataBuffer()}).formData();
    assert.deepEqual([...form.keys()].sort(),['businessCertificate','dealerLicense','password','profile']);
    const profile=JSON.parse(form.get('profile'));assert.equal(form.get('password'),PASSWORD);
    assert.deepEqual(Object.keys(profile).sort(),['businessAddress','businessNumber','companyName','displayName','email','kind','phone','representativeName']);
    assert.equal(profile.companyName,COMPANY);assert.equal(profile.businessNumber,'1234567890');assert.equal(profile.representativeName,'합성 대표');assert.equal(profile.businessAddress,'가상시 가상구 가상로 1');assert.equal(profile.displayName,'합성 가입자');assert.equal(profile.phone,PHONE);assert.equal(profile.email,EMAIL);assert(['representative','dealer'].includes(profile.kind));
    for(const field of ['businessCertificate','dealerLicense']){const file=form.get(field);assert(file instanceof File);assert.equal(file.type,'image/png');assert(file.size>0&&file.size<=5*1024*1024);assert.deepEqual(Buffer.from(await file.arrayBuffer()),PNG);}
    signup.posts.push({profile,files:['businessCertificate','dealerLicense']});signup.kind=profile.kind;signup.profile=profile;
    if(signup.holdRegister){const held=signup.holdRegister;held.arrive?.();await held.promise;}
    if(['COMPANY_EXISTS','CONTACT_EXISTS','AUTH_STATUS_UNKNOWN'].includes(signup.status))return route.fulfill({status:signup.status==='AUTH_STATUS_UNKNOWN'?502:409,contentType:'application/json',body:JSON.stringify({ok:false,code:signup.status,error:signup.status==='COMPANY_EXISTS'?COMPANY_DUPLICATE:signup.status==='CONTACT_EXISTS'?CONTACT_DUPLICATE:'인증 처리 상태를 확인하지 못했습니다. 인증 메일을 확인하거나 로그인해 주세요.'})});
    const session=signup.status==='immediate'?state.issue():null;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,email:EMAIL,confirmationRequired:!session,session})});
  });
  return{f,p,state,signup};
}
async function open(p,kind='dealer'){
  await p.locator(kind==='representative'?'#zc86-register':'#snote-dealer-register').click();
  await p.locator('#snote-registration-form').waitFor({state:'visible'});
  assert.equal(await p.locator('#zc-cloud-gate').getAttribute('data-auth-mode'),kind==='representative'?'admin':'dealer');
}
async function companyCheck(p){await p.locator(PREFIX+'company-check').click();await p.waitForFunction(()=>{const el=document.getElementById('snote-registration-company-status');return el&&/사용|가능|확인/.test(el.textContent)&&!document.getElementById('snote-registration-company-check').disabled;});}
async function fill(p,{files=true,check=true}={}){
  for(const [field,value]of[['company',COMPANY],['business','123-45-67890'],['owner','합성 대표'],['address','가상시 가상구 가상로 1'],['name','합성 가입자'],['phone','010-1122-3344'],['email',EMAIL],['password',PASSWORD],['password-confirm',PASSWORD]])await p.locator(PREFIX+field).fill(value);
  if(files)for(const field of ['business-certificate','dealer-license'])await p.locator(PREFIX+field).setInputFiles({name:'synthetic-'+field+'.png',mimeType:'image/png',buffer:PNG});
  if(check){await companyCheck(p);assert.equal(await p.locator(PREFIX+'company-status').getAttribute('data-state'),'available');assert(await p.locator(PREFIX+'company-status svg').count()>0,'Availability is shown with the requested inline checkmark');}
}
async function screenshotForm(p,label){
  await p.locator('#zc-cloud-gate').evaluate(element=>element.scrollTo({top:0,behavior:'instant'}));
  await p.screenshot({path:path.join(OUT,label+'.png'),fullPage:true});
  await p.locator(PREFIX+'business-certificate').evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
  await p.screenshot({path:path.join(OUT,label+'-attachments.png'),fullPage:true});
}
async function noSecrets(p){
  const stores=await p.evaluate(()=>({local:Object.fromEntries(Object.entries(localStorage)),session:Object.fromEntries(Object.entries(sessionStorage))}));
  assert(!JSON.stringify(stores).includes(PASSWORD),'Password must never be persisted');
  assert(!JSON.stringify(stores).includes('synthetic-business-certificate'),'Attachment paths/files must not be persisted in browser storage');
}
async function layoutAndPending(browser,width){
  const {f,p,signup}=await setup(browser,width);
  try{
    if(width===1440){const fallback=await p.evaluate(()=>{const clone=document.getElementById('snote-registration-form').cloneNode(true);clone.id='snote-registration-no-js-fixture';for(const field of clone.querySelectorAll('[required]'))field.removeAttribute('required');document.body.append(clone);const event=new SubmitEvent('submit',{bubbles:true,cancelable:true});const accepted=clone.dispatchEvent(event),value={accepted,prevented:event.defaultPrevented,method:clone.method,onsubmit:clone.getAttribute('onsubmit')};clone.remove();return value;});assert.equal(fallback.prevented,true,'Missing external registration JS must leave the native form submission canceled');assert.equal(fallback.accepted,false);assert.equal(fallback.method,'post','CSP/JS fallback must never put password fields in a GET URL');assert.match(fallback.onsubmit,/return\s+false/);results.push({kind:'unbound native form clone cancels submit and explicitly uses POST before module load',passed:true});console.log('PASS signup no-JS native fallback');}
    assert.equal(await p.locator('#zc86-register').textContent(),'상사대표 가입');assert.equal(await p.locator('#snote-dealer-register').textContent(),'일반딜러 가입');assert(!await p.locator('#zc-cloud-gate').innerText().then(text=>text.includes('상사 개설')));
    await open(p,'representative');await fill(p);
    const geometry=await p.locator('#snote-registration-form').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:document.documentElement.scrollWidth,width:innerWidth}));assert(geometry.left>=0&&geometry.right<=width+1);assert.equal(geometry.scroll>geometry.width,false);
    await screenshotForm(p,'representative-'+width);
    await p.locator(PREFIX+'submit').click();await p.locator('#snote-signup-complete').waitFor({state:'visible'});assert.equal(signup.posts.length,1);assert.equal(signup.posts[0].profile.kind,'representative');assert.equal(signup.setSessions.length,0);assert.equal(signup.completeCalls,0);assert.match(await p.locator('#snote-signup-complete-message').textContent(),/인증|메일/);assert.equal(await p.locator(PREFIX+'password').inputValue(),'');await noSecrets(p);
    await p.locator('#snote-signup-login').click();await open(p,'dealer');await fill(p);await screenshotForm(p,'dealer-'+width);await p.locator(PREFIX+'submit').click();await p.locator('#snote-signup-complete').waitFor({state:'visible'});assert.equal(signup.posts.length,2);assert.equal(signup.posts[1].profile.kind,'dealer');await noSecrets(p);
    if(width===1440){await p.locator('#snote-signup-login').click();await p.locator('#zc-cloud-email').fill(EMAIL);await p.locator('#zc-cloud-password').fill(PASSWORD);await p.locator('#zc-cloud-submit').click();await f.ready();assert.equal(signup.completeCalls,1);assert.equal(await p.evaluate(()=>currentUser.role),'dealer');assert.equal(signup.setSessions.length,0,'Email-confirmed return signs in normally without replaying signup');assert.equal(signup.posts.length,2,'Email confirmation login must not resend signup/files');}
    await f.finish();results.push({kind:'representative/dealer same fields, 2 private file multipart, confirmation-pending, responsive layout',width,passed:true});console.log('PASS signup pending/layout',width);
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function validation(browser){
 const {f,p,signup}=await setup(browser);
 try{
  await open(p);await fill(p,{files:false});await p.locator(PREFIX+'submit').click();await p.locator('#snote-message-dialog[open]').waitFor();assert.equal(signup.posts.length,0);await p.locator('#snote-message-dialog [data-message-accept]').click();
  for(const field of ['business-certificate','dealer-license'])await p.locator(PREFIX+field).setInputFiles({name:'synthetic-'+field+'.png',mimeType:'image/png',buffer:PNG});
  await p.locator(PREFIX+'company').fill('수정된 합성 상사');await p.locator(PREFIX+'submit').click();await p.locator('#snote-message-dialog[open]').waitFor();assert.equal(signup.posts.length,0);await p.locator('#snote-message-dialog [data-message-accept]').click();
  await p.locator(PREFIX+'company').fill(COMPANY);await companyCheck(p);signup.checkAvailable=false;await p.locator(PREFIX+'company').fill('기등록 합성 상사');await p.locator(PREFIX+'company-check').click();await checkPopup(p,COMPANY_DUPLICATE);assert.equal(signup.posts.length,0);
  signup.checkAvailable=true;await p.locator(PREFIX+'company').fill(COMPANY);await companyCheck(p);signup.status='CONTACT_EXISTS';await p.locator(PREFIX+'submit').click();await checkPopup(p,CONTACT_DUPLICATE);assert.equal(signup.posts.length,1);assert.equal(await p.locator('#snote-registration-form').isVisible(),true);await noSecrets(p);
  signup.status='COMPANY_EXISTS';await p.locator(PREFIX+'password').fill(PASSWORD);await p.locator(PREFIX+'password-confirm').fill(PASSWORD);await p.locator(PREFIX+'submit').click();await checkPopup(p,COMPANY_DUPLICATE);assert.equal(signup.posts.length,2);
  await f.finish();results.push({kind:'missing attachments and stale company check block; exact company/contact duplicate popups',passed:true});console.log('PASS signup validation and duplicate guards');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-validation.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function metadataCannotBootstrap(browser){
 const {f,p,state,signup}=await setup(browser);state.user.user_metadata={snote_registration:{version:1,kind:'admin',company_name:'위조 합성 상사',display_name:'합성 가입자'}};
 const original=state.rpc;state.rpc=(label,input)=>input.name==='snote_registration_complete'?{data:null,error:{code:'22023',message:'REGISTRATION_REQUIRED'}}:original(label,input);
 try{
  await p.locator('#zc-cloud-email').fill(EMAIL);await p.locator('#zc-cloud-password').fill(PASSWORD);await p.locator('#zc-cloud-submit').click();await p.waitForFunction(()=>!__normalState.busy);assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(signup.member,false);assert(!state.rpcCalls.some(call=>call.name==='zc_bootstrap_company'),'User-editable admin metadata may not invoke legacy bootstrap');assert.equal(state.reads.filter(read=>read.table==='zc_companies').length,0);await noSecrets(p);await f.finish();results.push({kind:'user-editable admin metadata cannot create a company or bypass verified registration',passed:true});console.log('PASS signup metadata cannot bootstrap');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-metadata.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function attachmentLimits(browser){
 const {f,p,signup}=await setup(browser);
 try{
  await open(p);await fill(p);
  for(const file of [{name:'synthetic-too-large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)},{name:'synthetic-not-an-image.gif',mimeType:'image/gif',buffer:Buffer.from('GIF89a')}]){
   await p.locator(PREFIX+'business-certificate').setInputFiles(file);await p.locator(PREFIX+'submit').click();await p.locator('#snote-message-dialog[open]').waitFor();assert.equal(signup.posts.length,0,'Unsupported or oversized attachment must not reach registration API');await p.locator('#snote-message-dialog [data-message-accept]').click();
  }
  await noSecrets(p);await f.finish();results.push({kind:'JPEG/PNG/WebP and 5MiB attachment limit blocks invalid files before submission',passed:true});console.log('PASS signup attachment limits');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-files.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function staleAndUnknown(browser){
 const {f,p,signup}=await setup(browser);
 try{
  await open(p);await fill(p,{check:false});
  const released=deferred(),arrived=deferred();signup.holdCheck={promise:released.promise,arrive:arrived.resolve};
  await p.locator(PREFIX+'company-check').click();await arrived.promise;
  await p.locator(PREFIX+'company').fill('다른 합성 상사');released.resolve();
  await p.waitForFunction(()=>!document.getElementById('snote-registration-company-check').disabled);
  assert.notEqual(await p.locator(PREFIX+'company-status').getAttribute('data-state'),'available','A late response may not verify the edited company');
  await p.locator(PREFIX+'submit').click();await p.locator('#snote-message-dialog[open]').waitFor();assert.equal(signup.posts.length,0);await p.locator('#snote-message-dialog [data-message-accept]').click();
  signup.holdCheck=null;await p.locator(PREFIX+'company').fill(COMPANY);await companyCheck(p);signup.status='AUTH_STATUS_UNKNOWN';
  await p.locator(PREFIX+'submit').click();await p.locator('#snote-message-dialog[open]').waitFor();assert.match(await p.locator('#snote-message-copy').textContent(),/인증|메일|로그인/);assert.equal(signup.posts.length,1);assert.equal(signup.setSessions.length,0);
  await p.locator('#snote-message-dialog [data-message-accept]').click();await p.waitForTimeout(250);assert.equal(signup.posts.length,1,'An uncertain Auth result must never auto-retry signup');await noSecrets(p);await f.finish();results.push({kind:'stale available response ignored; uncertain Auth status gives mail/login guidance without retry',passed:true});console.log('PASS signup late check and unknown Auth outcome');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-stale.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function completionDuplicates(browser){
 const {f,p,state,signup}=await setup(browser),original=state.rpc;let reply;
 state.rpc=(label,input)=>{if(input.name!=='snote_registration_complete')return original(label,input);state.rpcCalls.push({label,name:input.name});signup.completeCalls++;return reply;};
 try{
  await open(p);await fill(p);await p.locator(PREFIX+'submit').click();await p.locator('#snote-signup-complete').waitFor({state:'visible'});assert.equal(signup.posts.length,1);await p.locator('#snote-signup-login').click();
  for(const code of ['COMPANY_EXISTS','CONTACT_EXISTS'])for(const envelope of ['data','error']){
   reply=envelope==='data'?{data:{ok:false,code},error:null}:{data:null,error:{code:'23505',message:code}};
   if(await p.locator('#zc-cloud-login').isHidden())await p.locator('#snote-auth-back').click();
   await p.locator('#zc-cloud-email').fill(EMAIL);await p.locator('#zc-cloud-password').fill(PASSWORD);await p.locator('#zc-cloud-submit').click();
   await checkPopup(p,code==='COMPANY_EXISTS'?COMPANY_DUPLICATE:CONTACT_DUPLICATE);await p.waitForFunction(()=>!__normalState.busy);assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(signup.member,false);assert.equal(signup.posts.length,1,'Confirmed-login collision must not resend signup');assert.equal(state.reads.filter(read=>read.table==='zc_companies').length,0);results.push({kind:'email-confirmed signup completion '+code+' '+envelope+' shows exact popup and denies workspace',passed:true});console.log('PASS signup completion duplicate',code,envelope);
  }
  await noSecrets(p);await f.finish();
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-completion-duplicate.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function lateRegistration(browser,change){
 const {f,p,state,signup}=await setup(browser);signup.status='immediate';const released=deferred(),arrived=deferred();signup.holdRegister={promise:released.promise,arrive:arrived.resolve};
 try{
  await open(p);await fill(p);await p.locator(PREFIX+'submit').click();await arrived.promise;
  assert.equal(signup.posts.length,1);assert.equal(signup.setSessions.length,0);
  if(change==='navigation')await p.goBack();
  else{const replacement=state.issue();await p.evaluate(session=>{const c=__normalSdk.main,opts=c.options,key=opts.storageKey||'sb-'+new URL(c.client.supabaseUrl).hostname.split('.')[0]+'-auth-token';c.session=session;(opts.storage||localStorage).setItem(key,JSON.stringify(session));c.callback?.('SIGNED_IN',session);},replacement);}
  await p.waitForFunction(()=>!__normalState.busy);released.resolve();await p.waitForTimeout(200);
  assert.equal(signup.setSessions.length,0,'A stale API session may not overwrite navigation or a newer SDK Auth actor');assert.equal(await p.locator(PREFIX+'name').inputValue(),'','A canceled/new-actor signup must clear the previous personal fields');assert.equal(await p.locator(PREFIX+'business-certificate').evaluate(element=>element.files.length),0,'A canceled/new-actor signup must clear previous document selections');assert.equal(signup.completeCalls,0);assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(await p.locator('#snote-signup-complete').isVisible(),false);assert.equal(state.reads.filter(read=>read.table==='zc_companies').length,0);await noSecrets(p);await f.finish();results.push({kind:'held registration API response discarded after '+change+' with zero session installs/private completions',passed:true});console.log('PASS signup late registration rejects',change);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-late-'+change+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}finally{released.resolve();}
}
async function unknownInitialSession(browser){
 const {f,p,state,signup}=await setup(browser);
 try{
  await open(p);await fill(p);assert.equal(await p.evaluate(()=>__normalState.user),null);
  const session=state.issue(),authKey='sb-'+new URL(constants.DB).hostname.split('.')[0]+'-auth-token';
  await p.evaluate(({session,authKey})=>{const client=__normalSdk.main;if(client){const options=client.options||{};client.session=session;(options.storage||sessionStorage).setItem(options.storageKey||authKey,JSON.stringify(session));}else sessionStorage.setItem(authKey,JSON.stringify(session));},{session,authKey});
  assert.equal(await p.evaluate(()=>__normalState.user),null,'The external initial session is not an authenticated app actor');
  await p.locator(PREFIX+'submit').click();await checkPopup(p,'이미 로그인된 계정이 있습니다. 로그인 화면에서 계정을 먼저 확인해 주세요.');await p.waitForFunction(()=>!__normalState.busy);
  assert.equal(signup.posts.length,0,'Capture must reject the unadopted existing session before the registration API');assert.equal(signup.setSessions.length,0);assert.equal(signup.completeCalls,0);assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(await p.locator('#snote-registration-form').isVisible(),true);assert.equal(await p.evaluate(()=>__normalSdk.main.client.auth.getSession().then(value=>value.data.session.access_token)),session.access_token,'Rejected signup must preserve the other session');await noSecrets(p);await f.finish();results.push({kind:'unadopted initial Auth session blocks signup before API/session install and preserves the prior session',passed:true});console.log('PASS signup unknown initial session');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-initial-session.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function immediateCompletionErrors(browser){
 const cases=[
  {name:'COMPANY_EXISTS',reply:{data:{ok:false,code:'COMPANY_EXISTS'},error:null},exact:COMPANY_DUPLICATE},
  {name:'CONTACT_EXISTS',reply:{data:null,error:{code:'23505',message:'CONTACT_EXISTS'}},exact:CONTACT_DUPLICATE},
  {name:'PGRST202',reply:{data:null,error:{code:'PGRST202',message:'Could not find the function public.snote_registration_complete in the schema cache'}}},
  {name:'REGISTRATION_REQUIRED',reply:{data:{ok:false,code:'REGISTRATION_REQUIRED'},error:null}}
 ];
 for(const test of cases){
  const {f,p,state,signup}=await setup(browser),original=state.rpc;signup.status='immediate';
  state.rpc=(label,input)=>{if(input.name!=='snote_registration_complete')return original(label,input);state.rpcCalls.push({label,name:input.name});signup.completeCalls++;return structuredClone(test.reply);};
  try{
   await open(p);await fill(p);await p.locator(PREFIX+'submit').click();const dialog=p.locator('#snote-message-dialog[open]');await dialog.waitFor({state:'visible'});
   const text=await dialog.locator('#snote-message-copy').textContent();if(test.exact)assert.equal(text,test.exact);else assert(text.trim(),'A completion/setup failure must remain visible rather than silently hiding the form');
   assert.equal(await p.locator('#snote-registration-form').isVisible(),true,'Immediate completion failure must preserve the registration form behind its error popup');assert.equal(await p.locator('#snote-signup-complete').isVisible(),false,'An unsuccessful completion is never email-confirmation success');assert.equal(await p.locator('#zc86-onboard').isVisible(),false,'The new immediate flow may not switch to legacy onboarding');assert.equal(await p.evaluate(()=>__normalState.ready),false);assert.equal(signup.member,false);assert.equal(signup.completeCalls,1);assert.equal(signup.setSessions.length,1);assert.equal(signup.posts.length,1);assert.equal(state.reads.filter(read=>read.table==='zc_companies').length,0);
   await dialog.locator('[data-message-accept]').click();await p.waitForFunction(()=>!__normalState.busy);assert.equal(await p.locator('#snote-registration-form').isVisible(),true);assert.equal(await p.locator(PREFIX+'password').inputValue(),'');await noSecrets(p);await f.finish();results.push({kind:'immediate private completion '+test.name+' keeps registration form/error and denies workspace',passed:true});console.log('PASS immediate signup completion error',test.name);
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-immediate-completion-'+test.name+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
 }
}
async function immediate(browser,kind){
 const {f,p,state,signup}=await setup(browser);signup.status='immediate';
 try{await open(p,kind);await fill(p);await p.locator(PREFIX+'submit').click();await f.ready();await p.waitForFunction(()=>!__normalState.busy);assert.equal(signup.posts.length,1);assert.equal(signup.setSessions.length,1);assert.equal(signup.completeCalls,1);assert.equal(await p.evaluate(()=>currentUser.role),kind==='representative'?'admin':'dealer');assert.equal(await p.evaluate(()=>route),'dashboard');assert(!state.rpcCalls.some(call=>call.name==='zc_bootstrap_company'));assert.equal(await p.locator('#zc-cloud-gate').isHidden(),true);await noSecrets(p);await f.finish();results.push({kind:'API session adopted via setSession, verified private registration completes with server role '+kind,passed:true});console.log('PASS immediate signup',kind);}catch(error){await p.screenshot({path:path.join(OUT,'failure-immediate-'+kind+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
if(require.main===module){
(async()=>{const before=hashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});try{const focus=process.env.SNOTE_SIGNUP_FOCUS;if(!focus||focus==='initial-auth')await unknownInitialSession(browser);if(!focus){for(const width of WIDTHS)await layoutAndPending(browser,width);await validation(browser);await attachmentLimits(browser);await staleAndUnknown(browser);await metadataCannotBootstrap(browser);await immediate(browser,'representative');await immediate(browser,'dealer');}if(!focus||focus==='races'){await lateRegistration(browser,'navigation');await lateRegistration(browser,'other-tab-auth');}if(!focus||focus==='completion')await completionDuplicates(browser);if(!focus||focus==='immediate-errors')await immediateCompletionErrors(browser);if(focus==='screenshots')for(const width of WIDTHS)await layoutAndPending(browser,width);assert.deepEqual(hashes(),before,'Product sources must remain frozen during this verification');}finally{await browser.close();fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({syntheticOnly:true,productionReads:0,productionWrites:0,sourceHashes:before,results},null,2)+'\n');}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
}
module.exports={setup,open,fill,companyCheck,constants:{PREFIX,PNG,PASSWORD,COMPANY,PHONE,EMAIL}};
