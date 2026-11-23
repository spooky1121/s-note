'use strict';
// Real signup/invite UI; all Auth, RPC, files, and destination navigation are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_SIGNUP_URL_ARTIFACT_DIR||'/workspace/work/signup-url-v2197/browser';
const CANONICAL='https://s-note.kr/',LEGACY='https://zerocar-office.pages.dev',PASSWORD='SyntheticSignup!123';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const results=[];fs.mkdirSync(OUT,{recursive:true});

// Adapt only the test fixture origin. The application source and its URL logic remain untouched.
function normalFixture(origin){
 const file=path.join(__dirname,'normal-login.browser.cjs'),source=fs.readFileSync(file,'utf8'),marker="ORIGIN='https://normal-login-fixture.example'";
 assert(source.includes(marker));const loaded=new Module(path.join(__dirname,'normal-login-origin-fixture.cjs'),module);
 loaded.filename=path.join(__dirname,'normal-login-origin-fixture.cjs');loaded.paths=Module._nodeModulePaths(__dirname);
 loaded._compile(source.replace(marker,'ORIGIN='+JSON.stringify(origin)),loaded.filename);return loaded.exports;
}
const sourceHashes=()=>Object.fromEntries(['index.html','assets/signup-registration.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
async function signupFixture(browser,{origin=LEGACY,width=1440}={}){
 const normal=normalFixture(origin),state=normal.backend(),f=await normal.boot(browser,state,'signup-url-'+width,{width}),p=f.page,posts=[];
 await p.evaluate(()=>{const original=window.__normalFactory;window.__directSignups=[];window.__normalFactory=(...args)=>{const client=original(...args);client.auth.signUp=async value=>{window.__directSignups.push(value);return{data:{user:{id:'22222222-2222-4222-8222-222222222222',email:value.email,identities:[{id:'synthetic-identity'}]},session:null},error:null};};return client;};});
 await p.route('**/api/registration',async route=>{
  const req=route.request();assert.equal(req.method(),'POST');
  if((req.headers()['content-type']||'').startsWith('application/json')){assert.equal(req.postDataJSON().action,'check-company');return route.fulfill({contentType:'application/json',body:'{"ok":true,"available":true}'});}
  const form=await new Request(req.url(),{method:'POST',headers:req.headers(),body:req.postDataBuffer()}).formData();
  assert.deepEqual([...form.keys()].sort(),['businessCertificate','dealerLicense','password','profile']);assert.equal(form.get('password'),PASSWORD);
  const profile=JSON.parse(form.get('profile'));assert(['representative','dealer'].includes(profile.kind));posts.push(profile);
  return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,email:profile.email,confirmationRequired:true,session:null})});
 });return{f,p,state,posts};
}
async function guidance(p){
 const panel=p.locator('#snote-signup-complete');await panel.waitFor({state:'visible'});
 const link=panel.locator('#snote-signup-access-url');assert.equal(await link.getAttribute('href'),CANONICAL);assert.equal(await link.textContent(),CANONICAL);assert(await link.isVisible());
 assert.match(await panel.innerText(),/공식 접속 주소/);assert(!await panel.innerText().then(text=>text.includes('zerocar-office.pages.dev')));
 assert.equal(await p.locator('#snote-signup-login').isEnabled(),true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}
async function pending(browser,{kind,origin,width}){
 const {f,p,state,posts}=await signupFixture(browser,{origin,width});
 try{
  await p.locator(kind==='representative'?'#zc86-register':'#snote-dealer-register').click();await p.locator('#snote-registration-form').waitFor({state:'visible'});
  const values={company:'합성 가입 안내 상사',business:'123-45-67890',owner:'합성 대표',address:'합성시 합성로 10','address-detail':'합성동 101호',name:'합성 가입자',phone:'010-1234-5678',email:'new-'+kind+'@example.invalid',password:PASSWORD,'password-confirm':PASSWORD};
  for(const [key,value]of Object.entries(values))await p.locator('#snote-registration-'+key).fill(value);
  for(const key of['business-certificate','dealer-license'])await p.locator('#snote-registration-'+key).setInputFiles({name:'synthetic-'+key+'.png',mimeType:'image/png',buffer:PNG});
  await p.locator('#snote-registration-company-check').click();await p.waitForFunction(()=>document.getElementById('snote-registration-company-status').dataset.state==='available');
  await p.locator('#snote-registration-submit').click();await guidance(p);assert.equal(posts.length,1);assert.equal(posts[0].kind,kind);assert.equal(await p.evaluate(()=>__directSignups.length),0,'Representative/dealer signup retains the private registration API');assert.equal(state.passwordCalls.length,0);
  assert.equal(await p.locator('#snote-registration-password').inputValue(),'');await p.screenshot({path:path.join(OUT,'pending-'+kind+'-'+width+'.png'),fullPage:true});
  if(origin===new URL(CANONICAL).origin){
   await p.evaluate(()=>window.__sameDocumentSignupCanary='preserved');await p.locator('#snote-signup-login').click();await p.locator('#zc-cloud-login').waitFor({state:'visible'});
   assert.equal(await p.evaluate(()=>window.__sameDocumentSignupCanary),'preserved','Official-domain completion stays in the same document');assert.equal(new URL(p.url()).origin,origin);assert.equal(await p.locator('#zc-cloud-email').inputValue(),values.email);
  }else{
   let navigations=0;await p.route(CANONICAL,route=>{navigations++;return route.fulfill({contentType:'text/html',body:'<!doctype html><title>합성 공식 로그인 도착</title><p>공식 로그인</p>'});});
   await p.locator('#snote-signup-login').click();await p.waitForURL(CANONICAL);assert.equal(navigations,1);assert.equal(p.url(),CANONICAL,'Legacy-host completion leads to the exact official root without a password, token, or old invite in the URL');
  }
  await f.finish();results.push({kind:'pending '+kind,width,origin,officialGuidance:true,completionNavigation:true,privateSignupPosts:posts.length,passed:true});console.log('PASS signup access pending',kind,width,origin);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-pending-'+kind+'-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function staffSignup(browser){
 const {f,p,posts}=await signupFixture(browser,{origin:LEGACY,width:390});
 try{
  await p.locator('#snote-invite-open').click();await p.locator('#snote-staff-signup').waitFor({state:'visible'});
  const code='SyntheticStaffInvite_0123456789ABCDEF',values={code,name:'합성 직원',phone:'010-1234-5678',email:'staff@example.invalid',password:PASSWORD,'password-confirm':PASSWORD};
  for(const [key,value]of Object.entries(values))await p.locator('#snote-staff-'+key).fill(value);
  await p.locator('#snote-staff-submit').click();await guidance(p);
  const calls=await p.evaluate(()=>__directSignups);assert.equal(calls.length,1);assert.equal(calls[0].options.emailRedirectTo,CANONICAL);assert.equal(calls[0].options.data.snote_registration.invite_code,code);assert.equal(posts.length,0);
  assert.equal(new URL(calls[0].options.emailRedirectTo).hash,'');assert.equal(new URL(calls[0].options.emailRedirectTo).search,'');
  await p.screenshot({path:path.join(OUT,'staff-signup-390.png'),fullPage:true});await f.finish();results.push({kind:'legacy-host staff signup email redirect and code preserved',width:390,origin:LEGACY,passed:true});console.log('PASS signup access staff email redirect');
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-staff.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function inviteLinks(width){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;
 try{
  // Settings mounts the unrelated catalogue status probe; keep it unavailable locally.
  await f.context.route('**/api/vehicle-taxonomy-probe**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"ok":false,"code":"SETUP_REQUIRED"}'}));
  await p.evaluate(()=>{
   const s=__encarFixtureState,rpc=s.client.rpc.bind(s.client);window.__signupInviteCalls=[];window.__signupInviteCopies=[];
   currentUser.role='admin';for(const member of s.members)if(member.user_id===s.user.id)member.role='admin';
   s.client.rpc=async(name,args)=>{if(name==='zc_issue_invite'){__signupInviteCalls.push({name,args});return{data:'SyntheticInvite_'+args.p_role+'_0123456789ABCDEF',error:null};}if(name==='snote_company_staff_logins')return{data:[],error:null};return rpc(name,args);};
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>__signupInviteCopies.push(value)}});navigate('settings');
  });
  await p.locator('#zc86-invite-create').waitFor({state:'visible'});
  for(const role of['dealer','accountant']){
   const email='invited-'+role+'@example.invalid';await p.locator('#zc86-invite-email').fill(email);await p.locator('#zc86-invite-role').selectOption(role);await p.locator('#zc86-invite-create').click();
   const result=p.locator('#zc86-invite-result'),link=result.getByRole('textbox',{name:'직원 가입 초대 링크'});await link.waitFor();
   const value=await link.inputValue(),url=new URL(value),code='SyntheticInvite_'+role+'_0123456789ABCDEF';assert.equal(url.origin,new URL(CANONICAL).origin);assert.equal(url.pathname,'/');assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('invite'),code);assert.equal(value,CANONICAL+'#invite='+code);
   await result.getByRole('button',{name:'초대 링크 복사',exact:true}).click();assert.equal(await p.evaluate(()=>__signupInviteCopies.at(-1)),value);
  }
  assert.equal(await p.evaluate(()=>__signupInviteCalls.length),2);assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:path.join(OUT,'invite-links-'+width+'.png'),fullPage:true});await finish(f);results.push({kind:'admin dealer/accountant canonical invitation and clipboard/hash preservation',width,passed:true});console.log('PASS signup access invite links',width);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-invite-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function main(){
 const before=sourceHashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  await pending(browser,{kind:'representative',origin:LEGACY,width:1440});
  await pending(browser,{kind:'dealer',origin:LEGACY,width:390});
  await pending(browser,{kind:'dealer',origin:new URL(CANONICAL).origin,width:390});
  await staffSignup(browser);await inviteLinks(1440);await inviteLinks(390);
  assert.deepEqual(sourceHashes(),before,'Product source remains unchanged during verification');
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({passed:results.length===6,syntheticOnly:true,productionRequests:0,operationalEmailsSent:0,results,sourceHashes:before},null,2)+'\n');}
}
module.exports={normalFixture};
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
