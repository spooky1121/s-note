'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('./encar/node_modules/jsdom');
const model=require('../assets/operator-ocr-lab.js'),source=fs.readFileSync(require.resolve('../assets/operator-ocr-lab.js'),'utf8');
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function result({plate='123가4567',vin='KMHAB81AB5U123456',model:carModel='기아 쏘렌토',modelYear='2024',review=null}={}){
 const values={plate,vin,model:carModel,modelYear},fields={};for(const key of Object.keys(values))fields[key]={value:values[key],needsReview:key===review,autoFill:key!==review,reasons:key===review?['reread_disagrees']:[],polygon:[[40,70],[600,70],[600,130],[40,130]],confidence:.97};return{ok:true,engine:'synthetic-self-ocr',image:{width:1200,height:800,rotation:0},fields,elapsedMs:140,rawText:'private provider text not allowed into UI'};
}
function setup(t,request){
 const dom=new JSDOM('<!doctype html><html><body><main id="host"></main></body></html>',{url:'https://snote.example/operator.html',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,revoked=[],requests=[];let alive=true,created=0;
 w.URL.createObjectURL=()=>`blob:synthetic-${++created}`;w.URL.revokeObjectURL=url=>revoked.push(url);Object.defineProperty(w.HTMLImageElement.prototype,'naturalWidth',{get:()=>1200});Object.defineProperty(w.HTMLImageElement.prototype,'naturalHeight',{get:()=>800});
 w.eval(source);const host=w.document.getElementById('host');assert.equal(w.SnoteOperatorOcrLab.mount(host,{current:()=>alive,request:(file,options)=>{requests.push({file,options});return request(file,options);}}),true);
 t.after(()=>{w.SnoteOperatorOcrLab.reset();w.close();});
 const choose=name=>{const file=new w.File(['synthetic image bytes'],name,{type:'image/jpeg'}),input=host.querySelector('[data-ocr-lab-file]');Object.defineProperty(input,'files',{configurable:true,value:[file]});input.dispatchEvent(new w.Event('change',{bubbles:true}));return file;};
 const field=key=>host.querySelector('[data-ocr-lab-field="'+key+'"]');return{w,host,requests,revoked,choose,field,notCurrent:()=>{alive=false;}};
}
test('only valid supported original images within the 6MB limit are accepted',()=>{
 assert.equal(model.validateFile({type:'image/jpeg',size:1024}),true);assert.equal(model.validateFile({type:'image/png',size:6*1024*1024}),true);
 for(const type of ['image/svg+xml','text/html','image/gif'])assert.throws(()=>model.validateFile({type,size:10}),{code:'UNSUPPORTED_MEDIA_TYPE'});
 assert.throws(()=>model.validateFile({type:'image/jpeg',size:6*1024*1024+1}),{code:'PAYLOAD_TOO_LARGE'});assert.throws(()=>model.validateFile({type:'image/jpeg',size:0}),{code:'UNSUPPORTED_MEDIA_TYPE'});
});
test('normalizes only four fields and fixed metadata, never raw OCR or provider reason text',()=>{
 const raw=result();raw.fields.vin.reasons=['reread_disagrees','private raw text'];const r=model.normalizeResult(raw);assert.deepEqual(Object.keys(r),['fields','image','elapsedMs']);assert(!JSON.stringify(r).includes('private'));assert.equal(r.fields.vin.reasons[1],'review');assert.equal(model.reasonText('private value'),'사진의 해당 항목을 확인해 주세요.');assert.equal(model.reasonText('layout_uncertain'),'항목의 영역 경계를 확인해 주세요.');assert(Object.isFrozen(r));
 for(const bad of [null,{ok:false}, {...raw,image:{width:1200,height:800,rotation:12}},{...raw,fields:{...raw.fields,plate:{...raw.fields.plate,confidence:2}}},{...raw,fields:{...raw.fields,plate:{...raw.fields.plate,polygon:[[-1,0],[0,0],[0,0],[0,1]]}}}])assert.throws(()=>model.normalizeResult(bad),{code:'INVALID_RESPONSE'});
});
test('upload sends the untouched File and safe results populate exactly four existing test inputs',async t=>{
 const gate=pending(),f=setup(t,()=>gate.promise),file=f.choose('private_filename.jpg');assert.strictEqual(f.requests[0].file,file);assert.equal(f.requests.length,1);assert.equal(f.host.querySelector('[data-ocr-lab-run]').disabled,true);gate.resolve(result());await tick();assert.equal(f.field('plate').value,'123가4567');assert.equal(f.field('modelYear').value,'2024');assert.equal(f.host.querySelector('[data-ocr-lab-run]').disabled,false);assert(!f.host.textContent.includes('private_filename'));assert(!f.host.textContent.includes('private provider'));assert.equal(f.w.localStorage.length,0);assert.equal(f.w.sessionStorage.length,0);
});
test('a manual edit made during pending OCR is never overwritten and other safe fields still populate',async t=>{
 const gate=pending(),f=setup(t,()=>gate.promise);f.choose('synthetic.jpg');f.field('plate').value='88나9999';f.field('plate').dispatchEvent(new f.w.Event('input',{bubbles:true}));gate.resolve(result());await tick();assert.equal(f.field('plate').value,'88나9999');assert.equal(f.field('vin').value,'KMHAB81AB5U123456');assert(f.host.textContent.includes('직접 입력한 값은 유지합니다.'));
});
test('replacing image A with B aborts A and neither its late values nor polygons reach B',async t=>{
 const first=pending(),second=pending();let count=0;const f=setup(t,()=>++count===1?first.promise:second.promise);f.choose('A.jpg');const original=f.requests[0];f.choose('B.jpg');assert.equal(original.options.signal.aborted,true);assert.equal(f.requests.length,2);first.resolve(result({plate:'111가1111'}));await tick();assert.equal(f.field('plate').value,'');assert.equal(f.host.querySelector('[data-ocr-lab-run]').disabled,true);second.resolve(result({plate:'222나2222'}));await tick();assert.equal(f.field('plate').value,'222나2222');assert.deepEqual(f.revoked,['blob:synthetic-1']);assert(!f.host.textContent.includes('111가1111'));
});
test('review candidates stay out of automatic inputs, expose a fixed reason and connect to inline original regions',async t=>{
 const f=setup(t,async()=>result({review:'vin'}));f.choose('synthetic.jpg');await tick();assert.equal(f.field('vin').value,'');const row=f.field('vin').closest('.ocr-lab-field');assert(row.textContent.includes('판독 후보: KMHAB81AB5U123456'));assert(row.textContent.includes('확대 판독 결과가 달라'));const b=f.host.querySelector('[data-ocr-lab-region=vin]');b.click();assert.equal(b.getAttribute('aria-pressed'),'true');assert.equal(f.host.querySelector('.ocr-lab-region-overlay').hasAttribute('hidden'),false);assert.equal(f.host.querySelectorAll('[role=dialog]').length,0);f.host.querySelector('[data-ocr-lab-fit]').click();assert.equal(f.host.querySelector('.ocr-lab-region-overlay').hasAttribute('hidden'),true);
});
test('self OCR errors give explicit retry or manual input without any fallback or raw server error display',async t=>{
 let count=0;const f=setup(t,async()=>{if(++count===1)throw Object.assign(Error('private token or customer text'),{code:'OCR_NOT_READY'});return result();});f.choose('synthetic.jpg');await tick();assert(f.host.querySelector('[data-ocr-lab-status]').textContent.includes('직접 입력'));assert(!f.host.textContent.includes('private'));assert.equal(f.requests.length,1);f.field('model').value='직접 입력한 차명';f.field('model').dispatchEvent(new f.w.Event('input',{bubbles:true}));f.host.querySelector('[data-ocr-lab-run]').click();await tick();assert.equal(f.requests.length,2);assert.equal(f.field('model').value,'직접 입력한 차명');assert.equal(f.field('modelYear').value,'2024');
});
test('reanalysis clears unedited stale automatic values when a field becomes uncertain or missing, preserving manual edits',async t=>{
 let count=0;const changed=result({review:'vin',modelYear:null});changed.fields.modelYear={...changed.fields.modelYear,needsReview:true,autoFill:false,reasons:['model_year_missing']};const f=setup(t,async()=>++count===1?result():changed);f.choose('synthetic.jpg');await tick();assert.equal(f.field('vin').value,'KMHAB81AB5U123456');assert.equal(f.field('modelYear').value,'2024');f.field('plate').value='88나9999';f.field('plate').dispatchEvent(new f.w.Event('input',{bubbles:true}));f.host.querySelector('[data-ocr-lab-run]').click();await tick();assert.equal(f.field('vin').value,'');assert.equal(f.field('modelYear').value,'');assert.equal(f.field('plate').value,'88나9999');assert(f.field('vin').closest('.ocr-lab-field').textContent.includes('판독 후보:'));assert(f.field('modelYear').closest('.ocr-lab-field').textContent.includes('모델연도 표기를 확인'));
});
test('reset aborts OCR, erases values and URLs, and a late result cannot resurrect the previous view',async t=>{
 const gate=pending(),f=setup(t,()=>gate.promise);f.choose('synthetic.jpg');f.w.SnoteOperatorOcrLab.reset();assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(f.host.childElementCount,0);assert.deepEqual(f.revoked,['blob:synthetic-1']);gate.resolve(result());await tick();assert.equal(f.host.childElementCount,0);
});
test('changed authentication immediately suppresses late results before the periodic cleanup runs',async t=>{
 const gate=pending(),f=setup(t,()=>gate.promise);f.choose('synthetic.jpg');f.notCurrent();gate.resolve(result());await tick();assert.equal(f.field('plate').value,'');f.w.dispatchEvent(new f.w.Event('snote:auth-reset'));assert.equal(f.host.childElementCount,0);
});
