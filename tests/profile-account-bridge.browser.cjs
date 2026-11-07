'use strict';
// Actual profile account bridge in index.html. Auth, HTTP, Storage and SMS replies
// are synthetic; no production request, real SMS or credential change is made.
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',DB='https://profile-bridge.supabase.co';
const KEY='synthetic-profile-public-key',BUCKET='snote-profile-photos';
const ID='33333333-3333-4333-8333-333333333333',OLD_ID='44444444-4444-4444-8444-444444444444';
const token=id=>Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic-signature';
const TOKENS={[ACTOR]:token(ACTOR),[OTHER]:token(OTHER)};
const clone=value=>structuredClone(value);

async function setup(width=1440,{existingAvatar=false}={}){
 const f=await fixture(width),p=f.page;
 await p.evaluate(async()=>{await closeVehicle({discard:true});});
 const png=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=2;c.height=2;c.getContext('2d').fillRect(0,0,2,2);return c.toDataURL('image/png').split(',')[1];});
 const state={requests:[],objects:new Map(),profile:{user_id:ACTOR,company_id:COMPANY,role:'dealer',display_name:'브리지 검증 사용자',company_name:'브리지 검증 상사',phone:'01012345678',address:'서울특별시 합성 상사 주소 12',company_address:'서울특별시 합성 상사 주소 12',revision:0},avatar:{user_id:ACTOR,company_id:COMPANY,avatar_path:null,avatar_revision:0},avatarMode:'ok',avatarReceipt:null,phoneMode:'ok',profileMode:'ok',holds:new Map(),png:Buffer.from(png,'base64'),uploads:[],deletes:[],downloadCount:0};
 if(existingAvatar){state.avatar.avatar_path=COMPANY+'/'+ACTOR+'/'+OLD_ID+'.png';state.avatar.avatar_revision=1;state.objects.set(state.avatar.avatar_path,{body:state.png,type:'image/png'});}
 f.profile=state;
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, DELETE, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type, x-upsert, cache-control, x-client-info'};
 async function hold(name,path){const h=state.holds.get(name);if(h&&(!h.path||h.path===path)){h.waiting=true;await new Promise(resolve=>h.resolve=resolve);}}
 function reply(route,data,status=200){return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});}
 await f.context.route(DB+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const call={method:req.method(),path:url.pathname,authorization:req.headers().authorization,apikey:req.headers().apikey,body:req.postData()};state.requests.push(call);
  assert.equal(call.apikey,KEY);assert.equal(call.authorization,'Bearer '+TOKENS[ACTOR],'Every old-account operation must retain the verified old token');
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=decodeURIComponent(url.pathname.split('/').pop()),args=JSON.parse(req.postData()||'{}');call.name=name;call.args=args;
   if(name==='snote_profile_read'){const snapshot=clone(state.profile);await hold('profileRead');return reply(route,snapshot);}
   if(name==='snote_profile_save'){
    assert.deepEqual(Object.keys(args.p_expected).sort(),['company_id','company_name','display_name','revision','user_id']);
    if(state.profileMode==='conflict'||args.p_expected.revision!==state.profile.revision)return reply(route,{code:'40001',message:'PROFILE_CONFLICT'},409);
    if(args.p_profile.phone!==state.profile.phone)return reply(route,{code:'42501',message:'PHONE_VERIFICATION_REQUIRED'},403);
    if(args.p_profile.address!==state.profile.address)return reply(route,{code:'42501',message:'COMPANY_ADDRESS_READ_ONLY'},403);
    Object.assign(state.profile,args.p_profile);state.profile.revision++;return reply(route,clone(state.profile));
   }
   if(name==='snote_profile_avatar_read'){assert.equal(args.p_company,COMPANY);const snapshot=clone(state.avatar);await hold('avatarRead');return reply(route,snapshot);}
   if(name==='snote_profile_avatar_save'){
    assert.equal(args.p_company,COMPANY);assert.match(args.p_file_path,new RegExp('^'+COMPANY+'/'+ACTOR+'/[a-f0-9-]{36}\\.(?:png|jpg|webp)$'));
    assert(state.objects.has(args.p_file_path),'Metadata may only reference an uploaded private object');
    if(state.avatarMode==='conflict')return reply(route,{code:'40001',message:'PROFILE_AVATAR_CONFLICT'},409);
    if(state.avatarReceipt&&state.avatar.avatar_path===args.p_file_path&&state.avatar.avatar_revision===args.p_expected_revision+1){
     if(state.avatarMode==='unknown-always')return route.abort('failed');return reply(route,clone(state.avatarReceipt));
    }
    if(args.p_expected_revision!==state.avatar.avatar_revision)return reply(route,{code:'40001',message:'PROFILE_AVATAR_CONFLICT'},409);
    const previous=state.avatar.avatar_path;state.avatar={...state.avatar,avatar_path:args.p_file_path,avatar_revision:state.avatar.avatar_revision+1};state.avatarReceipt={...clone(state.avatar),previous_path:previous};
    if(state.avatarMode==='unknown-once'||state.avatarMode==='unknown-always')return route.abort('failed');return reply(route,clone(state.avatarReceipt));
   }
   throw Error('Unexpected profile RPC '+name);
  }
  const uploadPrefix='/storage/v1/object/'+BUCKET+'/',downloadPrefix='/storage/v1/object/authenticated/'+BUCKET+'/';
  if(req.method()==='POST'&&url.pathname.startsWith(uploadPrefix)){
   const path=decodeURIComponent(url.pathname.slice(uploadPrefix.length));assert.equal(req.headers()['x-upsert'],'false','Avatar uploads must be create-only');
   assert.equal(req.headers()['content-type'],'image/png');const body=req.postDataBuffer();assert(body&&body.length>0);assert(body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
   state.objects.set(path,{body,type:'image/png'});state.uploads.push(path);await hold('upload');return reply(route,{Key:BUCKET+'/'+path});
  }
  if(req.method()==='GET'&&url.pathname.startsWith(downloadPrefix)){
   const path=decodeURIComponent(url.pathname.slice(downloadPrefix.length));state.downloadCount++;await hold('download',path);if(state.failDownload)return reply(route,{code:'TEMPORARILY_UNAVAILABLE'},503);const row=state.objects.get(path);
   if(!row)return reply(route,{message:'Object not found'},404);return route.fulfill({status:200,headers,contentType:row.type,body:row.body});
  }
  if(req.method()==='DELETE'&&url.pathname==='/storage/v1/object/'+BUCKET){
   const body=JSON.parse(req.postData()||'{}');assert(Array.isArray(body.prefixes));
   for(const path of body.prefixes){state.deletes.push(path);if(path===state.avatar.avatar_path)return reply(route,{code:'42501',message:'REFERENCED_AVATAR'},403);state.objects.delete(path);}return reply(route,[]);
  }
  throw Error('Unexpected profile Storage call '+req.method()+' '+url.pathname);
 });
 await f.context.route('**/api/profile-phone',async route=>{
  const req=route.request(),b=JSON.parse(req.postData()||'{}');state.requests.push({method:req.method(),path:'/api/profile-phone',authorization:req.headers().authorization,args:b});
  assert.equal(req.method(),'POST');assert.equal(req.headers().authorization,'Bearer '+TOKENS[ACTOR]);assert.equal(b.companyId,COMPANY);
  if(state.phoneMode==='rate')return route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({ok:false,code:'RATE_LIMITED',error:'잠시 후 다시 시도해 주세요.',retryAfter:30})});
  if(b.action==='send-code'){assert.equal(b.phone,'01098765432');assert.equal(b.expected.user_id,ACTOR);assert.equal(b.expected.company_id,COMPANY);assert.equal(b.expected.phone,state.profile.phone);assert.match(b.requestId,/^[a-f0-9-]{36}$/);return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,challengeId:ID,expiresAt:new Date(Date.now()+300000).toISOString(),retryAfter:60})});}
  assert.equal(b.action,'verify');assert.equal(b.phone,'01098765432');assert.equal(b.challengeId,ID);
  if(b.code!=='123456')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,code:'INVALID_CODE',error:'인증번호가 일치하지 않습니다.'})});
  state.profile.phone=b.phone;state.profile.revision++;return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,profile:clone(state.profile)})});
 });
 await p.evaluate(({actor,other,company,key,url,tokens})=>{
  const S=__encarFixtureState,previous=S.client;
  window.__profileBridgeTest={sessionCalls:0,verifiedTokens:[],mutableAuthReads:0,mutableRpcCalls:0,holdSession:false,sessionWaiting:false,releases:[],urls:[],revoked:[]};const q=__profileBridgeTest;
  S.client={...previous,supabaseUrl:url,supabaseKey:key,auth:{...previous.auth,
   async getSession(){q.sessionCalls++;const snapshot={access_token:tokens[S.user.id],refresh_token:'synthetic-refresh-'+S.user.id,user:structuredClone(S.user)};if(q.holdSession){q.sessionWaiting=true;await new Promise(resolve=>q.releases.push(resolve));}return{data:{session:snapshot},error:null};},
   async getUser(jwt){if(jwt===undefined){q.mutableAuthReads++;return{data:{user:structuredClone(S.user)},error:null};}q.verifiedTokens.push(jwt);const id=Object.keys(tokens).find(id=>tokens[id]===jwt);return id?{data:{user:{id,email:'synthetic@example.invalid'}},error:null}:{data:{user:null},error:{code:'bad_jwt',message:'Invalid token'}};}
  },rpc(name,args){if(name.startsWith('snote_profile_')){q.mutableRpcCalls++;throw Error('Profile must not reacquire a mutable SDK RPC token');}return previous.rpc(name,args);}};
  S.rpcConfig={client:S.client,url,key};S.company={id:company,name:'브리지 검증 상사'};S.members=[{user_id:actor,company_id:company,role:'dealer',active:true,display_name:'브리지 검증 사용자'},{user_id:other,company_id:company,role:'dealer',active:true,display_name:'전환한 사용자'}];
  const alias=id=>'cld_'+id.replaceAll('-','').slice(0,18);q.ownAlias=alias(actor);q.peerAlias=alias(other);q.foreignAlias=alias('99999999-9999-4999-8999-999999999999');
  dealerAccounts=dealerAccounts.filter(account=>![q.ownAlias,q.peerAlias,q.foreignAlias].includes(account.username));
  dealerAccounts.push({username:q.ownAlias,name:'이전 내 이름',company:'이전 내 상사 표시',role:'dealer'},{username:q.peerAlias,name:'동일 상사 직원',company:'이전 동료 상사 표시',role:'dealer'},{username:q.foreignAlias,name:'다른 상사 직원',company:'다른 상사 보존',role:'dealer'});
  currentUser.name='브리지 검증 사용자';currentUser.company=S.company.name;window.snoteLoadDocumentLogo=async()=>null;
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);q.urls.push(url);return url;};URL.revokeObjectURL=url=>{q.revoked.push(url);return revoke(url);};
 },{actor:ACTOR,other:OTHER,company:COMPANY,key:KEY,url:DB,tokens:TOKENS});
 f.hold=(name,path)=>{const h={waiting:false,resolve:null,path};state.holds.set(name,h);return h;};
 f.release=name=>{const h=state.holds.get(name);state.holds.delete(name);h?.resolve?.();};
 f.wait=name=>p.waitForFunction(()=>true).then(async()=>{for(let n=0;n<150;n++){if(state.holds.get(name)?.waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Did not reach held '+name);});
 return f;
}

async function read(f){return f.page.evaluate(async()=>{const context=snoteProfileBridge.context();return await snoteProfileBridge.read(context);});}
async function changeAccount(p,id=OTHER){await p.evaluate(id=>{const S=__encarFixtureState;S.user={id,email:'second@example.invalid'};currentUser={...currentUser,username:'cld_'+id.replaceAll('-','').slice(0,18),name:'전환한 사용자'};document.getElementById('profile-name').textContent='전환한 사용자';document.getElementById('profile-avatar').textContent='전';},id);}
async function upload(f,expected=f.profile.avatar){return f.page.evaluate(async expected=>{const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),file=new File([blob],'synthetic-face.png',{type:'image/png'});return await snoteProfileBridge.avatarSave(snoteProfileBridge.context(),file,expected);},expected);}
function expected(profile){return Object.fromEntries(['user_id','company_id','display_name','company_name','revision'].map(key=>[key,profile[key]]));}
function phoneExpected(profile){return{...expected(profile),phone:profile.phone};}


async function assertCompanyCache(p){
 const result=await p.evaluate(()=>{const q=__profileBridgeTest,find=alias=>dealerAccounts.find(account=>account.username===alias);return{own:find(q.ownAlias).company,peer:find(q.peerAlias).company,foreign:find(q.foreignAlias).company,foreignName:find(q.foreignAlias).name};});
 assert.deepEqual(result,{own:'브리지 검증 상사',peer:'브리지 검증 상사',foreign:'다른 상사 보존',foreignName:'다른 상사 직원'},'Only account aliases belonging to the current server company may receive the company name');
}

async function profileAndPhoto(width){
 const f=await setup(width),p=f.page,result=await read(f);await assertCompanyCache(p);assert.equal(result.profile.address,f.profile.profile.company_address);assert.equal(result.profile.user_id,ACTOR);assert.equal(result.avatar.avatar_path,null);assert.equal(await p.evaluate(()=>typeof snoteProfileBridge.changeEmail),'undefined');
 const saved=await p.evaluate(async({profile,expected})=>{return await snoteProfileBridge.save(snoteProfileBridge.context(),expected,{display_name:'새 프로필 이름',company_name:profile.company_name,phone:profile.phone,address:profile.address});},{profile:f.profile.profile,expected:expected(f.profile.profile)});
 await assertCompanyCache(p);assert.equal(saved.profile.display_name,'새 프로필 이름');assert.equal(f.profile.profile.phone,'01012345678');assert.equal(await p.locator('#profile-name').textContent(),'새 프로필 이름 · 딜러');
 const photo=await upload(f);assert.match(photo.avatarURL,/^blob:/);assert.equal(photo.avatar.avatar_revision,1);assert.equal(f.profile.uploads.length,1);assert.equal(f.profile.deletes.length,0);assert.equal(await p.locator('#profile-avatar img').count(),1);assert.equal(await p.locator('#profile-avatar img').getAttribute('src'),photo.avatarURL);
 await p.locator('#profile-avatar img').waitFor({state:'visible'});
 const avatarLayout=await p.locator('#profile-avatar').evaluate(host=>{
  const rect=host.getBoundingClientRect(),css=getComputedStyle(host),image=host.querySelector('img'),calculator=document.getElementById('snote-calculator-trigger').getBoundingClientRect(),name=document.getElementById('profile-name').getBoundingClientRect();
  const radius=parseFloat(css.borderTopLeftRadius)*(css.borderTopLeftRadius.endsWith('%')?rect.width/100:1);
  return{width:rect.width,height:rect.height,radius,clipped:css.overflow==='hidden',imageFit:getComputedStyle(image).objectFit,afterCalculator:rect.left>=calculator.right,beforeName:rect.right<=name.left,centerDifference:Math.abs(rect.top+rect.height/2-calculator.top-calculator.height/2),overflow:document.documentElement.scrollWidth>innerWidth};
 });
 assert(avatarLayout.width>=28&&avatarLayout.width<=32,JSON.stringify(avatarLayout));assert.equal(avatarLayout.width,avatarLayout.height);assert(avatarLayout.radius>=avatarLayout.width/2);assert.equal(avatarLayout.clipped,true);assert.equal(avatarLayout.imageFit,'cover');assert.equal(avatarLayout.afterCalculator,true);assert.equal(avatarLayout.beforeName,true);assert(avatarLayout.centerDifference<1);assert.equal(avatarLayout.overflow,false);
 await p.locator('.topbar').screenshot({path:'/tmp/snote-v281-topbar-avatar-'+width+'.png'});
 await p.locator('#profile-avatar').click();await p.locator('#snote-profile-menu').waitFor({state:'visible'});await p.keyboard.press('Escape');
 const reopened=await read(f);assert.equal(reopened.avatar.avatar_path,photo.avatar.avatar_path);assert.match(reopened.avatarURL,/^blob:/);assert.equal(await p.evaluate(()=>__profileBridgeTest.mutableRpcCalls),0);assert.equal(await p.evaluate(()=>__profileBridgeTest.mutableAuthReads),0);assert((await p.evaluate(()=>__profileBridgeTest.verifiedTokens)).every(token=>token===TOKENS[ACTOR]));
 await finish(f);console.log('PASS',width,'actual pinned profile read/save, foreign-company cache isolation, readonly company address, email mutation removed and private avatar upload/read/topbar persistence');
}

async function invalidPhotos(){
 const f=await setup(),p=f.page;await read(f);const before=f.profile.requests.length;
 const failures=await p.evaluate(async avatar=>{const files=[new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'unsafe.svg',{type:'image/svg+xml'}),new File(['not-an-image'],'pretend.png',{type:'image/png'}),new File([new Uint8Array(5242881)],'large.png',{type:'image/png'})];const results=[];for(const file of files){try{await snoteProfileBridge.avatarSave(snoteProfileBridge.context(),file,avatar);results.push('ACCEPTED');}catch(error){results.push(error.code||error.message);}}return results;},f.profile.avatar);
 assert.equal(failures.length,3);assert(failures.every(result=>result!=='ACCEPTED'));assert.equal(f.profile.requests.length,before,'Invalid avatars must produce no upload or metadata mutation');await finish(f);console.log('PASS avatar MIME/magic/size validation rejects unsafe, disguised and oversized images before HTTP');
}


async function imageRecovery(){
 const missing=await setup(1440,{existingAvatar:true});const previous=missing.profile.avatar.avatar_path;missing.profile.objects.delete(previous);
 const unavailable=await read(missing);assert.equal(unavailable.avatar.avatar_revision,1);assert.equal(unavailable.avatar.avatar_path,previous);assert.equal(unavailable.avatarURL,null);assert(unavailable.avatarError);
 const replacement=await upload(missing,unavailable.avatar);assert.equal(replacement.avatar.avatar_revision,2);assert.match(replacement.avatarURL,/^blob:/);await finish(missing);
 console.log('PASS missing old avatar keeps its metadata for CAS and permits a valid replacement');
 const acknowledged=await setup(1440,{existingAvatar:true});await read(acknowledged);const before=clone(acknowledged.profile.avatar);acknowledged.profile.failDownload=true;
 const saved=await upload(acknowledged,before);assert.equal(saved.avatar.avatar_revision,2);assert.equal(saved.avatar.avatar_path,acknowledged.profile.avatar.avatar_path);assert.equal(saved.avatarURL,null);assert(saved.avatarError);assert.deepEqual(acknowledged.profile.deletes,[],'Preview failure after a committed ACK must retain previous and current bytes');
 acknowledged.profile.failDownload=false;const recovered=await read(acknowledged);assert.equal(recovered.avatar.avatar_revision,2);assert.match(recovered.avatarURL,/^blob:/);await finish(acknowledged);
 console.log('PASS acknowledged avatar remains saved after preview failure, preserves both files and recovers on reload');
}

async function phoneFlow(){
 const f=await setup(),p=f.page;await read(f);
 const sent=await p.evaluate(async args=>await snoteProfileBridge.phoneSend(snoteProfileBridge.context(),args),{phone:'01098765432',expected:phoneExpected(f.profile.profile),requestId:ID});assert.equal(sent.challengeId,ID);assert.equal(sent.retryAfterSeconds,60);assert.equal(f.profile.profile.phone,'01012345678','Sending code alone must not change the number');
 const invalid=await p.evaluate(async({id})=>{try{await snoteProfileBridge.phoneConfirm(snoteProfileBridge.context(),{phone:'01098765432',challengeId:id,code:'000000'});return'ACCEPTED';}catch(e){return e.code;}},{id:ID});assert.equal(invalid,'INVALID_CODE');assert.equal(f.profile.profile.phone,'01012345678');
 const confirmed=await p.evaluate(async id=>await snoteProfileBridge.phoneConfirm(snoteProfileBridge.context(),{phone:'01098765432',challengeId:id,code:'123456'}),ID);assert.equal(confirmed.profile.phone,'01098765432');assert.equal(confirmed.profile.revision,1);
 f.profile.phoneMode='rate';const limited=await p.evaluate(async args=>{try{await snoteProfileBridge.phoneSend(snoteProfileBridge.context(),args);return'ACCEPTED';}catch(e){return e.code;}},{phone:'01098765432',expected:phoneExpected(f.profile.profile),requestId:ID});assert.equal(limited,'RATE_LIMITED');
 const changed=await p.evaluate(async({profile,expected})=>{try{await snoteProfileBridge.save(snoteProfileBridge.context(),expected,{display_name:profile.display_name,company_name:profile.company_name,phone:'01022223333',address:profile.address});return'ACCEPTED';}catch(e){return e.code;}},{profile:f.profile.profile,expected:expected(f.profile.profile)});assert.notEqual(changed,'ACCEPTED');assert.equal(f.profile.profile.phone,'01098765432');await finish(f);console.log('PASS actual phone endpoint payload/token, code-only commit, invalid/rate errors and ordinary-save phone-change rejection');
}

async function tokenRaces(){
 for(const operation of['read','save','phoneSend','phoneConfirm','avatarSave']){
  const f=await setup(),p=f.page;await read(f);const before=f.profile.requests.length;
  await p.evaluate(({operation,profile,expected,avatar})=>{const q=__profileBridgeTest;q.holdSession=true;window.__oldContext=snoteProfileBridge.context();const action=async()=>{
   if(operation==='read')return snoteProfileBridge.read(__oldContext);
   if(operation==='save')return snoteProfileBridge.save(__oldContext,expected,{display_name:'Old draft',company_name:profile.company_name,phone:profile.phone,address:profile.address});
   if(operation==='phoneSend')return snoteProfileBridge.phoneSend(__oldContext,{phone:'01098765432',expected,requestId:'33333333-3333-4333-8333-333333333333'});
   if(operation==='phoneConfirm')return snoteProfileBridge.phoneConfirm(__oldContext,{phone:'01098765432',challengeId:'33333333-3333-4333-8333-333333333333',code:'123456'});
   const c=document.createElement('canvas');c.width=2;c.height=2;const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));return snoteProfileBridge.avatarSave(__oldContext,new File([blob],'test.png',{type:'image/png'}),avatar);
  };window.__pendingProfile=action().then(()=>({ok:true}),e=>({ok:false,code:e.code}));},{operation,profile:f.profile.profile,expected:operation==='phoneSend'?phoneExpected(f.profile.profile):expected(f.profile.profile),avatar:f.profile.avatar});
  await p.waitForFunction(()=>__profileBridgeTest.sessionWaiting);await changeAccount(p);await p.evaluate(()=>{__profileBridgeTest.holdSession=false;__profileBridgeTest.releases.splice(0).forEach(resolve=>resolve());});const result=await p.evaluate(()=>__pendingProfile);assert.equal(result.ok,false);assert.equal(f.profile.requests.length,before,operation+' must send zero HTTP requests after account change');assert.equal(await p.locator('#profile-name').textContent(),'전환한 사용자');await finish(f);
 }
 console.log('PASS delayed getSession plus account switch sends zero profile, phone or avatar HTTP with a different actor token');
 const f=await setup(),p=f.page;const epochs=await p.evaluate(()=>{const first=snoteProfileBridge.context(),S=__encarFixtureState;S.user={...S.user};currentUser={...currentUser};return{oldCurrent:snoteProfileBridge.current(first),newKey:snoteProfileBridge.context().key,oldKey:first.key};});assert.equal(epochs.oldCurrent,false);assert.notEqual(epochs.oldKey,epochs.newKey);await finish(f);console.log('PASS same-UID replacement session invalidates the old profile context');
}

