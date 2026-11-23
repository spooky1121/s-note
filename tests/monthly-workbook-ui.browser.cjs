'use strict';

// Offline browser fixtures: every HTTP response is intercepted, with fake data only.
// Requires Playwright on NODE_PATH (or a local installation) and Chromium.
// Run from any directory:
//   NODE_PATH="$(npm root -g)" CHROMIUM_PATH=/usr/bin/chromium node tests/monthly-workbook-ui.browser.cjs
// CHROMIUM_PATH is optional when Playwright's bundled Chromium is installed.
// Optional SNOTE_UI_OUTPUT_DIR selects the directory for two preview screenshots.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const outputDir=process.env.SNOTE_UI_OUTPUT_DIR||path.join(os.tmpdir(),'snote-monthly-workbook-ui');
fs.mkdirSync(outputDir,{recursive:true});
const executablePath=process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
const fixtureScript=`import {createBook,fingerprint,mergeMonth} from '/assets/monthly-workbook-model.js?v=2.16';
const inventoryFinance={key:'company-a:user-a:finance-1',ready:true,companyId:'company-a',limit:900000000,used:250000000,remaining:650000000};
const context={key:'company-a:user-a:frame-1',companyId:'company-a',userId:'user-a',companyName:'가상 상사',canEdit:true,mode:'cloud'};
let payload=[],versions={};const prior=createBook('2026-10');prior.opening={mode:'manual',amount:0};prior.dealers[0].buyFee=100000;prior.expenses[0].amount=5000;payload.push(prior);const current=createBook('2026-11');Object.assign(current.finance[0],{label:'과거 금융 기록',limit:777,used:333,rate:2.5});payload.push(current);versions[current.month]=await fingerprint(current);versions[prior.month]=await fingerprint(prior);payload.push({id:'legacy-fixture',date:'2026-11-03',kind:'out',category:'일반운영비',item:'가상 임차료',amount:500,account:'예시계좌',counterparty:'가상 거래처',memo:''});
const frame=document.createElement('iframe');frame.id='monthly';frame.src='/monthly.html?v=2.16';frame.style.cssText='display:block;width:100%;height:3000px;border:0';
const api=window.TEST={heightMessages:[],heightProtocol:'current',saves:[],loads:[],autoAck:false,holdLoad:false,frame,context,finance:inventoryFinance,sendFinance(value=this.finance,contextKey=context.key){frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_FINANCE',contextKey,inventoryFinance:value},location.origin)},async ack(index){const save=this.saves[index],book=structuredClone(save.book);book.updatedAt='2026-11-01T12:00:00Z';book.writeId=save.requestId;payload=mergeMonth(payload,book);versions[book.month]=await fingerprint(book);frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESULT',contextKey:save.contextKey,requestId:save.requestId,clientSeq:save.clientSeq,month:save.month,state:'saved',book,baseVersion:versions[book.month]},location.origin);},conflict(index){const s=this.saves[index];frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESULT',contextKey:s.contextKey,requestId:s.requestId,clientSeq:s.clientSeq,month:s.month,state:'conflict',remoteBook:payload.find(book=>book.month===s.month),baseVersion:versions[s.month]},location.origin)},error(index,code='NETWORK'){const s=this.saves[index];frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESULT',contextKey:s.contextKey,requestId:s.requestId,clientSeq:s.clientSeq,month:s.month,state:'error',code,message:'가상 네트워크 오류'},location.origin)},sync(index,override){const l=this.loads[index];frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_SYNC',contextKey:context.key,requestId:l.requestId,state:'saved',payload:override??payload,versions,inventoryFinance:this.finance},location.origin)}};
window.addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!==location.origin)return;const d=e.data;if(d.type==='SNOTE_MONTHLY_WORKBOOK_READY')frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_INIT',context,payload,versions,inventoryFinance:api.finance},location.origin);if(['SNOTE_MONTHLY_HEIGHT','ZEROCAR_MONTHLY_HEIGHT'].includes(d.type))api.heightMessages.push({type:d.type,height:d.height});if(api.heightProtocol==='legacy'?d.type==='ZEROCAR_MONTHLY_HEIGHT':d.type==='SNOTE_MONTHLY_HEIGHT')frame.style.height=Math.max(650,d.height+16)+'px';if(d.type==='SNOTE_MONTHLY_WORKBOOK_SAVE'){api.saves.push(d);if(api.autoAck)await api.ack(api.saves.length-1);}if(d.type==='SNOTE_MONTHLY_WORKBOOK_LOAD'){api.loads.push(d);if(!api.holdLoad)api.sync(api.loads.length-1);}});document.body.append(frame);`;
let browser;
async function fixture(width=1440,reduce=false){const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:reduce?'reduce':'no-preference'}),p=await context.newPage(),errors=[],external=[];p.on('pageerror',e=>errors.push(e.message));await context.addInitScript(()=>{window.__monthlyPopups=[];window.__manualMessages=false;window.addEventListener('snote:message-open',event=>{window.__monthlyPopups.push(event.detail);if(!window.__manualMessages)document.querySelector('#snote-message-dialog[open] [data-message-accept]')?.click();});});await p.clock.install({time:new Date('2026-11-01T12:00:00Z')});await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='https://monthly.test'){external.push(u.href);return route.abort();}if(u.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/assets/message-popup.css"><script src="/assets/message-popup.js" defer></script><script type="module" src="/fixture.js"></script></head><body style="margin:0"></body></html>'});if(u.pathname==='/fixture.js')return route.fulfill({contentType:'application/javascript',body:fixtureScript});const file=u.pathname==='/monthly.html'?'monthly.html':u.pathname.slice(1);if(!/^assets\/(?:(?:mobile-popup-history|message-popup|close-controls|readable-type|action-controls|icon-sizing|mobile-documents|screen-refinement|icon-feedback|number-format|monthly-workbook(?:-model|-print)?)\.(?:js|css)|popup-controls\.(?:js|css)|service-location\.js|reference-theme\.css|fonts\/[a-z-]+\.woff2)$/.test(file)&&file!=='monthly.html')return route.abort();return route.fulfill({contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'application/javascript',body:fs.readFileSync(path.join(root,file))});});await p.goto('https://monthly.test/fixture');await p.waitForFunction(()=>document.querySelector('#monthly')?.contentWindow?.document.querySelector('#book-fields')?.disabled===false);const frame=p.frames().find(f=>f.url().includes('/monthly.html'));return {context,p,frame,errors,external};}
async function settle(f){await f.p.clock.fastForward(500);await f.p.waitForTimeout(30);}
async function finish(f){assert.deepEqual(f.errors,[]);assert.deepEqual(f.external,[]);await f.context.close();}
async function paste(input,text){await input.evaluate((el,text)=>{const data=new DataTransfer();data.setData('text/plain',text);el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));},text);}
async function selectMonth(frame,month){await frame.locator('#month-input').fill(month);await frame.locator('#month-input').dispatchEvent('change');}
async function templateDecision(f,month='2026-10'){
 await f.frame.locator('#new-template').click();await f.frame.locator('#template-dialog[open]').waitFor();
 await f.frame.locator('#template-month').fill(month);await f.frame.locator('#create-template').click();
 const confirm=f.p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await confirm.waitFor();
 assert.match(await confirm.locator('#snote-message-copy').textContent(),/작성한 자료가 있습니다/);
 assert.equal(await f.frame.locator('#snote-message-dialog').count(),0,'The actual parent SnoteMessages must own the decision');
 assert.equal(await f.p.evaluate(()=>typeof SnoteMessages.confirm),'function');return confirm;
}
(async()=>{browser=await chromium.launch({executablePath,headless:true});try{
 // Exercise the actual child emitter with both a current and an already-open
 // legacy parent. The transport must remain same-origin and source-pinned.
 {
 const f=await fixture(),{p,frame}=f;await settle(f);
 const first=await p.evaluate(()=>TEST.heightMessages);
 assert(first.some(message=>message.type==='SNOTE_MONTHLY_HEIGHT'&&Number.isFinite(message.height)&&message.height>0));
 assert(first.some(message=>message.type==='ZEROCAR_MONTHLY_HEIGHT'),'Already-open parent tabs retain a height update alias');
 await p.evaluate(()=>{TEST.heightProtocol='legacy';TEST.heightMessages=[];TEST.frame.style.height='333px';const spacer=document.createElement('div');spacer.id='height-protocol-spacer';spacer.style.height='150px';TEST.frame.contentWindow.document.getElementById('monthly-shell').append(spacer);});await settle(f);
 await p.waitForFunction(()=>TEST.heightMessages.some(message=>message.type==='ZEROCAR_MONTHLY_HEIGHT'));
 assert.equal(await p.evaluate(()=>TEST.frame.style.height),await p.evaluate(()=>Math.max(650,TEST.heightMessages.filter(message=>message.type==='ZEROCAR_MONTHLY_HEIGHT').at(-1).height+16)+'px'));
 await finish(f);console.log('PASS current SNOTE height protocol and explicit cached-parent alias preserve automatic iframe sizing');
 }

 {
 const f=await fixture(),{p,frame}=f;const name=frame.locator('#dealer-body tr').first().locator('[data-field=name]'),fee=frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]');await name.fill('가상 담당자');await fee.fill('123');await fee.press('End');await fee.type('45');assert.equal(await fee.inputValue(),'12,345');assert.equal(await fee.evaluate(e=>e===document.activeElement),true);assert.equal(await frame.locator('[data-total=income]').first().textContent(),'12,345');await settle(f);assert.equal(await p.evaluate(()=>TEST.saves.length),1);await fee.type('6');assert.equal(await fee.inputValue(),'123,456');await p.evaluate(()=>TEST.ack(0));await p.waitForTimeout(30);assert.equal(await fee.inputValue(),'123,456');assert.equal(await fee.evaluate(e=>e===document.activeElement),true);assert.notEqual(await frame.locator('#save-status').textContent(),'서버 저장 완료');await settle(f);assert.equal(await p.evaluate(()=>TEST.saves.length),2);await p.evaluate(()=>TEST.ack(1));await frame.locator('#save-status[data-state=saved]').waitFor();assert.equal(await fee.inputValue(),'123,456');assert.equal(await p.evaluate(()=>window.__monthlyPopups.length),0,'Typing and autosave acknowledgements must not produce popups');
 await frame.locator('#expense-body tr').first().locator('[data-field=amount]').fill('500');await settle(f);await p.evaluate(()=>TEST.ack(2));await frame.locator('#save-status[data-state=saved]').waitFor();assert.equal(await frame.locator('[data-total=operatingNet]').first().textContent(),'122,956');assert.equal(await frame.locator('[data-total=closing]').first().textContent(),'217,956');
 await frame.locator('#legacy-section summary').click();assert((await frame.locator('#legacy-content').textContent()).includes('가상 임차료'));assert((await frame.locator('#legacy-content').textContent()).includes('지출'));assert((await frame.locator('#legacy-content').textContent()).includes('예시계좌'));assert((await frame.locator('#legacy-content').textContent()).includes('가상 거래처'));
 await frame.evaluate(()=>{window.print=()=>window.__printed=document.querySelector('#print-snapshot').textContent;});await frame.locator('#print-button').click();await p.waitForTimeout(70);assert((await frame.evaluate(()=>window.__printed)).includes('217,956'));assert((await frame.evaluate(()=>window.__printed)).includes('가상 담당자'));assert.equal(await frame.locator('#print-snapshot input').count(),0);
 const download=p.waitForEvent('download');await frame.locator('#csv-button').click();const file=await (await download).path(),bytes=fs.readFileSync(file);assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert(bytes.toString().includes('가상 담당자'));
 await frame.locator('#legacy-section summary').click();await p.screenshot({path:path.join(outputDir,'monthly-workbook-1440.png'),fullPage:true});assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await finish(f);console.log('PASS 1440 real iframe typing focus/caret, edit during ACK, confirmed-only saved badge, previous-month carry, legacy fields, all-text print and BOM CSV');
 }
 {
 const f=await fixture(320),{p,frame}=f;
 const values=()=>frame.locator('.finance-summary output').allTextContents();
 assert.deepEqual(await values(),['900,000,000','250,000,000','650,000,000']);
 assert.equal(await frame.locator('.finance-panel input,.finance-panel button').count(),0);
 assert.equal(await frame.locator('#save-status').isVisible(),false);assert.equal(await frame.locator('#footer-status').isVisible(),false);
 assert.equal(await p.evaluate(()=>TEST.saves.length),0,'Opening current finance must not autosave a historical workbook');
 await p.evaluate(()=>TEST.sendFinance({...TEST.finance,limit:1,used:0,remaining:1},'stale-workbook-key'));await p.waitForTimeout(25);
 assert.deepEqual(await values(),['900,000,000','250,000,000','650,000,000']);
 await p.evaluate(()=>TEST.sendFinance({...TEST.finance,companyId:'other-company',limit:1,used:0,remaining:1}));await p.waitForTimeout(25);
 assert.deepEqual(await values(),['900,000,000','250,000,000','650,000,000']);
 await frame.evaluate(()=>window.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_FINANCE',contextKey:'company-a:user-a:frame-1',inventoryFinance:{key:'forged',companyId:'company-a',ready:true,limit:1,used:0,remaining:1}},location.origin));await p.waitForTimeout(25);
 assert.deepEqual(await values(),['900,000,000','250,000,000','650,000,000'],'Only the actual parent may deliver finance');
 await p.evaluate(()=>TEST.sendFinance({...TEST.finance,ready:false}));await p.waitForTimeout(25);assert.deepEqual(await values(),['—','—','—']);assert.equal(await frame.locator('#finance-status').getAttribute('data-state'),'loading');
 await p.evaluate(()=>TEST.sendFinance({...TEST.finance,remaining:123}));await p.waitForTimeout(25);assert.deepEqual(await values(),['—','—','—']);assert.equal(await frame.locator('#finance-status').getAttribute('data-state'),'error');
 await p.evaluate(()=>{TEST.finance={...TEST.finance,key:'company-a:user-a:finance-2',limit:400000000,used:450000000,remaining:-50000000};TEST.sendFinance()});await p.waitForTimeout(25);
 assert.deepEqual(await values(),['400,000,000','450,000,000','-50,000,000']);assert.equal(await p.evaluate(()=>TEST.saves.length),0);
 await frame.locator('#month-input').fill('2026-10');await frame.locator('#month-input').dispatchEvent('change');assert.deepEqual(await values(),['400,000,000','450,000,000','-50,000,000']);
 await frame.locator('#month-input').fill('2026-11');await frame.locator('#month-input').dispatchEvent('change');
 await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').fill('5000');await settle(f);
 assert.deepEqual(await p.evaluate(()=>TEST.saves[0].book.finance[0]),{id:'finance-1',label:'과거 금융 기록',limit:777,used:333,rate:2.5},'Saving another field must preserve original finance history');
 await p.evaluate(()=>TEST.ack(0));await frame.locator('#save-status[data-state=saved]').waitFor();assert.equal(await frame.locator('#save-status').isVisible(),true);
 await frame.evaluate(()=>{window.print=()=>window.__printed=document.querySelector('#print-snapshot').textContent});await frame.locator('#print-button').click();await p.waitForTimeout(70);
 const printed=await frame.evaluate(()=>window.__printed);assert(printed.includes('현재 등록 기준'));assert(printed.includes('400,000,000'));assert(!printed.includes('과거 금융 기록'));
 const download=p.waitForEvent('download');await frame.locator('#csv-button').click();const csv=fs.readFileSync(await (await download).path(),'utf8');assert(csv.includes('400000000'));assert(csv.includes('현재 등록 금융사 합계'));assert(!csv.includes('과거 금융 기록'));
 await frame.locator('#expense-body tr').first().locator('[data-field=amount]').fill('잘못된 입력');assert.deepEqual(await values(),['400,000,000','450,000,000','-50,000,000'],'Independent live finance stays visible when another input is invalid');
 await frame.locator('.finance-panel').screenshot({path:path.join(outputDir,'monthly-finance-live-320.png')});
 await p.evaluate(()=>{const key='snote.monthly-workbook.v1:cloud:company-a:user-a:2026-11',draft=JSON.parse(localStorage.getItem(key));draft.rawInputs.push({key:JSON.stringify(['finance','finance-1','limit']),raw:'이전 금융 입력 오류'});localStorage.setItem(key,JSON.stringify(draft));TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESET'},location.origin)});await p.clock.fastForward(1100);await frame.locator('#draft-banner').waitFor({state:'visible'});await frame.locator('#recover-draft').click();assert.equal(await frame.locator('#expense-body [aria-invalid=true]').count(),1,'Other draft validation errors remain editable');await frame.locator('#expense-body tr').first().locator('[data-field=amount]').fill('100');await settle(f);assert.equal(await p.evaluate(()=>TEST.saves.length),2,'Old hidden finance raw errors cannot trap recovered workbooks');assert.equal(await p.evaluate(()=>TEST.saves[1].book.finance[0].limit),777);await p.evaluate(()=>TEST.ack(1));await frame.locator('#save-status[data-state=saved]').waitFor();
 await p.evaluate(()=>{TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESET'},location.origin);TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_INIT',context:{...TEST.context,key:'company-b:user-a:frame-2',companyId:'company-b'},payload:[],versions:{},inventoryFinance:{key:'company-b:finance',companyId:'company-b',ready:false}},location.origin);TEST.sendFinance()});await p.waitForTimeout(25);assert.deepEqual(await values(),['—','—','—'],'Account/company changes immediately clear the preceding aggregate');
 await p.evaluate(()=>TEST.sendFinance({key:'company-b:finance',companyId:'company-b',ready:true,limit:0,used:0,remaining:0},'company-b:user-a:frame-2'));await p.waitForTimeout(25);assert.deepEqual(await values(),['0','0','0']);
 assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await frame.locator('.finance-panel').screenshot({path:path.join(outputDir,'monthly-finance-320.png')});await finish(f);console.log('PASS 320 current scoped finance matches parent; read-only/large-source separation, stale/source/company/error guards, no implicit historical writes, live print/CSV');
 }
 {
 const f=await fixture(390,true),{p,frame}=f;const name=frame.locator('#dealer-body tr').first().locator('[data-field=name]');await paste(name,'가상 A\t1대\t2\t1,000\t2,000\t300\n가상 B\t3\t4\t4,000\t5,000\t600');assert.equal(await frame.locator('[data-total=income]').first().textContent(),'12,900');assert.equal(await frame.locator('[data-total=buyCount]').textContent(),'4');const before=await frame.locator('#dealer-body input').evaluateAll(es=>es.map(e=>e.value));await paste(name,'바뀌면안됨\t1\t2\t잘못된숫자\t200\t300');assert.deepEqual(await frame.locator('#dealer-body input').evaluateAll(es=>es.map(e=>e.value)),before);assert((await frame.locator('#message').textContent()).includes('붙여넣지 않았습니다'));
 await paste(name,'가상 C\t\t5\t6\t100\t200\t300\t600');assert.equal(await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').inputValue(),'100');assert.equal(await frame.locator('[data-total=income]').first().textContent(),'10,200');
 await paste(frame.locator('#expense-body tr').first().locator('[data-field=label]'),'임차료\t500\n관리비\t100');assert.equal(await frame.locator('[data-total=expense]').first().textContent(),'600');
 await frame.locator('[data-add=dealers]').click();assert.equal(await frame.locator('#dealer-body tr').count(),10);assert.equal(await frame.locator('#dealer-body tr').last().evaluate(e=>getComputedStyle(e).animationName),'none');await frame.locator('#dealer-body tr').last().locator('[data-delete]').click();assert.equal(await frame.locator('#dealer-body tr').count(),9);await frame.locator('#undo-delete').click();assert.equal(await frame.locator('#dealer-body tr').count(),10);
 assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await name.evaluate(e=>getComputedStyle(e).fontSize),'18px');assert.equal(await frame.locator('#reference-button,#reference-dialog,#reload-button').count(),0);await p.evaluate(async()=>{TEST.autoAck=true;for(let i=0;i<TEST.saves.length;i++)await TEST.ack(i);});await settle(f);await frame.locator('#save-status[data-state=saved]').waitFor();await p.screenshot({path:path.join(outputDir,'monthly-workbook-390.png'),fullPage:true});await finish(f);console.log('PASS 390 atomic TSV/smart Excel B:I mapping/expense paste, add-delete-undo, 18px input, no body overflow, reduced motion and simplified toolbar');
 }
 {
 const f=await fixture(),{p,frame}=f;const fee=frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]');await fee.fill('100');await settle(f);await p.evaluate(()=>TEST.error(0));await fee.fill('200');await settle(f);assert.equal(await p.evaluate(()=>TEST.saves.length),1);await frame.locator('#save-now').click();await p.waitForTimeout(20);assert.equal(await p.evaluate(()=>TEST.saves.length),2);assert.deepEqual(await p.evaluate(()=>TEST.saves[0].book),await p.evaluate(()=>TEST.saves[1].book));assert.equal(await p.evaluate(()=>TEST.saves[0].requestId),await p.evaluate(()=>TEST.saves[1].requestId));await p.evaluate(()=>TEST.ack(1));await settle(f);assert.equal(await p.evaluate(()=>TEST.saves.length),3);assert.equal(await p.evaluate(()=>TEST.saves[2].book.dealers[0].buyFee),200);await p.evaluate(()=>TEST.ack(2));await frame.locator('#save-status[data-state=saved]').waitFor();await finish(f);console.log('PASS unknown save error retries exact request/snapshot before latest edits');
 }
 {
 const f=await fixture(),{p,frame}=f,fee=frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]');await fee.fill('100');await settle(f);await p.evaluate(()=>TEST.ack(0));await frame.locator('#save-status[data-state=saved]').waitFor();await fee.fill('200');await settle(f);await p.evaluate(()=>TEST.conflict(1));await frame.locator('#conflict-banner').waitFor({state:'visible'});await p.evaluate(()=>window.__manualMessages=true);const loads=await p.evaluate(()=>TEST.loads.length);await frame.locator('#read-server').click();const confirm=p.locator('#snote-message-dialog[open][data-message-kind="confirm"]');await confirm.waitFor();assert.match(await confirm.locator('#snote-message-copy').textContent(),/현재 작성본 대신/);assert.equal(await frame.locator('#snote-message-dialog').count(),0);await confirm.locator('[data-message-cancel]').click();assert.equal(await fee.inputValue(),'200');assert.equal(await p.evaluate(()=>TEST.loads.length),loads,'Cancelled server reload must not request or overwrite data');
 await frame.locator('#read-server').click();await confirm.waitFor();await fee.evaluate(el=>{el.value='250';el.dispatchEvent(new Event('input',{bubbles:true}));});await p.clock.fastForward(120);await confirm.waitFor({state:'hidden'});assert.equal(await fee.inputValue(),'250');assert.equal(await p.evaluate(()=>TEST.loads.length),loads,'Stale reload confirmation must preserve newer input');
 await frame.locator('#read-server').click();await confirm.waitFor();await p.evaluate(()=>{TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESET'},location.origin);TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_INIT',context:{...TEST.context,key:'company-b:user-a:new-frame',companyId:'company-b'},payload:[],versions:{},inventoryFinance:{key:'company-b:finance',companyId:'company-b',ready:false}},location.origin);});await p.waitForTimeout(30);await p.clock.fastForward(120);await confirm.waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>TEST.loads.length),loads,'Context replacement must cancel an old pending decision');assert.equal(await fee.inputValue(),'');await finish(f);console.log('PASS shared parent dirty/reload decisions preserve cancel/newer input and invalidate previous company context');
 }
 for(const width of [1440,390]){
 const f=await fixture(width),{p,frame}=f;
 await frame.locator('#dealer-body tr').first().locator('[data-field=name]').fill('가상 원본 담당자');
 await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').fill('123');
 await frame.locator('#expense-body tr').first().locator('[data-field=label]').fill('가상 운영 분류');
 await frame.locator('#expense-body tr').first().locator('[data-field=amount]').fill('77');
 await frame.locator('#adjustment-body tr').first().locator('[data-field=label]').fill('가상 현금 분류');
 await frame.locator('#adjustment-body tr').first().locator('[data-field=amount]').fill('5');
 await frame.locator('#account-body tr').first().locator('[data-field=label]').fill('가상 계좌 분류');
 await frame.locator('#account-body tr').first().locator('[data-field=balance]').fill('88');
 await frame.locator('#receivable-body tr').first().locator('[data-field=label]').fill('가상 이전 고객');
 await frame.locator('#receivable-body tr').first().locator('[data-field=amount]').fill('99');
 await frame.locator('#receivable-body tr').first().locator('[data-field=note]').fill('원본 보조 메모');
 await frame.locator('#month-note').fill('원본 월 메모');await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),1);
 assert.equal(await p.evaluate(()=>TEST.saves[0].book.dealers.length),9);
 // A confirmed older snapshot must not erase a row added while its ACK was pending.
 await frame.locator('[data-add=dealers]').click();
 await frame.locator('#dealer-body tr').last().locator('[data-field=name]').fill('가상 추가 담당자');
 await p.evaluate(()=>TEST.ack(0));await p.waitForTimeout(30);
 assert.equal(await frame.locator('#dealer-body tr').count(),10);
 assert.equal(await frame.locator('#dealer-body tr').last().locator('[data-field=name]').inputValue(),'가상 추가 담당자');
 assert.notEqual(await frame.locator('#save-status').getAttribute('data-state'),'saved');await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),2);
 const source=await p.evaluate(()=>TEST.saves[1].book);
 assert.equal(source.dealers.length,10);assert.equal(source.dealers[9].name,'가상 추가 담당자');
 await p.evaluate(()=>TEST.ack(1));await frame.locator('#save-status[data-state=saved]').waitFor();
 await frame.locator('#new-template').click();await frame.locator('#template-month').fill('2026-12');
 await frame.locator('#create-template').click();await frame.locator('#template-dialog').waitFor({state:'hidden'});await settle(f);
 assert.equal(await frame.locator('#month-input').inputValue(),'2026-12');
 assert.equal(await p.evaluate(()=>TEST.saves.length),3);
 const next=await p.evaluate(()=>TEST.saves[2].book);
 for(const group of ['dealers','expenses','adjustments','accounts','finance','receivables'])assert.equal(next[group].length,source[group].length,'New template preserves '+group+' row count');
 for(const group of ['expenses','adjustments','accounts','finance'])assert.deepEqual(next[group].map(row=>row.label),source[group].map(row=>row.label),'New template preserves '+group+' classification');
 for(const row of next.dealers)assert.deepEqual([row.name,row.buyCount,row.sellCount,row.buyFee,row.sellFee,row.yardFee],['',null,null,null,null,null]);
 for(const group of ['expenses','adjustments'])assert(next[group].every(row=>row.amount===null));
 assert(next.accounts.every(row=>row.balance===null));assert(next.finance.every(row=>row.limit===null&&row.used===null&&row.rate===null));
 assert(next.receivables.every(row=>row.label===''&&row.amount===null&&row.note===''));
 assert.equal(next.note,'');assert.deepEqual(next.opening,{mode:'auto',amount:null});
 await p.evaluate(()=>TEST.ack(2));await frame.locator('#save-status[data-state=saved]').waitFor();
 await selectMonth(frame,'2026-11');assert.equal(await frame.locator('#dealer-body tr').count(),10);
 assert.equal(await frame.locator('#dealer-body tr').first().locator('[data-field=name]').inputValue(),'가상 원본 담당자');
 assert.equal(await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').inputValue(),'123');
 assert.equal(await frame.locator('#month-note').inputValue(),'원본 월 메모');
 await finish(f);console.log('PASS '+width+' pending ACK retains a new row; new template carries row counts/classifications and clears amounts, names and notes without changing its source');
 }
 for(const width of [1440,390]){
 const f=await fixture(width),{p,frame}=f,fee=frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]');
 await p.evaluate(()=>window.__manualMessages=true);
 let confirm=await templateDecision(f);await confirm.locator('[data-message-cancel]').click();
 assert.equal(await frame.locator('#month-input').inputValue(),'2026-11');assert.equal(await fee.inputValue(),'');
 assert.equal(await p.evaluate(()=>TEST.saves.length),0,'Cancelled replacement must not save either month');
 // The source stays editable by another event while the real parent decision is open.
 await frame.locator('#template-dialog [data-close]').last().click();confirm=await templateDecision(f);
 await fee.evaluate(el=>{el.value='250';el.dispatchEvent(new Event('input',{bubbles:true}));});
 await p.clock.fastForward(120);await confirm.waitFor({state:'hidden'});
 assert.equal(await frame.locator('#month-input').inputValue(),'2026-11');assert.equal(await fee.inputValue(),'250');
 await frame.locator('#template-dialog [data-close]').last().click();await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),1);
 assert.equal(await p.evaluate(()=>TEST.saves[0].month),'2026-11');await p.evaluate(()=>TEST.ack(0));
 await frame.locator('#save-status[data-state=saved]').waitFor();
 confirm=await templateDecision(f);
 // Change the intended target while approval is pending, without selecting another book.
 await frame.locator('#template-month').evaluate(el=>{el.value='2026-09';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.clock.fastForward(120);await confirm.waitFor({state:'hidden'});
 assert.equal(await frame.locator('#month-input').inputValue(),'2026-11');assert.equal(await fee.inputValue(),'250');
 await frame.locator('#template-dialog [data-close]').last().click();await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),1,'Stale source/target approvals cannot create a replacement write');
 await selectMonth(frame,'2026-10');assert.equal(await fee.inputValue(),'100,000');
 assert.equal(await frame.locator('#expense-body tr').first().locator('[data-field=amount]').inputValue(),'5,000');
 await selectMonth(frame,'2026-09');assert.equal(await fee.inputValue(),'');await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),1,'Neither the original target nor changed target may be replaced by a stale confirmation');
 await finish(f);console.log('PASS '+width+' actual parent template confirmation preserves cancellation and rejects source edits or target changes while approval is pending');
 }
 {
 const f=await fixture(390),{p,frame}=f;await p.evaluate(()=>window.__manualMessages=true);
 const confirm=await templateDecision(f);const savesBefore=await p.evaluate(()=>TEST.saves.length);
 await p.evaluate(()=>{
  TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_RESET'},location.origin);
  TEST.frame.contentWindow.postMessage({type:'SNOTE_MONTHLY_WORKBOOK_INIT',context:{...TEST.context,key:'company-a:user-b:new-frame',userId:'user-b'},payload:[],versions:{},inventoryFinance:{...TEST.finance,key:'company-a:user-b:finance-1'}},location.origin);
 });
 await p.clock.fastForward(120);await confirm.waitFor({state:'hidden'});
 await frame.locator('#template-dialog').waitFor({state:'hidden'});
 assert.equal(await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').inputValue(),'');
 assert.equal(await frame.locator('#book-fields').evaluate(el=>el.disabled),false);
 // A late activation of the previous parent's button cannot approve the abandoned request.
 await p.locator('#snote-message-dialog [data-message-accept]').evaluate(el=>el.click());await settle(f);
 assert.equal(await p.evaluate(()=>TEST.saves.length),savesBefore);
 assert.equal(await frame.locator('#month-input').inputValue(),'2026-11');
 await selectMonth(frame,'2026-10');assert.equal(await frame.locator('#dealer-body tr').first().locator('[data-field=buyFee]').inputValue(),'');
 assert.equal(await p.evaluate(()=>TEST.saves.length),savesBefore);
 await finish(f);console.log('PASS 390 account context replacement dismisses the actual parent template confirmation and a late approval cannot copy or save the previous actor\'s workbook');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
