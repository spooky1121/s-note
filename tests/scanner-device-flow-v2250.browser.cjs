'use strict';
// The actual accountant page and private-inbox flow, with a generated image and
// a fake loopback helper. No scanner, operating account or network is contacted.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const inbox=require('./accountant-scanner-v2247.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),BASE='http://127.0.0.1:17426',OUT=process.env.SCANNER_DEVICE_FLOW_ARTIFACT_DIR||'/workspace/work/scanner-device-v2250/browser';
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==','base64');
const S={main:'#snote-scanner-device-scan',panel:'[data-scanner-device-panel]',code:'[data-scanner-device-code]',pair:'[data-scanner-device-pair]',select:'[data-scanner-device-select]',start:'[data-scanner-device-start]',save:'[data-scanner-device-save]',cancel:'[data-scanner-device-cancel]',status:'[data-scanner-device-status]'};
const FILES=['index.html','assets/scanner.js','assets/scanner.css','assets/scanner-device.js','assets/scanner-client.js','assets/feature-loader.js'];
const hash=value=>crypto.createHash('sha256').update(value).digest('hex'),sources=()=>Object.fromEntries(FILES.map(file=>[file,hash(fs.readFileSync(path.join(ROOT,file)))]));
const later=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};},checks=[];
fs.mkdirSync(OUT,{recursive:true});
function record(name,evidence={}){checks.push({name,...evidence});console.log('PASS '+name);fs.writeFileSync(path.join(OUT,'progress.json'),JSON.stringify({syntheticOnly:true,operatingReads:0,operatingWrites:0,checks},null,2)+'\n');}
async function until(test,label){const end=Date.now()+15000;while(!test()){if(Date.now()>end)throw Error('Timed out waiting for '+label);await new Promise(resolve=>setTimeout(resolve,20));}}
function fakeHelper(now){
 const token='a7'.repeat(32),helper={calls:[],jobs:new Map(),available:true,protocol:1,startCode:null,scanCode:null,holdStatus:false,imageHold:null,deviceName:'Samsung SL-J3560FW (가상)',sequence:0};
 const json=(status,body)=>({status,headers:{'content-type':'application/json','cache-control':'no-store'},text:JSON.stringify(body)}),fail=(status,code)=>json(status,{ok:false,code});
 helper.handle=async request=>{
  assert.equal(new URL(request.url).origin,BASE);assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');assert(!Object.hasOwn(request.headers,'authorization'),'Supabase/session Authorization must never reach the local helper');assert(!Object.hasOwn(request.headers,'apikey'));assert(!JSON.stringify(request.headers).includes('Bearer '));
  const url=new URL(request.url),method=request.method||'GET',body=request.body?JSON.parse(request.body):null,call={method,path:url.pathname,body,headers:request.headers};helper.calls.push(call);
  if(!helper.available)return{networkError:true};
  if(url.pathname==='/v1/health')return json(200,{ok:true,product:'snote-scanner-connector',protocol:helper.protocol,version:'1.0.0',platform:'windows'});
  if(url.pathname==='/v1/pair'){if(body?.code!=='123456')return fail(403,'BAD_CODE');return json(200,{ok:true,token,expiresAt:new Date(new Date(now).getTime()+12*60*60*1000).toISOString()});}
  if(request.headers['x-snote-scanner-token']!==token)return fail(401,'PAIRING_REQUIRED');
  if(url.pathname==='/v1/devices')return json(200,{ok:true,devices:[{id:'synthetic-j3560',name:helper.deviceName,sources:['flatbed','feeder']}]});
  if(url.pathname==='/v1/scans'&&method==='POST'){
   if(helper.startCode)return fail(409,helper.startCode);assert.match(body.id,/^[a-f0-9-]{36}$/i);assert.equal(body.deviceId,'synthetic-j3560');assert(['flatbed','feeder'].includes(body.source));assert([150,200,300].includes(body.dpi));assert(['color','gray','bw'].includes(body.color));
   const old=helper.jobs.get(body.id);if(old)assert.deepEqual(old.request,body,'Same scan request ID must retain its fingerprint');else helper.jobs.set(body.id,{request:body,cancelled:false,polls:0});return json(202,{ok:true,id:body.id,state:'running'});
  }
  const m=url.pathname.match(/^\/v1\/scans\/([a-f0-9-]+)(\/image)?$/i),job=m&&helper.jobs.get(m[1]);if(!job)return fail(404,'NOT_FOUND');
  if(method==='DELETE'){job.cancelled=true;return json(200,{ok:true,id:m[1],state:'cancelled'});}
  if(m[2]){if(helper.imageHold){helper.imageHold.started.resolve();await helper.imageHold.release.promise;}if(job.cancelled)return fail(409,'CANCELLED');return{status:200,headers:{'content-type':'image/jpeg','content-length':String(JPEG.length),'cache-control':'no-store','x-snote-scan-id':m[1]},base64:JPEG.toString('base64')};}
  job.polls++;if(job.cancelled)return json(200,{ok:true,id:m[1],state:'cancelled'});if(helper.scanCode)return json(200,{ok:true,id:m[1],state:'failed',code:helper.scanCode});return json(200,{ok:true,id:m[1],state:helper.holdStatus?'running':'complete'});
 };
 return helper;
}
async function setup(browser,width=1440){
 const windows={newContext:async options=>{const context=await browser.newContext({...options,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36'});await context.addInitScript(()=>{Object.defineProperty(navigator,'platform',{get:()=> 'Win32'});Object.defineProperty(navigator,'userAgentData',{get:()=>({platform:'Windows',mobile:false})});});return context;}};
 const state=inbox.backend(),f=await inbox.setup(windows,width,'accountant@example.invalid',state),p=f.page,h=f.helper=fakeHelper(state.now),seed=state.scannerSeed;
 state.scannerSeed=(companyId,name,createdAt)=>{const item=seed(companyId,name,createdAt);if(/\.jpe?g$/i.test(name)){item.mimeType='image/jpeg';item.size=JPEG.length;Object.assign(state.scannerRows.get(item.id).item,item);}return item;};
 await p.exposeFunction('__scannerDeviceFixture',request=>h.handle(request));
 await p.evaluate(BASE=>{
  const native=window.fetch;window.__scannerDeviceUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);__scannerDeviceUrls.created.push(url);return url;};URL.revokeObjectURL=value=>{__scannerDeviceUrls.revoked.push(value);return revoke(value);};
  window.fetch=async(input,init={})=>{const url=String(typeof input==='string'||input instanceof URL?input:input.url);if(!url.startsWith(BASE+'/'))return native(input,init);const request=new Request(input,init),headers=Object.fromEntries(request.headers),signal=init.signal||request.signal;if(signal?.aborted)throw new DOMException('Synthetic helper request cancelled','AbortError');const body=['GET','HEAD'].includes(request.method)?null:await request.clone().text();if(signal?.aborted)throw new DOMException('Synthetic helper request cancelled','AbortError');const result=window.__scannerDeviceFixture({url,method:request.method,headers,body,credentials:request.credentials,redirect:request.redirect,cache:request.cache});return new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Synthetic helper request cancelled','AbortError'));signal?.addEventListener('abort',abort,{once:true});result.then(reply=>{signal?.removeEventListener('abort',abort);if(reply.networkError)return reject(new TypeError('Synthetic local connection unavailable'));const bytes=reply.base64?Uint8Array.from(atob(reply.base64),c=>c.charCodeAt(0)):reply.text||'';resolve(new Response(bytes,{status:reply.status,headers:reply.headers}));},reject);});};
 },BASE);
 assert.equal(h.calls.length,0);assert(!await p.evaluate(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname==='/assets/scanner-device.js')),'Device module must not load during login');
 await p.evaluate(()=>window.navigate('acctScanner'));await p.locator('#snote-scanner').waitFor();await p.locator('[data-scanner-record-id]').first().waitFor();assert.equal(h.calls.length,0,'Opening scanner menu must not probe local devices');assert(!await p.evaluate(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname==='/assets/scanner-device.js')),'Device module remains lazy until a device action');
 return f;
}
async function connect(f){const p=f.page;await p.locator(S.main).click();await p.locator(S.code).waitFor();await p.locator(S.code).fill('123456');await p.locator(S.pair).click();await until(()=>f.helper.calls.some(c=>c.path==='/v1/devices'),'paired device enumeration');await p.locator(S.select+' option').first().waitFor({state:'attached'});await p.locator(S.start).waitFor({state:'visible'});assert.equal(await p.evaluate(cap=>[localStorage,sessionStorage].some(storage=>Object.values(storage).some(value=>String(value).includes(cap))),'a7'.repeat(32)),false,'Local scanner capabilities must remain memory-only');}
async function start(f){const p=f.page;if(!f.helper.calls.some(c=>c.method==='POST'&&c.path==='/v1/scans')){await p.locator(S.start).waitFor();await p.locator(S.start).click();}}
async function preview(f){await f.page.locator(S.save).waitFor({state:'visible'});assert.equal(f.state.scannerCalls.filter(c=>c.action==='upload').length,0,'Scanned image must wait for explicit preview-save confirmation');}
async function noUrlsRemain(p){const u=await p.evaluate(()=>__scannerDeviceUrls);assert(u.created.every(url=>u.revoked.includes(url)),'Every generated preview object URL must be revoked');}
async function noOtherWrites(s){assert.equal(s.officeCalls.length,0);assert.equal(s.infoWrites.length,0);assert.equal(s.boxWrites.length,0);assert.equal(s.scheduleWrites.length,0);assert.equal(s.monthlyWrites,0);assert(!s.rpcCalls.some(c=>/zc_write_dataset|profile.*save|member.*save|finance.*save/.test(c.name)));}
async function happy(browser,width){
 const f=await setup(browser,width),p=f.page,h=f.helper;
 try{
  await connect(f);await start(f);await preview(f);assert.equal(h.calls.filter(c=>c.path==='/v1/scans'&&c.method==='POST').length,1);const b=await p.locator(S.panel).evaluate(e=>({right:e.getBoundingClientRect().right,width:innerWidth,page:document.documentElement.scrollWidth}));assert(b.right<=b.width+1&&b.page<=b.width+1,'Device panel fits viewport');await p.screenshot({path:path.join(OUT,'preview-'+width+'.png'),fullPage:true});
  await p.locator(S.save).click();await until(()=>f.state.scannerCalls.filter(c=>c.action==='upload').length===1,'confirmed scanned image upload');await p.locator('[data-scanner-job-state=saved]').waitFor();const call=f.state.scannerCalls.find(c=>c.action==='upload');assert.equal(call.file.type,'image/jpeg');assert.equal(call.file.sha256,hash(JPEG));assert(call.file.name.endsWith('.jpg')||call.file.name.endsWith('.jpeg'));await noUrlsRemain(p);await noOtherWrites(f.state);record('actual accountant device scan → preview → explicit private save '+width,{helperScans:1,privateUploads:1,viewport:b});
  const before=h.calls.filter(c=>c.path==='/v1/scans'&&c.method==='POST').length;await p.locator(S.main).dblclick();await p.locator(S.save).waitFor();assert.equal(h.calls.filter(c=>c.path==='/v1/scans'&&c.method==='POST').length,before+1,'Duplicate clicks start one physical scan');await p.locator(S.cancel).last().click();assert.equal(f.state.scannerCalls.filter(c=>c.action==='upload').length,1);await noUrlsRemain(p);record('paired repeat click scans once and cancelling preview never uploads '+width);await f.finish();
 }catch(error){await p.screenshot({path:path.join(OUT,'failure-happy-'+width+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
}
async function connectionFailures(browser){
 for(const kind of['unavailable','protocol','pair']){
  const f=await setup(browser),p=f.page,h=f.helper;
  try{if(kind==='unavailable')h.available=false;if(kind==='protocol')h.protocol=999;await p.locator(S.main).click();await p.locator(S.panel).waitFor();
   if(kind==='pair'){await p.locator(S.code).fill('000000');await p.locator(S.pair).click();await until(()=>h.calls.some(c=>c.path==='/v1/pair'),'bad pairing response');await p.waitForTimeout(100);assert.equal(h.calls.filter(c=>c.path==='/v1/devices').length,0);assert.equal(h.calls.filter(c=>c.path==='/v1/scans').length,0);assert.match(await p.locator(S.panel).innerText(),/코드|연결/);}
   else{await p.waitForTimeout(100);assert.equal(h.calls.filter(c=>c.path==='/v1/scans').length,0);assert.match(await p.locator(S.panel).innerText(),/설치|연결|업데이트|지원/);}
   assert.equal(f.state.scannerCalls.filter(c=>c.action==='upload').length,0);record('helper '+kind+' shows recovery guidance without scan or private upload');await f.finish();
  }catch(error){await p.screenshot({path:path.join(OUT,'failure-'+kind+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
 }
}
async function scanFailures(browser){
 for(const code of['BUSY','NO_PAPER','DRIVER_ERROR']){
  const f=await setup(browser),p=f.page,h=f.helper;
  try{if(code==='BUSY')h.startCode=code;else h.scanCode=code;await connect(f);await start(f);await until(()=>h.calls.some(c=>c.path==='/v1/scans'&&c.method==='POST'),'failed scanner attempt');await p.waitForTimeout(200);assert.equal(await p.locator(S.save).isVisible(),false);assert.equal(f.state.scannerCalls.filter(c=>c.action==='upload').length,0);assert.match(await p.locator(S.panel).innerText(),/스캔|용지|연결|사용|작업/);record(code+' has no false preview or private upload');await f.finish();}
  catch(error){await p.screenshot({path:path.join(OUT,'failure-'+code+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
 }
}
async function lifecycle(browser){
 for(const kind of['cancel','logout']){
  const f=await setup(browser),p=f.page,h=f.helper,held={started:later(),release:later()};
  try{h.imageHold=held;await connect(f);await start(f);await held.started.promise;
   if(kind==='cancel'){await p.locator(S.cancel).last().click();assert.equal(await p.evaluate(()=>window.navigate('acctInfo')),true);await p.locator('#snote-accountant-information').waitFor();}
   else await p.evaluate(async()=>{await __normalState.client.auth.signOut({scope:'local'});});
   held.release.resolve();await p.waitForTimeout(150);assert.equal(f.state.scannerCalls.filter(c=>c.action==='upload').length,0);assert.equal(await p.locator(S.save).isVisible(),false);await noUrlsRemain(p);assert(h.calls.some(c=>c.method==='DELETE'),'Leaving must discard the transient local scan');record('late native image after '+kind+' cannot create a preview or private upload');await f.finish();
  }catch(error){held.release.resolve();await p.screenshot({path:path.join(OUT,'failure-lifecycle-'+kind+'.png'),fullPage:true}).catch(()=>{});await f.context.close();throw error;}
 }
}
async function ordinaryImport(browser){
 const f=await setup(browser,390),p=f.page;
 try{await p.locator('#snote-scanner-files').setInputFiles({name:'기존 파일 선택.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});await p.locator('[data-scanner-job-state=saved]').waitFor();assert.equal(f.helper.calls.length,0);assert(!await p.evaluate(()=>performance.getEntriesByType('resource').some(e=>new URL(e.name).pathname==='/assets/scanner-device.js')));record('existing image import persists without loading or contacting the device helper');await f.finish();}catch(error){await f.context.close();throw error;}
}
async function safeDeviceText(browser){
 const f=await setup(browser),p=f.page;
 try{f.helper.deviceName='<img src=x onerror=alert(1)> 가상 장치';await connect(f);assert.equal(await p.locator(S.panel+' img[onerror]').count(),0);assert.equal(await p.locator(S.panel+' [onerror]').count(),0);assert((await p.locator(S.select).textContent()).includes('<img src=x onerror=alert(1)>'));assert.equal(f.helper.jobs.size,0);record('driver-supplied device names render as text without executing markup');await f.finish();}catch(error){await f.context.close();throw error;}
}
async function run(){
 const before=sources(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});
 try{for(const width of[1440,390])await happy(browser,width);await connectionFailures(browser);await scanFailures(browser);await lifecycle(browser);await ordinaryImport(browser);await safeDeviceText(browser);assert.deepEqual(sources(),before,'Product source must stay frozen during device QA');fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingReads:0,operatingWrites:0,helperTransport:'Interception of only the fixed loopback fetch target; browser LNA user permission is not automated here.',checks,sourceHashes:before,physicalScannerTested:false},null,2)+'\n');}
 finally{await browser.close();}
}
if(require.main===module)run().catch(error=>{fs.writeFileSync(path.join(OUT,'failure.txt'),error.stack||String(error));console.error(error.stack);process.exitCode=1;});
module.exports={fakeHelper};
