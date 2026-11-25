'use strict';
// The real received-share module, synthetic scoped bridge only. No network/DB writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://unified-shares.test',OUT=process.env.SNOTE_UNIFIED_SHARES_DIR||'/workspace/work/compact-workspace-v2228/shares';
fs.mkdirSync(OUT,{recursive:true});
const INIT=()=>{
 window.currentUser={username:'synthetic-recipient',role:'dealer',name:'가상 딜러'};window.route='dashboard';window.cars=[];
 const state=window.__shares={scope:1,ready:true,calls:[],opens:[],renders:0,fail:false,hold:false,waiting:0,releases:[],blockNavigate:false,asyncNavigate:false,items:[]};
 const company='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner='33333333-3333-4333-8333-333333333333';
 for(let n=0;n<2;n++)state.items.push({companyId:company,ownerId:owner,carId:'synthetic-'+n,ownerName:'가상 공유 딜러 '+n,state:'accepted',invitationId:'55555555-5555-4555-8555-55555555555'+n,version:1,permission:'read'});
 state.raw=Object.fromEntries(state.items.map((item,n)=>[item.carId,{id:item.carId,status:'판매중',model:'가상 검색 차량 '+n,plate:'00가000'+n,vin:'SYNTHETICVIN'+n,make:'가상 제조사',year:2026,color:'흰색',vehicleMemo:'합성 메모',buy:12345600,sell:23456700,inventoryLoan:3000000,costs:{repair:1000},contractData:{private:'excluded'},moneyUnit:'KRW'}]));
 const metadata=item=>({apiVersion:2,permission:item.permission,canRead:true,canEdit:false,canDelete:false,nativeAccess:false,invitationId:item.invitationId,version:item.version});
 const context=()=>state.ready&&['dealer','admin'].includes(currentUser?.role)?{key:'synthetic-scope-'+state.scope,companyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',userId:'11111111-1111-4111-8111-111111111111'}:null;
 window.snoteVehicleShareBridge={context,current:c=>!!c&&context()?.key===c.key,async rpc(c,args){
  if(!this.current(c))throw Error('CONTEXT_CHANGED');
  const call={...args,scope:c.key};state.calls.push(call);
  if(state.fail)throw Error('SYNTHETIC_NETWORK_FAILURE');
  if(args.p_action==='incoming'){
   const rows=state.items.map(item=>({...item,...metadata(item)}));
   if(state.hold){state.waiting++;await new Promise(resolve=>state.releases.push(resolve));state.waiting--;}
   call.finished=true;return rows;
  }
  const item=state.items.find(item=>item.state==='accepted'&&item.companyId===args.p_company&&item.ownerId===args.p_owner&&item.carId===args.p_car);
  if(!item)throw Error('FORBIDDEN');
  call.finished=true;
  if(args.p_action==='read')return{car:structuredClone(state.raw[item.carId]),revision:1,...metadata(item)};
  if(args.p_action==='media')return [];
  throw Error('Unexpected action: '+args.p_action);
 },file(){throw Error('No private files are needed for search');}};
 window.renderCars=()=>{state.renders++;};window.fallbackImage=()=>({src:''});
 window.navigate=page=>{const finish=()=>{if(state.blockNavigate)return false;route=page;dispatchEvent(new CustomEvent('snote:route-changed',{detail:{page}}));return true;};return state.asyncNavigate?new Promise(resolve=>setTimeout(()=>resolve(finish()),25)):finish();};
 window.SnoteSharedVehicleDetail={open:item=>{state.opens.push(structuredClone(item));}};
 window.__release=()=>{state.hold=false;for(const release of state.releases.splice(0))release();};
};
async function setup(browser,width=1440){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(INIT);
 await context.route('**/*',request=>{
  const u=new URL(request.request().url());if(u.origin!==ORIGIN){external.push(u.href);return request.abort();}
  if(u.pathname==='/')return request.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><meta charset="utf-8"><div id="list-screen"></div><script src="/assets/money.js"></script><script src="/assets/received-share-list.js"></script>'});
  const file=path.join(ROOT,u.pathname);return request.fulfill({contentType:'application/javascript;charset=utf-8',body:fs.readFileSync(file)});
 });
 await page.goto(ORIGIN,{waitUntil:'networkidle'});await page.evaluate(()=>SnoteReceivedVehicleList.searchRows());
 const raw=await page.evaluate(()=>JSON.stringify(__shares.raw));
 return{page,async finish(){assert.equal(await page.evaluate(()=>JSON.stringify(__shares.raw)),raw,'Search/open never writes source vehicle data');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}};
}
async function exercise(browser,width){const f=await setup(browser,width),p=f.page,results=[];try{
 assert.equal(await p.evaluate(()=>SnoteReceivedVehicleList.rows().length),0,'Existing list API remains route-bound');
 const fresh=await p.evaluate(async()=>{const before=__shares.calls.length,rows=await SnoteReceivedVehicleList.searchRows();return{rows,calls:__shares.calls.slice(before)};});
 assert.equal(fresh.rows.length,2);assert.equal(fresh.calls.filter(c=>c.p_action==='incoming').length,1,'An explicit search verifies fresh grants despite the ordinary 15-second cache');
 assert.deepEqual(Object.keys(fresh.rows[0]).sort(),['id','model','plate','vin','brand','year','color','memo','ownerLabel','status','shared'].sort());
 assert.equal(fresh.rows[0].brand,'가상 제조사');assert.equal(fresh.rows[0].shared,true);assert(fresh.rows.every(row=>!Object.hasOwn(row,'buy')&&!Object.hasOwn(row,'inventoryLoan')&&!Object.hasOwn(row,'contractData')));
 assert.equal(await p.evaluate(()=>SnoteReceivedVehicleList.rows().length),0,'Global search never widens rows()/has() outside buy');results.push('outside-buy fresh grants and nonfinancial allowlist');
 const coalesced=await p.evaluate(()=>{__shares.hold=true;const before=__shares.calls.length,a=SnoteReceivedVehicleList.searchRows(),b=SnoteReceivedVehicleList.searchRows();window.__pendingSearch=a;return{same:a===b,incoming:__shares.calls.slice(before).filter(c=>c.p_action==='incoming').length};});assert.deepEqual(coalesced,{same:true,incoming:1});
 await p.evaluate(()=>__release());assert.equal((await p.evaluate(()=>__pendingSearch)).length,2);results.push('concurrent searches share one verification');
 await p.evaluate(()=>navigate('buy'));await p.evaluate(()=>SnoteReceivedVehicleList.searchRows());await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
 const stable=await p.evaluate(()=>{__shares.hold=true;const before=__shares.renders;window.__pendingSearch=SnoteReceivedVehicleList.searchRows();return{before,rows:SnoteReceivedVehicleList.rows().length};});assert.equal(stable.rows,2);
 await p.evaluate(()=>__release());await p.evaluate(()=>__pendingSearch);await p.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.equal(await p.evaluate(()=>__shares.renders),stable.before,'Unchanged search ACK never clears/repaints existing list rows');results.push('unchanged visible list retained during search');
 const target=fresh.rows[0].id;await p.evaluate(()=>navigate('dashboard'));
 assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),target),true);assert.equal(await p.evaluate(()=>route),'buy');assert.equal(await p.evaluate(()=>__shares.opens.length),1);results.push('result selection enters buy and uses the existing detail opener');
 await p.evaluate(()=>{navigate('dashboard');__shares.items[0].state='revoked';});assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),target),false);assert.equal(await p.evaluate(()=>__shares.opens.length),1);results.push('revoked result cannot open from a cached search');
 const remaining=fresh.rows[1].id;await p.evaluate(()=>{navigate('dashboard');__shares.fail=true;});assert.deepEqual(await p.evaluate(()=>SnoteReceivedVehicleList.searchRows()),[]);assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),false);assert.equal(await p.evaluate(()=>__shares.opens.length),1);results.push('network failure exposes no stale grant and cannot open');
 await p.evaluate(()=>{__shares.fail=false;});assert.equal((await p.evaluate(()=>SnoteReceivedVehicleList.searchRows())).length,1,'A failed verification can be retried');
 await p.evaluate(()=>{__shares.blockNavigate=true;});assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),false);await p.evaluate(()=>{__shares.blockNavigate=false;});assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),true,'An unsuccessful navigation does not poison later retries');results.push('navigation refusal remains retryable');
 await p.evaluate(()=>{navigate('dashboard');__shares.asyncNavigate=true;__shares.blockNavigate=true;});assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),false);assert.equal(await p.evaluate(()=>route),'dashboard');assert.equal(await p.evaluate(()=>__shares.opens.length),2);results.push('asynchronous navigation refusal cannot open a result');
 await p.evaluate(()=>{__shares.blockNavigate=false;});assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),true,'A result waits for asynchronous before-leave approval');assert.equal(await p.evaluate(()=>route),'buy');assert.equal(await p.evaluate(()=>__shares.opens.length),3);await p.evaluate(()=>{__shares.asyncNavigate=false;});results.push('asynchronous navigation approval opens after route completion');
 await p.evaluate(()=>{navigate('dashboard');__shares.hold=true;window.__pendingSearch=SnoteReceivedVehicleList.searchRows();});await p.waitForFunction(()=>__shares.waiting===1);await p.evaluate(()=>{currentUser={...currentUser,name:'다른 가상 계정'};__shares.scope++;__release();});assert.deepEqual(await p.evaluate(()=>__pendingSearch),[]);assert.equal(await p.evaluate(()=>__shares.opens.length),3);results.push('late search reply is fenced by account/context');
 await p.evaluate(()=>SnoteReceivedVehicleList.searchRows());
 await p.evaluate(()=>{__shares.hold=true;window.__pendingOpen=SnoteReceivedVehicleList.searchOpen('snote-shared:'+__shares.items[1].companyId+':'+__shares.items[1].ownerId+':'+__shares.items[1].carId);});await p.waitForFunction(()=>__shares.waiting===1);await p.evaluate(()=>{currentUser={...currentUser,name:'교체된 가상 계정'};__shares.scope++;__release();});assert.equal(await p.evaluate(()=>__pendingOpen),false);assert.equal(await p.evaluate(()=>__shares.opens.length),3);results.push('late open is fenced by account/context');
 await p.evaluate(()=>{currentUser={...currentUser,role:'accountant'};});const before=await p.evaluate(()=>__shares.calls.length);assert.deepEqual(await p.evaluate(()=>SnoteReceivedVehicleList.searchRows()),[]);assert.equal(await p.evaluate(id=>SnoteReceivedVehicleList.searchOpen(id),remaining),false);assert.equal(await p.evaluate(()=>__shares.calls.length),before);results.push('ineligible role triggers no sharing request');
 await f.finish();return{width,passed:results};
 }catch(e){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await p.context().close();throw e;}}
if(require.main===module)(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];try{for(const width of [1440,390]){results.push(await exercise(browser,width));console.log('PASS unified shared search '+width);}fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({ok:true,syntheticOnly:true,operatingReads:0,operatingWrites:0,results},null,2)+'\n');}finally{await browser.close();}})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
