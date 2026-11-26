'use strict';
// Actual app, Auth bridge and scheduler assets. Every account, RPC and response is synthetic.
// No real credentials, customer data, hosted database writes, messages or external requests.
// Run: NODE_PATH=/workspace/work/deps/node_modules node tests/dealer-scheduler.browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const {boot:normalBoot,dashboardReady,constants}=require('./normal-login.browser.cjs');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.SNOTE_SCHEDULER_ARTIFACT_DIR||'/workspace/work/dealer-scheduler-v2205/browser';
const CLOCK='2027-03-14T15:30:00.000Z',TODAY='2027-03-15',PASSWORD=constants.PASSWORD;
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',ADMIN='44444444-4444-4444-8444-444444444444',ACCOUNTANT='55555555-5555-4555-8555-555555555555';
const COMPANY=constants.COMPANY,OTHER_COMPANY='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clone=value=>structuredClone(value),decode=token=>{try{return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{return{};}};
const uuid=n=>'90000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
fs.mkdirSync(OUT,{recursive:true});
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};}
function range(month){const [y,m]=month.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1)),start=new Date(first);start.setUTCDate(1-first.getUTCDay());const end=new Date(start);end.setUTCDate(end.getUTCDate()+41);return[start.toISOString().slice(0,10),end.toISOString().slice(0,10)];}
function backend(){
 const accounts=new Map([
  [A,{id:A,email:'dealer@example.invalid',name:'예시 딜러 A',companyId:COMPANY,role:'dealer'}],
  [B,{id:B,email:'dealer-b@example.invalid',name:'예시 딜러 B',companyId:COMPANY,role:'dealer'}],
  [C,{id:C,email:'dealer-c@example.invalid',name:'예시 딜러 C',companyId:OTHER_COMPANY,role:'dealer'}],
  [ADMIN,{id:ADMIN,email:'admin@example.invalid',name:'예시 대표',companyId:COMPANY,role:'admin'}],
  [ACCOUNTANT,{id:ACCOUNTANT,email:'accountant@example.invalid',name:'예시 경리',companyId:COMPANY,role:'accountant'}]
 ]);
 const state={accounts,sequence:0,now:CLOCK,sessions:new Map(),passwordCalls:[],rpcCalls:[],logouts:[],reads:[],downloads:[],events:new Map(),writes:[],lock:false,hold:null};
 const user=a=>({id:a.id,email:a.email,email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{}});
 state.valid=token=>state.sessions.get(decode(token).session_id)?.live===true;
 state.scope=token=>{const session=state.sessions.get(decode(token).session_id);return session?.live?accounts.get(session.userId):null;};
 state.issue=account=>{const sid='40000000-0000-4000-8000-'+String(++state.sequence).padStart(12,'0'),token=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:account.id,session_id:sid,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic',session={access_token:token,refresh_token:'synthetic-refresh-'+sid,user:user(account)};state.sessions.set(sid,{session:clone(session),live:true,userId:account.id});return clone(session);};
 state.auth=(label,input)=>{state.passwordCalls.push({label});const account=[...accounts.values()].find(a=>a.email===input.email);if(!account||input.password!==PASSWORD)return{data:{session:null,user:null},error:{code:'invalid_credentials',message:'Synthetic invalid credentials'}};const session=state.issue(account);return{data:{session,user:session.user},error:null};};
 state.getUser=token=>{const a=state.scope(token);return a?{data:{user:user(a)},error:null}:{data:{user:null},error:{code:'session_not_found'}};};
 state.logout=(label,{token,scope})=>{assert.equal(scope,'local');const sid=decode(token).session_id;state.logouts.push({label,sid});const session=state.sessions.get(sid);if(session)session.live=false;return{error:null};};
 state.from=(label,{table,filters,single,token})=>{
  const a=state.scope(token);state.reads.push({label,table,filters:clone(filters||{})});if(!a)return{data:null,error:{code:'401'}};let rows=[];
  if(table==='zc_members')rows=[...accounts.values()].filter(x=>x.companyId===a.companyId).map(x=>({user_id:x.id,company_id:x.companyId,active:x.active!==false,role:x.role,display_name:x.name}));
  if(table==='zc_companies')rows=[{id:a.companyId,name:a.companyId===COMPANY?'가상 일정 상사':'다른 가상 상사',rrn_enabled:false}];
  if(table==='zc_datasets')rows=[{company_id:a.companyId,dataset:'cars',owner_id:a.id,payload:[{id:'scheduler-car-'+a.id,ownerId:'cld_'+a.id.replaceAll('-','').slice(0,18),model:'가상 일정 차량',plate:'00가1001',buy:10000000,sell:12000000,moneyUnit:'KRW',status:'판매중',purchaseAt:'2026-11-01'}],revision:0},{company_id:a.companyId,dataset:'covers',owner_id:a.id,payload:{},revision:0}];
  rows=rows.filter(row=>Object.entries(filters||{}).every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value));return{data:single?(rows[0]||null):rows,error:null};
 };
 state.download=()=>{throw Error('No private media downloads expected in scheduler fixture');};
 state.seed=(owner,partial)=>{const a=accounts.get(owner),entry={id:uuid(state.events.size+1),title:'예시 일정',notes:'',eventDate:TODAY,time:null,completed:false,revision:1,createdAt:state.now,updatedAt:state.now,...partial,companyId:a.companyId,ownerId:owner,deleted:false};state.events.set(entry.id,entry);return clone(entry);};
 const publicEvent=event=>Object.fromEntries(['id','title','notes','eventDate','time','completed','revision','createdAt','updatedAt'].map(key=>[key,event[key]]));
 const sort=(a,b)=>a.eventDate.localeCompare(b.eventDate)||String(a.time||'').localeCompare(String(b.time||''))||a.id.localeCompare(b.id);
 const unavailable=()=>({data:null,error:{code:'42501',message:'SCHEDULE_EVENT_UNAVAILABLE'}});
 state.rpc=async(label,{name,args,token})=>{
  state.rpcCalls.push({label,name,args:clone(args||{})});const a=state.scope(token);if(!a)return{data:null,error:{code:'401'}};
  if(name==='snote_finance_lock_get')return{data:{enabled:state.lock,revision:1},error:null};
  if(name==='snote_dealer_finance_rates_list')return{data:{companyId:a.companyId,userId:a.id,profiles:[{companyId:a.companyId,ownerId:a.id,rates:{},fallbackRates:{},lenderNames:[],revision:0}]},error:null};
  if(name==='snote_access_ping')return{data:{ok:true},error:null};
  if(name==='snote_company_purchase_rows'){if(!['admin','accountant'].includes(a.role)||args.p_company!==a.companyId)return unavailable();const rows=state.from(label,{table:'zc_datasets',filters:{company_id:a.companyId,owner_id:a.id},single:false,token}).data||[];return{data:{companyId:a.companyId,datasets:rows.map(row=>({dataset:row.dataset,ownerId:row.owner_id,payload:row.payload,revision:row.revision})),owners:[{id:a.id,name:a.name,active:a.active!==false,memberExists:true}]},error:null};}
  if(!name.startsWith('snote_schedule_'))return{data:null,error:{code:'PGRST202',message:'Optional synthetic RPC unavailable'}};
  if(!['dealer','admin','accountant'].includes(a.role)||a.active===false||args.p_expected_company_id!==a.companyId)return unavailable();
  if(state.hold?.name===name){const held=state.hold;held.started.resolve();await held.release.promise;}
  const own=[...state.events.values()].filter(x=>x.ownerId===a.id&&x.companyId===a.companyId&&!x.deleted),today=date(state.now);
  if(name==='snote_schedule_list'){
   assert.match(args.p_month,/^\d{4}-\d{2}$/);const[start,end]=range(args.p_month),visible=own.filter(x=>x.eventDate>=start&&x.eventDate<=end).sort(sort),todays=own.filter(x=>x.eventDate===today).sort(sort),upcoming=own.filter(x=>!x.completed&&x.eventDate>today).sort(sort),overdue=own.filter(x=>!x.completed&&x.eventDate<today).sort(sort);
   const dayCounts={};for(let at=new Date(start+'T00:00:00Z');at<=new Date(end+'T00:00:00Z');at.setUTCDate(at.getUTCDate()+1))dayCounts[at.toISOString().slice(0,10)]=0;for(const item of visible)dayCounts[item.eventDate]=(dayCounts[item.eventDate]||0)+1;
   return{data:{ok:true,companyId:a.companyId,ownerId:a.id,month:args.p_month,today,rangeStart:start,rangeEnd:end,events:visible.slice(0,500).map(publicEvent),todayEvents:todays.slice(0,50).map(publicEvent),upcomingEvents:upcoming.slice(0,50).map(publicEvent),overdueEvents:overdue.slice(0,50).map(publicEvent),counts:{calendar:visible.length,today:todays.length,upcoming:upcoming.length,overdue:overdue.length},truncated:{calendar:visible.length>500,today:todays.length>50,upcoming:upcoming.length>50,overdue:overdue.length>50},dayCounts},error:null};
  }
  if(name==='snote_schedule_save'){
   const input=args.p_event,previous=state.events.get(input.id);assert.deepEqual(Object.keys(input).sort(),['completed','eventDate','id','notes','time','title']);
   if(previous&&(previous.ownerId!==a.id||previous.companyId!==a.companyId||previous.deleted))return unavailable();
   if(!previous&&args.p_expected_revision!==0)return unavailable();
   if(previous&&previous.revision===args.p_expected_revision+1&&Object.keys(input).every(key=>previous[key]===input[key]))return{data:{ok:true,companyId:a.companyId,ownerId:a.id,event:publicEvent(previous),duplicate:true},error:null};
   if(previous&&previous.revision!==args.p_expected_revision)return{data:null,error:{code:'40001',message:'SCHEDULE_CONFLICT'}};
   const value={...input,companyId:a.companyId,ownerId:a.id,revision:(previous?.revision||0)+1,createdAt:previous?.createdAt||state.now,updatedAt:state.now,deleted:false};state.events.set(value.id,value);state.writes.push({name,ownerId:a.id,id:value.id});return{data:{ok:true,companyId:a.companyId,ownerId:a.id,event:publicEvent(value),duplicate:false},error:null};
  }
  if(name==='snote_schedule_delete'){
   const previous=state.events.get(args.p_event_id);if(!previous||previous.ownerId!==a.id||previous.companyId!==a.companyId)return unavailable();if(previous.deleted&&previous.revision===args.p_expected_revision+1)return{data:{ok:true,companyId:a.companyId,ownerId:a.id,id:previous.id,revision:previous.revision,deleted:true,duplicate:true},error:null};if(previous.deleted)return unavailable();if(previous.revision!==args.p_expected_revision)return{data:null,error:{code:'40001',message:'SCHEDULE_CONFLICT'}};previous.deleted=true;previous.revision++;previous.updatedAt=state.now;state.writes.push({name,ownerId:a.id,id:previous.id});return{data:{ok:true,companyId:a.companyId,ownerId:a.id,id:previous.id,revision:previous.revision,deleted:true,duplicate:false},error:null};
  }
  throw Error('Unexpected synthetic schedule RPC '+name);
 };
 return state;
}
async function boot(browser,state,width=1440,label='scheduler',email='dealer@example.invalid',clock=CLOCK){
 const f=await normalBoot(browser,state,label,{width,clock:true});await f.page.clock.setSystemTime(new Date(clock));
 await f.page.route(constants.DB+'/rest/v1/rpc/snote_schedule_*',async route=>{
  const request=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,cache-control,pragma'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(request.method(),'POST');const name=new URL(request.url()).pathname.split('/').at(-1),token=request.headers().authorization?.replace(/^Bearer /,''),result=await state.rpc(label,{name,args:request.postDataJSON(),token});
  const status=result.error?(result.error.code==='42501'?403:result.error.code==='40001'?409:400):200;
  return route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(result.error||result.data)});
 });
 f.loginAs=async(address=email)=>{await f.page.locator('#snote95-remember').setChecked(true);await f.page.locator('#zc-cloud-password').fill(PASSWORD);await f.page.locator('#zc-cloud-email').fill(address);assert.equal(await f.page.locator('#zc-cloud-email').inputValue(),address);assert.equal(await f.page.locator('#zc-cloud-password').inputValue(),PASSWORD);await f.page.locator('#zc-cloud-submit').click();if(address==='accountant@example.invalid'){await f.ready();await f.page.waitForFunction(()=>!__normalState.busy);}else await dashboardReady(f);};
 await f.loginAs();return f;
}
module.exports={backend,boot,constants:{CLOCK,TODAY,A,B,C,ADMIN,ACCOUNTANT,COMPANY,OTHER_COMPANY,PASSWORD},deferred};


