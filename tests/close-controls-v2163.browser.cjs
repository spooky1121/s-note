'use strict';
// Actual popup assets; all account reads, documents and vehicle data are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const officeFixture=require('./contract-office.browser.cjs');
const ART=process.env.CLOSE_CONTROLS_ARTIFACTS||'/workspace/work/documents-v2165/close-controls';
fs.mkdirSync(ART,{recursive:true});
const normal='rgba(0, 0, 0, 0)',results=[];

async function check(p,selector,label,{screenshot=false}={}){
 const control=p.locator(selector);await control.waitFor({state:'visible'});await control.evaluate(async e=>{const frame=e.closest('.snote-popup-frame,.vehicle-detail-frame,.snote-sale-frame,#zoom-image-frame');if(frame)await Promise.all(frame.getAnimations().map(a=>a.finished.catch(()=>{})));});await p.waitForTimeout(180);
 await control.evaluate(e=>e.blur());await p.mouse.move(0,0);
 await p.waitForFunction(selector=>document.querySelector(selector)?.querySelector('img.snote-close-image')?.complete,selector);
 const shape=await control.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),img=e.querySelector('img.snote-close-image'),picture=img?.getBoundingClientRect(),frame=e.closest('.snote-popup-frame,.vehicle-detail-frame,.snote-sale-frame,.snote-profile-panel,dialog,#snote-calculator-panel,#zoom-image-frame')?.getBoundingClientRect();return{background:s.backgroundColor,color:s.color,radius:s.borderRadius,shadow:s.boxShadow,width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,targetTop:frame&&r.y-frame.y,targetRight:frame&&frame.right-r.right,imageWidth:picture?.width,imageHeight:picture?.height,imageTop:frame&&picture.y-frame.y,imageLeft:frame&&picture.x-frame.x,imageRight:frame&&frame.right-picture.right,children:e.childNodes.length,legacy:e.querySelectorAll('svg,.snote-original-direction-text').length,text:e.textContent.trim(),source:img?.getAttribute('src'),decoded:img?.naturalWidth,filter:img&&getComputedStyle(img).filter,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e};});
 assert.equal(shape.background,normal,label);assert.equal(shape.radius,'50%',label);assert.equal(shape.shadow,'none',label);assert(Math.abs(shape.width-30)<.1,label+' '+JSON.stringify(shape));assert(Math.abs(shape.height-30)<.1,label+' '+JSON.stringify(shape));assert.equal(shape.children,1,label+' must contain only the shared image');assert.equal(shape.legacy,0,label+' old drawing must be removed');assert.equal(shape.text,'',label+' old X text must be removed');assert(shape.source.endsWith('/assets/close-circle.svg'),label);assert.equal(shape.decoded,32,label);assert.equal(shape.clickable,true,label);
 assert.equal(shape.imageWidth,24,label+' image shrinks 20% while keeping its 30px hit area');assert.equal(shape.imageHeight,24,label);
 if(['vehicle','calculator','confirm','notifications','late-dialog'].includes(label)){assert(shape.imageTop>=6&&shape.imageTop<=9,label+' image stays near the top corner '+JSON.stringify(shape));const edge=['vehicle','calculator'].includes(label)?shape.imageLeft:shape.imageRight;assert(edge>=6&&edge<=9,label+' image is about 3px closer to the side corner '+JSON.stringify(shape));}
 if(label==='center'){assert(shape.imageTop>=11&&shape.imageTop<=13,label+' preserves the wizard upper-right close while moving 3px nearer');assert(shape.imageRight>=11&&shape.imageRight<=13,label);}
 if(label==='zoom'){assert(Math.abs(shape.targetTop-8)<.1,'Image close target stays 8px from the actual image top');assert(Math.abs(shape.targetRight-8)<.1,'Image close target stays 8px from the actual image right');assert(Math.abs(shape.imageTop-11)<.1,'The centered 24px symbol stays within its original 30px target');assert(Math.abs(shape.imageRight-11)<.1,label);}
 if(['profile','chatbot','office-preview','office-history'].includes(label)){shape.flowCorner=await control.evaluate((e,left)=>{const css=e.style.cssText;e.style.setProperty('top','0px','important');e.style.setProperty(left?'left':'right','0px','important');const normal=e.getBoundingClientRect();e.style.cssText=css;const image=e.querySelector('img.snote-close-image').getBoundingClientRect();return{top:normal.top-image.top,side:left?normal.left-image.left:image.right-normal.right};},label==='profile');assert(Math.abs(shape.flowCorner.top-3)<.1,label+' image moves 3px toward the top of its existing header');assert(Math.abs(shape.flowCorner.side-3)<.1,label+' image moves 3px toward the existing side corner');}
 const pixels=await control.evaluate(e=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=32;const c=canvas.getContext('2d');c.drawImage(e.querySelector('img'),0,0,32,32);return{red:[...c.getImageData(16,4,1,1).data],cross:[...c.getImageData(16,16,1,1).data],outside:[...c.getImageData(0,0,1,1).data]};});assert.deepEqual(pixels.red,[246,55,74,255]);assert.deepEqual(pixels.cross,[255,255,255,255]);assert.equal(pixels.outside[3],0,'The circle must have no rectangular image background');
 const width=p.viewportSize().width,height=p.viewportSize().height;assert(shape.x>=-.5&&shape.y>=-.5&&shape.right<=width+.5&&shape.bottom<=height+.5,label+' must stay inside the viewport');
 await control.hover();await p.waitForFunction(selector=>getComputedStyle(document.querySelector(selector).querySelector('img')).filter==='brightness(0.92)',selector);
 const hovered=await control.boundingBox();assert(Math.abs(hovered.x-shape.x)<.1,label+' hover cannot move the control');assert(Math.abs(hovered.y-shape.y)<.1,label+' hover cannot move the control');
 if(screenshot)await p.screenshot({path:path.join(ART,label+'-'+width+'.png')});
 await p.mouse.move(0,0);await control.evaluate(e=>e.blur());await p.waitForTimeout(180);
 await p.emulateMedia({media:'print'});assert.equal(await control.evaluate(e=>getComputedStyle(e).display),'none',label+' must never print');await p.emulateMedia({media:'screen'});
 results.push({viewportWidth:width,label,...shape,pixels});return control;
}

