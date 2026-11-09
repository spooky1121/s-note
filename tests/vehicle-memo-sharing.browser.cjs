'use strict';
// Real current app/editor/notifications + real tenant sharing SQL. Auth, vehicles,
// companies and all HTTP are synthetic; no Production data or messages are used.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const {createPermissionFixture:createMemoFixture,COMPANY,FOREIGN,OWNER,RECIPIENT,ID,originalMemo}=require('./vehicle-share-permissions-db.cjs');
const ART=process.env.VEHICLE_MEMO_SHARED_ARTIFACT_DIR||'/tmp/snote-vehicle-memo-shared';fs.mkdirSync(ART,{recursive:true});
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);
 try{for(const width of[1440,1024,390,320]){
  const sql=await createMemoFixture();let queue=Promise.resolve(),f;
  const serial=(actor,fn)=>{const task=queue.then(async()=>{await sql.actor(actor);return fn();});queue=task.catch(()=>{});return task;};
  const calls=[];
  try{
   const invitation=await serial(OWNER,()=>sql.call('grant',{email:RECIPIENT+'@example.invalid',permission:'edit'}));await serial(RECIPIENT,()=>sql.reply(invitation.invitationId,invitation.version));
   f=await fixture(width);const p=f.page;
   await p.exposeFunction('__memoActualRpc',(context,args)=>serial(context.userId,()=>{calls.push(structuredClone(args));return sql.call(args.p_action,{company:args.p_company,owner:args.p_owner,car:args.p_car,email:args.p_email,target:args.p_target,expected:args.p_expected,...(Object.hasOwn(args,'p_permission')?{permission:args.p_permission}:{}),...(Object.hasOwn(args,'p_access')?{access:args.p_access}:{}),...(Object.hasOwn(args,'p_patch')?{patch:args.p_patch}:{})});}));
   await p.exposeFunction('__memoActualNotifications',(context,args)=>serial(context.userId,()=>sql.notes(args.p_action,args.p_ids)));
   await p.evaluate(async({company,recipient,owner})=>{
    await closeVehicle({discard:true});const original=window.snoteVehicleShareBridge;
    window.__memoScope={key:'memo@recipient',companyId:company,userId:recipient};window.__memoSourceOwner=owner;
    window.snoteVehicleShareBridge={...original,context:()=>window.__memoScope,current:c=>!!c&&c.key===window.__memoScope?.key,
     async rpc(c,args){if(!this.current(c))throw Error('CONTEXT_CHANGED');const result=await __memoActualRpc(c,args);if(args.p_action==='update'&&window.__memoHold){window.__memoWaiting=true;await new Promise(resolve=>window.__memoRelease=resolve);}return result;},
     notification:(c,args)=>__memoActualNotifications(c,args),flush:async()=>{},file:async()=>{throw Error('NO_FIXTURE_MEDIA');}};
   },{company:FOREIGN,recipient:RECIPIENT,owner:OWNER});
   const dialog=p.locator('#snote-vehicle-sharing'),memo=dialog.getByLabel('차량 메모',{exact:true}),save=dialog.getByRole('button',{name:'공유 차량 저장',exact:true});
   async function open(){await p.locator('#vehicle-shared-inbox').click();await dialog.getByRole('button',{name:/업무 메모 차량/}).click();await memo.waitFor();}
   async function saved(){await dialog.getByText('공유 차량을 서버에 저장했습니다.',{exact:true}).waitFor();}
   async function readMemo(){return serial(OWNER,async()=>{const snapshot=await sql.state();return snapshot.payload.find(car=>car.id===ID).vehicleMemo;});}
   await open();assert.equal(await memo.inputValue(),originalMemo);assert.equal(await memo.getAttribute('maxlength'),'2000');assert.equal(await memo.evaluate(el=>el.tagName),'TEXTAREA');
   const actual='  점검 메모\r\n둘째 줄\r\t출고 <img src=x onerror=alert(1)>  ',normalized=actual.replace(/\r\n?/g,'\n');await memo.fill(actual);await save.click();await saved();assert.equal(await readMemo(),normalized);assert.equal(await memo.inputValue(),normalized);assert.equal(await dialog.locator('img[src=x]').count(),0);
   await dialog.getByRole('button',{name:'차량 공유 닫기'}).click();await open();assert.equal(await memo.inputValue(),normalized,'Server reopen preserves whitespace and line endings');
   await memo.fill('🚘'.repeat(1000));await save.click();await saved();assert.equal((await readMemo()).length,2000);
   const beforeInvalid=calls.filter(x=>x.p_action==='update').length;
   await memo.evaluate(el=>{el.value='가'.repeat(2001);el.dispatchEvent(new Event('input',{bubbles:true}));});await save.click();await dialog.getByText(/차량 메모는 제어문자 없이 2,000자/).waitFor();assert.equal(calls.filter(x=>x.p_action==='update').length,beforeInvalid);
   await memo.evaluate(el=>{el.value='잘못된\u0001메모';el.dispatchEvent(new Event('input',{bubbles:true}));});await save.click();await dialog.getByText(/차량 메모는 제어문자 없이 2,000자/).waitFor();assert.equal(calls.filter(x=>x.p_action==='update').length,beforeInvalid);
   await memo.fill('');await save.click();await saved();assert.equal(await readMemo(),'','Empty text clears the canonical note');
   await memo.fill('  먼저 저장\n  ');await p.evaluate(()=>{window.__memoHold=true;window.__memoWaiting=false;});await save.click();await p.waitForFunction(()=>window.__memoWaiting===true);await memo.fill('  저장 중 추가 입력\n유지  ');await p.evaluate(()=>{window.__memoHold=false;window.__memoRelease();});await dialog.getByText('저장 중 추가로 수정한 내용이 있습니다. 다시 저장해 주세요.').waitFor();assert.equal(await readMemo(),'  먼저 저장\n  ');assert.equal(await memo.inputValue(),'  저장 중 추가 입력\n유지  ');await save.click();await saved();assert.equal(await readMemo(),'  저장 중 추가 입력\n유지  ');
   await serial(OWNER,async()=>{const state=await sql.state();await sql.actor(OWNER);return sql.call('update',{expected:state.revision,patch:{vehicleMemo:'서버의 최신 메모'}});});
   await memo.fill('충돌해도 보존할 입력');await save.click();await dialog.getByText(/다른 딜러가 먼저 수정했습니다/).waitFor();assert.equal(await memo.inputValue(),'충돌해도 보존할 입력');f.answerConfirm(true,/현재 입력 대신 서버의 최신 정보를 불러올까요/);await dialog.getByRole('button',{name:'최신 정보 다시 불러오기'}).click();await p.waitForFunction(()=>document.querySelector('textarea[name=vehicleMemo]')?.value==='서버의 최신 메모');
   const geometry=await memo.evaluate(el=>{const r=el.getBoundingClientRect(),d=el.closest('dialog');return{font:parseFloat(getComputedStyle(el).fontSize),width:r.width,left:r.left,right:r.right,fieldColumn:getComputedStyle(el.parentElement).gridColumn,dialogOverflow:d.scrollWidth>d.clientWidth,documentOverflow:document.documentElement.scrollWidth>innerWidth};});assert.equal(geometry.dialogOverflow,false);assert.equal(geometry.documentOverflow,false);assert(geometry.left>=0&&geometry.right<=width);assert.equal(geometry.fieldColumn,'1 / -1');if(width<=760)assert(geometry.font>=16);
   await p.screenshot({path:ART+'/shared-editor-'+width+'.png'});await dialog.getByRole('button',{name:'차량 공유 닫기'}).click();
   await p.evaluate(({company,owner})=>{window.__memoScope={key:'memo@owner',companyId:company,userId:owner};window.dispatchEvent(new Event('snote-vehicle-changed'));void window.snoteOpenNotifications();},{company:COMPANY,owner:OWNER});
   const notifications=p.locator('#snote-notifications-dialog');await notifications.waitFor({state:'visible'});await notifications.locator('dt').filter({hasText:'차량 메모'}).first().waitFor();assert((await notifications.locator('dt').allTextContents()).includes('차량 메모'));assert.equal(await notifications.locator('img[src=x]').count(),0);assert.equal(await notifications.evaluate(el=>el.scrollWidth>el.clientWidth),false);await p.screenshot({path:ART+'/shared-notifications-'+width+'.png'});await notifications.getByRole('button',{name:'알림 닫기'}).click();
   await finish(f);f=null;console.log('PASS',width,'actual shared editor + SQL: persisted/reopened whitespace, CRLF, UTF16 boundary, controls, empty clear, late ACK edits, CAS conflict preservation, Korean notification label and escaped text');
  }finally{if(f)await f.context.close();await queue;await sql.db.close();}
 }}finally{await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