const HOST='#snote-dealer-scheduler',DIALOG='#snote-dealer-scheduler-dialog',MESSAGE='#snote-message-dialog[open]';
async function ready(f){await f.page.locator(HOST+'[data-state="ready"]').waitFor();await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function confirm(f,accept,pattern){const dialog=f.page.locator(MESSAGE+'[data-message-kind="confirm"]');await dialog.waitFor();if(pattern)assert.match(await dialog.textContent(),pattern);await dialog.locator(accept?'[data-message-accept]':'[data-message-cancel]').click();await dialog.waitFor({state:'hidden'});}
async function dismiss(f){const dialog=f.page.locator(MESSAGE);if(await dialog.count()){await dialog.locator('[data-message-accept]').click();await dialog.waitFor({state:'hidden'});}}
async function openDay(f,day=TODAY){await f.page.locator(HOST+' [data-date="'+day+'"] .snote-scheduler-date').click();await f.page.locator(DIALOG+'[open]').waitFor();assert.equal(await f.page.locator(DIALOG+' [name=eventDate]').inputValue(),day);}
async function fill(f,{title,eventDate,time,notes,completed}={}){const d=f.page.locator(DIALOG);for(const[key,value]of Object.entries({title,eventDate,time,notes}))if(value!==undefined)await d.locator('[name='+key+']').fill(value);if(completed!==undefined)await d.locator('[name=completed]').setChecked(completed);}
async function save(f){await f.page.locator(DIALOG+' .snote-scheduler-save').click();await f.page.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(f);}
async function logout(f){await f.page.evaluate(()=>{window.__schedulerLogout=zc86Cloud.signOut();});await confirm(f,true,/로그아웃/);await f.page.evaluate(()=>__schedulerLogout);await f.page.waitForFunction(()=>!__normalState.ready&&currentUser===null);}
async function geometry(f,width){return f.page.locator(HOST).evaluate((host,width)=>{const r=e=>{const x=e.getBoundingClientRect();return{x:x.x,y:x.y,right:x.right,bottom:x.bottom,width:x.width,height:x.height};},calendar=host.querySelector('.snote-scheduler-calendar'),sidebar=host.querySelector('.snote-scheduler-sidebar');return{width,overflow:document.documentElement.scrollWidth>innerWidth,hostOverflow:host.scrollWidth>host.clientWidth,calendar:r(calendar),sidebar:r(sidebar),cells:host.querySelectorAll('[role=gridcell]').length};},width);}
async function checkLayout(f,width,name){const g=await geometry(f,width);assert.equal(g.overflow,false,JSON.stringify(g));assert.equal(g.hostOverflow,false,JSON.stringify(g));assert.equal(g.cells,42);for(const r of[g.calendar,g.sidebar])assert(r.x>=0&&r.right<=width+1,JSON.stringify(g));if(width>760)assert(Math.abs(g.calendar.y-g.sidebar.y)<1&&g.calendar.width>g.sidebar.width);else assert(g.calendar.bottom<=g.sidebar.y+1);await f.page.screenshot({path:path.join(OUT,name+'-'+width+'.png'),fullPage:true});return g;}
async function crud(browser){
 const s=backend(),today=s.seed(A,{title:'오늘 고객 방문',time:'09:30'}),overdue=s.seed(A,{title:'지난 이전서류 확인',eventDate:'2027-02-10'}),upcoming=s.seed(A,{title:'다음달 출고',eventDate:'2027-04-12',time:'14:00'});s.seed(A,{title:'완료한 과거 일정',eventDate:'2027-02-11',completed:true});s.seed(B,{title:'동료 딜러 비공개 일정'});s.seed(C,{title:'다른 상사 비공개 일정'});
 const f=await boot(browser,s),p=f.page;
 try{
  await ready(f);assert.equal(await p.locator('#snote-dashboard-home [data-list]').count(),0);assert.equal(await p.locator(HOST+' [aria-current=date]').textContent(),'15');assert.equal(await p.locator('#snote-scheduler-month-label').textContent(),'2027년 3월');assert.equal(await p.locator(HOST+' [data-agenda=today] .snote-scheduler-agenda-count').textContent(),'1');assert.match(await p.locator(HOST+' [data-agenda=upcoming]').textContent(),/다음달 출고/);assert.equal(await p.locator(HOST+' [data-agenda=overdue]').count(),0);assert.doesNotMatch(await p.locator(HOST).textContent(),/비공개|완료한 과거/);await checkLayout(f,1440,'dashboard');
  await openDay(f,'2027-03-18');await fill(f,{title:'신규 출고 일정',time:'16:45',notes:'가상 업무 메모\n서류 준비'});await save(f);const added=[...s.events.values()].find(x=>x.title==='신규 출고 일정');assert(added);assert.equal(added.ownerId,A);assert.equal(added.revision,1);assert.equal(added.time,'16:45');assert.match(await p.locator(HOST+' [data-date="2027-03-18"]').textContent(),/16:45신규 출고 일정/);
  await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+added.id+'"]').click();assert.equal(await p.locator(DIALOG+' [name=notes]').inputValue(),'가상 업무 메모\n서류 준비');await fill(f,{title:'수정된 출고 일정',completed:true});await save(f);assert.equal(s.events.get(added.id).revision,2);assert.equal(await p.locator(HOST+' .snote-scheduler-event.is-completed[data-event-id="'+added.id+'"]').count(),1);assert.equal(await p.locator(HOST+' [data-agenda=upcoming] [data-event-id="'+added.id+'"]').count(),0);
  await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+added.id+'"]').click();await p.locator(DIALOG+' .snote-scheduler-delete').click();await confirm(f,false,/삭제/);assert.equal(s.events.get(added.id).deleted,false);await p.locator(DIALOG+' .snote-scheduler-delete').click();await confirm(f,true,/삭제/);await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(f);assert.equal(s.events.get(added.id).deleted,true);assert.equal(await p.locator(HOST+' [data-event-id="'+added.id+'"]').count(),0);
  await p.locator(HOST+' [aria-label="이전 달"]').click();await ready(f);await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+overdue.id+'"]').click();await fill(f,{completed:true});await save(f);assert.equal(s.events.get(overdue.id).completed,true);await p.locator(HOST+' .snote-scheduler-today').click();await ready(f);assert.equal(await p.locator(HOST+' [data-agenda=overdue]').count(),0);
  await openDay(f);await fill(f,{title:'<img src=x onerror="window.__scheduleXss=1">',notes:'<script>window.__scheduleXss=2</script>'});await save(f);assert.equal(await p.locator(HOST+' img').count(),0);assert.equal(await p.evaluate(()=>window.__scheduleXss),undefined);assert.match(await p.locator(HOST).textContent(),/<img src=x/);assert.equal(await p.evaluate(()=>Object.entries(localStorage).some(([k,v])=>/scheduleXss|업무 메모|고객 방문/.test(k+v))),false,'Private schedules must never enter local persistent storage');
  assert.equal(await p.evaluate(()=>SnoteDealerSchedulerUI.beforeLeave()===true),true);assert.deepEqual(await p.evaluate(()=>({synchronous:navigate('buy')===true,route})),{synchronous:true,route:'buy'});assert.deepEqual(await p.evaluate(()=>({synchronous:navigate('dashboard')===true,route})),{synchronous:true,route:'dashboard'});await ready(f);assert.match(await p.locator(HOST).textContent(),/오늘 고객 방문/);await p.reload({waitUntil:'networkidle'});await dashboardReady(f);await ready(f);assert.match(await p.locator(HOST).textContent(),/오늘 고객 방문/);assert.equal(await p.locator(HOST+' [data-event-id="'+added.id+'"]').count(),0);
  // Month navigation preserves cross-month agenda; calendar contents follow requested month.
  await p.locator(HOST+' [aria-label="다음 달"]').click();await ready(f);assert.equal(await p.locator('#snote-scheduler-month-label').textContent(),'2027년 4월');assert.equal(await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+upcoming.id+'"]').count(),1);await p.locator(HOST+' .snote-scheduler-today').click();await ready(f);assert.equal(await p.locator('#snote-scheduler-month-label').textContent(),'2027년 3월');
  return{name:'actual desktop calendar CRUD, CAS revisions, completion, delete confirmation, reload/re-entry, KST date and XSS',geometry:await checkLayout(f,1440,'dashboard-complete'),writes:s.writes.length};
 }finally{await f.finish();}
}
async function scopeAndLock(browser){
 const s=backend();s.lock=true;for(const [id,title]of[[A,'A 전용 일정'],[B,'B 전용 일정'],[C,'C 전용 일정'],[ADMIN,'대표 전용 일정'],[ACCOUNTANT,'경리 전용 일정']])s.seed(id,{title});const results=[];
 for(const [id,email]of[[A,'dealer@example.invalid'],[B,'dealer-b@example.invalid'],[C,'dealer-c@example.invalid'],[ADMIN,'admin@example.invalid'],[ACCOUNTANT,'accountant@example.invalid']]){
  const f=await boot(browser,s,1440,'scope-'+id,email),p=f.page;try{
   if(id===ACCOUNTANT){await p.evaluate(()=>navigate('dashboard'));await ready(f);assert.equal(await p.evaluate(()=>snoteDealerSchedulerBridge.context()?.role),'accountant');assert.equal(await p.evaluate(()=>snotePageAllowed('dashboard')),true);assert.equal(await p.locator('#snote-dashboard-home').getAttribute('data-mode'),'accountant');assert.equal(await p.locator('#snote-dashboard-home .snote-home-number,#snote-dashboard-home .snote-home-kpis,#snote-dashboard-home .snote-home-settlement-card').count(),0);const ownTitle=[...s.events.values()].find(e=>e.ownerId===ACCOUNTANT).title,view=await p.locator(HOST).innerText();assert(view.includes(ownTitle));for(const e of s.events.values())if(e.ownerId!==ACCOUNTANT)assert(!view.includes(e.title));await openDay(f);await fill(f,{title:'경리 본인 개인 일정'});await save(f);assert([...s.events.values()].some(e=>e.ownerId===ACCOUNTANT&&e.title==='경리 본인 개인 일정'));results.push('경리 본인 일정과 비금융 대시보드');continue;}
   await ready(f);const text=await p.locator(HOST).textContent(),title=[...s.events.values()].find(x=>x.ownerId===id).title;assert(text.includes(title));for(const e of s.events.values())if(e.ownerId!==id)assert(!text.includes(e.title));assert.equal(await p.locator('#snote-dashboard-home').getAttribute('data-state'),'locked');assert.deepEqual(await p.evaluate(()=>snoteHomeDashboardBridge.snapshot().rows),[]);assert.equal(await p.locator('#snote-dashboard-home .snote-home-number').count(),0);assert.equal(await p.locator('#snote-dashboard-home .snote-home-task-row').count(),0);
   await openDay(f);await fill(f,{title:'금융 잠금 중 개인 일정 '+id.slice(0,1)});await save(f);assert([...s.events.values()].some(e=>e.title.startsWith('금융 잠금 중 개인 일정')&&e.ownerId===id));await p.evaluate(()=>navigate('buy'));await p.evaluate(()=>navigate('dashboard'));await ready(f);assert.equal(await p.locator('#zc-dashboard-gate').isVisible(),false);await p.evaluate(()=>navigate('finance'));await p.locator('#zc-dashboard-gate').waitFor();assert.equal(await p.evaluate(()=>route),'dashboard');assert.match(await p.locator('#zc-dashboard-gate-title').textContent(),/수익/);await p.keyboard.press('Escape');await ready(f);results.push(id===ADMIN?'대표 본인 일정만':'딜러·상사별 분리');
  }finally{await f.finish();}
 }
 return{name:'actual Auth identities, same-company/different-company separation, admin own-only, accountant own-only calendar and finance lock independence',checks:results};
}
async function mobile(browser,width){
 const s=backend();s.seed(A,{title:'모바일 고객 방문',time:'10:00'});const f=await boot(browser,s,width,'mobile-'+width),p=f.page;try{
  await ready(f);const geometry=await checkLayout(f,width,'dashboard-mobile');assert.equal(await p.evaluate(()=>document.querySelector('#snote-dashboard-home').firstElementChild.id),'snote-dealer-scheduler');await openDay(f,'2027-03-16');const before={route:await p.evaluate(()=>route),url:p.url()};await p.evaluate(()=>history.back());await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>route),before.route);assert.equal(p.url(),before.url);
  await openDay(f,'2027-03-16');await fill(f,{title:'모바일 신규 일정',time:'13:15',notes:'모바일 입력 검증'});assert(Number(await p.locator(DIALOG+' [name=title]').evaluate(e=>getComputedStyle(e).fontSize.replace('px','')))>=16);await p.screenshot({path:path.join(OUT,'dialog-'+width+'.png'),fullPage:false});await p.setViewportSize({width,height:480});const d=await p.locator(DIALOG).boundingBox();assert(d.x>=0&&d.x+d.width<=width+1);assert(d.y>=0&&d.y+d.height<=481,'Short visual viewport must keep dialog inside screen');await p.locator(DIALOG+' .snote-scheduler-save').scrollIntoViewIfNeeded();await save(f);await p.setViewportSize({width,height:950});await checkLayout(f,width,'dashboard-saved');assert.match(await p.locator(HOST+' [data-date="2027-03-16"]').textContent(),/모바일 신규 일정/);
  await openDay(f);await fill(f,{title:'취소할 초안'});await p.locator(DIALOG+' .snote-popup-close').click();await confirm(f,false,/저장하지 않고/);assert.equal(await p.locator(DIALOG+'[open]').isVisible(),true);assert.equal(await p.locator(DIALOG+' [name=title]').inputValue(),'취소할 초안');await p.locator(DIALOG+' .snote-popup-close').click();await confirm(f,true,/저장하지 않고/);await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});assert(![...s.events.values()].some(e=>e.title==='취소할 초안'));
  return{name:'mobile '+width+'px actual create, responsive calendar, dialog-only Back, dirty cancel and short keyboard viewport',geometry};
 }finally{await f.finish();}
}
async function lateAndConflict(browser){
 const s=backend(),entry=s.seed(A,{title:'충돌 전 일정'}),f=await boot(browser,s),p=f.page;let held;
 try{
  await ready(f);await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+entry.id+'"]').click();await fill(f,{title:'저장되지 않은 수정'});s.events.get(entry.id).title='서버에서 먼저 수정';s.events.get(entry.id).revision++;await p.locator(DIALOG+' .snote-scheduler-save').click();await p.locator(MESSAGE).waitFor();assert.match(await p.locator(MESSAGE).textContent(),/다른 화면에서 일정이 변경/);await dismiss(f);assert.equal(await p.locator(DIALOG+' [name=title]').inputValue(),'저장되지 않은 수정');assert.equal(s.events.get(entry.id).title,'서버에서 먼저 수정');await p.locator(DIALOG+' .snote-popup-close').click();await confirm(f,true,/저장하지 않고/);await p.locator(HOST+' .snote-scheduler-retry').click();await ready(f);
  await openDay(f);await fill(f,{title:'A 로그아웃 직전 대기 저장',notes:'이전 계정의 민감하지 않은 가상 메모'});held={name:'snote_schedule_save',started:deferred(),release:deferred()};s.hold=held;await p.locator(DIALOG+' .snote-scheduler-save').click();await held.started.promise;assert.equal(await p.locator(DIALOG).getAttribute('aria-busy'),'true');await logout(f);assert.equal(await p.locator(DIALOG+'[open]').count(),0);assert.equal(await p.locator(DIALOG+' [name=title]').inputValue(),'');assert.equal(await p.locator('#zc-cloud-login').isVisible(),true);assert.equal(await p.locator(HOST+' [data-event-id]').count(),0);assert.doesNotMatch(await p.locator('#snote-dashboard-home').textContent(),/로그아웃 직전|먼저 수정/);s.hold=null;await f.loginAs('dealer-b@example.invalid');await ready(f);held.release.resolve();await p.evaluate(()=>new Promise(resolve=>setTimeout(resolve,40)));assert.doesNotMatch(await p.locator(HOST).textContent(),/로그아웃 직전|먼저 수정/);assert.equal(await p.locator(DIALOG+'[open]').count(),0);assert(s.writes.every(w=>w.ownerId===A));
  return{name:'CAS rejection preserves the draft; logout clears busy private form and a pinned late ACK cannot enter next dealer session'};
 }finally{held?.release.resolve();s.hold=null;await f.finish();}
}
async function midnight(browser){const s=backend();s.now='2027-03-15T14:59:40.000Z';s.seed(A,{title:'자정 전 오늘 일정'});s.seed(A,{title:'자정 후 오늘 일정',eventDate:'2027-03-16'});const f=await boot(browser,s,1440,'midnight','dealer@example.invalid',s.now),p=f.page;try{await ready(f);s.now='2027-03-15T15:00:01.000Z';await p.clock.setSystemTime(new Date(s.now));await p.clock.runFor(1100);await ready(f);await p.waitForFunction(()=>document.querySelector('#snote-dealer-scheduler [aria-current=date]')?.textContent==='16');assert.match(await p.locator(HOST+' [data-agenda=today]').textContent(),/자정 후 오늘 일정/);assert.doesNotMatch(await p.locator(HOST+' [data-agenda=today]').textContent(),/자정 전 오늘 일정/);assert.equal(await p.locator(HOST+' [data-agenda=overdue]').count(),0);assert.match(await p.locator(HOST+' [data-date="2027-03-15"]').textContent(),/자정 전 오늘 일정/);return{name:'KST midnight refresh moves agenda and current date without account or finance changes'};}finally{await f.finish();}}