async function profile(p,f){
 await p.evaluate(async()=>{
  await closeVehicle({discard:true});
  const original=snoteProfileBridge,S=__encarFixtureState;
  window.__closeProfile={user_id:S.user.id,company_id:S.company.id,role:'dealer',display_name:'닫기 검증 딜러',company_name:'닫기 검증 상사',phone:'01012345678',address:'합성 상사 주소',company_address:'합성 상사 주소',revision:0};
  window.snoteProfileBridge=Object.freeze({...original,async read(ctx){assertCurrent(ctx);return{profile:structuredClone(__closeProfile),user:{...S.user},avatar:{user_id:S.user.id,company_id:S.company.id,avatar_path:null,avatar_revision:0},avatarURL:'',companyLogoURL:''};}});
  function assertCurrent(ctx){if(!original.current(ctx))throw Error('Synthetic stale profile context');}
  await snoteProfileEditor.open();
 });
 await p.waitForFunction(()=>!document.getElementById('snote-profile-name').disabled);await p.waitForTimeout(360);
 await check(p,'#snote-profile-close','profile',{screenshot:true});
 await p.locator('#snote-profile-dialog').dispatchEvent('click');await p.keyboard.press('Escape');assert.equal(await p.locator('#snote-profile-dialog').isVisible(),true,'Profile must keep its close-only rule');
 await p.locator('#snote-profile-name').fill('보존해야 하는 변경');f.answerConfirm(false,/저장하지 않은 변경사항/);await p.locator('#snote-profile-close').click();assert.equal(await p.locator('#snote-profile-dialog').isVisible(),true,'Declining discard keeps the profile open');assert.equal(await p.locator('#snote-profile-name').inputValue(),'보존해야 하는 변경');
 f.answerConfirm(true,/저장하지 않은 변경사항/);await p.locator('#snote-profile-close').click();await p.locator('#snote-profile-dialog').waitFor({state:'hidden'});
}

