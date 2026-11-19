'use strict';
// Actual application + Chromium. Identity, cars and all responses are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.ENCAR_LOADING_ARTIFACT_DIR||'/workspace/work/encar-id-gloar-ui/loading';fs.mkdirSync(OUT,{recursive:true});
const found={ok:true,status:'found',plate:'12가3456',id:'43123456',provider:'gloar'};
async function run(width){
 const f=await fixture(width,null,{lookupUnavailable:true}),p=f.page;let release=null,next=found,requests=0;
 try{
  await p.route('**/api/encar-id',async route=>{requests++;await new Promise(resolve=>{release=resolve;});release=null;try{await route.fulfill({status:next.ok?200:429,contentType:'application/json',body:JSON.stringify(next)});}catch{}});
  await p.waitForFunction(()=>!!window.SnoteEncarId);await p.locator('#vehicle-encar-check:not([disabled])').waitFor();
  const dialog=p.locator('#snote-encar-id-dialog'),loader=dialog.locator('[data-encar-id-loading]'),status=dialog.locator('[role="status"]');
  async function pending(){await p.locator('#vehicle-encar-check').click();await loader.waitFor({state:'visible'});for(let i=0;!release&&i<100;i++)await p.waitForTimeout(10);assert(release,'A pending real request must hold the animation');assert.equal(await loader.getAttribute('aria-hidden'),'true');assert.equal(await dialog.getAttribute('aria-busy'),'true');}
  async function stopped(){await loader.waitFor({state:'hidden'});assert.equal(await dialog.getAttribute('aria-busy'),null);}
  await pending();
  assert.equal(await loader.locator('.snote-encar-id-scan-lens').evaluate(e=>getComputedStyle(e).animationName),'snote-encar-search');
  assert.equal(await loader.locator('.snote-encar-id-loading-dots span').count(),3);assert.equal(await status.innerText(),'GLOAR DATA에서 광고 ID를 찾고 있습니다.');await p.screenshot({path:path.join(OUT,'searching-'+width+'.png')});
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await loader.locator('.snote-encar-id-scan-lens').evaluate(e=>getComputedStyle(e).animationName),'none');assert.match(await status.innerText(),/찾고 있습니다/);await p.screenshot({path:path.join(OUT,'searching-reduced-'+width+'.png')});await p.emulateMedia({reducedMotion:'no-preference'});
  release();await dialog.locator('[data-encar-ad-id]').filter({hasText:'43123456'}).waitFor();await stopped();assert.equal((await dialog.innerText()).trim(),'광고 ID\n43123456\n확인');await dialog.getByRole('button',{name:'확인',exact:true}).click();
  next={ok:false,code:'UPSTREAM_RATE_LIMITED'};await pending();release();await status.filter({hasText:'검색 브라우저의 실행 요청'}).waitFor();await stopped();await dialog.getByRole('button',{name:'확인',exact:true}).click();
  next=found;await pending();await dialog.getByRole('button',{name:'확인',exact:true}).click();await stopped();assert.equal(await dialog.isVisible(),false);release();await p.waitForTimeout(40);
  await pending();await p.evaluate(()=>{__encarFixtureState.user={id:'99999999-9999-4999-8999-999999999999'};currentUser={...currentUser,username:'other-synthetic-account'};});await dialog.waitFor({state:'hidden'});await stopped();release();await p.waitForTimeout(40);
  assert.equal(await dialog.locator('[data-encar-ad-id]').innerText(),'');assert.equal(await p.evaluate(()=>__encarFixtureWrites.length),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(requests,4);
  console.log('PASS searching animation',width,'pending/success/rate-limit/close/account-change + reduced-motion; no writes');return{width,requests,pass:true};
 }finally{release?.();await finish(f);}
}
async function main(){const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{const results=[];for(const width of[1440,390])results.push(await run(width));fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({syntheticOnly:true,results},null,2)+'\n');}finally{await browser.close();}}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
