'use strict';
// Actual list/card DOM, image decoding and native animations. Accounts, photos
// and storage are synthetic; the shared fixture blocks all external requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const shared=require('./shared-detail-v2166.browser.cjs');
const OUT=process.env.VEHICLE_LIST_PHOTO_ARTIFACTS||'/tmp/snote-vehicle-list-photo';fs.mkdirSync(OUT,{recursive:true});
const results=[],sourceHashes=()=>Object.fromEntries(['index.html','assets/vehicle-image-viewer.js','assets/vehicle-image-viewer.css'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')]));
const image=button=>button.locator('..').locator('img').first();
const frames=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function recordAnimations(p){await p.evaluate(()=>{
 const original=Element.prototype.animate;window.__listPhotoAnimations=[];
 Element.prototype.animate=function(...args){
  const r=this.getBoundingClientRect(),base={x:r.x,y:r.y,width:r.width,height:r.height},animation=original.apply(this,args);
  if(this.id==='zoom-image-frame'){
   const keys=animation.effect.getKeyframes(),last=keys.at(-1),m=new DOMMatrix(last.transform==='none'?undefined:last.transform),after=this.getBoundingClientRect();
   const points=[[0,0],[base.width,0],[0,base.height],[base.width,base.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
   const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
   __listPhotoAnimations.push({duration:animation.effect.getTiming().duration,keys:keys.map(k=>({transform:k.transform,opacity:k.opacity})),start:{x:after.x,y:after.y,width:after.width,height:after.height},end:{x:base.x+Math.min(...xs),y:base.y+Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}});
  }
  return animation;
 };
});}
function thumb(p,mode,id){return p.locator((mode==='list'?'#list-table':'#list-mobile')+' [data-snote-list-photo]'+(id?'[data-snote-list-photo="'+id+'"]':'' )).first();}
async function mode(p,value){if(await p.locator('#list-screen').getAttribute('data-vehicle-view')!==value)await p.locator('#snote-vehicle-view-switch').click();await p.waitForFunction(value=>document.getElementById('list-screen').dataset.vehicleView===value,value);await frames(p);}
async function state(p){return p.evaluate(()=>({query:document.getElementById('list-query').value,page:document.querySelector('#list-pagination [aria-current="page"]')?.textContent||null,route,ids:getFiltered('list').map(c=>c.id)}));}
async function ownSetup(width,view,{fallback=false}={}){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;await p.setViewportSize({width,height:width===390?844:900});await recordAnimations(p);
 await p.evaluate(async fallback=>{
  await closeVehicle({discard:true});
  const owner=currentUser.username,base=cars.find(c=>c.ownerId===owner),images=[];
  for(const [width,height,color] of [[640,320,'#315f92'],[320,640,'#7f4d60']]){
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const draw=canvas.getContext('2d');draw.fillStyle=color;draw.fillRect(0,0,width,height);draw.fillStyle='#fff';draw.fillRect(width*.2,height*.2,width*.6,height*.6);
   images.push(URL.createObjectURL(await new Promise(resolve=>canvas.toBlob(resolve,'image/png'))));
  }
  mediaObjectUrls.push(...images);window.__listPhotoExpected=images[1];
  cars=Array.from({length:25},(_,i)=>({...base,id:'list-photo-'+i,model:'확대 검증 차량 '+String(i).padStart(2,'0'),plate:'12가'+String(2000+i),status:'판매중',purchaseAt:'2026-10-'+String(i+1).padStart(2,'0')}));
  mediaByCar=Object.fromEntries(cars.map(car=>[car.id,fallback?[]:images.map((url,n)=>({id:car.id+'-photo-'+n,carId:car.id,ownerId:owner,group:'photos',filename:'synthetic-list-main-'+n+'.png',createdAt:n+1,url}))]));
  covers=Object.fromEntries(cars.map(car=>[car.id,car.id+'-photo-1']));window.__listPhotoSource=JSON.stringify({cars,mediaByCar,covers,writes:__encarFixtureWrites});
  window.snote236ResetPagination();navigate('buy');
 },fallback);
 await mode(p,view);await p.locator('#list-query').fill('확대 검증');await p.locator('#list-pagination [aria-label="2페이지"]').click();
 await thumb(p,view).waitFor({state:'visible'});await image(thumb(p,view)).evaluate(async image=>{await image.decode();});return f;
}
async function openPhoto(p,button,activation='click',{motion=true,expected=null}={}){
 await button.scrollIntoViewIfNeeded();const source=await image(button).boundingBox(),id=await button.getAttribute('data-snote-list-photo'),src=await image(button).getAttribute('src');
 await p.evaluate(()=>{__listPhotoAnimations=[];});
 if(activation==='click')await button.click();else{await button.focus();await p.keyboard.press(activation);}
 await p.waitForFunction(()=>document.getElementById('zoom-overlay').dataset.imageState==='ready');
 await p.locator('#zoom-overlay').evaluate(async overlay=>{await Promise.all(overlay.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})));});
 assert.equal(await p.locator('#vehicle-overlay').isVisible(),false,'Photo activation must not bubble into vehicle detail');
 assert.equal(await p.locator('#zoom-image').getAttribute('src'),expected||src,'The visible cover/main photo is the enlarged source');
 const observed=await p.evaluate(()=>__listPhotoAnimations),moving=observed.filter(a=>Number(a.duration)>1&&new Set(a.keys.map(k=>k.transform)).size>1);
 if(motion){assert(moving.length>0,'Opening uses a native transform animation');const start=moving[0].start;assert(Math.abs(start.x+start.width/2-source.x-source.width/2)<12&&Math.abs(start.y+start.height/2-source.y-source.height/2)<12,'Enlargement starts at the clicked photo');}
 else assert.equal(moving.length,0,'Reduced-motion opening skips spatial travel');
 return{id,src};
}
async function closePhoto(p,view,id,method='button',{motion=true}={}){
 const button=thumb(p,view,id),source=await image(button).boundingBox();await p.evaluate(()=>{__listPhotoAnimations=[];});
 if(method==='back'){await p.waitForFunction(()=>Object.keys(history.state||{}).some(k=>/popup/i.test(k)));await p.goBack();}
 else if(method==='escape')await p.keyboard.press('Escape');
 else if(method==='backdrop')await p.mouse.click(2,2);
 else await p.locator('#zoom-close').click();
 await p.locator('#zoom-overlay').waitFor({state:'hidden'});assert.equal(await p.locator('#zoom-image').getAttribute('src'),null,'Closing removes the image URL');
 const moving=(await p.evaluate(()=>__listPhotoAnimations)).filter(a=>Number(a.duration)>1&&new Set(a.keys.map(k=>k.transform)).size>1);
 if(motion){assert(moving.length>0,'User close animates back toward the thumbnail');const end=moving.at(-1).end;assert(Math.abs(end.x+end.width/2-source.x-source.width/2)<12&&Math.abs(end.y+end.height/2-source.y-source.height/2)<12,'Shrink returns to the current thumbnail');assert(Math.abs(end.width-source.width)<6&&Math.abs(end.height-source.height)<6,'Shrink returns to thumbnail dimensions');}
 else assert.equal(moving.length,0,'Reduced-motion closing skips spatial travel');
 assert.equal(await button.evaluate(el=>document.activeElement===el),true,'Closing returns keyboard focus to the current thumbnail');
}
async function unchangedOwn(p){assert.equal(await p.evaluate(()=>JSON.stringify({cars,mediaByCar,covers,writes:__encarFixtureWrites})===__listPhotoSource),true,'Viewing never changes vehicle, media, cover or server writes');}
async function owned(width,view,activation,method,{fallback=false,rerender=false,reduced=false}={}){
 const f=await ownSetup(width,view,{fallback}),p=f.page,label=[width,view,activation,fallback?'fallback':'cover',reduced?'reduced':'motion'].join('-');
 try{
  if(reduced)await p.emulateMedia({reducedMotion:'reduce'});const before=await state(p),expected=fallback?null:await p.evaluate(()=>__listPhotoExpected);
  const opened=await openPhoto(p,thumb(p,view),activation,{motion:!reduced,expected});
  if(!fallback)assert.equal(await p.locator('#zoom-image').evaluate(e=>e.naturalWidth/e.naturalHeight),.5,'Selected second cover differs from the first photo');
  if(rerender){await p.evaluate(()=>{window.__oldListPhoto=document.querySelector('#list-table [data-snote-list-photo]');document.getElementById('list-table').replaceChildren();renderCars();});assert.equal(await p.evaluate(()=>__oldListPhoto.isConnected),false,'Fixture replaces the original thumbnail while preview stays open');await frames(p);assert.equal(await p.locator('#zoom-overlay').isVisible(),true);}
  await p.screenshot({path:path.join(OUT,label+'.png')});await closePhoto(p,view,opened.id,method,{motion:!reduced});assert.deepEqual(await state(p),before,'Preview preserves route, search, page and filtered order');await unchangedOwn(p);
  const row=p.locator((view==='list'?'#list-table':'#list-mobile')+' [data-registration-car-id="'+opened.id+'"]');await row.locator(view==='list'?'.car-name':'.vehicle-title').click();await p.locator('#vehicle-overlay.open').waitFor();assert.equal(await p.evaluate(()=>activeCarId),opened.id,'The rest of the row keeps its detail action');await p.evaluate(()=>closeVehicle({discard:true}));await unchangedOwn(p);
  results.push({label,passed:true});console.log('PASS list photo '+label);await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+label+'.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function sharedReadonly(){
 const f=await shared.setup(390),p=f.page;await recordAnimations(p);await mode(p,'cards');
 try{
  const first=p.locator('#list-mobile [data-received-share-photo]').first();await first.scrollIntoViewIfNeeded();await p.waitForFunction(()=>{const image=document.querySelector('#list-mobile [data-received-share-photo]');return image?.getAttribute('src')?.startsWith('blob:')&&image.complete&&image.naturalWidth>0;});
  const button=first.locator('..').locator('[data-snote-list-photo]'),before=await state(p),opened=await openPhoto(p,button);assert.equal(await p.locator('#zoom-share').isVisible(),false,'Shared photo has no own-only document share action');await closePhoto(p,'cards',opened.id);assert.deepEqual(await state(p),before);await shared.unchanged(p);
  await openPhoto(p,thumb(p,'cards',opened.id));await p.evaluate(()=>{__sharedDetail.items=[];window.dispatchEvent(new Event('snote-vehicle-sharing-updated'));});await p.locator('#zoom-overlay').waitFor({state:'hidden',timeout:3000});assert.equal(await p.locator('#zoom-image').getAttribute('src'),null,'Revoked sharing clears the open photo');assert.equal(await p.evaluate(()=>SnoteVehicleImageViewer.download()),false,'Revoked preview cannot download');await shared.unchanged(p);
  results.push({label:'390-shared-readonly-and-revocation',passed:true});console.log('PASS list photo shared readonly and revocation');await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-shared.png')}).catch(()=>{});await f.context.close();throw error;}
}
async function accountChange(){
 const f=await ownSetup(1440,'cards'),p=f.page;
 try{await openPhoto(p,thumb(p,'cards'));await p.evaluate(()=>{__encarFixtureState.members[0].active=false;currentUser={...currentUser,username:'synthetic-list-other-account'};});await p.locator('#zoom-overlay').waitFor({state:'hidden',timeout:3000});assert.equal(await p.locator('#zoom-image').getAttribute('src'),null,'Actor replacement clears the private photo');assert.equal(await p.evaluate(()=>SnoteVehicleImageViewer.download()),false);await unchangedOwn(p);results.push({label:'1440-account-change',passed:true});console.log('PASS list photo account change');await finish(f);
 }catch(error){await f.context.close();throw error;}
}
(async()=>{
 const before=sourceHashes(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  await owned(1440,'list','click','button',{rerender:true});
  await owned(1440,'cards','Enter','escape');
  await owned(390,'cards','Space','back');
  await owned(1440,'list','click','backdrop',{fallback:true});
  await owned(390,'cards','click','button',{reduced:true});
  await sharedReadonly();await accountChange();
  assert.deepEqual(sourceHashes(),before,'Product source remains unchanged during the UI verification');
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({passed:results.length===7,results,sourceHashes:before,syntheticOnly:true,operatingReads:0,operatingWrites:0},null,2)+'\n');}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
