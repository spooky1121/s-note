'use strict';
// The real optional loader and real catalogue/taxonomy modules. Routes and the
// office-sibling side-effect probes are synthetic; no external service is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./encar/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://feature-loader.example',OUT=process.env.SNOTE_FEATURE_LOADER_ARTIFACT_DIR||'/tmp/snote-feature-loader';fs.mkdirSync(OUT,{recursive:true});
const source=file=>fs.readFileSync(path.join(ROOT,'assets',file),'utf8'),loader=source('feature-loader.js');
async function fixture(browser,fail){
 const p=await browser.newPage(),requests=[],executions={};p.setDefaultTimeout(15000);
 await p.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,ORIGIN);requests.push(url.pathname+url.search);
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><script src="/assets/feature-loader.js"></script>'});
  const file=path.basename(url.pathname);if(file==='feature-loader.js')return route.fulfill({contentType:'application/javascript',body:loader});
  if(fail(file,url))return route.fulfill({status:503,contentType:'application/javascript',body:''});
  if(file==='vehicle-catalog.json')return route.fulfill({contentType:'application/json',body:source(file)});
  assert(/^[a-z-]+\.js$/.test(file));
  const actual=['vehicle-catalog.js','vehicle-taxonomy-store.js','vehicle-taxonomy-ui.js'].includes(file);
  const body=(actual?source(file):'')+'\n;window.__moduleExecutions??={};window.__moduleExecutions['+JSON.stringify(file)+']=(window.__moduleExecutions['+JSON.stringify(file)+']||0)+1;';
  return route.fulfill({contentType:'application/javascript',body});
 });
 await p.goto(ORIGIN,{waitUntil:'networkidle'});return{p,requests,async counters(){return p.evaluate(()=>window.__moduleExecutions||{});},close:()=>p.close()};
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium'}),results=[];
 try{
  {
   let fails=1;const f=await fixture(browser,file=>file==='vehicle-catalog.js'&&fails-->0);try{
    const first=await f.p.evaluate(async()=>{const a=SnoteFeatures.load('catalog'),b=SnoteFeatures.load('catalog');return{same:a===b,results:await Promise.allSettled([a,b]).then(rows=>rows.map(row=>row.status)),loaded:SnoteFeatures.loaded('catalog')};});assert.deepEqual(first,{same:true,results:['rejected','rejected'],loaded:false});
    await f.p.evaluate(async()=>{await SnoteFeatures.load('catalog');await SnoteVehicleCatalog.ready;});assert.equal(await f.p.evaluate(()=>SnoteVehicleCatalog.rows().length),3128);
    const before=f.requests.length;await f.p.evaluate(async()=>{const a=SnoteFeatures.load('catalog'),b=SnoteFeatures.load('catalog');if(a!==b)throw Error('Success must reuse its group Promise');await a;});assert.equal(f.requests.length,before);assert.equal((await f.counters())['vehicle-catalog.js'],1);
    assert.deepEqual(f.requests.filter(url=>/^\/assets\/vehicle-catalog\.js\?/.test(url)),['/assets/vehicle-catalog.js?v=2.185','/assets/vehicle-catalog.js?v=2.185&snote_retry=1']);results.push({name:'failed module URL retries once; in-flight and successful groups coalesce',requests:f.requests});
   }finally{await f.close();}
  }
  {
   let fails=1;const f=await fixture(browser,file=>file==='vehicle-taxonomy-store.js'&&fails-->0);try{
    assert.equal(await f.p.evaluate(async()=>SnoteFeatures.load('taxonomyUI').then(()=>true,()=>false)),false);
    await f.p.evaluate(()=>SnoteFeatures.load('taxonomyUI'));assert.equal(await f.p.evaluate(()=>typeof snoteLoadVehicleTaxonomy),'function');
    const identity=await f.p.evaluate(async()=>{const a=SnoteFeatures.module('taxonomyStore'),b=SnoteFeatures.module('taxonomyStore');const model=await a;return{same:a===b,identity:typeof model.taxonomyIdentity,confirmSource:snotePrepareVehicleTaxonomyCar===model.taxonomyEntryFromCar};});assert.deepEqual(identity,{same:true,identity:'function',confirmSource:true});
    const before=f.requests.length;await f.p.evaluate(()=>SnoteFeatures.load('taxonomyUI'));assert.equal(f.requests.length,before);assert.equal((await f.counters())['vehicle-taxonomy-store.js'],1);assert.equal((await f.counters())['vehicle-taxonomy-ui.js'],1);
    assert.deepEqual(f.requests.filter(url=>url.startsWith('/assets/vehicle-taxonomy-store.js')),['/assets/vehicle-taxonomy-store.js?v=2.20','/assets/vehicle-taxonomy-store.js?v=2.20&snote_retry=1']);results.push({name:'failed shared taxonomy dependency retries at its canonical initial version; UI and ACK verifier share one namespace',requests:f.requests});
   }finally{await f.close();}
  }
  {
   let fails=1;const f=await fixture(browser,file=>file==='company-assets.js'&&fails-->0);try{
    assert.equal(await f.p.evaluate(async()=>SnoteFeatures.load('office').then(()=>true,()=>false)),false);await f.p.evaluate(()=>SnoteFeatures.load('office'));await f.p.evaluate(()=>SnoteFeatures.load('companyAssets'));
    const counters=await f.counters();for(const file of ['transfer-document-layout.js','transfer-name-seal.js','transfer-company-seal.js','company-assets.js','contract-office.js'])assert.equal(counters[file],1,'Successful sibling must never execute again: '+file);
    assert.equal(f.requests.filter(url=>url.startsWith('/assets/company-assets.js')).length,2);assert.equal(f.requests.filter(url=>/snote_retry/.test(url)).length,1);results.push({name:'office partial failure retries only its failed file and reuses successful/shared siblings',executions:counters});
   }finally{await f.close();}
  }
  {
   const f=await fixture(browser,()=>false);try{const count=f.requests.length;assert.deepEqual(await f.p.evaluate(async()=>Promise.all([SnoteFeatures.load('../untrusted'),SnoteFeatures.module('office')].map(task=>task.then(()=>true,()=>false)))),[false,false]);assert.equal(f.requests.length,count);results.push({name:'unknown feature/module names cannot introduce arbitrary imports'});}finally{await f.close();}
  }
  {
   const f=await fixture(browser,()=>false);try{
    await f.p.evaluate(async()=>{window.SnoteFeatures=Object.freeze({load:()=>Promise.resolve(true),loaded:()=>false});await import('/assets/vehicle-taxonomy-ui.js?v=2.184');});
    assert.equal(await f.p.evaluate(()=>typeof snoteLoadVehicleTaxonomy),'function');assert.deepEqual(f.requests.filter(url=>url.startsWith('/assets/vehicle-taxonomy-store.js')),['/assets/vehicle-taxonomy-store.js?v=2.20']);
    assert.equal((await f.counters())['vehicle-taxonomy-store.js'],1);results.push({name:'an already-open older loader keeps classification working through its original fixed dependency URL'});
   }finally{await f.close();}
  }
  fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({ok:true,syntheticOnly:true,productionRequests:0,loaderHash:crypto.createHash('sha256').update(loader).digest('hex'),results},null,2)+'\n');for(const result of results)console.log('PASS '+result.name);
 }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
