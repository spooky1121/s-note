'use strict';
// Actual application hydration and settings paths; all replies and accounts are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('./encar/node_modules/playwright'),{fixture,setBrowser,finish}=require('./encar/browser-smoke.cjs');
const OUT=process.env.PRESTOCK_SETTINGS_ARTIFACT_DIR||'/tmp/snote-prestock-settings';fs.mkdirSync(OUT,{recursive:true});
const saved={total:8500000,bank:'가상 은행',account:'TEST-ACCOUNT-A',holder:'가상 상사 A'};
async function reload(f){f.answerConfirm(true,/서버에 저장된 데이터로 다시 불러올까요/);await f.page.evaluate(()=>zc86Cloud.reload());}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'});setBrowser(browser);
 try{
  for(const width of [1440,390]){
   const f=await fixture(width),p=f.page;
   await p.evaluate(async()=>{
    await closeVehicle({discard:true});closeDashboardGate();navigate('buy');const S=__encarFixtureState;
    S.members[0].role='admin';currentUser.role='admin';
    window.__ps={rows:[],writes:[],reads:[],originalCompany:S.company.id};
    const original=S.client.from.bind(S.client),rpc=S.client.rpc.bind(S.client);
    S.client.from=table=>{if(table!=='zc_datasets')return original(table);const filters={};let single=false;const q={select(){return q;},eq(key,value){filters[key]=value;return q;},limit(){return q;},maybeSingle(){single=true;return q;},then(resolve,reject){__ps.reads.push(structuredClone(filters));const rows=__ps.rows.filter(row=>Object.entries(filters).every(([k,v])=>row[k]===v));return Promise.resolve({data:single?(rows[0]||null):structuredClone(rows),error:null}).then(resolve,reject);}};return q;};
    S.client.rpc=async(name,args)=>{if(name==='zc_write_dataset'&&args.p_dataset==='finance_limits'){if(args.p_company!==S.company.id)throw Error('Foreign-company write');__ps.writes.push(structuredClone(args));const row={company_id:S.company.id,dataset:'finance_limits',owner_id:'00000000-0000-0000-0000-000000000000',payload:structuredClone(args.p_payload),revision:args.p_expected+1};__ps.rows=__ps.rows.filter(r=>r.dataset!=='finance_limits');__ps.rows.push(row);return{data:row.revision,error:null};}return rpc(name,args);};
    // A previous company's raw browser cache must not become this company's default.
    S.loading=true;localStorage.setItem(ZC157_FINANCE_KEY,JSON.stringify([{_snote203_meta:{prestock:{total:1234567,bank:'다른 회사 은행',account:'FOREIGN-CACHE',holder:'다른 회사'}}}]));S.loading=false;S.queue.clear();
   });
   assert.equal(await p.evaluate(()=>snote203PrestockConfig().total),null);
   await p.evaluate(()=>{navigate('prestock');snoteOpenPrestockAccount();});
   assert((await p.locator('#snote-prestock-account [data-bank]').allTextContents()).every(value=>value==='미확인'));
   assert.equal((await p.locator('#ps-bank-account').innerText()).trim(),'미확인');await p.locator('#snote-prestock-account button').click();
   await reload(f);
   assert.deepEqual(await p.evaluate(()=>snote203PrestockConfig()),{total:null,bank:'',account:'',holder:''});
   const missing=await p.evaluate(()=>prestockSection());assert.match(missing,/id="ps-bank-account"[^>]*>미설정/);assert.match(missing,/id="ps-balance">미설정/);
   await p.evaluate(()=>snoteOpenPrestockAccount());assert((await p.locator('#snote-prestock-account [data-bank]').allTextContents()).every(value=>value==='미설정'));await p.locator('#snote-prestock-account button').click();
   await p.evaluate(saved=>{const S=__encarFixtureState;__ps.rows=[{company_id:S.company.id,dataset:'finance_limits',owner_id:'00000000-0000-0000-0000-000000000000',payload:[['가상 금융사',10000000,3],{_snote203_meta:{prestock:saved,other:{preserve:true}}}],revision:4}];},saved);
   await reload(f);assert.deepEqual(await p.evaluate(()=>snote203PrestockConfig()),saved);
   await p.evaluate(()=>{closeDashboardGate();navigate('prestock');});await p.locator('#ps-bank-account').waitFor();assert.match(await p.locator('#ps-bank-account').innerText(),/8,500,000/);
   await reload(f);assert.match(await p.locator('#ps-bank-account').innerText(),/8,500,000/);
   // External tab cache change leaves the current authenticated snapshot intact.
   await p.evaluate(()=>{const S=__encarFixtureState;S.loading=true;localStorage.setItem(ZC157_FINANCE_KEY,'[]');S.loading=false;});assert.deepEqual(await p.evaluate(()=>snote203PrestockConfig()),saved);
   assert.equal(await p.evaluate(saved=>snote203WriteMeta({prestock:{...saved,total:9000000}}),saved),true);
   assert.equal((await p.evaluate(()=>zc86Cloud.flush())).ok,true);
   const writes=await p.evaluate(()=>__ps.writes);assert.equal(writes.length,1);assert.equal(writes[0].p_payload[0][0],'가상 금융사');assert.deepEqual(writes[0].p_payload[1]._snote203_meta.other,{preserve:true});
   assert.equal(await p.evaluate(()=>snote203PrestockConfig().total),9000000);
   const companyB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
   await p.evaluate(companyB=>{const S=__encarFixtureState;S.company={id:companyB,name:'가상 상사 B'};S.members=[{...S.members[0],company_id:companyB}];__ps.rows=[];},companyB);
   assert.equal(await p.evaluate(()=>snote203PrestockConfig().total),null);assert.equal(await p.evaluate(()=>snote203WriteMeta({prestock:{total:1}})),false);
   await reload(f);assert.deepEqual(await p.evaluate(()=>snote203PrestockConfig()),{total:null,bank:'',account:'',holder:''});
   await p.evaluate(()=>{const S=__encarFixtureState;currentUser.role='accountant';S.members[0].role='accountant';});assert.equal(await p.evaluate(()=>snote203WriteMeta({prestock:{total:1}})),false);
   await p.evaluate(()=>{closeDashboardGate();navigate('prestock');});await p.locator('#ps-bank-account').waitFor();assert.equal((await p.locator('#ps-bank-account').innerText()).trim(),'미설정');
   await p.screenshot({path:path.join(OUT,'unconfigured-'+width+'.png')});
   assert.equal(await p.evaluate(()=>__ps.writes.length),1);
   await finish(f);console.log('PASS '+width+'px existing/unconfigured company hydration, no shared-cache fallback, own-company admin save, accountant read-only and company switch');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
