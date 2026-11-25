'use strict';
// Real workspace, synthetic support bridge only. No live messages or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.MOBILE_CHATBOT_ARTIFACT_DIR||'/workspace/work/mobile-chatbot-v2233';fs.mkdirSync(OUT,{recursive:true});
const results=[],record=(name,extra={})=>{results.push({name,...extra});console.log('PASS '+name);};
async function setup(width){
 const f=await fixture(width),p=f.page;await p.evaluate(async()=>{await closeVehicle({discard:true,animate:false});});
 await p.waitForFunction(()=>!document.getElementById('vehicle-overlay').classList.contains('open')&&!!window.SnoteChatbot&&!!window.SnoteTutorial);
 await p.evaluate(()=>{
  const prior=snoteSupportChatBridge,ctx=prior.context();
  window.__mobileHelp={calls:[],writes:[],unread:2,readAt:'2026-11-25T00:01:00Z',hold:false,releases:[],waiting:0,version:1};
  const t=__mobileHelp,base=ctx,key=ctx?.key;
  window.snoteSupportChatBridge={context:()=>t.version===1?base:{...base,key:key+':other'},current:value=>!!value&&value.key===(t.version===1?key:key+':other'),
   async history(context,args){const readAt=t.readAt;t.calls.push({limit:args.limit,before:args.before,key:context.key});if(args.limit!==1&&t.hold){t.waiting++;await new Promise(resolve=>t.releases.push(resolve));t.waiting--;}
    return{messages:args.limit===1?[]:[{id:'synthetic-support-message',sender:'operator',text:'합성 상담 답변',sequence:1,createdAt:'2026-11-25T00:00:00Z',readAt}],hasMore:false,nextBefore:null,unreadCount:t.unread};},
   async read(context,args){t.writes.push({kind:'read',args});return{unreadCount:0};},
   async send(context,args){t.writes.push({kind:'send',args});throw Error('No support send is authorized in this test');}
  };
  t.release=()=>{t.hold=false;for(const release of t.releases.splice(0))release();};
  dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));SnoteChatbot.refresh();
 });
 await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await p.clock.install();await p.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 return f;
}
async function hidden(p){await p.waitForFunction(()=>{const r=document.getElementById('snote-chatbot'),panel=document.getElementById('snote-chatbot-panel');return r.hidden&&r.inert&&panel.hidden&&panel.inert&&!r.contains(document.activeElement);});assert.equal(await p.locator('#snote-chatbot-launcher').isHidden(),true);}
async function mobile(width){
 const f=await setup(width),p=f.page;try{
  await hidden(p);assert.equal(await p.evaluate(()=>SnoteChatbot.open()),false);assert.equal(await p.evaluate(()=>SnoteTutorial.open()),false);await hidden(p);
  const routeBefore=await p.evaluate(()=>route),beforePoll=await p.evaluate(()=>__mobileHelp.calls.length);await p.clock.fastForward(31000);
  const state=await p.evaluate(()=>({calls:__mobileHelp.calls,writes:__mobileHelp.writes,route}));
  assert(state.calls.length>beforePoll&&state.calls.some(c=>c.limit===1),'Profile unread polling remains available on mobile');assert.equal(await p.locator('#snote-profile-trigger').getAttribute('data-support-count'),'2','The existing profile support badge remains supplied on mobile');assert(state.calls.every(c=>c.limit===1),'Hidden mobile help never loads the active support history');assert.deepEqual(state.writes,[]);assert.equal(state.route,routeBefore);
  await p.evaluate(()=>{window.__mobileAccount=currentUser;currentUser=null;document.getElementById('auth-shell').classList.remove('hidden');document.getElementById('zc-cloud-gate').hidden=false;SnoteChatbot.refresh();});await hidden(p);assert.equal(await p.evaluate(()=>SnoteChatbot.open()),false);assert.equal(await p.evaluate(()=>SnoteTutorial.open()),false);await p.clock.fastForward(35000);await hidden(p);
  await p.screenshot({path:path.join(OUT,'mobile-hidden-'+width+'.png')});record('mobile '+width+' hides chatbot/tutorial APIs in workspace and public login; profile unread only');await finish(f);
 }catch(error){await f.page.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function resize(){
 const f=await setup(1440),p=f.page;try{
  await p.locator('#snote-chatbot-launcher').waitFor({state:'visible'});await p.locator('#snote-chatbot-launcher').click();await p.getByRole('button',{name:'상담원 연결',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.snote-support-log').textContent.includes('합성 상담 답변'));
  const draft='모바일 전환에도 보존할 합성 상담 초안';await p.locator('#snote-support-input').fill(draft);await p.evaluate(()=>{__mobileHelp.hold=true;__mobileHelp.readAt=null;});await p.getByRole('button',{name:'다시 불러오기',exact:true}).click();await p.waitForFunction(()=>__mobileHelp.waiting===1);
  const before=await p.evaluate(()=>__mobileHelp.calls.filter(c=>c.limit===50).length);await p.setViewportSize({width:390,height:844});await hidden(p);assert.equal(await p.locator('#snote-support-input').inputValue(),draft);
  await p.evaluate(()=>{__mobileHelp.readAt='2026-11-25T00:01:00Z';__mobileHelp.release();});await p.clock.fastForward(45000);assert.equal(await p.evaluate(()=>__mobileHelp.calls.filter(c=>c.limit===50).length),before,'No active support poll while mobile');assert.deepEqual(await p.evaluate(()=>__mobileHelp.writes),[]);assert.equal(await p.evaluate(()=>SnoteChatbot.open()),false);
  await p.setViewportSize({width:761,height:950});await p.locator('#snote-chatbot-launcher').waitFor({state:'visible'});assert.equal(await p.locator('#snote-chatbot-panel').isHidden(),true,'Desktop return does not reopen a private panel automatically');await p.locator('#snote-chatbot-launcher').click();await p.locator('#snote-support-input').waitFor({state:'visible'});assert.equal(await p.locator('#snote-support-input').inputValue(),draft);await p.waitForFunction(n=>__mobileHelp.calls.filter(c=>c.limit===50).length>n,before);assert.equal(await p.locator('#snote-chatbot-panel').evaluate(e=>e.contains(document.activeElement)),true);record('desktop support closes on mobile, rejects late history, stops active polling and preserves same-account draft on return');
  await p.keyboard.press('Escape');await p.evaluate(()=>SnoteTutorial.open());await p.locator('#snote-tutorial-dialog[open]').waitFor();await p.setViewportSize({width:760,height:844});await p.waitForFunction(()=>!document.getElementById('snote-tutorial-dialog').open);await hidden(p);record('desktop tutorial closes at mobile boundary without focus trapped in hidden help');
  await p.setViewportSize({width:1024,height:950});await p.locator('#snote-chatbot-launcher').waitFor({state:'visible'});await p.locator('#snote-chatbot-launcher').click();await p.getByRole('button',{name:'‹ 도움말',exact:true}).click();await p.getByRole('button',{name:'차량 등록',exact:true}).click();assert.match(await p.locator('.snote-chat-log').innerText(),/차량/);assert.deepEqual(await p.evaluate(()=>__mobileHelp.writes),[]);await p.screenshot({path:path.join(OUT,'desktop-resumed.png')});record('desktop FAQ and support entry remain usable after mobile round trip');await finish(f);
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-resize.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
if(require.main===module)(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{for(const width of[760,390,320])await mobile(width);await resize();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingMessages:0,operatingWrites:0,results},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
