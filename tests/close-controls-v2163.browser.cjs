'use strict';
// Actual popup assets; all account reads, documents and vehicle data are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const officeFixture=require('./contract-office.browser.cjs');
const ART=process.env.CLOSE_CONTROLS_ARTIFACTS||'/workspace/work/ui-v2163/close-controls';
fs.mkdirSync(ART,{recursive:true});
const normal='rgb(220, 76, 92)',hover='rgb(197, 61, 77)',results=[];

async function check(p,selector,label,{screenshot=false}={}){
 const control=p.locator(selector);await control.waitFor({state:'visible'});await p.waitForTimeout(300);
 await control.evaluate(e=>e.blur());await p.mouse.move(0,0);
 await p.waitForFunction(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor==='rgb(220, 76, 92)',selector);
 const shape=await control.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),svg=e.querySelector('svg');return{background:s.backgroundColor,color:s.color,radius:s.borderRadius,shadow:s.boxShadow,width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,stroke:svg&&getComputedStyle(svg).stroke,clickable:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e};});
 assert.equal(shape.background,normal,label);assert.equal(shape.color,'rgb(255, 255, 255)',label);assert.equal(shape.radius,'8px',label);assert.equal(shape.shadow,'none',label);assert(Math.abs(shape.width-30)<.1,label);assert(Math.abs(shape.height-30)<.1,label);assert.equal(shape.stroke,'rgb(255, 255, 255)',label);assert.equal(shape.clickable,true,label);
 const width=p.viewportSize().width,height=p.viewportSize().height;assert(shape.x>=-.5&&shape.y>=-.5&&shape.right<=width+.5&&shape.bottom<=height+.5,label+' must stay inside the viewport');
 await control.hover();await p.waitForFunction(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor==='rgb(197, 61, 77)',selector);
 const hovered=await control.boundingBox();assert(Math.abs(hovered.x-shape.x)<.1,label+' hover cannot move the control');assert(Math.abs(hovered.y-shape.y)<.1,label+' hover cannot move the control');
 if(screenshot)await p.screenshot({path:path.join(ART,label+'-'+width+'.png')});
 await p.mouse.move(0,0);await control.evaluate(e=>e.blur());await p.waitForFunction(selector=>getComputedStyle(document.querySelector(selector)).backgroundColor==='rgb(220, 76, 92)',selector);
 await p.emulateMedia({media:'print'});assert.equal(await control.evaluate(e=>getComputedStyle(e).display),'none',label+' must never print');await p.emulateMedia({media:'screen'});
 results.push({viewportWidth:width,label,...shape});return control;
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
 await p.locator('#detail-extra').fill('닫기 취소 검증');f.answerConfirm(false);await p.locator('#vehicle-overlay .detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Discard closes without any vehicle write');await p.evaluate(()=>openVehicle('encar-car-1'));
 await p.evaluate(()=>changeVehicleStatus({stopPropagation(){},target:{value:'계약중'}},activeCarId));await check(p,'#status-overlay .snote-popup-close','confirm',{screenshot:true});assert.equal(await p.locator('#status-confirm-no').evaluate(e=>getComputedStyle(e).backgroundColor=== 'rgb(220, 76, 92)'),false,'The textual cancel is not a close icon');await p.locator('#status-overlay .snote-popup-close').click();await p.locator('#status-overlay.open').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>cars[0].status),'판매중');
 for(const kind of['quote','contract','receipt']){
  await p.evaluate(async kind=>{if(kind==='quote')openQuotePreview();if(kind==='contract')openContractPreview();if(kind==='receipt')await zc76OpenReceipt({name:'합성 고객',phone:'01012345678',address:'합성 주소'},cars.find(c=>c.id===activeCarId));},kind);
  const root=kind==='receipt'?'#zc76-receipt-overlay':'#'+kind+'-overlay';const close=await check(p,root+' .snote-popup-close',kind,{screenshot:true});const print=p.locator(root+' [data-document-print]');assert.notEqual(await print.evaluate(e=>getComputedStyle(e).backgroundColor),normal,'Printer keeps its own presentation');await close.click();await p.locator(root+'.open').waitFor({state:'hidden'});
 }
 await p.evaluate(async()=>{await closeVehicle({discard:true});openAdd();});await check(p,'#overlay .snote-popup-close','center',{screenshot:true});await p.locator('#overlay .snote-popup-close').click();await p.locator('#overlay.open').waitFor({state:'hidden'});
 await p.locator('#snote-calculator-trigger').click();await check(p,'#snote-calculator-close','calculator');assert.notEqual(await p.locator('[data-calculator-key="*"]').evaluate(e=>getComputedStyle(e).backgroundColor),normal,'The multiplication X is not a close icon');await p.locator('#snote-calculator-close').click();await p.locator('#snote-calculator-panel').waitFor({state:'hidden'});
 await p.locator('#snote-chatbot-launcher').click();await check(p,'#snote-chatbot .snote-chat-close','chatbot',{screenshot:true});assert.equal(await p.locator('.snote-chat-close').evaluate(e=>getComputedStyle(e,'::before').display),'none');assert.notEqual(await p.locator('#snote-chatbot-launcher').evaluate(e=>getComputedStyle(e).backgroundColor),normal,'The chatbot launcher keeps its bot icon');await p.locator('#snote-chatbot .snote-chat-close').click();await p.locator('#snote-chatbot-panel').waitFor({state:'hidden'});
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
 assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0,'Styling and close flows do not mutate vehicle data');await finish(f);console.log('PASS',width,'red/white closes, stable placement, dirty/profile rules, dynamic/native dialogs, print exclusion and unrelated X controls');
}

(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of [1440,390,320])await workspace(width);fs.writeFileSync(path.join(ART,'results.json'),JSON.stringify(results,null,2));}finally{await browser.close();}})().catch(error=>{console.error(error.stack);process.exitCode=1;});
