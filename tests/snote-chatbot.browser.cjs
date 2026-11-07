'use strict';
// Real application and local help assets; synthetic accounts and intercepted HTTP only.
const assert=require('node:assert/strict');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser}=require('./encar/browser-smoke.cjs');
const widget='#snote-chatbot',launcher='#snote-chatbot-launcher',panel='#snote-chatbot-panel';
async function geometry(p){
 const state=await p.evaluate(()=>{const button=document.querySelector('#snote-chatbot-launcher'),card=document.querySelector('#snote-chatbot-panel'),input=document.querySelector('#snote-chatbot-input'),nav=[...document.querySelectorAll('.bottom-nav,#bottom-nav')].find(e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return{button:rect(button),card:rect(card),input:rect(input),nav:nav?rect(nav):null,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}});
 assert.equal(state.overflow,false);assert(state.button.x>=8&&state.button.right<=state.width-8);assert(state.button.bottom<=state.height-8);
 if(state.nav&&state.width<=760)assert(state.button.bottom<=state.nav.y-8,JSON.stringify(state));
 assert(state.card.x>=8&&state.card.right<=state.width-8&&state.card.y>=8,JSON.stringify(state));assert(state.card.bottom<=state.button.y-8);assert(state.input.y>=state.card.y&&state.input.bottom<state.card.bottom);return state;
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{
 for(const width of[1440,1024,390,320]){
  const f=await fixture(width),p=f.page;if(width===320){await p.setViewportSize({width,height:640});await p.emulateMedia({reducedMotion:'reduce'});}
  await p.waitForFunction(()=>!!window.SnoteChatbot);assert.equal(await p.locator(widget).isHidden(),true,'An open vehicle drawer must hide help');
  await p.locator('#vehicle-overlay .detail-close').click();await p.locator('#vehicle-overlay.open').waitFor({state:'hidden'});await p.locator(launcher).waitFor({state:'visible'});
  const postRequests=[];p.on('request',r=>{if(r.method()==='POST')postRequests.push(r.url());});
  await p.locator(launcher).click();await p.locator(panel).waitFor({state:'visible'});assert.equal(await p.locator(panel).getAttribute('aria-modal'),'false');assert.equal(await p.locator(panel).evaluate(e=>e.contains(document.activeElement)),true);await geometry(p);
  assert.equal(await p.locator(launcher+' svg').evaluate(e=>getComputedStyle(e).width),'64px');
  await p.getByRole('button',{name:'차량 등록',exact:true}).click();assert.match(await p.locator('.snote-chat-log').textContent(),/파란 \+ 아이콘/);
  const marker='SNOTE-CHAT-MEMORY-ONLY-21984 <img src=x onerror=alert(1)>';
  await p.locator('#snote-chatbot-input').fill(marker);await p.getByRole('button',{name:'보내기',exact:true}).click();assert((await p.locator('.snote-chat-log').textContent()).includes(marker));assert.equal(await p.locator('.snote-chat-log img').count(),0);assert.match(await p.locator('.snote-chat-log .is-assistant').last().textContent(),/화면 사용법/);
  assert.equal(await p.evaluate(marker=>JSON.stringify({...localStorage,...sessionStorage}).includes(marker),marker),false);assert.deepEqual(postRequests,[]);
  await p.screenshot({path:'/tmp/snote-chatbot-'+width+'.png'});await p.keyboard.press('Escape');assert.equal(await p.locator(panel).isHidden(),true);assert.equal(await p.locator(launcher).evaluate(e=>e===document.activeElement),true);
  await p.locator(launcher).click();await p.getByRole('button',{name:'도움말 닫기',exact:true}).click();assert.equal(await p.locator(launcher).getAttribute('aria-expanded'),'false');assert.equal(await p.locator(launcher).evaluate(e=>e===document.activeElement),true);
  if(width===320){await p.setViewportSize({width,height:480});await p.locator(launcher).click();await geometry(p);assert.equal(await p.locator(panel).evaluate(e=>getComputedStyle(e).animationName),'none');await p.keyboard.press('Escape');}
  if(width===1440){
   await p.locator(launcher).click();await p.getByRole('button',{name:'차량 등록',exact:true}).click();
   await p.evaluate(()=>{window.__chatAllowed=snotePageAllowed;window.__chatNavigate=navigate;window.__chatMoves=[];window.snotePageAllowed=()=>false;window.navigate=(...args)=>{window.__chatMoves.push(args[0]);return window.__chatNavigate(...args);};});
   await p.getByRole('button',{name:'매입 관리 열기',exact:true}).last().click();assert.deepEqual(await p.evaluate(()=>window.__chatMoves),[]);assert.match(await p.locator('.snote-chat-log .is-assistant').last().textContent(),/현재 계정/);
   await p.evaluate(()=>{window.snotePageAllowed=window.__chatAllowed;});await p.getByRole('button',{name:'차량 등록',exact:true}).click();await p.getByRole('button',{name:'매입 관리 열기',exact:true}).last().click();assert.deepEqual(await p.evaluate(()=>window.__chatMoves),['buy']);assert.equal(await p.locator(panel).isHidden(),true);await p.evaluate(()=>{window.navigate=window.__chatNavigate;});
   await p.locator(launcher).click();await p.evaluate(()=>openVehicle('encar-car-1'));await p.locator(widget).waitFor({state:'hidden'});assert.equal(await p.locator(panel).isHidden(),true);await p.locator('#vehicle-overlay .detail-close').click();await p.locator(launcher).waitFor({state:'visible'});
   await p.evaluate(()=>{currentUser=null;document.getElementById('auth-shell').classList.remove('hidden');document.getElementById('zc-cloud-gate').hidden=false;window.SnoteChatbot.refresh();});await p.locator(launcher).click();
   assert.equal(await p.locator(widget).evaluate(e=>!!e.closest('#zc-cloud-gate')),true,'Login help belongs inside the active modal login region');assert.equal(await p.getByRole('button',{name:'로그인 도움',exact:true}).count(),1);assert.equal(await p.getByRole('button',{name:'가입 · 직원 초대',exact:true}).count(),1);assert.equal(await p.getByRole('button',{name:'차량 등록',exact:true}).count(),0);assert(!(await p.locator('.snote-chat-log').textContent()).includes(marker));
   await p.getByRole('button',{name:'로그인 도움',exact:true}).click();assert.match(await p.locator('.snote-chat-log').textContent(),/이메일 인증/);assert.equal(await p.locator('.snote-chat-action').count(),0);await p.keyboard.press('Escape');
   await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!!window.SnoteChatbot);assert(!(await p.locator('.snote-chat-log').textContent()).includes(marker));
  }
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpectedDialogs,[]);await f.context.close();console.log('PASS '+width+' actual local FAQ widget, native focus/Esc/close, mobile navigation spacing, escaped input and memory-only chat'+(width===1440?', guarded real navigation, drawer exclusion and login/reload reset':''));
 }
}finally{await browser.close()}})().catch(error=>{console.error(error.stack);process.exitCode=1});