async function lifecycle(browser){
 const checks=[];
 for(const mode of['inactive','company','idle']){const s=backend();s.seed(A,{title:'전환 전 개인 일정 '+mode,notes:'전환 전 메모'});const f=await boot(browser,s,1440,'lifecycle-'+mode),p=f.page;try{
  await ready(f);await openDay(f);await fill(f,{title:'전환 시 제거할 초안 '+mode,notes:'이전 계정에서만 보이는 가상 초안'});
  if(mode==='idle'){await p.clock.fastForward(31*60000);await p.waitForFunction(()=>!__normalState.ready&&currentUser===null);assert.equal(await p.locator('#zc-cloud-login').isVisible(),true);assert.equal(s.logouts.length,1);}
  else{await p.evaluate(mode=>{if(mode==='inactive'){__normalState.members.find(m=>m.user_id===__normalState.user.id).active=false;}else{__normalState.company={...__normalState.company,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};__normalState.members=__normalState.members.map(m=>({...m,company_id:__normalState.company.id}));}window.dispatchEvent(new Event('snote:sales-data-changed'));},mode);await p.clock.runFor(1100);}
  await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});assert.equal(await p.locator(DIALOG+' [name=title]').inputValue(),'');assert.equal(await p.locator(DIALOG+' [name=notes]').inputValue(),'');assert.doesNotMatch(await p.locator('#snote-dashboard-home').textContent(),/전환 전 개인 일정|전환 시 제거할 초안/);assert.equal(s.writes.length,0);checks.push(mode+' clears private view and draft');
 }finally{await f.finish();}}
 return{name:'actual inactive membership/company changes and ordinary idle expiry clear private agenda and dirty form',checks};
}
async function largeResponse(browser){
 const s=backend(),notes='😀'.repeat(2000);for(let n=0;n<500;n++)s.seed(A,{title:'대용량 가상 일정 '+String(n).padStart(3,'0'),notes,time:'09:30'});
 const f=await boot(browser,s,1440,'large-response'),p=f.page;try{
  const response=await s.rpc('measure',{name:'snote_schedule_list',args:{p_expected_company_id:COMPANY,p_month:'2027-03'},token:[...s.sessions.values()].find(v=>v.live).session.access_token}),bytes=Buffer.byteLength(JSON.stringify(response.data));assert(bytes>2*1024*1024&&bytes<8*1024*1024);await ready(f);assert.equal(await p.locator(HOST+' [data-agenda=today] .snote-scheduler-agenda-count').textContent(),'500');const shown=await p.locator(HOST+' [data-date="2027-03-15"] .snote-scheduler-event').count();assert(shown>=1);assert.equal(await p.locator(HOST+' [data-date="2027-03-15"] .snote-scheduler-more').textContent(),'+'+(500-shown)+'건');await p.locator(HOST+' [data-date="2027-03-15"] .snote-scheduler-more').click();assert.equal(await p.locator(DIALOG+' .snote-scheduler-agenda-item').count(),500);await p.locator(DIALOG+' .snote-scheduler-agenda-item').last().click();assert.equal(await p.locator(DIALOG+' [name=notes]').inputValue(),notes);await p.locator(DIALOG+' .snote-popup-close').click();await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});return{name:'valid maximum Unicode calendar response crosses 2MiB, loads under 8MiB cap and opens complete day list',bytes,events:500};
 }finally{await f.finish();}
}