async function lateAvatar(){
 const f=await setup(1440,{existingAvatar:true}),p=f.page;f.hold('download');await p.evaluate(()=>{window.__lateProfile=snoteProfileBridge.read(snoteProfileBridge.context()).then(()=>({ok:true}),e=>({ok:false,code:e.code}));});await f.wait('download');await changeAccount(p);f.release('download');const result=await p.evaluate(()=>__lateProfile);assert.equal(result.ok,false);assert.equal(await p.locator('#profile-avatar img').count(),0);assert.equal(await p.locator('#profile-name').textContent(),'전환한 사용자');await finish(f);console.log('PASS delayed private avatar download never publishes an old photo or profile into a switched account');
}


async function monotonicAvatar(){
 for(const held of['metadata','download']){
  const f=await setup(1440,{existingAvatar:held==='download'}),p=f.page;
  const base=clone(f.profile.avatar);if(held==='metadata')f.hold('avatarRead');else f.hold('download',base.avatar_path);
  await p.evaluate(()=>{window.__olderAvatarRead=snoteProfileBridge.read(snoteProfileBridge.context());});
  await f.wait(held==='metadata'?'avatarRead':'download');
  const saved=await upload(f,base);assert.match(saved.avatarURL,/^blob:/);
  f.release(held==='metadata'?'avatarRead':'download');const late=await p.evaluate(()=>__olderAvatarRead);
  assert.equal(late.avatar.avatar_revision,saved.avatar.avatar_revision);assert.equal(late.avatar.avatar_path,saved.avatar.avatar_path);assert.equal(late.avatarURL,saved.avatarURL);
  assert.equal(await p.locator('#profile-avatar img').getAttribute('src'),saved.avatarURL);
  await finish(f);console.log('PASS older avatar '+held+' reply cannot replace a newly acknowledged photo or decrease its revision');
 }
}

