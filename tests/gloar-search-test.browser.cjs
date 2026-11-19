'use strict';
// Actual static test page in Chromium; all auth and API responses are synthetic.
// No external provider request, real account, database write, or deployed lookup.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.GLOAR_TEST_ARTIFACT_DIR||'/workspace/work/gloar-search-test/browser';
const PROJECT='https://rmlycycleuscfqywbihj.supabase.co',AUTH_KEY='sb-rmlycycleuscfqywbihj-auth-token';
const USER='11111111-1111-4111-8111-111111111111',SESSION='22222222-2222-4222-8222-222222222222';
const token=(extra={})=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:USER,session_id:SESSION,exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url'),'synthetic'].join('.');
const found=(plate='28오6877',slug='encar-43161296')=>({ok:true,status:'found',plate,links:[{url:'https://gloar-data.com/en/lot/'+slug,title:'실제 화면 테스트용 합성 차량'}]});
let browser,origin;const summaries=[];
async function fixture(width,{auth=true,remember=false,expired=false,claims={},configured=true,shortDeadline=false}={}){
 const context=await browser.newContext({viewport:{width,height:960},deviceScaleFactor:1});
 const authToken=token(claims),requests=[],external=[],errors=[];
 await context.addInitScript(({auth,remember,expired,authToken,AUTH_KEY,PROJECT,USER,SESSION,shortDeadline})=>{
  localStorage.clear();sessionStorage.clear();
  if(remember)localStorage.setItem('snote95-remember-login','1');
  if(auth)(remember?localStorage:sessionStorage).setItem(AUTH_KEY,JSON.stringify({access_token:authToken}));
  if(expired)localStorage.setItem('snote-idle:v1:'+encodeURIComponent(PROJECT)+':'+encodeURIComponent(USER)+':expired:'+encodeURIComponent(SESSION),JSON.stringify({version:1,project:PROJECT,userId:USER,sessionId:SESSION,at:Date.now()}));
  window.__storageWrites=[];
  for(const name of ['setItem','removeItem','clear']){const original=Storage.prototype[name];Storage.prototype[name]=function(...args){window.__storageWrites.push(name);return original.apply(this,args);};}
  if(shortDeadline){const original=window.setTimeout;window.setTimeout=function(fn,ms,...args){return original(fn,ms===60000?120:ms,...args);};}
 },{auth,remember,expired,authToken,AUTH_KEY,PROJECT,USER,SESSION,shortDeadline});
 let next=found(),handler=null;
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==origin){external.push(url.href);await route.abort();return;}
  if(url.pathname==='/api/gloar-search'){
   const record={method:request.method(),headers:request.headers(),body:request.postDataJSON()};requests.push(record);
   if(request.method()==='GET'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,configured})});return;}
   if(handler){await handler(route,record);return;}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(next)});return;
  }
  await route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/gloar-search-test.html');
 await page.locator('#configuration').filter({hasText:configured?'검색 준비됨':'서버 설정 필요'}).waitFor();
 return{page,context,requests,external,errors,authToken,setNext(value){next=value;},setHandler(value){handler=value;},async finish(){assert.deepEqual(external,[]);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.__storageWrites),[]);await context.close();}};
}
async function common(width){
 const f=await fixture(width),p=f.page;
 try{
  assert.equal(await p.locator('#plate').inputValue(),'28오6877');assert.equal(await p.locator('#auth-notice').isVisible(),false);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'GET');assert.equal(f.requests[0].headers.authorization,undefined);
  await p.fill('#plate','incorrect');await p.click('#search-button');await p.locator('#search-status').filter({hasText:'차량번호를 확인'}).waitFor();assert.equal(f.requests.length,1);
  await p.fill('#plate','２８오６８７７');await p.click('#search-button');await p.locator('#results-section').waitFor({state:'visible'});
  assert.equal(f.requests[1].method,'POST');assert.deepEqual(f.requests[1].body,{plate:'28오6877'});assert.equal(f.requests[1].headers.authorization,'Bearer '+f.authToken);
  assert.equal(await p.locator('.result-link').getAttribute('href'),'https://gloar-data.com/en/lot/encar-43161296');assert.equal(await p.locator('.result-link').getAttribute('rel'),'noopener noreferrer');
  assert.equal(await p.locator('#result-count').textContent(),'1건');assert.equal(await p.locator('#search-spinner').isVisible(),false);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:path.join(OUT,'found-'+width+'.png'),fullPage:true});
  f.setNext({ok:true,status:'found',plate:'28오6877',links:[
   {url:'https://gloar-data.com/en/lot/safe',title:'<img src=x onerror=alert(1)>'},
   {url:'https://gloar-data.com:443/en/lot/explicit-port'},
   {url:'https://user@gloar-data.com/en/lot/userinfo'},
   {url:'https://evil.example/en/lot/foreign'},
   {url:'https://gloar-data.com/en/lot/encoded%2Fslug'},
   {url:'https://gloar-data.com/en/lot/fragment#secret'}
  ]});
  await p.click('#search-button');await p.locator('.result-link').filter({hasText:'<img src=x onerror=alert(1)>'}).waitFor();assert.equal(await p.locator('.result-link').count(),1);assert.equal(await p.locator('#results img').count(),0);
  f.setNext({ok:true,status:'found',plate:'12가3456',links:[{url:'https://gloar-data.com/en/lot/wrong'}]});await p.click('#search-button');await p.locator('#search-status').filter({hasText:'응답을 확인하지 못했습니다'}).waitFor();assert.equal(await p.locator('#results-section').isVisible(),false);
  f.setNext({ok:true,status:'not_found',plate:'28오6877',links:[]});await p.click('#search-button');await p.locator('#search-status').filter({hasText:'검색 결과를 찾지 못했습니다'}).waitFor();assert.equal(await p.locator('#results-section').isVisible(),false);
  let release;f.setHandler(async route=>{await new Promise(resolve=>release=resolve);try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(found('28오6877','late'))});}catch{}});
  await p.click('#search-button');await p.locator('#search-spinner').waitFor({state:'visible'});assert.equal(await p.locator('#search-form').getAttribute('aria-busy'),'true');
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('#search-spinner').evaluate(element=>getComputedStyle(element).animationName),'none');
  await p.screenshot({path:path.join(OUT,'loading-'+width+'.png'),fullPage:true});await p.click('#cancel-button');await p.locator('#search-status').filter({hasText:'검색을 취소했습니다'}).waitFor();assert.equal(await p.locator('#search-spinner').isVisible(),false);
  f.setHandler(null);f.setNext(found('28오6877','newer'));await p.click('#search-button');await p.locator('.result-link[href$="/newer"]').waitFor();release?.();await p.waitForTimeout(80);assert.equal(await p.locator('.result-link').getAttribute('href'),'https://gloar-data.com/en/lot/newer');
  f.setHandler(async route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({ok:false,status:'error',code:'AUTH_FAILED',error:'must not render raw secret'})}));
  await p.click('#search-button');await p.locator('#search-status').filter({hasText:'로그인이 만료'}).waitFor();assert.equal(await p.locator('#auth-notice').isVisible(),true);assert.equal(await p.locator('#auth-notice a').getAttribute('href'),'/');assert.equal(await p.locator('#search-button').isDisabled(),true);assert(!((await p.locator('body').innerText()).includes('must not render raw secret')));
  summaries.push({width,passed:true,cases:['configuration GET','default plate','validation','normalized POST','authenticated read only','actual returned links','URL allowlist','DOM text safety','mismatch','not found','loading','reduced motion','cancel and stale response','auth failure guidance'],externalRequests:0});
 }finally{await f.finish();}
}
async function authCases(){
 for(const options of [{auth:false},{expired:true},{claims:{exp:1}},{configured:false},{remember:true}]){
  const f=await fixture(390,options);try{
   if(options.remember){await f.page.click('#search-button');await f.page.locator('#results-section').waitFor({state:'visible'});assert.equal(f.requests.filter(x=>x.method==='POST').length,1);}
   else{assert.equal(await f.page.locator('#search-button').isDisabled(),true);assert.equal(f.requests.filter(x=>x.method==='POST').length,0);if(options.configured!==false)assert.equal(await f.page.locator('#auth-notice').isVisible(),true);}
  }finally{await f.finish();}
 }
 const f=await fixture(390,{shortDeadline:true});try{
  await f.page.evaluate(()=>{const original=fetch;window.fetch=(url,options)=>options?.method==='POST'?Promise.resolve(new Response(new ReadableStream({start(){},cancel(){return new Promise(()=>{});}}),{headers:{'Content-Type':'application/json'}})):original(url,options);});
  await f.page.click('#search-button');await f.page.locator('#search-status').filter({hasText:'검색 시간이 초과'}).waitFor();assert.equal(await f.page.locator('#search-spinner').isVisible(),false);assert.equal(await f.page.locator('#search-button').isEnabled(),true);
 }finally{await f.finish();}
 summaries.push({authAndTimeoutCases:['missing auth','idle expiry','JWT expiry','missing server configuration','remembered auth','deadline covers stalled body with nonsettling reader cancellation'],passed:true});
}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(!['/gloar-search-test.html','/assets/gloar-search-test.js','/assets/gloar-search-test.css','/assets/idle-auth-storage.js'].includes(pathname)){response.writeHead(404);response.end();return;}
  response.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');response.end(fs.readFileSync(path.join(ROOT,pathname)));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 try{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});for(const width of[1440,390])await common(width);await authCases();fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({syntheticOnly:true,liveProviderVerified:false,summaries},null,2)+'\n');console.log(JSON.stringify({passed:true,syntheticOnly:true,summaries},null,2));}
 finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