async function sqlWire(browser){
 const {createSchedulerFixture}=require('./dealer-schedule.sql.cjs'),{db}=await createSchedulerFixture(),s=backend(),baseRpc=s.rpc,baseAuth=s.auth;let serial=Promise.resolve();
 const query=(text,args=[])=>db.query(text,args),scalar=async(text,args=[])=>Object.values((await query(text,args)).rows[0])[0];
 s.auth=async(label,input)=>{const response=baseAuth(label,input);if(response.data?.session){const session=response.data.session;await query('insert into auth.sessions(id,user_id) values($1,$2)',[decode(session.access_token).session_id,session.user.id]);}return response;};
 s.rpc=(label,input)=>{if(!input.name.startsWith('snote_schedule_'))return baseRpc(label,input);const run=async()=>{
  const a=s.scope(input.token),args=input.args,claims=decode(input.token);s.rpcCalls.push({label,name:input.name,args:clone(args)});if(!a)return{data:null,error:{code:'42501',message:'SCHEDULE_CONTEXT_CHANGED'}};
  await db.exec('reset role');await query("select set_config('request.jwt.claim.sub',$1,false)",[a.id]);await query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:a.id,session_id:claims.session_id})]);await db.exec('set role authenticated');
  try{let values;if(input.name==='snote_schedule_list')values=[args.p_expected_company_id,args.p_month];else if(input.name==='snote_schedule_save')values=[args.p_expected_company_id,JSON.stringify(args.p_event),args.p_expected_revision];else values=[args.p_expected_company_id,args.p_event_id,args.p_expected_revision];const data=await scalar('select public.'+input.name+'('+values.map((_,n)=>'$'+(n+1)).join(',')+')',values);return{data,error:null};}
  catch(error){return{data:null,error:{code:error.code,message:error.message}};}finally{await db.exec('reset role');}
 };const promise=serial.then(run);serial=promise.catch(()=>{});return promise;};
 const clock=await scalar('select to_char(clock_timestamp() at time zone \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\')'),day=date(clock),f=await boot(browser,s,1440,'sql-wire','dealer@example.invalid',clock),p=f.page;
 try{await ready(f);await openDay(f,day);await fill(f,{title:'실제 SQL 왕복 일정',time:'17:20',notes:'한글과 이모지 😀 보존\n격리된 가상 DB 검증'});await save(f);let event=await scalar('select snote_schedule_private.event_value(e) from snote_schedule_private.events e where title=$1',['실제 SQL 왕복 일정']);assert.equal(event.revision,1);assert.equal(event.eventDate,day);assert.equal(event.time,'17:20');assert.match(event.notes,/이모지 😀/);await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+event.id+'"]').click();await fill(f,{title:'실제 SQL 수정 완료',completed:true});await save(f);event=await scalar('select snote_schedule_private.event_value(e) from snote_schedule_private.events e where id=$1',[event.id]);assert.equal(event.revision,2);assert.equal(event.completed,true);await p.locator(HOST+' .snote-scheduler-event[data-event-id="'+event.id+'"]').click();await p.locator(DIALOG+' .snote-scheduler-delete').click();await confirm(f,true,/삭제/);await p.locator(DIALOG+'[open]').waitFor({state:'hidden'});await ready(f);assert.equal(await scalar('select deleted_at is not null from snote_schedule_private.events where id=$1',[event.id]),true);assert.equal(await p.locator(HOST+' [data-event-id="'+event.id+'"]').count(),0);return{name:'actual isolated Postgres RPC → root pinned fetch → verified store → calendar CRUD round trip',sqlDate:day,revisionAfterSave:2};}
 finally{await f.finish();await serial;await db.close();}
}

