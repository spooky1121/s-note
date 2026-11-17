'use strict';
// Real profile editor and context guards; all branding/profile replies are synthetic.
const assert=require('node:assert/strict'),{chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const LOGO='#snote-profile-company-logo',DRAWER='#snote-profile-dialog';
async function boot(f){
 const p=f.page;
 await f.context.route('**/__profile-logo-test/*',route=>route.request().url().includes('/broken.')?
  route.fulfill({status:404,contentType:'text/plain',body:'Synthetic missing logo'}):
  route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30" fill="#315cf5"/></svg>'}));
 await p.evaluate(async()=>{
  await closeVehicle({discard:true,animate:false});
  const S=window.__encarFixtureState,original=window.snoteProfileBridge;
  const q=window.__logoTest={reads:0,readHold:false,readReleases:[],loads:[],logoURL:location.origin+'/__profile-logo-test/initial.svg',
   profile:{user_id:S.user.id,company_id:S.company.id,role:'dealer',display_name:'로고 검증 딜러',company_name:S.company.name,phone:'01012345678',address:'합성 상사 주소',company_address:'합성 상사 주소',revision:0}};
  window.snoteLoadDocumentLogo=()=>new Promise(resolve=>q.loads.push(resolve));
  window.snoteProfileBridge=Object.freeze({...original,async read(context){
   if(!original.current(context))throw Error('Synthetic profile context changed');q.reads++;
   const result={profile:structuredClone(q.profile),user:structuredClone(S.user),avatar:{user_id:S.user.id,company_id:S.company.id,avatar_path:null,avatar_revision:0},avatarURL:'',companyLogoURL:q.logoURL};
   if(q.readHold)await new Promise(resolve=>q.readReleases.push(resolve));
   if(!original.current(context))throw Error('Synthetic delayed profile context changed');return result;
  }});
  await window.snoteProfileEditor.open();
 });
 await loaded(p,'initial.svg');
}
async function loaded(p,name){await p.waitForFunction(name=>{const img=document.getElementById('snote-profile-company-logo');return!img.hidden&&img.getAttribute('src')?.endsWith(name)&&img.naturalWidth>0;},name);}
async function changed(p,{reset=false,kind='companyLogo'}={}){return p.evaluate(detail=>{
 window.dispatchEvent(new CustomEvent('snote:company-assets-changed',{detail}));
 const img=document.getElementById('snote-profile-company-logo');return{hidden:img.hidden,src:img.getAttribute('src'),loads:__logoTest.loads.length};
},{kind,...(reset?{reset:true}:{})});}
async function resolve(p,index,name){await p.evaluate(({index,name})=>__logoTest.loads[index](name===null?null:location.origin+'/__profile-logo-test/'+name),{index,name});}
async function tick(p){await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function draft(p){return p.evaluate(()=>({name:document.getElementById('snote-profile-name').value,phone:document.getElementById('snote-profile-phone').value,
 password:document.getElementById('snote-profile-password-new').value,reads:__logoTest.reads}));}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  const f=await fixture(390),p=f.page;
  try{
   await boot(f);await p.locator('#snote-profile-name').fill('로고 변경에도 유지할 이름');await p.locator('#snote-profile-phone').fill('01098765432');
   await p.locator('.snote-profile-password-section summary').click();await p.locator('#snote-profile-password-new').fill('SyntheticDraft!123');const before=await draft(p);
   assert.equal((await changed(p,{kind:'companyStamp'})).loads,0,'A stamp event must not reload or clear the company logo');await loaded(p,'initial.svg');
   await p.evaluate(()=>window.__oldLogoError=document.getElementById('snote-profile-company-logo').onerror);
   assert.deepEqual(await changed(p),{hidden:true,src:null,loads:1});assert.deepEqual(await changed(p),{hidden:true,src:null,loads:2});
   await resolve(p,1,'replacement.svg');await loaded(p,'replacement.svg');await resolve(p,0,'obsolete.svg');await tick(p);await loaded(p,'replacement.svg');
   await p.evaluate(()=>window.__oldLogoError?.(new Event('error')));await loaded(p,'replacement.svg');assert.deepEqual(await draft(p),before,'Logo-only events cannot reload or reset personal/phone/password drafts');
   console.log('PASS logo-only refresh preserves dirty form, ignores unrelated assets and out-of-order responses/errors');

   await p.locator(LOGO).dispatchEvent('error');assert.equal(await p.locator(LOGO).getAttribute('src'),null);assert.equal(await p.locator(LOGO).isVisible(),false);
   await changed(p);const failedImage=p.waitForResponse(response=>response.url().endsWith('/broken.svg'));await resolve(p,2,'broken.svg');const failed=await failedImage;assert.equal(failed.status(),404);await failed.finished();await tick(p);await p.waitForFunction(()=>{const img=document.getElementById('snote-profile-company-logo');return img.hidden&&!img.hasAttribute('src');});
   assert.deepEqual(await draft(p),before);await changed(p);await resolve(p,3,'recovered.svg');await loaded(p,'recovered.svg');
   await p.evaluate(()=>document.getElementById('snote-profile-company-logo').style.display='none');await changed(p);await resolve(p,4,'display-restored.svg');await loaded(p,'display-restored.svg');assert.equal(await p.locator(LOGO).evaluate(el=>getComputedStyle(el).display==='none'),false);
   console.log('PASS broken image sources are removed and hidden; valid replacement recovers inline display');

   await changed(p);assert.deepEqual(await changed(p,{reset:true}),{hidden:true,src:null,loads:6},'Reset must clear immediately without a new branding read');
   await resolve(p,5,'before-reset.svg');await tick(p);assert.equal(await p.locator(LOGO).getAttribute('src'),null);assert.deepEqual(await draft(p),before);
   console.log('PASS reset invalidates pending image loads without reloading or changing the dirty profile');

   await p.evaluate(()=>{window.snoteProfileEditor.close({force:true,immediate:true});__logoTest.readHold=true;__logoTest.logoURL=location.origin+'/__profile-logo-test/stale-read.svg';void window.snoteProfileEditor.open();});
   await p.waitForFunction(()=>__logoTest.readReleases.length===1);await changed(p);await resolve(p,6,'newer-than-profile-read.svg');await loaded(p,'newer-than-profile-read.svg');
   await p.evaluate(()=>{__logoTest.readHold=false;__logoTest.readReleases.shift()();});await p.waitForFunction(()=>!document.getElementById('snote-profile-name').disabled);await loaded(p,'newer-than-profile-read.svg');
   console.log('PASS a delayed profile read cannot overwrite the newer logo-only response');

   await p.evaluate(()=>{
    const q=__logoTest;q.nativeImage=window.Image;q.assetState=window.snoteCompanyAssetState;q.heldLoads=[];q.blobs=[];
    window.Image=function(){const image=new q.nativeImage();let callback=null;Object.defineProperty(image,'onload',{get:()=>callback,set:value=>{callback=value;}});
     image.addEventListener('load',event=>{const loaded=callback;if(loaded)q.heldLoads.push(()=>loaded.call(image,event));});return image;};
    window.snoteCompanyAssetState=()=>q.snapshot;
   });
   for(const replacement of['missing','ready','same','same-loading']){
    const index=(await changed(p)).loads-1;
    await p.evaluate(index=>{const q=__logoTest;q.heldLoads=[];q.blob=URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"><rect width="80" height="30"/></svg>'],{type:'image/svg+xml'}));q.blobs.push(q.blob);q.snapshot={status:'ready',url:q.blob};q.loads[index](q.blob);},index);
    await p.waitForFunction(()=>__logoTest.heldLoads.length===1);
    await p.evaluate(replacement=>{const q=__logoTest;if(replacement==='same-loading')q.snapshot={status:'loading',url:q.blob};else if(replacement!=='same'){q.snapshot={status:replacement,url:replacement==='ready'?'blob:replacement-from-another-consumer':null};URL.revokeObjectURL(q.blob);}q.heldLoads.shift()();},replacement);
    await tick(p);
    if(replacement.startsWith('same'))await p.waitForFunction(()=>{const image=document.getElementById('snote-profile-company-logo');return !image.hidden&&image.getAttribute('src')===__logoTest.blob&&image.naturalWidth>0;});
    else{assert.equal(await p.locator(LOGO).getAttribute('src'),null);assert.equal(await p.locator(LOGO).isVisible(),false);}
   }
   await p.evaluate(()=>{const q=__logoTest;window.Image=q.nativeImage;window.snoteCompanyAssetState=q.assetState;for(const url of q.blobs)URL.revokeObjectURL(url);});
   console.log('PASS a delayed off-DOM blob decode rechecks the scoped asset snapshot after another consumer removes/replaces it');

   const pendingCompany=(await changed(p)).loads-1;await p.evaluate(()=>{
    const S=__encarFixtureState,id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';S.company={id,name:'새 합성 상사'};S.members[0].company_id=id;currentUser.company='새 합성 상사';
    __logoTest.profile={...__logoTest.profile,company_id:id,company_name:'새 합성 상사'};__logoTest.logoURL=location.origin+'/__profile-logo-test/new-company.svg';
   });
   await p.locator(DRAWER).waitFor({state:'hidden'});await p.evaluate(()=>window.snoteProfileEditor.open());await loaded(p,'new-company.svg');
   await resolve(p,pendingCompany,'previous-company.svg');await tick(p);await loaded(p,'new-company.svg');assert.equal(await p.locator('#snote-profile-company').inputValue(),'새 합성 상사');
   await p.evaluate(()=>window.snoteProfileEditor.close({force:true,immediate:true}));assert.equal(await p.locator(LOGO).getAttribute('src'),null);await finish(f);
   console.log('PASS switching companies and closing invalidate earlier logo requests and remove image references');
  }catch(error){await f.context.close();throw error;}
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
