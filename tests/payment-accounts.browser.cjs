'use strict';
// Real UI, pinned profile HTTP bridge and A4 PDFs; every account and request is synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.PAYMENT_ACCOUNTS_TEST_ARTIFACT_DIR||path.join(os.tmpdir(),'snote-payment-accounts');fs.mkdirSync(OUT,{recursive:true});
const SCENARIO=process.env.PAYMENT_ACCOUNTS_TEST_SCENARIO||'all';assert(['all','max','gate'].includes(SCENARIO));
const ACTOR='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',COMPANY='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',DB='https://payment-fixture.supabase.co',KEY='synthetic-payment-publishable-key';
const token=id=>Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')+'.synthetic';
const TOKENS={[ACTOR]:token(ACTOR),[OTHER]:token(OTHER)},EMPTY={vehicle:null,transfer:null};
const ACCOUNTS={vehicle:{bank:'합성차량은행',number:'0012345678901',holder:'합성 딜러'},transfer:{bank:'합성이전은행',number:'009-8765-432109',holder:'합성 이전'}};
const compact=value=>String(value).replace(/\s/g,''),clone=value=>structuredClone(value),results=[];
const row=(id,accounts=EMPTY,revision=0)=>({user_id:id,company_id:COMPANY,revision,accounts:clone(accounts)});