async function photoTransactions(){
 for(const mode of['ok','conflict','unknown-once','unknown-always']){
  const f=await setup(1440,{existingAvatar:true});await read(f);const previous=f.profile.avatar.avatar_path;f.profile.avatarMode=mode;let result;try{result={ok:true,value:await upload(f,clone(f.profile.avatar))};}catch(e){result={ok:false,error:e.message};}
  const calls=f.profile.requests.filter(r=>r.name==='snote_profile_avatar_save');assert.equal(f.profile.uploads.length,1);const uploaded=f.profile.uploads[0];
  if(mode==='conflict'){assert.equal(result.ok,false);assert.equal(f.profile.avatar.avatar_path,previous);assert(f.profile.deletes.includes(uploaded));assert(!f.profile.deletes.includes(previous));}
  else if(mode==='unknown-always'){assert.equal(result.ok,false);assert.equal(f.profile.avatar.avatar_path,uploaded);assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);assert.deepEqual(f.profile.deletes,[],'Unknown ACK must retain both old and potentially committed new bytes');}
  else{assert.equal(result.ok,true);assert.equal(f.profile.avatar.avatar_path,uploaded);assert(f.profile.deletes.includes(previous));assert(!f.profile.deletes.includes(uploaded));if(mode==='unknown-once'){assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);}}
  await finish(f);console.log('PASS private avatar',mode,'CAS, one create-only upload, retry identity and cleanup limited to acknowledged unreferenced bytes');
 }
}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of[1440,390,320])await profileAndPhoto(width);await invalidPhotos();await imageRecovery();await phoneFlow();await tokenRaces();await lateAvatar();await monotonicAvatar();await photoTransactions();}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