if(require.main===module)(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{for(const [group,task] of [['crud',()=>crud(browser)],['scope',()=>scopeAndLock(browser)],...([360,390,430].map(width=>['mobile'+width,()=>mobile(browser,width)])),['late',()=>lateAndConflict(browser)],['midnight',()=>midnight(browser)],['lifecycle',()=>lifecycle(browser)],['large',()=>largeResponse(browser)],['sql',()=>sqlWire(browser)]].filter(([group])=>!process.env.SNOTE_SCHEDULER_CASE||process.env.SNOTE_SCHEDULER_CASE.split(',').includes(group))){const result=await task();results.push(result);console.log('PASS '+result.name);}fs.writeFileSync(path.join(OUT,process.env.SNOTE_SCHEDULER_CASE?'results-'+process.env.SNOTE_SCHEDULER_CASE.replaceAll(',','-')+'.json':'results.json'),JSON.stringify({clock:CLOCK,today:TODAY,results,syntheticOnly:true,sourceHashes:Object.fromEntries(['index.html','assets/home-dashboard.js','assets/home-dashboard.css','assets/dealer-scheduler.js','assets/dealer-scheduler.css','assets/dealer-scheduler-store.js','tests/dealer-scheduler.browser.cjs'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]))},null,2));console.log('PASS dealer scheduler actual-browser regression ('+results.length+' groups)');}
 finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