async function workspace(width){
 const f=await fixture(width,null,{paymentAccountsRegistered:true}),p=f.page;
 // The unrelated intake endpoint is read-only and local in this browser suite.
 await f.context.route('**/api/customer-intake',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,requests:[]})}));
 await check(p,'#vehicle-overlay .detail-close','vehicle',{screenshot:true});
 // The actual media click uses the new image-local frame rather than a generic popup wrapper.
 await p.evaluate(async()=>{const car=cars.find(c=>c.id===activeCarId),canvas=document.createElement('canvas');canvas.width=640;canvas.height=320;const paint=canvas.getContext('2d');paint.fillStyle='#406d97';paint.fillRect(0,0,640,320);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),url=URL.createObjectURL(blob);mediaByCar[car.id]=[{id:'close-synthetic-photo',carId:car.id,ownerId:car.ownerId,group:'photos',filename:'synthetic-close.png',createdAt:1,blob,url}];mediaObjectUrls.push(url);renderVehicle();});
 await p.locator('#photo-grid .photo-thumb').click();await p.waitForFunction(()=>document.getElementById('zoom-overlay').dataset.imageState==='ready');const imageClose=await check(p,'#zoom-close','zoom',{screenshot:true});assert.equal(await p.locator('#zoom-overlay #zoom-toolbar,#zoom-overlay #zoom-caption,#zoom-overlay .snote-popup-frame').count(),0,'New image frame has no toolbar, caption or legacy popup wrapper');await imageClose.click();await p.locator('#zoom-overlay.open').waitFor({state:'hidden'});assert.equal(await p.locator('#vehicle-overlay.open').isVisible(),true,'Image close must leave its vehicle drawer open');assert.equal(await p.locator('#zoom-image').getAttribute('src'),null,'Image close clears the private preview source');assert.equal(await p.evaluate(()=>zoomRecordId),null);
 await p.locator('#detail-extra').fill('닫기 취소 검증');f.answerConfirm(false);await p.locator('#vehicle-overlay .detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Discard closes without any vehicle write');await p.evaluate(()=>openVehicle('encar-car-1'));
 await p.evaluate(()=>changeVehicleStatus({stopPropagation(){},target:{value:'계약중'}},activeCarId));await check(p,'#status-overlay .snote-popup-close','confirm',{screenshot:true});assert.equal(await p.locator('#status-confirm-no .snote-close-image').count(),0,'The textual cancel is not a close icon');await p.locator('#status-overlay .snote-popup-close').click();await p.locator('#status-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>cars[0].status),'판매중');
 for(const kind of['quote','contract','receipt']){
  await p.evaluate(async kind=>{if(kind==='quote')openQuotePreview();if(kind==='contract')openContractPreview();if(kind==='receipt')await zc76OpenReceipt({name:'합성 고객',phone:'01012345678',address:'합성 주소'},cars.find(c=>c.id===activeCarId));},kind);
  const root=kind==='receipt'?'#zc76-receipt-overlay':'#'+kind+'-overlay';const close=await check(p,root+' .snote-popup-close',kind,{screenshot:true});const print=p.locator(root+' [data-document-print]');assert.equal(await print.locator('.snote-close-image').count(),0,'Printer keeps its own presentation');await close.click();await p.locator(root+'.open').waitFor({state:'hidden'});
 }
 await p.evaluate(async()=>{await closeVehicle({discard:true});openAdd();});await check(p,'#overlay .snote-popup-close','center',{screenshot:true});await p.locator('#overlay .snote-popup-close').click();await p.locator('#overlay.open').waitFor({state:'hidden'});
 await p.locator('#snote-calculator-trigger').click();await check(p,'#snote-calculator-close','calculator');assert.equal(await p.locator('[data-calculator-key="*"] .snote-close-image').count(),0,'The multiplication X is not a close icon');await p.locator('#snote-calculator-close').click();await p.locator('#snote-calculator-panel').waitFor({state:'hidden'});
 await p.locator('#snote-chatbot-launcher').click();await check(p,'#snote-chatbot .snote-chat-close','chatbot',{screenshot:true});assert.equal(await p.locator('.snote-chat-close').evaluate(e=>getComputedStyle(e,'::before').display),'none');assert.equal(await p.locator('#snote-chatbot-launcher .snote-close-image').count(),0,'The chatbot launcher keeps its bot icon');await p.locator('#snote-chatbot .snote-chat-close').click();await p.locator('#snote-chatbot-panel').waitFor({state:'hidden'});
 await profile(p,f);
 // The existing notification module creates its native dialog after page parsing.
 await p.evaluate(()=>document.getElementById('snote-notifications-dialog').showModal());await check(p,'#snote-notifications-dialog .snote-popup-close','notifications');await p.locator('#snote-notifications-dialog .snote-popup-close').click();await p.locator('#snote-notifications-dialog').waitFor({state:'hidden'});
 // A late dialog proves the shared observer preserves its original close handler.
 await p.evaluate(()=>{const dialog=document.createElement('dialog');dialog.id='close-late-dialog';const text=document.createElement('p');text.textContent='동적으로 추가한 창';const button=document.createElement('button');button.setAttribute('aria-label','새 창 닫기');button.textContent='×';button.onclick=()=>{window.__closeLateClicked=true;dialog.close();};dialog.append(text,button);document.body.append(dialog);dialog.showModal();});await check(p,'#close-late-dialog .snote-popup-close','late-dialog');await p.locator('#close-late-dialog .snote-popup-close').click();assert.equal(await p.evaluate(()=>__closeLateClicked),true);await p.locator('#close-late-dialog').waitFor({state:'hidden'});
 // Both office closes are created by the actual accountant workspace module.
 await officeFixture.setup(p);await p.locator('#contract-office-landing button[data-document-kind="purchase"]').click();await p.locator('#contract-office-form').waitFor({state:'visible'});
 await p.locator('#contract-office-history').click();await p.locator('#contract-office-history-close').scrollIntoViewIfNeeded();await check(p,'#contract-office-history-close','office-history');await p.locator('#contract-office-history-close').click();assert.equal(await p.locator('#contract-office-history-panel').isVisible(),false);
 for(const key of officeFixture.KEYS)await p.locator('#contract-office-'+key).fill(String(officeFixture.VALUES[key]??''));
 await p.locator('#contract-office-preview').click();await p.locator('#contract-office-dialog[open]').waitFor();await p.locator('#contract-office-print:not([disabled])').waitFor();await check(p,'#contract-office-preview-close','office-preview',{screenshot:true});await p.locator('#contract-office-preview-close').click();assert.equal(await p.locator('#contract-office-dialog').evaluate(e=>e.open),false);assert.equal(await p.evaluate(()=>__contractMock.saves.length),0,'Office preview and closes must not save the document');
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Styling and close flows do not mutate vehicle data');await finish(f);console.log('PASS',width,'single circular close image, stable placement, dirty/profile rules, dynamic/native dialogs, print exclusion and unrelated X controls');
}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of (process.env.CLOSE_CONTROLS_WIDTHS||'1440,390,320').split(',').map(Number))await workspace(width);fs.writeFileSync(path.join(ART,'results.json'),JSON.stringify(results,null,2));}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
