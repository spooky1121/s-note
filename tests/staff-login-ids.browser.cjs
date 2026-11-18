'use strict';
// Actual settings UI with synthetic memberships and login-ID RPC responses only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.STAFF_LOGIN_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-staff-login-ids');fs.mkdirSync(OUT,{recursive:true});
const A='11111111-1111-4111-8111-111111111111',D='22222222-2222-4222-8222-222222222222',K='33333333-3333-4333-8333-333333333333',N='44444444-4444-4444-8444-444444444444',I='55555555-5555-4555-8555-555555555555',X='66666666-6666-4666-8666-666666666666';
const C='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',F='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',HOST='#snote90-members',ROW=HOST+' .snote90-member';
async function setup(width,{mode='ok',hold=false}={}){
 const f=await fixture(width),p=f.page;
 await f.context.route('**/api/vehicle-taxonomy-probe**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,code:'SETUP_REQUIRED'})}));
 await p.evaluate(async({A,D,K,N,I,X,C,F,mode,hold})=>{
  await closeVehicle({discard:true});const S=__encarFixtureState,from=S.client.from.bind(S.client),rpc=S.client.rpc.bind(S.client);
  const member=(id,company,role,name,active=true)=>({user_id:id,company_id:company,role,display_name:name,active,phone:'01012345678'});
  const t=window.__staffUI={mode,holdCompany:hold?C:null,waiting:false,requests:[],mutations:[],authCalls:[],members:{[C]:[member(A,C,'admin','합성 대표'),member(D,C,'dealer','합성 딜러'),member(K,C,'accountant','합성 경리'),member(N,C,'dealer','ID 미등록'),member(I,C,'dealer','비활성 직원',false)],[F]:[member(A,F,'admin','변경된 상사 대표'),member(X,F,'dealer','새 상사 직원')]},logins:{[C]:[{userId:A,loginId:'admin@example.test'},{userId:D,loginId:'dealer@example.test'},{userId:K,loginId:'accounting@example.test'},{userId:N,loginId:null},{userId:I,loginId:'inactive@example.test'},{userId:X,loginId:'FOREIGN_CANARY@example.test'}],[F]:[{userId:A,loginId:'admin@example.test'},{userId:X,loginId:'new-company@example.test'}]}};
  // The unrelated catalogue diagnostic has separate pinned-auth coverage.
  // Supply its status locally so any Auth/session request here belongs to staff lookup.
  window.snoteTaxonomyProbeBridge=Object.freeze({...window.snoteTaxonomyProbeBridge,status:async()=>({ok:true,configured:false,provider:'encar-api.com'})});
  t.authCallStacks=[];
  for(const method of ['getSession','getUser','signOut']){const original=S.client.auth[method];if(original)S.client.auth[method]=async(...args)=>{t.authCalls.push(method);t.authCallStacks.push({method,stack:new Error().stack});return original.apply(S.client.auth,args);};}
  S.client.from=table=>{
   if(!['zc_members','zc_companies'].includes(table))return from(table);
   const filters={};let single=false;const q={select(){return q;},eq(key,value){filters[key]=value;return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},then(resolve,reject){
    const values=table==='zc_members'?(t.members[filters.company_id||S.company.id]||[]):[S.company],rows=values.filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value));
    return Promise.resolve({data:single?(rows[0]||null):structuredClone(rows),error:null}).then(resolve,reject);
   }};return q;
  };
  S.client.rpc=async(name,args)=>{
   if(name==='snote_company_staff_logins'){
    if(JSON.stringify(Object.keys(args).sort())!==JSON.stringify(['p_expected_company_id']))throw Error('Unexpected staff-ID arguments');
    const company=args.p_expected_company_id;t.requests.push({name,company});const rows=structuredClone(t.logins[company]||[]),mode=t.mode;
    if(t.holdCompany===company){t.waiting=true;await new Promise(resolve=>t.release=resolve);t.waiting=false;}
    if(mode==='error')return{data:null,error:{code:'PGRST202',message:'SYNTHETIC_SETUP_REQUIRED'}};
    if(mode==='reject')throw Error('SYNTHETIC_NETWORK_FAILED');
    return{data:rows,error:null};
   }
   if(name==='snote90_admin_update_name'){
    if(JSON.stringify(Object.keys(args).sort())!==JSON.stringify(['p_company_name','p_display_name','p_target']))throw Error('Unexpected name mutation arguments');
    t.mutations.push({name,args:structuredClone(args)});const row=(t.members[S.company.id]||[]).find(row=>row.user_id===args.p_target);if(!row)throw Error('Unexpected target');row.display_name=args.p_display_name;return{data:null,error:null};
   }
   return rpc(name,args);
  };
  currentUser.role='admin';currentUser.name='합성 대표';currentUser.company='합성 상사';S.company={...S.company,name:'합성 상사',business_number:'1234567890',representative_name:'합성 대표',business_phone:'0311234567',business_address:'합성 주소',business_address_detail:''};S.members=t.members[C];
  navigate('settings');
 },{A,D,K,N,I,X,C,F,mode,hold});
 return f;
}
async function loaded(p,count=4){await p.waitForFunction(count=>document.querySelectorAll('#snote90-members .snote-staff-login-id').length===count,count);await p.waitForFunction(()=>[...document.querySelectorAll('#snote90-members .snote90-member')].every(row=>row.querySelectorAll('button.snote-settings-icon svg').length===2));}
async function identity(p,id){return p.locator('.snote-staff-login-id[data-staff-login-id="'+id+'"]');}
async function clean(f){const calls=await f.page.evaluate(()=>__staffUI.authCalls);if(calls.length)fs.writeFileSync(path.join(OUT,'auth-call-debug.json'),JSON.stringify(await f.page.evaluate(()=>__staffUI.authCallStacks),null,2));assert.deepEqual(calls,[],'Displaying staff IDs must not add Auth/session requests');await finish(f);}
async function layout(width){
 const f=await setup(width),p=f.page;
 try{await loaded(p);assert.equal(await p.locator(ROW).count(),4);assert.equal(await (await identity(p,D)).textContent(),'dealer@example.test');assert.equal(await (await identity(p,K)).textContent(),'accounting@example.test');assert.equal(await (await identity(p,N)).textContent(),'ID 확인 필요');
  const text=await p.locator(HOST).innerText();assert(!text.includes('FOREIGN_CANARY'));assert(!text.includes('inactive@example.test'));assert(!text.includes('cld_'));for(const id of[A,D,K,N,I,X])assert(!text.includes(id),'Internal UUIDs must never become the displayed staff ID');
  fs.writeFileSync(path.join(OUT,'geometry-'+width+'.json'),JSON.stringify(await p.locator(ROW).evaluateAll(rows=>rows.map(row=>Object.fromEntries([['row',row],['label',row.querySelector('label')],['identity',row.querySelector('.snote-staff-login-line')],['input',row.querySelector('input')],['login',row.querySelector('.snote-staff-login-id')],['role',row.querySelector('span')],['save',row.querySelectorAll('button')[0]],['remove',row.querySelectorAll('button')[1]]].map(([name,el])=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return[name,{x:b.x,y:b.y,width:b.width,height:b.height,alignSelf:s.alignSelf,gridRow:s.gridRow,gridTemplateRows:s.gridTemplateRows,className:el.className,style:el.getAttribute("style"),symbol:el.getAttribute("data-settings-symbol")}];})))),null,2));
  await p.locator(HOST).screenshot({path:path.join(OUT,'staff-'+width+'.png')});
  for(const row of await p.locator(ROW).all()){
   const input=await row.locator('input').boundingBox(),login=await row.locator('.snote-staff-login-id').boundingBox(),buttons=await row.locator('button').all();assert.equal(buttons.length,2);
   for(const button of buttons){const box=await button.boundingBox();assert(Math.abs(box.y+box.height/2-input.y-input.height/2)<1.6,'Save/delete icons must share the staff-name input center line');assert(box.x>=0&&box.x+box.width<=width+.5);}
   if(width>700){assert(login.x>=input.x+input.width+8,'Desktop login ID belongs beside the name input');assert(Math.abs(login.y+login.height/2-input.y-input.height/2)<2);}
   else{assert(login.y>=input.y+input.height+1,'Mobile login ID should wrap below the name without moving the actions');assert(login.x>=input.x-.5&&login.x+login.width<=input.x+input.width+.5);}
  }
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width===1440){const row=(await identity(p,D)).locator('xpath=ancestor::div[contains(@class,"snote90-member")]');await row.locator('input').fill('수정한 합성 딜러');f.answerAlert(/직원 이름 저장 완료/);await row.locator('button').first().click();await p.waitForFunction(()=>__staffUI.mutations.length===1);assert.equal(await (await identity(p,D)).textContent(),'dealer@example.test');assert.equal((await p.evaluate(()=>__staffUI.mutations[0])).args.p_display_name,'수정한 합성 딜러');}
  await p.locator(HOST).screenshot({path:path.join(OUT,'staff-'+width+'.png')});await clean(f);console.log('PASS '+width+' actual staff login IDs, null fallback, compact input/action alignment and unchanged name-only save');
 }catch(error){await p.locator(HOST).screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}
}
async function missingAndFailure(){
 const f=await setup(1440,{mode:'error'}),p=f.page;try{await loaded(p);assert.equal(await p.locator(ROW).count(),4);for(const login of await p.locator(HOST+' .snote-staff-login-id').all())assert.equal(await login.textContent(),'ID 조회 확인 필요');
  assert(!(await p.locator(HOST).innerText()).includes('cld_'));await p.evaluate(()=>{__staffUI.mode='ok';navigate('buy');navigate('settings');});await loaded(p);assert.equal(await (await identity(p,D)).textContent(),'dealer@example.test');assert.equal(await (await identity(p,N)).textContent(),'ID 확인 필요');assert.equal(await p.evaluate(()=>__staffUI.mutations.length),0);
  await clean(f);console.log('PASS failed staff-ID lookup keeps staff names/actions, shows a safe fallback and recovers without UUID substitution');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
async function lateCompanyResponse(){
 const f=await setup(390,{hold:true}),p=f.page;try{await p.waitForFunction(()=>__staffUI.waiting);assert.equal(await p.locator(HOST+' .snote-staff-login-id').count(),0);
  await p.evaluate(({F})=>{const S=__encarFixtureState;S.company={...S.company,id:F,name:'새 합성 상사'};S.members=__staffUI.members[F];currentUser={...currentUser,name:'변경된 상사 대표',company:S.company.name};__staffUI.release();},{F});
  await p.waitForFunction(()=>!__staffUI.waiting);await p.waitForTimeout(100);assert.equal(await p.locator(HOST+' .snote-staff-login-id').count(),0,'A delayed old-company lookup cannot fill the still-connected host');
  await p.evaluate(()=>{__staffUI.holdCompany=null;navigate('buy');navigate('settings');});await loaded(p,2);assert.equal(await (await identity(p,X)).textContent(),'new-company@example.test');assert.equal(await (await identity(p,D)).count(),0);assert(!(await p.locator(HOST).innerText()).includes('dealer@example.test'));
  await clean(f);console.log('PASS a late previous-company response is discarded before inserting any email into the current settings view');
 }catch(error){await f.context.close().catch(()=>{});throw error;}
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);const failures=[];try{for(const run of[()=>layout(1440),()=>layout(390),missingAndFailure,lateCompanyResponse])try{await run();}catch(error){failures.push(error);console.error(error.stack||error);}}finally{await browser.close();}if(failures.length)throw Error(failures.length+' staff login browser group(s) failed');})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