async function setup(width=1440){
 const f=await fixture(width),p=f.page,state={rows:new Map([[ACTOR,row(ACTOR)],[OTHER,row(OTHER)]]),calls:[],holds:new Map(),failRead:false,conflict:false,wrongScope:false,profileRole:'dealer'};f.bank=state;
 // Administrator settings also show a read-only taxonomy status card.
 await f.context.route('**/api/vehicle-taxonomy-probe*',async route=>{assert.equal(route.request().method(),'GET');return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,provider:'encar-api.com',configured:false,importEnabled:false})});});
 const headers={'access-control-allow-origin':'*','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization, apikey, content-type'};
 await f.context.route(DB+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  assert.equal(req.method(),'POST');assert.equal(req.headers().apikey,KEY);const actor=Object.keys(TOKENS).find(id=>req.headers().authorization==='Bearer '+TOKENS[id]);assert(actor,'A captured verified token is required');
  const name=url.pathname.split('/').pop(),args=JSON.parse(req.postData()||'{}');state.calls.push({actor,name,args:clone(args)});
  const reply=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  const h=state.holds.get(name),snapshot=clone(state.rows.get(actor));if(h){h.waiting=true;await new Promise(resolve=>h.resolves.push(resolve));}
  if(name==='snote_payment_accounts_read'){
   assert.deepEqual(args,{p_company:COMPANY});if(state.failRead)return reply({code:'SERVER_ERROR',message:'Synthetic temporary read failure'},503);
   return reply(state.wrongScope?{...snapshot,user_id:OTHER}:snapshot);
  }
  if(name==='snote_payment_accounts_save'){
   assert.deepEqual(Object.keys(args).sort(),['p_accounts','p_company','p_expected_revision']);assert.equal(args.p_company,COMPANY);
   const current=state.rows.get(actor);if(state.conflict||args.p_expected_revision!==current.revision)return reply({code:'40001',message:'PAYMENT_ACCOUNTS_CONFLICT'},409);
   const next=row(actor,args.p_accounts,current.revision+1);state.rows.set(actor,next);return reply(next);
  }
  if(name==='snote_profile_read')return reply({user_id:actor,company_id:COMPANY,role:state.profileRole,display_name:'합성 입금 딜러',company_name:'합성 자동차 상사',phone:'01012345678',address:'서울특별시 합성로 12',company_address:'서울특별시 합성로 12',revision:0});
  if(name==='snote_profile_avatar_read')return reply({user_id:actor,company_id:COMPANY,avatar_path:null,avatar_revision:0});
  throw Error('Unexpected synthetic RPC '+name);
 });
 await p.evaluate(async({actor,other,company,url,key,tokens})=>{
  const S=__encarFixtureState,previous=S.client;window.__paymentTest={prints:0,pinnedTokens:[],mutableTokens:0};window.print=()=>++__paymentTest.prints;
  S.client={...previous,supabaseUrl:url,supabaseKey:key,auth:{...previous.auth,
   async getSession(){const id=S.user.id;return{data:{session:{access_token:tokens[id],refresh_token:'synthetic-refresh',user:{id,email:'synthetic@example.invalid'}}},error:null};},
   async getUser(jwt){if(!jwt){__paymentTest.mutableTokens++;return{data:{user:structuredClone(S.user)},error:null};}__paymentTest.pinnedTokens.push(jwt);const id=Object.keys(tokens).find(id=>tokens[id]===jwt);return{data:{user:id?{id,email:'synthetic@example.invalid'}:null},error:id?null:{code:'invalid_token'}};}
  },rpc(name,args){if(name.startsWith('snote_payment_accounts_'))throw Error('Payment RPC must keep the captured HTTP token');return previous.rpc(name,args);}};
  S.rpcConfig={client:S.client,url,key};S.company={...S.company,name:'합성 자동차 상사',business_address:'서울특별시 합성로 12',business_number:'1234567890',business_phone:'0212345678'};
  S.members=[{user_id:actor,company_id:company,role:'dealer',active:true,display_name:'합성 입금 딜러'},{user_id:other,company_id:company,role:'dealer',active:true,display_name:'다른 합성 딜러'}];
  currentUser.name='합성 입금 딜러';currentUser.company=S.company.name;window.snoteLoadDocumentLogo=async()=>null;
  const seal=document.createElement('canvas');seal.width=96;seal.height=96;const ink=seal.getContext('2d');ink.strokeStyle='#c93347';ink.lineWidth=6;ink.strokeRect(10,10,76,76);window.__paymentStamp=URL.createObjectURL(await new Promise(resolve=>seal.toBlob(resolve,'image/png')));window.snoteLoadDocumentStamp=async()=>__paymentStamp;
 },{actor:ACTOR,other:OTHER,company:COMPANY,url:DB,key:KEY,tokens:TOKENS});
 f.hold=name=>{const h={waiting:false,resolves:[]};state.holds.set(name,h);return h;};
 f.wait=async name=>{for(let i=0;i<200;i++){if(state.holds.get(name)?.waiting)return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Synthetic RPC hold was not reached: '+name);};
 f.release=name=>{const h=state.holds.get(name);state.holds.delete(name);for(const resolve of h?.resolves||[])resolve();};
 return f;
}
async function profile(p){await p.evaluate(()=>snoteProfileEditor.open());await p.locator('#snote-payment-profile:not([hidden])').waitFor();await p.waitForFunction(()=>!document.getElementById('snote-payment-vehicle-bank').disabled);}
async function closeProfile(p){await p.evaluate(()=>snoteProfileEditor.close({force:true,immediate:true}));}
async function fields(p,kind,value){for(const key of ['bank','number','holder'])await p.locator('#snote-payment-'+kind+'-'+key).fill(value?.[key]||'');}
async function save(p){await p.locator('#snote-payment-save').click();await p.waitForFunction(()=>document.getElementById('snote-payment-message').dataset.tone==='success');}
async function quote(p){await p.evaluate(async()=>{if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});if(route==='settings')navigate('buy');openVehicle('encar-car-1');await openQuotePreview();});await p.locator('#quote-overlay.open').waitFor();await p.evaluate(()=>SnotePaymentAccounts.loadDocument(()=>document.getElementById('quote-overlay').classList.contains('open')));}
async function contract(p){await p.evaluate(async()=>{closeQuotePreview();openVehicle('encar-car-1');openContractPreview({loadCustomer:false});document.getElementById('ct-buyer-name').value='합성 계약 고객';});await p.locator('#contract-overlay.open').waitFor();await p.evaluate(()=>SnotePaymentAccounts.loadDocument(()=>document.getElementById('contract-overlay').classList.contains('open')));}
const MISSING_ACCOUNT=/^입금 계좌 먼저 입력 하셔야합니다$/;
async function directSettings(p){
 await p.waitForFunction(()=>route==='settings'&&!!document.getElementById('snote-settings-payment-body')?.querySelector('#snote-payment-profile'));
 await p.waitForFunction(()=>!document.getElementById('snote-payment-vehicle-bank').disabled);
 assert.equal(await p.locator('#snote-settings-profile-details').evaluate(el=>el.open),false,'Receiving accounts must be directly editable while profile settings are collapsed');
 assert.equal(await p.locator('#snote-profile-dialog').isVisible(),false);
 assert.equal(await p.locator('#snote-settings-payment-body #snote-payment-profile').isVisible(),true);
}
async function missingQuote(f){
 const p=f.page,count=f.dialogs.length;f.answerAlert(MISSING_ACCOUNT);
 await p.evaluate(async()=>{if(document.getElementById('contract-overlay').classList.contains('open'))await closeContractPreview({discard:true});if(route==='settings')navigate('buy');openVehicle('encar-car-1');});
 await p.locator('#vehicle-overlay .quote-launch').click();await directSettings(p);
 assert.equal(f.dialogs.length,count+1);assert.equal(f.dialogs.at(-1).message,'입금 계좌 먼저 입력 하셔야합니다');
 assert.equal(await p.locator('#quote-overlay').evaluate(el=>el.classList.contains('open')),false,'An unregistered account must never open a quotation');
 await p.waitForFunction(()=>document.activeElement?.id==='snote-payment-vehicle-bank');
}
async function assertAccounts(p,scope,accounts){
 for(const kind of ['vehicle','transfer']){
  const node=p.locator(scope+' [data-snote-payment-account="'+kind+'"]'),line=p.locator(scope+' [data-snote-payment-row="'+kind+'"]');
  const text=await node.textContent();if(!accounts[kind]){assert.equal(text.trim(),'');assert.equal(await line.isVisible(),false);}else{for(const value of Object.values(accounts[kind]))assert(compact(text).includes(compact(value)),'Document must retain the full saved '+kind+' value');assert.equal(await line.isVisible(),true);}
 }
 assert.equal(await p.locator(scope+' [data-snote-payment-section]').isVisible(),!!(accounts.vehicle||accounts.transfer));
}
async function pdf(p,kind,label,accounts){
 const before=await p.evaluate(()=>__paymentTest.prints);await p.evaluate(kind=>kind==='quote'?printQuote():printContract(),kind);assert.equal(await p.evaluate(()=>__paymentTest.prints),before+1,'The actual print entry point must complete after the receiving-account read');
 const file=path.join(OUT,label+'.pdf'),bytes=await p.pdf({format:'A4',printBackground:true,preferCSSPageSize:true,path:file}),pages=(bytes.toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length;
 assert.equal(pages,kind==='contract'?2:1,'Each document must retain the complete A4 copy count');const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}),rawText=execFileSync('pdftotext',['-raw',file,'-'],{encoding:'utf8'});fs.writeFileSync(path.join(OUT,label+'.txt'),text);
 for(const type of ['vehicle','transfer'])for(const value of Object.values(accounts[type]||{})){const expected=compact(value),occurrences=Math.max(compact(text).split(expected).length-1,compact(rawText).split(expected).length-1);assert(occurrences>=(kind==='contract'?2:1),'Every printed copy must contain the complete saved account');}
 for(const old of ['1005-304-826434','1002-966-532614'])assert(!text.includes(old),'No fixed legacy receiving account may print');
 if(kind==='contract'){
  await p.emulateMedia({media:'print'});
  const metrics=await p.locator('#contract-print-pages .contract-print-copy').evaluateAll(papers=>papers.map(paper=>{
   const rect=paper.getBoundingClientRect(),footer=paper.querySelector('.ct-footer').getBoundingClientRect(),section=paper.querySelector('[data-snote-payment-section]'),box=section.getBoundingClientRect(),bodyBoxes=[];
   const visible=el=>{for(let node=el;node&&node!==paper.parentElement;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden')return false;}return true;};
   const walk=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode())if(node.textContent.trim()&&!node.parentElement.closest('.ct-footer')&&visible(node.parentElement)){const range=document.createRange();range.selectNodeContents(node);for(const r of range.getClientRects())if(r.width&&r.height)bodyBoxes.push({left:r.left-rect.left,right:r.right-rect.left,bottom:r.bottom-rect.top});}
   for(const el of paper.querySelectorAll('input,textarea,img'))if(!el.closest('.ct-footer')&&visible(el)){const r=el.getBoundingClientRect();if(r.width&&r.height)bodyBoxes.push({left:r.left-rect.left,right:r.right-rect.left,bottom:r.bottom-rect.top});}
   return{pageHeight:rect.height,pageWidth:rect.width,sectionBottom:box.bottom-rect.top,footerTop:footer.top-rect.top,overflow:section.scrollWidth>section.clientWidth,bodyBottom:Math.max(...bodyBoxes.map(r=>r.bottom)),escaping:bodyBoxes.filter(r=>r.left<-.6||r.right>rect.width+.6)};
  }));fs.writeFileSync(path.join(OUT,label+'-layout.json'),JSON.stringify(metrics,null,2)+'\n');for(const item of metrics){assert(!item.overflow,'Receiving account text must stay inside its own frame');assert(item.sectionBottom<item.footerTop-8,'Receiving information must clear the printed footer');assert(item.bodyBottom<item.footerTop-7.4,'All printed contract content must still clear the footer with receiving accounts');assert.deepEqual(item.escaping,[],'Long receiving details must remain inside the A4 page');}
  fs.writeFileSync(path.join(OUT,label+'-layout.json'),JSON.stringify(metrics,null,2)+'\n');
  await p.emulateMedia({media:'screen'});
 }
 await p.screenshot({path:path.join(OUT,label+'.png')});results.push({kind,label,pages});
}
async function surface(width){const f=await setup(width),p=f.page;try{
 await missingQuote(f);assert(!(await p.locator('#quote-paper').textContent()).includes('1005-304-826434'));
 await directSettings(p);

 await fields(p,'vehicle',{bank:'부분 입력'});const savesBefore=f.bank.calls.filter(c=>c.name==='snote_payment_accounts_save').length;await p.locator('#snote-payment-save').click();await p.waitForFunction(()=>document.getElementById('snote-payment-message').dataset.tone==='error');assert.equal(f.bank.calls.filter(c=>c.name==='snote_payment_accounts_save').length,savesBefore,'Partial receiving details must not be saved');
 await fields(p,'vehicle',ACCOUNTS.vehicle);await fields(p,'transfer',ACCOUNTS.transfer);await save(p);assert.deepEqual(f.bank.rows.get(ACTOR).accounts,ACCOUNTS,'Leading zero and 13-digit accounts must stay exact strings');assert.equal(await p.evaluate(()=>SnotePaymentAccounts.profileDirty()),false);
 const persisted=await p.evaluate(()=>JSON.stringify({...localStorage}));assert(!persisted.includes(ACCOUNTS.vehicle.number),'Receiving accounts must not be copied into browser localStorage');
 await p.evaluate(()=>navigate('buy'));await profile(p);for(const kind of ['vehicle','transfer'])for(const key of ['bank','number','holder'])assert.equal(await p.locator('#snote-payment-'+kind+'-'+key).inputValue(),ACCOUNTS[kind][key]);
 await p.screenshot({path:path.join(OUT,'profile-'+width+'.png')});await closeProfile(p);await quote(p);await assertAccounts(p,'#quote-paper',ACCOUNTS);await pdf(p,'quote','quote-'+width,ACCOUNTS);
 await contract(p);await assertAccounts(p,'#contract-paper',ACCOUNTS);await pdf(p,'contract','contract-'+width,ACCOUNTS);
 const copies=await p.locator('#contract-print-pages [data-snote-payment-account="vehicle"]').allTextContents();assert.equal(copies.length,2);for(const text of copies)assert(text.includes(ACCOUNTS.vehicle.number));
 await p.evaluate(()=>closeContractPreview({discard:true}));await profile(p);await fields(p,'vehicle',null);await save(p);await closeProfile(p);await quote(p);await assertAccounts(p,'#quote-paper',{vehicle:null,transfer:ACCOUNTS.transfer});
 await p.evaluate(()=>closeQuotePreview());await profile(p);await fields(p,'transfer',null);await save(p);await closeProfile(p);await missingQuote(f);await p.evaluate(()=>navigate('buy'));await contract(p);await assertAccounts(p,'#contract-paper',EMPTY);
 await p.evaluate(()=>closeContractPreview({discard:true}));await profile(p);f.bank.conflict=true;await fields(p,'vehicle',ACCOUNTS.vehicle);await p.locator('#snote-payment-save').click();await p.waitForFunction(()=>document.getElementById('snote-payment-message').dataset.tone==='error');assert.equal(await p.locator('#snote-payment-vehicle-number').inputValue(),ACCOUNTS.vehicle.number,'Save conflict must retain the typed account');assert.equal(f.bank.rows.get(ACTOR).accounts.vehicle,null);await closeProfile(p);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await p.evaluate(()=>__paymentTest.mutableTokens),0);assert(f.bank.calls.filter(call=>call.name.startsWith('snote_payment_accounts_')).every(call=>call.actor===ACTOR));await finish(f);console.log('PASS '+width+' receiving account UI, exact strings, empty/one/both accounts, quote/contract real A4 PDFs, reopening, conflict retention, pinned transport');
}catch(error){await p.screenshot({path:path.join(OUT,'failure-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
async function changeActor(p,id){await p.evaluate(id=>{const S=__encarFixtureState;S.user={id,email:'other-synthetic@example.invalid'};currentUser={...currentUser,username:'cld_'+id.replaceAll('-','').slice(0,18),name:'다른 합성 딜러'};window.SnotePaymentAccounts.reset();},id);}
async function races(){const f=await setup(),p=f.page;try{
 f.bank.rows.set(ACTOR,row(ACTOR,ACCOUNTS,1));await quote(p);await assertAccounts(p,'#quote-paper',ACCOUNTS);
 // The receiving dealer remains the signed-in actor even for another owner's vehicle.
 await p.evaluate(()=>{cars.find(car=>car.id==='encar-car-1').ownerId='cld_222222222222422282';});await p.evaluate(()=>SnotePaymentAccounts.loadDocument(()=>true));await assertAccounts(p,'#quote-paper',ACCOUNTS);assert.equal(f.bank.calls.at(-1).actor,ACTOR);
 f.hold('snote_payment_accounts_read');await p.evaluate(()=>{window.__latePaymentRead=SnotePaymentAccounts.loadDocument(()=>true);});await f.wait('snote_payment_accounts_read');await changeActor(p,OTHER);await assertAccounts(p,'#quote-paper',EMPTY);f.release('snote_payment_accounts_read');assert.equal(await p.evaluate(()=>__latePaymentRead),false);await assertAccounts(p,'#quote-paper',EMPTY);await p.evaluate(()=>SnotePaymentAccounts.loadDocument(()=>true));await assertAccounts(p,'#quote-paper',EMPTY);assert.equal(f.bank.calls.at(-1).actor,OTHER);
 await changeActor(p,ACTOR);await p.evaluate(()=>{cars.find(car=>car.id==='encar-car-1').ownerId=currentUser.username;});await quote(p);await assertAccounts(p,'#quote-paper',ACCOUNTS);f.bank.failRead=true;const prints=await p.evaluate(()=>__paymentTest.prints);await p.evaluate(()=>printQuote());assert.equal(await p.evaluate(()=>__paymentTest.prints),prints,'A failed account read must stop printing');await assertAccounts(p,'#quote-paper',EMPTY);f.bank.failRead=false;f.bank.wrongScope=true;await p.evaluate(()=>printQuote());assert.equal(await p.evaluate(()=>__paymentTest.prints),prints,'A foreign owner response must stop printing');await assertAccounts(p,'#quote-paper',EMPTY);
 await finish(f);console.log('PASS logged-in dealer scope, old-account late read rejection, account-switch blanking, read failure/foreign-row print cancellation');
}catch(error){await p.screenshot({path:path.join(OUT,'failure-races.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
async function settingsAndQuoteGate(width){const f=await setup(width),p=f.page;try{
 await missingQuote(f);
 assert.equal(await p.locator('#snote-payment-profile').count(),1,'There must be one receiving-account editor, not a duplicate with conflicting IDs');
 await fields(p,'vehicle',ACCOUNTS.vehicle);
 assert.equal(await p.evaluate(()=>SnotePaymentAccounts.ensureQuoteAccounts(()=>true)),'missing','Unsaved settings input cannot count as registered account');
 await p.evaluate(()=>navigate('settings'));await directSettings(p);assert.equal(await p.locator('#snote-payment-vehicle-number').inputValue(),ACCOUNTS.vehicle.number,'Same-account settings rerender must preserve an unsaved account draft');
 f.answerConfirm(false,/입금계좌|저장하지 않은/);assert.equal(await p.evaluate(()=>navigate('buy')),false);assert.equal(await p.evaluate(()=>route),'settings');assert.equal(await p.locator('#snote-payment-vehicle-number').inputValue(),ACCOUNTS.vehicle.number);
 f.bank.conflict=true;await p.locator('#snote-payment-save').click();await p.waitForFunction(()=>document.getElementById('snote-payment-message').dataset.tone==='error');assert.equal(await p.locator('#snote-payment-vehicle-number').inputValue(),ACCOUNTS.vehicle.number);assert.equal(await p.evaluate(()=>SnotePaymentAccounts.ensureQuoteAccounts(()=>true)),'missing','A failed account save must not unlock quotations');f.bank.conflict=false;
 await save(p);await p.evaluate(()=>navigate('buy'));await quote(p);await assertAccounts(p,'#quote-paper',{vehicle:ACCOUNTS.vehicle,transfer:null});
 await p.evaluate(()=>{closeQuotePreview();navigate('settings');});await directSettings(p);assert.equal(await p.locator('#snote-payment-vehicle-number').inputValue(),ACCOUNTS.vehicle.number);
 await p.screenshot({path:path.join(OUT,'settings-account-'+width+'.png')});
 // Profile settings can expand/collapse without moving the independent account editor.
 await p.locator('#snote-settings-profile-details > summary').click();await p.waitForFunction(()=>document.getElementById('snote-settings-profile-details').open);assert.equal(await p.locator('#snote-settings-payment-body #snote-payment-profile').isVisible(),true);
 await p.locator('#snote-settings-profile-details > summary').click();await p.waitForFunction(()=>!document.getElementById('snote-settings-profile-details').open);assert.equal(await p.locator('#snote-settings-payment-body #snote-payment-profile').isVisible(),true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await finish(f);console.log('PASS '+width+' missing account quote OK → direct settings/focus, editable collapsed-profile card, unsaved/failed save stays gated, rerender/dirty navigation, one saved account unlocks quote');
}catch(error){await p.screenshot({path:path.join(OUT,'failure-settings-gate-'+width+'.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
async function quoteGateRaces(){
 for(const action of ['close','same-car-reopen','other-car','other-account']){const f=await setup(),p=f.page;try{
  f.bank.rows.set(ACTOR,row(ACTOR,ACCOUNTS,1));f.hold('snote_payment_accounts_read');await p.evaluate(()=>{window.__pendingQuoteGate=openQuotePreview();});await f.wait('snote_payment_accounts_read');
  if(action==='close')await p.evaluate(()=>closeVehicle({discard:true}));
  if(action==='same-car-reopen')await p.evaluate(async()=>{await closeVehicle({discard:true});openVehicle('encar-car-1');});
  if(action==='other-car')await p.evaluate(()=>{cars.push({...cars[0],id:'quote-gate-other',plate:'000가9999'});openVehicle('quote-gate-other');});
  if(action==='other-account')await changeActor(p,OTHER);
  f.release('snote_payment_accounts_read');await p.evaluate(()=>__pendingQuoteGate);assert.equal(await p.locator('#quote-overlay').evaluate(el=>el.classList.contains('open')),false,'A late quote lookup must not open a changed vehicle/account view');assert.equal(f.dialogs.length,0);await finish(f);
 }catch(error){await f.context.close().catch(()=>{});throw error;}}
 {
  const f=await setup(),p=f.page,initialRoute=await p.evaluate(()=>route);f.bank.failRead=true;await p.evaluate(()=>openQuotePreview());assert.equal(f.dialogs.length,0,'Read errors must not claim that an account is unregistered');assert.equal(await p.evaluate(()=>route),initialRoute);assert.equal(await p.locator('#quote-overlay').evaluate(el=>el.classList.contains('open')),false);assert.match(await p.locator('#toast').textContent(),/계좌|불러|확인/);await finish(f);
 }
 {
  const f=await setup(),p=f.page,initialRoute=await p.evaluate(()=>route);f.answerAlert(MISSING_ACCOUNT);f.answerConfirm(false,/작성 중인 내용/);
  await p.locator('#detail-extra').fill('저장하지 않은 차량 안내');await p.evaluate(()=>openQuotePreview());assert.equal(await p.evaluate(()=>route),initialRoute);assert.equal(await p.locator('#detail-extra').inputValue(),'저장하지 않은 차량 안내');assert.equal(await p.locator('#vehicle-overlay').evaluate(el=>el.classList.contains('open')),true,'Declining the existing unsaved vehicle dialog must preserve the original vehicle view');assert.equal(await p.locator('#quote-overlay').evaluate(el=>el.classList.contains('open')),false);await finish(f);
 }
 {
  const f=await setup(),p=f.page;f.answerAlert(MISSING_ACCOUNT);f.hold('snote_payment_accounts_read');await p.evaluate(()=>{window.__duplicateQuoteGate=Promise.all([openQuotePreview(),openQuotePreview()]);});await f.wait('snote_payment_accounts_read');f.release('snote_payment_accounts_read');await p.evaluate(()=>__duplicateQuoteGate);await directSettings(p);assert.equal(f.dialogs.length,1,'Repeated quote clicks must show only one missing-account alert');await finish(f);
 }
 console.log('PASS quote gate failed-read distinction, same-car reopen/close/vehicle/account stale response rejection and duplicate-click single alert');
}
async function administratorSettings(){const f=await setup(),p=f.page;try{
 f.bank.profileRole='admin';await p.evaluate(()=>{const S=__encarFixtureState;S.members.find(m=>m.user_id===S.user.id).role='admin';currentUser.role='admin';navigate('settings');});await directSettings(p);await fields(p,'vehicle',ACCOUNTS.vehicle);await fields(p,'transfer',ACCOUNTS.transfer);await save(p);await p.evaluate(()=>navigate('settings'));await directSettings(p);assert.equal(await p.locator('#snote-payment-transfer-number').inputValue(),ACCOUNTS.transfer.number);await finish(f);console.log('PASS administrator settings expose the same independent saved receiving-account card');
}catch(error){await p.screenshot({path:path.join(OUT,'failure-admin-settings.png')}).catch(()=>{});await f.context.close().catch(()=>{});throw error;}}
async function smallPrint(){const f=await setup(320),p=f.page;try{
 const longest={vehicle:{bank:'가'.repeat(35),number:'0'+'1'.repeat(31),holder:'나'.repeat(60)},transfer:{bank:'다'.repeat(35),number:'0'+'2'.repeat(31),holder:'라'.repeat(60)}};
 await profile(p);await fields(p,'vehicle',longest.vehicle);await fields(p,'transfer',longest.transfer);await save(p);assert.deepEqual(f.bank.rows.get(ACTOR).accounts,longest);await closeProfile(p);await quote(p);await assertAccounts(p,'#quote-paper',longest);await pdf(p,'quote','quote-320-max-fields',longest);await contract(p);await assertAccounts(p,'#contract-paper',longest);await pdf(p,'contract','contract-320-max-fields',longest);await finish(f);console.log('PASS 320px maximum-length saved bank/number/holder details remain complete in quotation and both contract A4 copies and clear the footer');
}catch(error){await f.context.close().catch(()=>{});throw error;}}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);try{if(SCENARIO!=='max'){for(const width of [1440,390])await settingsAndQuoteGate(width);await quoteGateRaces();await administratorSettings();}if(SCENARIO==='all'){for(const width of [1440,390])await surface(width);await races();}if(SCENARIO!=='gate')await smallPrint();fs.writeFileSync(path.join(OUT,'verification.json'),JSON.stringify({passed:true,scenario:SCENARIO,syntheticOnly:true,pdfs:results},null,2)+'\n');}finally{await browser.close();}})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
