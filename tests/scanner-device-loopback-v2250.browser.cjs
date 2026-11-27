'use strict';
// Real browser HTTPS -> real loopback Kestrel -> generated fake scanner bytes.
// No browser security features are disabled and no WIA/operating API is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const{chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SCANNER_LOOPBACK_ARTIFACT_DIR||'/workspace/work/scanner-device-v2250/loopback-browser',DOTNET=process.env.DOTNET_EXECUTABLE||'/workspace/work/deps/dotnet/dotnet';
const ORIGIN='https://s-note.kr',EVIL='https://evil.invalid',MODULE=fs.readFileSync(path.join(ROOT,'assets/scanner-device.js'));
const files=['assets/scanner-device.js','tools/scanner-connector/ScannerConnector.Core/ConnectorHost.cs','tools/scanner-connector/ScannerConnector.Core/PairingState.cs','tools/scanner-connector/ScannerConnector.Core/ScanJobs.cs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
fs.mkdirSync(OUT,{recursive:true});
async function server(){
 const env={...process.env,DOTNET_CLI_HOME:'/workspace/work/deps/dotnet-home',DOTNET_NOLOGO:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'};
 await new Promise((resolve,reject)=>{const build=spawn(DOTNET,['build','--no-restore','tools/scanner-connector/ScannerConnector.Tests/ScannerConnector.Tests.csproj'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});let output='';build.stdout.on('data',data=>{output+=String(data);});build.stderr.on('data',data=>{output+=String(data);});build.on('error',reject);build.on('exit',code=>code===0?resolve():reject(Error('Native test-host build failed: '+output)));});
 // Run the DLL directly so the one process we terminate owns the listener.
 const child=spawn(DOTNET,[path.join(ROOT,'tools/scanner-connector/ScannerConnector.Tests/bin/Debug/net10.0/ScannerConnector.Tests.dll'),'--serve'],{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 const ready=new Promise((resolve,reject)=>{let text='',errors='',done=false;const timer=setTimeout(()=>{if(!done){done=true;child.kill();reject(Error('Synthetic native test host did not start'));}},45000);
  child.stderr.on('data',data=>{errors+=String(data);});child.stdout.on('data',data=>{text+=String(data);const line=text.split('\n').find(line=>line.startsWith('SNOTE_SYNTHETIC_SCANNER_READY '));if(line&&!done){done=true;clearTimeout(timer);resolve(JSON.parse(line.slice('SNOTE_SYNTHETIC_SCANNER_READY '.length)));}});child.on('error',error=>{if(!done){done=true;clearTimeout(timer);reject(error);}});child.on('exit',code=>{if(!done){done=true;clearTimeout(timer);reject(Error('Synthetic native host exited '+code+': '+errors));}});
 });
 return{child,ready};
}
async function grant(context,page,origin){
 const target=await context.newCDPSession(page),info=await target.send('Target.getTargetInfo'),browserContextId=info.targetInfo.browserContextId,granted=[],unsupported=[];await target.detach();
 const cdp=await context.browser().newBrowserCDPSession();
 // Current CDP exposes loopbackNetwork separately. The older Playwright
 // alias and PermissionDescriptor overrides can leave Chrome154 at prompt.
 try{await cdp.send('Browser.grantPermissions',{permissions:['loopbackNetwork'],origin,browserContextId});granted.push('loopbackNetwork');}
 catch{unsupported.push('loopbackNetwork');try{await context.grantPermissions(['local-network-access'],{origin});granted.push('playwright:local-network-access');}catch{unsupported.push('playwright:local-network-access');}}
 await cdp.detach();return{granted,unsupported,browserContextId};
}
async function main(){
 const before=hashes(),host=await server();let browser;const diagnostics={console:[],failedRequests:[],responses:[]};
 try{
  const native=await host.ready;assert.equal(native.actualWiaUsed,false);assert.equal(new URL(native.address).hostname,'127.0.0.1');
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});const context=await browser.newContext(),page=await context.newPage(),requests=[];
  await context.route(ORIGIN+'/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/assets/scanner-device.js')return route.fulfill({contentType:'application/javascript',body:MODULE});return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><title>가상 스캐너 연결 검증</title><script src="/assets/scanner-device.js"></script><body>Generated scanner wire test</body></html>'});});
  await context.route(EVIL+'/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Untrusted origin fixture</title>'}));
  diagnostics.browserVersion=browser.version();page.on('console',msg=>diagnostics.console.push(msg.text()));page.on('requestfailed',request=>diagnostics.failedRequests.push({url:request.url(),failure:request.failure()}));page.on('response',response=>{if(response.url().startsWith('http://127.0.0.1:17426/'))diagnostics.responses.push({url:response.url(),status:response.status()});});page.on('request',request=>{if(request.url().startsWith('http://127.0.0.1:17426/')){const headers=request.headers();assert(!headers.authorization&&!headers.apikey,'Cloud authentication must not reach loopback');requests.push({method:request.method(),path:new URL(request.url()).pathname});}});
  await page.goto(ORIGIN+'/__synthetic_scanner_wire__');await page.waitForFunction(()=>!!window.SnoteScannerDevice);
  const permissions=await grant(context,page,ORIGIN);diagnostics.permissions=permissions;
  diagnostics.page=await page.evaluate(async()=>{const states={};for(const name of['loopback-network','local-network-access','local-network'])try{states[name]=(await navigator.permissions.query({name})).state;}catch(error){states[name]=String(error);}return{secure:isSecureContext,origin:location.origin,states,policy:document.permissionsPolicy?.allowedFeatures?.()||document.featurePolicy?.allowedFeatures?.()};});
  // Permission-query implementations may retain "prompt" for local-network
  // aliases. Success requires actual browser fetch/CORS below, never this hint.
  const result=await page.evaluate(async code=>{const client=SnoteScannerDevice.createClient({isCurrent:()=>true,pollMs:10}),healthy=await client.probe(),paired=await client.pair(code),devices=await client.devices(),file=await client.scan({deviceId:devices[0].id,source:'flatbed',dpi:300,color:'color'}),bytes=new Uint8Array(await file.arrayBuffer());return{healthy,paired,count:devices.length,file:{name:file.name,type:file.type,size:file.size},magic:[bytes[0],bytes[1],bytes.at(-2),bytes.at(-1)],persisted:[localStorage,sessionStorage].some(storage=>Object.keys(storage).length>0)};},native.code);
  assert(result.healthy&&result.paired);assert.equal(result.count,1);assert.equal(result.file.type,'image/jpeg');assert.equal(result.file.size,631);assert.deepEqual(result.magic,[255,216,255,217]);assert.equal(result.persisted,false);
  assert.equal(requests.filter(r=>r.method==='POST'&&r.path==='/v1/scans').length,1);assert(requests.some(r=>r.method==='GET'&&r.path.endsWith('/image')));
  const hostile=await context.newPage();await hostile.goto(EVIL+'/');const hostilePermissions=await grant(context,hostile,EVIL);
  const blocked=await hostile.evaluate(async()=>{try{await fetch('http://127.0.0.1:17426/v1/health',{credentials:'omit',targetAddressSpace:'loopback'});return false;}catch{return true;}});assert.equal(blocked,true,'An untrusted HTTPS origin cannot read the loopback service');
  assert.deepEqual(hashes(),before);const receipt={ok:true,syntheticOnly:true,realBrowserFetch:true,realLoopbackHttp:true,realCorsAndPreflight:true,physicalScannerTested:false,actualWiaUsed:false,productionRequests:0,browserVersion:browser.version(),permissions,hostilePermissions,securityFeaturesDisabled:false,cases:['approved HTTPS origin pairs and enumerates over real loopback HTTP','one actual client scan obtains generated JPEG through real CORS/preflight','untrusted HTTPS origin remains blocked despite granted loopback permission'],result,requests,sourceHashes:before};fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(receipt,null,2)+'\n');console.log('PASS actual HTTPS browser -> loopback CORS/pair/scan/image and foreign-origin rejection');await context.close();
 }catch(error){fs.writeFileSync(path.join(OUT,'failure-diagnostics.json'),JSON.stringify(diagnostics,null,2)+'\n');throw error;}finally{if(browser)await browser.close();host.child.kill('SIGTERM');}
}
if(require.main===module)main().catch(error=>{fs.writeFileSync(path.join(OUT,'failure.txt'),error.stack||String(error));console.error(error.stack);process.exitCode=1;});
