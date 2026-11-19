'use strict';
// Native Workers WebSocket contract, entirely within two synthetic service-bound
// workers. No Cloudflare account, provider, customer or outbound URL is accessed.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar-id-browser.workerd.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{Miniflare,Response:WorkerResponse,convertV4MiniflareOptions}=require('miniflare');
const root=path.resolve(__dirname,'..');
const transport=fs.readFileSync(path.join(root,'functions/_shared/encar-id-browser.mjs'),'utf8');
const entry=`
import {createBrowserSession} from './transport.mjs';
export default{async fetch(request,env){
 let browser;const trace=[];
 try{browser=await createBrowserSession({CLOUDFLARE_ACCOUNT_ID:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',CLOUDFLARE_BROWSER_TOKEN:'synthetic-browser-token'},{fetchImpl:async(url,options)=>{trace.push('fetch');try{const response=await env.MOCK_CDP.fetch(url,options);trace.push({status:response.status,socket:!!response.webSocket});return response;}catch(error){trace.push({message:error.message});throw error;}}});}
 catch(error){return Response.json({code:error.code,message:error.message,trace},{status:500});}
 try{const page=await browser.newPage();await page.goto('https://carnect.biz/catalog?tab=encar');await page.keypress('Enter');const value=await page.evaluate('"synthetic"');await page.close();return Response.json(value);}
 finally{await browser.close();}
}};`;
const upstream=`
export default{async fetch(request){
 if(request.headers.get('Upgrade')!=='websocket'||request.headers.get('Authorization')!=='Bearer synthetic-browser-token')return new Response('rejected',{status:403});
 const pair=new WebSocketPair(),[client,socket]=Object.values(pair);socket.accept();const commands=[];
 socket.addEventListener('message',event=>{const command=JSON.parse(event.data);commands.push(command.method);
  const result=command.method==='Target.createTarget'?{targetId:'native-target'}:command.method==='Target.attachToTarget'?{sessionId:'native-session'}:command.method==='Target.closeTarget'?{success:true}:command.method==='Page.navigate'?{frameId:'native-frame',loaderId:'native-loader'}:command.method==='Runtime.evaluate'?{result:{value:{syntheticOnly:true,websocket:true,commands:commands.slice(),url:request.url,guardrails:JSON.parse(atob(request.headers.get('cf-brapi-guardrails').replace(/-/g,'+').replace(/_/g,'/')))}}}:{};
  socket.send(JSON.stringify({id:command.id,...(command.sessionId?{sessionId:command.sessionId}:{}),result}));
  if(command.method==='Page.navigate')socket.send(JSON.stringify({method:'Page.lifecycleEvent',sessionId:command.sessionId,params:{frameId:'native-frame',loaderId:'native-loader',name:'DOMContentLoaded'}}));
 });
 return new Response(null,{status:101,webSocket:client});
}};`;
(async()=>{
 let outbound=0;
 const options={workers:[
  {name:'client',modulesRoot:'/id-browser-native',modules:[{type:'ESModule',path:'/id-browser-native/entry.mjs',contents:entry},{type:'ESModule',path:'/id-browser-native/transport.mjs',contents:transport}],serviceBindings:{MOCK_CDP:'cdp-fixture'},compatibilityDate:'2026-10-01'},
  {name:'cdp-fixture',modulesRoot:'/id-browser-native',modules:[{type:'ESModule',path:'/id-browser-native/cdp-fixture.mjs',contents:upstream}],compatibilityDate:'2026-10-01'}
 ],cf:false,outboundService:()=>{outbound++;return new WorkerResponse('No outbound calls allowed',{status:502});}};
 const runtime=new Miniflare(typeof convertV4MiniflareOptions==='function'?{...convertV4MiniflareOptions(options),telemetry:{enabled:false}}:options);
 try{
  const response=await runtime.dispatchFetch('https://native-id-browser.example');const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.syntheticOnly,true);assert.equal(value.websocket,true);assert.equal(value.url,'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/browser-run/devtools/browser?keep_alive=10000');assert(value.commands.includes('Page.navigate'));assert.equal(value.commands.filter(c=>c==='Target.createTarget').length,1);assert.equal(value.commands.filter(c=>c==='Input.dispatchKeyEvent').length,2);assert.deepEqual(value.guardrails.allowedDomainSets,['common-cdns']);assert.equal(outbound,0);console.log('PASS native workerd Browser Run client: HTTP Upgrade response.webSocket/accept, flattened CDP commands, fixed provider navigation, guardrails; synthetic service binding only, outbound=0.');
 }finally{await runtime.dispose();}
})().catch(error=>{console.error(error);process.exitCode=1;});
