'use strict';
// Actual settings DOM and icon upgraders with isolated fixture auth/data.
const assert=require('node:assert/strict');
const {chromium}=require('./encar/node_modules/playwright');
const {fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');

(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium'});setBrowser(browser);
 try{for(const width of[1440,390,320]){
  const f=await fixture(width),p=f.page;
  await p.evaluate(()=>{
   closeVehicle({discard:true});const S=window.__encarFixtureState;currentUser.role='admin';S.members[0].role='admin';
   S.members.push({user_id:'22222222-2222-4222-8222-222222222222',company_id:S.company.id,role:'dealer',display_name:'검증 직원',active:true},{user_id:'33333333-3333-4333-8333-333333333333',company_id:S.company.id,role:'accountant',display_name:'검증 경리',active:true});
   const from=S.client.from.bind(S.client);S.client.from=table=>{
    if(!['zc_companies','zc_members'].includes(table))return from(table);
    let single=false;const filters={};const chain={select(){return chain},eq(k,v){filters[k]=v;return chain},order(){return chain},single(){single=true;return chain},maybeSingle(){single=true;return chain},then(resolve,reject){const rows=table==='zc_companies'?[{...S.company,business_number:'1234567890',representative_name:'가상 대표',business_address:'가상 도로',business_phone:'0212345678'}]:S.members.filter(m=>!filters.user_id||m.user_id===filters.user_id);return Promise.resolve({data:single?rows[0]:rows,error:null}).then(resolve,reject);}};return chain;
   };
   const rpc=S.client.rpc.bind(S.client);S.client.rpc=async(name,args)=>name==='snote_vehicle_notifications'?{data:{items:[],unread:0},error:null}:rpc(name,args);
   navigate('settings');
  });
  await p.locator('#snote90-members .snote90-member').nth(2).waitFor();
  await p.waitForFunction(()=>[...document.querySelectorAll('.snote90-member button')].every(e=>e.classList.contains('snote-settings-icon')&&e.querySelector('svg')));
  await p.waitForFunction(()=>[...document.querySelectorAll('.snote90-member button svg')].every(e=>e.classList.contains('snote-sized-action-glyph')));
  await p.mouse.move(0,0);
  const rows=await p.locator('.snote90-member').evaluateAll(elements=>elements.map(row=>{
   const rect=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,cx:b.x+b.width/2,cy:b.y+b.height/2,right:b.right};};
   return{row:rect(row),controls:[...row.querySelectorAll('input,:scope>span,button')].map(rect),icons:[...row.querySelectorAll('button svg')].map(svg=>{const r=rect(svg),b=svg.getBBox(),v=svg.viewBox.baseVal,sw=parseFloat(getComputedStyle(svg).strokeWidth)||0,unit=Math.min(r.width/v.width,r.height/v.height);return{...r,inkWidth:(b.width+sw)*unit,inkHeight:(b.height+sw)*unit};}),labels:[...row.querySelectorAll('button')].map(e=>e.getAttribute('aria-label'))};
  }));
  assert.equal(rows.length,3);
  for(const row of rows){
   assert.equal(row.controls.length,4);
   const [input,role,save,remove]=row.controls;
   for(const control of row.controls){assert(Math.abs(control.cy-input.cy)<.6,'Name, role, save and delete must share the input center: '+JSON.stringify({width,row}));assert(Math.abs(control.height-input.height)<.6,'All staff controls must use the same height');assert(control.x>=row.row.x-.6&&control.right<=row.row.right+.6,'Staff controls must fit their row');}
   assert(save.x>=role.right+5&&remove.x>=save.right+5,'Staff actions must have consistent visible gaps');
   assert.equal(row.icons.length,2);row.icons.forEach((icon,i)=>{const button=row.controls[i+2];assert(Math.abs(icon.cx-button.cx)<.6&&Math.abs(icon.cy-button.cy)<.6,'Each glyph must be centered in its action');assert(Math.abs(Math.max(icon.inkWidth,icon.inkHeight)-20)<.3,'Staff drawings must match the20px customer-management reference');});
  }
  for(const row of rows.slice(1))for(let i=0;i<4;i++){assert(Math.abs(row.controls[i].x-rows[0].controls[i].x)<.6,'Staff columns must align across roles');assert(Math.abs(row.controls[i].width-rows[0].controls[i].width)<.6,'Staff columns must keep matching widths across roles');}
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.locator('.snote-settings-staff').screenshot({path:'/tmp/snote-v271-staff-'+width+'.png'});
  await finish(f);console.log('PASS',width,'staff name/role/save/delete centers, matching heights, centered icons, consistent gaps and no overflow');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
