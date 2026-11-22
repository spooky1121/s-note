'use strict';
// Real app/queue/flush; every server row and response is synthetic.
const assert=require('node:assert/strict');
const{chromium}=require('./encar/node_modules/playwright');
const{fixture,setBrowser}=require('./encar/browser-smoke.cjs');
async function boot(width=1440){
 const f=await fixture(width),p=f.page;
 await p.evaluate(async()=>{
  await closeVehicle({discard:true});closeDashboardGate();navigate('buy');const S=__encarFixtureState;S.members[0].role='admin';currentUser.role='admin';
  const rows=[{id:'ps-inline-1',date:'2026-11-01',model:'합성 첫 차량',plate:cars[0].plate,dealer:'검증 담당자',amount:1000000,repaid:false,type:'car',ownerId:currentUser.username,carId:cars[0].id,extra:{preserve:'metadata'}},{id:'ps-inline-2',date:'2026-11-02',model:'합성 둘째 차량',plate:cars[1].plate,dealer:'둘째 담당자',amount:2000000,repaid:false},{id:'ps-adjust-test',date:'2026-11-03',model:'차량 조정',plate:cars[0].plate,dealer:'자동 조정',amount:-100000,repaid:false,type:'adjustment',ownerId:currentUser.username,carId:cars[0].id},{id:'legacy-hidden-row',date:'unrecognized',model:'보존할 원본',amount:11,extra:['keep']}];
  const q=window.__prestockTest={company:S.company.id,actor:S.user.id,server:structuredClone(rows),revision:7,calls:[],writes:[],reads:0,mode:'ok',waiting:false,releases:[],detachedWrites:[],carsBefore:JSON.stringify(cars)};
  const originalRpc=S.client.rpc.bind(S.client),originalFrom=S.client.from.bind(S.client);
  S.client.rpc=async(name,args)=>{
   if(name!=='zc_write_dataset'||args.p_dataset!=='prestock')return originalRpc(name,args);
   q.calls.push(structuredClone(args));if(args.p_company!==q.company||args.p_owner!=='00000000-0000-0000-0000-000000000000')throw Error('Unexpected prestock write scope');
   if(args.p_expected!==q.revision)return{data:null,error:{message:'CONFLICT'}};
   const requestCompany=args.p_company;if(q.mode==='hold'){q.waiting=true;await new Promise(resolve=>q.releases.push(resolve));q.waiting=false;}
   if(requestCompany!==q.company){q.detachedWrites.push(structuredClone(args));return{data:args.p_expected+1,error:null};}
   if(q.mode==='fail')return{data:null,error:{message:'SYNTHETIC_PRESTOCK_WRITE_FAILED'}};
   q.server=structuredClone(args.p_payload);q.writes.push(structuredClone(args));const revision=++q.revision;
   if(q.mode==='lost')return{data:null,error:{message:'SYNTHETIC_RESPONSE_LOST_AFTER_COMMIT'}};
   return{data:revision,error:null};
  };
  S.client.from=table=>{
   if(table!=='zc_datasets')return originalFrom(table);const filters={};let single=false;
   const chain={select(){return chain},eq(k,v){filters[k]=v;return chain},in(){return chain},order(){return chain},limit(){return chain},maybeSingle(){single=true;return chain},single(){single=true;return chain},then(resolve,reject){
    const row={company_id:q.company,dataset:'prestock',owner_id:'00000000-0000-0000-0000-000000000000',payload:structuredClone(q.server),revision:q.revision};
    if(filters.dataset==='prestock'){q.reads++;return Promise.resolve({data:single?row:[row],error:null}).then(resolve,reject);}
    let original=originalFrom(table).select('*');for(const[k,v]of Object.entries(filters))original=original.eq(k,v);if(single)original=original.maybeSingle();
    return Promise.resolve(original).then(result=>{if(result.error||single||filters.dataset)return result;const existing=(result.data||[]).filter(item=>item.company_id===q.company&&item.dataset!=='prestock');return{...result,data:[...existing,row]};}).then(resolve,reject);
   }};return chain;
  };
  S.queue.clear();S.conflict=false;clearTimeout(S.timer);buildMenus();
 });
 f.answerConfirm(true,/서버에 저장된 데이터로 다시 불러올까요/);await p.evaluate(()=>zc86Cloud.reload());
 await p.evaluate(()=>{closeDashboardGate();navigate('prestock');__prestockTest.carsBefore=JSON.stringify(cars);});
 await p.locator('#prestock-card').waitFor();return f;
}
function field(p,width,key,id='ps-inline-1'){return p.locator((width<=760?'#ps-mobile-list':'#ps-scroll')+' [data-ps-row="'+id+'"][data-ps-field="'+key+'"]');}
async function success(p){await p.waitForFunction(()=>document.getElementById('ps-inline-status')?.dataset.tone==='success');}
async function change(p,width,key,value){await field(p,width,key).fill(value);await field(p,width,key).press('Enter');await success(p);}
async function finish(f){assert.deepEqual(f.errors,[]);assert.deepEqual(f.unexpectedDialogs,[]);await f.context.close();}
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(b);try{
 if(process.env.SNOTE_PRESTOCK_SCREENSHOTS_ONLY){for(const width of[1440,390]){const f=await boot(width),p=f.page;await p.locator('.snote-prestock-entry').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/snote-v2136-prestock-current-'+width+'.png',fullPage:true});await p.locator('.snote-prestock-entry').screenshot({path:'/tmp/snote-v2136-prestock-current-entry-'+width+'.png'});await p.locator('.snote-prestock-ledger').screenshot({path:'/tmp/snote-v2136-prestock-current-ledger-'+width+'.png'});if(width===390){await change(p,width,'date','20261119');assert.equal(await p.evaluate(()=>__prestockTest.server.find(r=>r.id==='ps-inline-1').date),'2026-11-19');assert.equal(await field(p,width,'date').inputValue(),'2026.11.19');console.log('PASS mobile numeric-keyboard eight-digit date is normalized and acknowledged');}await finish(f);console.log('PASS current screenshot',width);}return;}
 for(const width of(process.env.SNOTE_PRESTOCK_NEGATIVE_ONLY?[]:[1440,390,320])){
  const f=await boot(width),p=f.page;
  const arrow=p.locator('#ps-entry-form .ps-entry-submit');assert.equal(await p.locator('#prestock-card .ps-add').count(),0);assert.equal(await arrow.getAttribute('aria-label'),'선재고 내역 추가');assert.equal(await arrow.getAttribute('data-tooltip'),'선재고 내역 추가');await arrow.locator('img').evaluate(e=>e.decode());
  const style=await arrow.evaluate(e=>{const s=getComputedStyle(e),a=e.getBoundingClientRect(),t=e.parentElement.querySelector('strong').getBoundingClientRect();return{background:s.backgroundColor,border:s.borderWidth,shadow:s.boxShadow,sameLine:Math.abs(a.y+a.height/2-t.y-t.height/2)<2,right:a.x>=t.right}});assert.deepEqual(style,{background:'rgba(0, 0, 0, 0)',border:'0px',shadow:'none',sameLine:true,right:true});
  for(const selector of['.ps-ledger-head','.ps-scroll','.ps-list-controls'])assert.equal(await p.locator('.snote-prestock-ledger '+selector).evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');assert.equal(await p.locator('.snote-prestock-ledger').evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
  assert.equal(await field(p,width,'amount','ps-adjust-test').getAttribute('readonly'),'');
  await change(p,width,'model','직접 수정 차량');await change(p,width,'date',width<=760?'20261110':'2026.11.10');await change(p,width,'dealer','새 담당자');await change(p,width,'plate','33가3333');await change(p,width,'amount','2500000');
  assert.equal(await field(p,width,'amount').inputValue(),'2,500,000');const result=await p.evaluate(()=>({row:__prestockTest.server.find(r=>r.id==='ps-inline-1'),hidden:__prestockTest.server.find(r=>r.id==='legacy-hidden-row'),sum:prestockSums().total,linked:prestockForCar(cars[0]),cars:JSON.stringify(cars),before:__prestockTest.carsBefore,writes:__prestockTest.writes.length}));
  assert.equal(result.row.date,'2026-11-10');assert.equal(result.row.amount,2500000);assert.equal(result.row.model,'직접 수정 차량');assert.equal(result.row.dealer,'새 담당자');assert.equal(result.row.plate,'33가3333');assert.deepEqual(result.row.extra,{preserve:'metadata'});assert.equal(result.hidden.date,'unrecognized');assert.deepEqual(result.hidden.extra,['keep']);assert.equal(result.sum,4500000);assert.equal(result.linked,0);assert.equal(result.cars,result.before);assert.equal(result.writes,5);
  const writes=result.writes;await field(p,width,'date').fill('2026.02.30');await field(p,width,'date').press('Enter');assert.equal(await field(p,width,'date').inputValue(),'2026.02.30');assert.equal(await field(p,width,'date').getAttribute('aria-invalid'),'true');assert.equal(await p.evaluate(()=>__prestockTest.writes.length),writes);await field(p,width,'date').press('Escape');assert.equal(await field(p,width,'date').inputValue(),'2026.11.10');
  await field(p,width,'amount').fill('');await field(p,width,'amount').press('Enter');assert.equal(await field(p,width,'amount').inputValue(),'');assert.equal(await field(p,width,'amount').getAttribute('aria-invalid'),'true');await field(p,width,'amount').press('Escape');assert.equal(await field(p,width,'amount').inputValue(),'2,500,000');
  await field(p,width,'model').fill('조합 중 입력');await field(p,width,'model').evaluate(e=>{e.dataset.psComposing='1';e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true}));});await p.waitForTimeout(50);assert.equal(await p.evaluate(()=>__prestockTest.writes.length),writes);await field(p,width,'model').evaluate(e=>e.dataset.psComposing='0');await field(p,width,'model').press('Escape');
  await field(p,width,'amount').locator('xpath=..').locator('button').click();await p.locator('#ps-action-menu.open').waitFor();assert.match(await p.locator('#ps-action-menu').textContent(),/선재고상환/);assert.match(await p.locator('#ps-action-menu').textContent(),/취소/);await p.evaluate(()=>closePrestockMenu());
  await p.locator('#ps-date').fill('2026-11-18');await p.locator('#ps-model').fill('화살표 신규 등록');await p.locator('#ps-amount').fill('123400');await arrow.click();assert.equal(await p.evaluate(()=>prestockAllRows().some(r=>r.model==='화살표 신규 등록'&&r.amount===123400)),true);assert.equal(await p.evaluate(async()=>{const r=await zc86Cloud.flush();return r.ok}),true);assert.equal(await p.evaluate(()=>__prestockTest.server.some(r=>r.model==='화살표 신규 등록'&&r.amount===123400)),true);assert.equal(await p.evaluate(()=>__prestockTest.server.some(r=>r.id==='legacy-hidden-row'&&r.extra?.[0]==='keep')),true,'Adding one row must preserve unrecognized server rows');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:'/tmp/snote-v2136-prestock-inline-'+width+'.png'});await p.locator('.snote-prestock-entry').screenshot({path:'/tmp/snote-v2136-prestock-entry-'+width+'.png'});await p.locator('.snote-prestock-ledger').screenshot({path:'/tmp/snote-v2136-prestock-ledger-'+width+'.png'});await finish(f);console.log('PASS',width,'arrow heading, nested borders, five Enter edits/ACK, exact won/link/totals and car immutability, invalid/Escape/IME, original menu/add action');
 }
 {
  const f=await boot(),p=f.page;await field(p,1440,'model').fill('보존할 오른쪽 초안');await p.locator('#ps-model').fill('보존할 왼쪽 신규 초안');
  await p.evaluate(async()=>{const rows=snotePrestockLedgerBridge.rows();rows.find(r=>r.id==='ps-inline-2').model='다른 행 정식 변경';if(!savePrestockRows(rows)||(await zc86Cloud.flush()).ok!==true)throw Error('Synthetic acknowledged update failed');window.dispatchEvent(new StorageEvent('storage',{key:PRESTOCK_V148_KEY}));});
  assert.equal(await field(p,1440,'model').inputValue(),'보존할 오른쪽 초안');assert.equal(await p.locator('#ps-model').inputValue(),'보존할 왼쪽 신규 초안');await field(p,1440,'model').press('Enter');await success(p);assert.equal(await p.evaluate(()=>__prestockTest.server.find(r=>r.id==='ps-inline-2').model),'다른 행 정식 변경');assert.equal(await p.locator('#ps-model').inputValue(),'보존할 왼쪽 신규 초안');await finish(f);console.log('PASS same-company storage refresh preserves both drafts and merges an unrelated acknowledged row');
 }
 {
  const f=await boot(),p=f.page;await p.evaluate(()=>{__encarFixtureState.ready=false;buildPrestockManagement();});assert.equal(await field(p,1440,'model').count(),0,'Unconfirmed readiness cannot render cached company rows');await p.evaluate(()=>{__encarFixtureState.ready=true;snote136PrestockScope=snote136PrestockContext()?.key||'';refreshPrestockDisplay();});assert.equal(await field(p,1440,'model').getAttribute('readonly'),null);await finish(f);console.log('PASS ready=false does not render cached rows and confirmed readiness restores editable company rows');
 }
 for(const mode of['fail','lost']){
  const f=await boot(),p=f.page;await p.evaluate(mode=>__prestockTest.mode=mode,mode);await field(p,1440,'amount').fill('1900000');await field(p,1440,'amount').press('Enter');await p.waitForFunction(()=>document.getElementById('ps-inline-status')?.dataset.tone==='error');assert.equal(await field(p,1440,'amount').inputValue(),'1,900,000');assert.equal(await p.locator('#ps-total').textContent(),'2,900,000원');
  if(mode==='lost'){const kept=await p.evaluate(()=>{const draft=snote136PrestockDrafts.get('ps-inline-1'),view=snote136PrestockView;window.dispatchEvent(new StorageEvent('storage',{key:PRESTOCK_V148_KEY}));return snote136PrestockDrafts.get('ps-inline-1')===draft&&!!draft.attempt&&snote136PrestockView===view;});assert.equal(kept,true,'Same-company storage refresh preserves the unknown ACK attempt');assert.equal(await field(p,1440,'amount').inputValue(),'1,900,000');}
  await p.evaluate(()=>__prestockTest.mode='ok');await field(p,1440,'amount').press('Enter');await success(p);assert.equal(await p.evaluate(()=>__prestockTest.server.find(r=>r.id==='ps-inline-1').amount),1900000);assert.equal(await p.evaluate(()=>__prestockTest.writes.length),1);assert.equal(await p.locator('#ps-total').textContent(),'3,800,000원');assert.equal(await p.evaluate(()=>__prestockTest.server.some(r=>r.id==='legacy-hidden-row')),true);await finish(f);console.log('PASS',mode,'failure preserves input/old summary; retry reconciles original queue without duplicate commit');
 }
 {
  const f=await boot(),p=f.page;await p.evaluate(()=>__prestockTest.mode='hold');await field(p,1440,'amount').fill('2200000');await field(p,1440,'amount').press('Enter');await p.waitForFunction(()=>__prestockTest.waiting);assert.equal(await p.locator('#ps-total').textContent(),'2,900,000원');assert.equal(await field(p,1440,'amount').isDisabled(),true);
  const next=await p.evaluate(()=>{const S=__encarFixtureState,id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';S.ready=false;S.company={...S.company,id,name:'새 상사'};S.members=[{user_id:S.user.id,company_id:id,role:'admin',active:true,display_name:'새 상사 관리자'}];S.loading=true;const data=[{id:'ps-next-company',date:'2026-11-18',model:'새 상사 원장',amount:500000,repaid:false}];localStorage.setItem(PRESTOCK_V148_KEY,JSON.stringify(data));__prestockTest.company=id;__prestockTest.server=structuredClone(data);__prestockTest.revision=3;S.loading=false;S.ready=true;return JSON.stringify(data);});
  f.answerConfirm(true,/서버에 저장된 데이터로 다시 불러올까요/);await p.evaluate(()=>{window.__prestockReload=zc86Cloud.reload();});
  await p.waitForFunction(()=>__encarFixtureState.ready===false);await p.evaluate(()=>{__prestockTest.mode='ok';__prestockTest.releases.shift()();});await p.evaluate(()=>window.__prestockReload);await p.evaluate(()=>{closeDashboardGate();navigate('prestock');});await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>localStorage.getItem(PRESTOCK_V148_KEY)),next);assert.equal(await field(p,1440,'model','ps-next-company').inputValue(),'새 상사 원장');assert.equal(await p.locator('#ps-inline-status').textContent(),'');await finish(f);console.log('PASS late ACK cannot change the new company cache, fields or status');
 }
 {
  const f=await boot(),p=f.page;await field(p,1440,'model').fill('경합 중 사용자 입력');await p.evaluate(()=>{const rows=structuredClone(__prestockTest.server);rows.find(r=>r.id==='ps-inline-1').model='다른 화면 수정';__prestockTest.server=rows;__prestockTest.revision++;window.dispatchEvent(new StorageEvent('storage',{key:PRESTOCK_V148_KEY}));});assert.equal(await field(p,1440,'model').inputValue(),'경합 중 사용자 입력');f.answerAlert(/다른 기기에서 먼저 변경한 장부/);await field(p,1440,'model').press('Enter');await p.waitForFunction(()=>document.getElementById('ps-inline-status')?.dataset.tone==='error');assert.equal(await field(p,1440,'model').inputValue(),'경합 중 사용자 입력');assert.equal(await p.evaluate(()=>__prestockTest.writes.length),0);await finish(f);console.log('PASS changed target baseline refuses overwrite while preserving the draft');
 }
}finally{await b.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1});
