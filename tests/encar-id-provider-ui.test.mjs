import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {providerPageAction,searchBrowserProvider} from '../functions/_shared/encar-id-provider-ui.mjs';
import {PROVIDERS} from '../functions/_shared/encar-id-resolver.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require('./encar/node_modules/jsdom');
// Synthetic DOMs use public labels only. They are not live HTML captures and do
// not establish that a provider currently accepts or completes this workflow.
const PLATE='12가3456',OTHER='34나5678';
function dom(html,url='https://gloar-data.com/en/lot/model-opaque-key'){
 const page=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true});
 Object.defineProperty(page.window.document,'readyState',{get:()=> 'complete'});
 page.window.HTMLElement.prototype.getClientRects=function(){return this.hidden?[]:[{width:1,height:1}];};
 page.window.HTMLElement.prototype.scrollIntoView=function(){};
 return page;
}
function action(page,args={}){return page.window.eval('('+providerPageAction.toString()+')('+JSON.stringify({provider:'gloar',plate:PLATE,...args})+')');}
const original=id=>'<a href="https://fem.encar.com/cars/detail/'+id+'">Source</a>';
function plain(value){return JSON.parse(JSON.stringify(value));}

test('full plate and explicit original Encar link produce only source ID evidence',()=>{
 const page=dom('<main><section><h1>Vehicle</h1><p>'+PLATE+'</p>'+original('43123456')+'</section></main>');
 const result=action(page);assert.deepEqual(plain(result.ids),['43123456']);assert.equal(result.url,'https://gloar-data.com/en/lot/model-opaque-key');assert.equal(result.exactPlateSeen,true);page.window.close();
});
test('search input echoes, filter chips, and an unrelated primary plate cannot prove a match',()=>{
 for(const echo of['<form><input value="'+PLATE+'"></form>','<div class="filter-chip">'+PLATE+'</div>','<header>'+PLATE+'</header>']){
  const page=dom(echo+'<main><article><p>'+OTHER+'</p>'+original('43123456')+'</article></main>');
  const result=action(page);assert.deepEqual(plain(result.ids),[]);assert.equal(result.exactPlateSeen,false);page.window.close();
 }
});
test('recommendation links and plates never replace the primary advertisement ID',()=>{
 for(const primary of[original('43123456'),'']){
  const page=dom('<main><section><p>'+PLATE+'</p>'+primary+'</section><h2>Similar vehicles in stock</h2><article><p>'+OTHER+'</p>'+original('43999999')+'</article></main>');
  assert.deepEqual(plain(action(page).ids),primary?['43123456']:[]);page.window.close();
 }
});
test('Russian and Korean recommendation headings cannot replace a different primary vehicle',()=>{
 for(const heading of['Похожие автомобили','Рекомендуемые автомобили','Другие автомобили','Смотрите также','추천 차량','유사 매물','다른 자동차']){
  const page=dom('<main><section><h1>Primary vehicle</h1><p>'+OTHER+'</p>'+original('43123456')+'</section><h2>'+heading+'</h2><article><p>'+PLATE+'</p>'+original('43999999')+'</article></main>');
  assert.deepEqual(plain(action(page).ids),[],heading);assert.equal(action(page).exactPlateSeen,false,heading);page.window.close();
 }
});
test('explicit recommendation regions are excluded without a heading',()=>{
 for(const attributes of['class="related-cars"','class="similarVehicles"','data-testid="recommended-listings"','aria-label="추천 차량"','class="Похожие_автомобили"']){
  const page=dom('<main><section><p>'+OTHER+'</p>'+original('43123456')+'</section><div '+attributes+'><article><p>'+PLATE+'</p>'+original('43999999')+'</article></div></main>');
  assert.deepEqual(plain(action(page).ids),[],attributes);assert.equal(action(page).exactPlateSeen,false,attributes);page.window.close();
 }
 const page=dom('<main><section><p>'+PLATE+'</p>'+original('43123456')+'</section><div class="related-cars"><article><p>'+PLATE+'</p>'+original('43999999')+'</article></div></main>');
 assert.deepEqual(plain(action(page).ids),['43123456'],'A recommendation of the same plate cannot introduce another source ID');page.window.close();
});
test('a full plate split across styled inline fragments retains exact source proof',()=>{
 for(const value of['<p><span>12</span><b>가</b><span>3456</span></p>','<p><span>1</span><span>2</span><b>가</b><span>3</span><span>4</span><span>5</span><span>6</span></p>','<div class="license-plate"><span>12</span>\n<b>가</b> <span>3456</span></div>','<div class="license-plate"><div style="display:inline">12</div><div style="display:inline">가3456</div></div>','<dl><dt>번호판</dt><dd><span>12</span><b>가</b><span>3456</span></dd></dl>']){
  const page=dom('<main><section>'+value+original('43123456')+'</section></main>');const result=action(page);assert.equal(result.exactPlateSeen,true,value);assert.deepEqual(plain(result.ids),['43123456'],value);page.window.close();
 }
});
test('an explicit regional prefix may contain local formatting whitespace without losing identity',()=>{
 for(const value of['<p>경기 13바1234</p>','<p><span>경기</span> <span>13</span><b>바</b><span>1234</span></p>']){
  const page=dom('<main><section>'+value+original('43123456')+'</section></main>');const result=action(page,{plate:'경기13바1234'});assert.equal(result.exactPlateSeen,true);assert.deepEqual(plain(result.ids),['43123456']);page.window.close();
 }
 const page=dom('<main><section><p>경기</p><p>13바1234</p>'+original('43999999')+'</section></main>');assert.equal(action(page,{plate:'경기13바1234'}).exactPlateSeen,false);assert.deepEqual(plain(action(page,{plate:'경기13바1234'}).ids),[]);page.window.close();
});
test('split fragments cannot construct a plate across separate values or result cards',()=>{
 for(const value of['<p>12</p><p>가3456</p>','<div class="license-plate"><p>12</p><p>가3456</p></div>','<article><p>12</p></article><article><p>가3456</p></article>']){
  const page=dom('<main>'+value+original('43999999')+'</main>');const result=action(page);assert.equal(result.exactPlateSeen,false,value);assert.deepEqual(plain(result.ids),[],value);page.window.close();
 }
});
test('split search, navigation, footer and recommendation echoes cannot supply plate evidence',()=>{
 const split='<span>12</span><b>가</b><span>3456</span>';
 for(const value of['<form><p>'+split+'</p></form>','<div role="search"><p>'+split+'</p></div>','<header><p>'+split+'</p></header>','<footer><p>'+split+'</p></footer>','<div class="filter-chip">'+split+'</div>','<section class="related-cars"><p>'+split+'</p>'+original('43999999')+'</section>']){
  const page=dom(value+'<main><section><p>'+OTHER+'</p>'+original('43123456')+'</section></main>');assert.equal(action(page).exactPlateSeen,false,value);assert.deepEqual(plain(action(page).ids),[],value);page.window.close();
 }
});
test('a matching explicit record cannot borrow an original ID from a neighboring record',()=>{
 const page=dom('<main><article><p>'+PLATE+'</p></article><article><h2>Unrelated vehicle</h2>'+original('43999999')+'</article></main>');
 assert.equal(action(page).exactPlateSeen,true);assert.deepEqual(plain(action(page).ids),[]);page.window.close();
});
test('hidden identifiers and navigation source links cannot supply primary evidence',()=>{
 for(const extra of['<span hidden>Encar ID: 43999999</span>','<nav>'+original('43999999')+'</nav>','<div hidden><p>'+PLATE+'</p>'+original('43999999')+'</div>']){
  const page=dom('<main><p>'+PLATE+'</p>'+extra+'</main>');assert.deepEqual(plain(action(page).ids),[]);page.window.close();
 }
 const page=dom('<main><section><p>'+PLATE+'</p>'+original('43123456')+'<span hidden>Encar ID: 43999999</span></section></main>');assert.deepEqual(plain(action(page).ids),['43123456']);page.window.close();
});
test('equal-count button result changes produce different bounded fingerprints',()=>{
 const page=dom('<main><article><h2>First vehicle</h2><button>View details</button></article></main>','https://carnect.biz/catalog?tab=encar');
 const before=action(page,{provider:'carnect'}).fingerprint;page.window.document.querySelector('h2').textContent='Different filtered vehicle';const after=action(page,{provider:'carnect'}).fingerprint;assert.notEqual(before,after);page.window.close();
});
test('the initial blank document is a transient pending state',()=>{
 const page=dom('<main></main>','about:blank');const result=action(page);assert.equal(result.pending,true);assert.equal(result.error,undefined);page.window.close();
});
test('a navigation document without a body remains pending instead of failing the provider',()=>{
 const page=dom('<main></main>');page.window.document.body.remove();const result=action(page);assert.equal(result.pending,true);assert.equal(result.ready,false);assert.equal(result.error,undefined);page.window.close();
});
test('an external internal path or an unlabelled number is never treated as an Encar ID',()=>{
 const page=dom('<main><section><p>'+PLATE+'</p><a href="/car/43123456">Vehicle 43123456</a></section></main>','https://carnect.biz/car/opaque-internal-key');
 assert.deepEqual(plain(action(page,{provider:'carnect'}).ids),[]);page.window.close();
});
test('Trust lot proof stays inside the exact matching result card',()=>{
 const page=dom('<main><article><h2><a href="/auto/opaque-a/">Car</a></h2><p>'+PLATE+'</p><p>Лот: 43123456</p></article><article><h2><a href="/auto/opaque-b/">Car</a></h2><p>'+OTHER+'</p><p>Лот: 43999999</p></article></main>','https://encar.spb.ru/catalog/');
 assert.deepEqual(plain(action(page,{provider:'trust'}).ids),['43123456']);page.window.close();
});
test('conflicting explicit source IDs remain ambiguous instead of selecting a URL number',()=>{
 const page=dom('<main><section><p>'+PLATE+'</p><p>Encar ID: 43123456</p>'+original('43999999')+'</section></main>');
 assert.deepEqual(plain(action(page).ids).sort(),['43123456','43999999']);page.window.close();
});
test('only explicit Encar URLs are read and no original advertisement link is clicked',()=>{
 const page=dom('<main><section><p>'+PLATE+'</p><a id="source" href="https://www.encar.com/dc/dc_cardetailview.do?carid=43123456">Source</a><a href="https://fem.encar.com.evil.invalid/cars/detail/43999999">Other</a></section></main>');
 let clicks=0;page.window.document.getElementById('source').addEventListener('click',()=>clicks++);assert.deepEqual(plain(action(page).ids),['43123456']);assert.equal(clicks,0);page.window.close();
});
test('each observed provider search field is filled without invoking save or unrelated controls',()=>{
 for(const [id,placeholder]of[['carnect','e.g. 123가4567'],['gloar','Enter 17-digit VIN, Lot #, or Plate...'],['trust','364406']]){
  const p=PROVIDERS.find(p=>p.id===id),page=dom('<main><form><input placeholder="'+placeholder+'"><button type="submit">Search</button><button type="button" id="save">Save this search</button></form></main>',p.url);
  let submissions=0,saves=0;page.window.document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();submissions++;});page.window.document.getElementById('save').addEventListener('click',()=>saves++);
  const result=action(page,{provider:id,op:'prepare'});assert.equal(result.prepared,true,id);assert.equal(result.submitted,true,id);assert.equal(page.window.document.querySelector('input').value,PLATE);assert.equal(submissions,1);assert.equal(saves,0);page.window.close();
 }
});
test('a whitespace-only search icon uses its actual accessible Search label',()=>{
 const page=dom('<main><form><input placeholder="e.g. 123가4567"><button type="button" aria-label="Search"> \n <svg></svg> </button></form></main>','https://carnect.biz/catalog?tab=encar');let searched=0;page.window.document.querySelector('button').addEventListener('click',()=>searched++);
 const result=action(page,{provider:'carnect',op:'prepare'});assert.equal(result.prepared,true);assert.equal(result.submitted,true);assert.equal(searched,1);page.window.close();
});
test('only the Trust vehicle number field is filled; lot and VIN inputs are untouched',()=>{
 const page=dom('<main><input placeholder="36447206"><input placeholder="364406"><input placeholder="17 символов"></main>','https://encar.spb.ru/catalog/');
 const result=action(page,{provider:'trust',op:'prepare'});assert.equal(result.prepared,true);assert.deepEqual([...page.window.document.querySelectorAll('input')].map(e=>e.value),['',PLATE,'']);page.window.close();
});
test('Trust numeric type, input mode and strict numeric patterns use observed digit formatting only',()=>{
 for(const attributes of['type="number"','inputmode="numeric"','pattern="[0-9]*"','pattern="\\d{6,7}"']){
  const page=dom('<main><input '+attributes+' placeholder="364406"></main>','https://encar.spb.ru/catalog/');
  const prepared=action(page,{provider:'trust',op:'prepare'});assert.equal(prepared.prepared,true);assert.equal(prepared.numericSearch,true,attributes);assert.equal(page.window.document.querySelector('input').value,'123456',attributes);
  assert.equal(action(page,{provider:'trust'}).inputMatches,false,'A digit-only query is not accepted before its runtime formatting was observed');
  assert.equal(action(page,{provider:'trust',numericTrust:prepared.numericSearch}).inputMatches,true);page.window.close();
 }
});
test('Trust observes exact digit sanitization without weakening full plate ID proof',()=>{
 const page=dom('<main><input placeholder="364406"><article><p>12나3456</p><p>Лот: 43999999</p></article></main>','https://encar.spb.ru/catalog/');
 const input=page.window.document.querySelector('input');input.addEventListener('input',()=>{input.value=input.value.replace(/[^0-9]/g,'');});
 const prepared=action(page,{provider:'trust',op:'prepare'});assert.equal(prepared.numericSearch,true);assert.equal(input.value,'123456');
 const snapshot=action(page,{provider:'trust',numericTrust:true});assert.equal(snapshot.inputMatches,true);assert.deepEqual(plain(snapshot.ids),[],'The same digits with a different Korean letter cannot identify a vehicle');page.window.close();
});
test('foreign navigation, malformed original hostnames and hidden empty states fail safely',()=>{
 const foreign=dom('<p>'+PLATE+'</p>'+original('43123456'),'https://evil.invalid/en/lot/a');assert.equal(action(foreign).error,'PROVIDER_NAVIGATION_BLOCKED');foreign.window.close();
 const page=dom('<main><p>'+PLATE+'</p><p hidden>No results found</p><a href="https://fem.encar.com.evil.invalid/cars/detail/43123456">Source</a></main>');
 const result=action(page);assert.equal(result.empty,false);assert.deepEqual(plain(result.ids),[]);page.window.close();
});

function browserFixture(provider,{found=true,empty=false,button=false,unchanged=false,numeric=false,wrongPlate='',detailLag=0,sourceLag=false}={}){
 let page,closed=0,typed=0,detailReads=0;const navigations=[];
 const input=provider.id==='carnect'?'e.g. 123가4567':provider.id==='gloar'?'Enter 17-digit VIN, Lot #, or Plate...':'364406';
 const detailURL=provider.id==='carnect'?'https://carnect.biz/car/opaque-result':provider.id==='gloar'?'https://gloar-data.com/en/lot/opaque-result':'https://encar.spb.ru/auto/opaque-result/';
 function set(html,url){page?.window.close();page=dom(html,url);}
 const old=provider.id==='carnect'?'/car/old-key':provider.id==='gloar'?'/en/lot/old-key':'/auto/old-key/';
 const browser={async newPage(){return{
  async goto(url){navigations.push(url);assert(!url.includes('encar.com'),'Original Encar advertisements must never be visited');if(url===provider.url)set('<main><input '+(numeric?'type="number" ':'')+'placeholder="'+input+'"><a href="'+old+'">Unfiltered old vehicle</a></main>',url);else{assert.equal(url,detailURL);set(detailLag?'<main><h1>Loading vehicle</h1>'+(sourceLag?'<p>'+PLATE+'</p>':'')+'</main>':'<main><section><p>'+(wrongPlate||(found?PLATE:OTHER))+'</p>'+original('43123456')+'</section></main>',url);}},
  async evaluate(expression){if(detailLag&&page.window.location.href===detailURL&&++detailReads>detailLag)set('<main><section><p>'+(wrongPlate||(found?PLATE:OTHER))+'</p>'+original('43123456')+'</section></main>',detailURL);return page.window.eval(expression);},
  async keypress(key){assert.equal(key,'Enter');typed++;if(numeric)assert.equal(page.window.document.querySelector('input').value,'123456');if(unchanged)return;const main=page.window.document.querySelector('main');main.querySelector('a').remove();if(empty)main.insertAdjacentHTML('beforeend','<p>No results found</p>');else if(button){main.insertAdjacentHTML('beforeend','<article><button type="button">View details</button></article>');main.querySelector('button').addEventListener('click',()=>set('<main><p>'+PLATE+'</p>'+original('43123456')+'</main>',detailURL));}else main.insertAdjacentHTML('beforeend','<a href="'+detailURL+'">Filtered vehicle</a>');},
  async close(){closed++;page?.window.close();}
 };}};
 return{browser,navigations,get closed(){return closed;},get typed(){return typed;},get detailReads(){return detailReads;}};
}
test('all three provider routes search the public input and follow only actual filtered detail links',async()=>{
 for(const provider of PROVIDERS){const f=browserFixture(provider),result=await searchBrowserProvider(provider,{plate:PLATE,browser:f.browser});assert.equal(result.status,'found',provider.id);assert.equal(result.id,'43123456');assert.equal(result.plate,PLATE);assert.equal(new URL(result.sourceUrl).hostname,provider.host);assert.equal(f.navigations.length,2);assert.equal(f.typed,1);assert.equal(f.closed,1);}
});
test('navigation context replacement is retried as a read without submitting another search',async()=>{
 const provider=PROVIDERS[0],f=browserFixture(provider),open=f.browser.newPage;let probeFailures=0,prepareFailures=0,inspectFailures=0;
 f.browser.newPage=async options=>{const page=await open(options),evaluate=page.evaluate;return{...page,async evaluate(expression){if(expression.includes('"op":"probe"')&&probeFailures++===0)throw Object.assign(new Error('Execution context was destroyed'),{code:'PAGE_CONTEXT_UNAVAILABLE'});if(expression.includes('"op":"prepare"')&&prepareFailures++===0){await evaluate(expression);await page.keypress('Enter');throw Object.assign(new Error('Execution context was destroyed after actual form submission'),{code:'PAGE_CONTEXT_UNAVAILABLE'});}if(!expression.includes('"op":')&&inspectFailures++===0)throw Object.assign(new Error('Cannot find context with specified id'),{code:'PAGE_CONTEXT_UNAVAILABLE'});return evaluate(expression);}};};
 const result=await searchBrowserProvider(provider,{plate:PLATE,browser:f.browser});assert.equal(result.status,'found');assert.equal(result.id,'43123456');assert.equal(f.typed,1);assert.equal(f.navigations.length,2);assert.equal(f.closed,1);
});
test('an actual page script failure is not retried as a navigation transition',async()=>{
 let reads=0,closed=0;const browser={async newPage(){return{async goto(){},async evaluate(){reads++;throw Object.assign(new Error('ReferenceError in page script'),{code:'PROVIDER_UNAVAILABLE'});},async keypress(){throw Error('must not submit');},async close(){closed++;}};}};
 const result=await searchBrowserProvider(PROVIDERS[0],{plate:PLATE,browser});assert.equal(result.status,'error');assert.equal(result.code,'PROVIDER_UNAVAILABLE');assert.equal(reads,1);assert.equal(closed,1);
});
test('a ready client-rendered detail waits for its plate and original ID instead of declaring an early miss',async()=>{
 for(const sourceLag of[false,true]){const f=browserFixture(PROVIDERS[0],{detailLag:6,sourceLag}),result=await searchBrowserProvider(PROVIDERS[0],{plate:PLATE,browser:f.browser});assert.equal(result.status,'found');assert.equal(result.id,'43123456');assert.equal(f.detailReads,7);assert.equal(f.typed,1);assert.equal(f.closed,1);}
});
test('an unrendered detail is an unverified response rather than proof that no advertisement exists',async()=>{
 const f=browserFixture(PROVIDERS[0],{detailLag:100}),result=await searchBrowserProvider(PROVIDERS[0],{plate:PLATE,browser:f.browser});assert.equal(result.status,'error');assert.equal(result.code,'AD_ID_UNVERIFIED');assert.equal(f.detailReads,18);assert.equal(f.closed,1);
});
test('a Trust digit-only control can find a full-plate match but rejects a different Hangul letter',async()=>{
 const provider=PROVIDERS[2];
 const matching=browserFixture(provider,{numeric:true}),hit=await searchBrowserProvider(provider,{plate:PLATE,browser:matching.browser});assert.equal(hit.status,'found');assert.equal(hit.id,'43123456');assert.equal(matching.closed,1);
 const other=browserFixture(provider,{numeric:true,wrongPlate:'12나3456'}),miss=await searchBrowserProvider(provider,{plate:PLATE,browser:other.browser});assert.notEqual(miss.status,'found');assert.equal(miss.id,undefined);assert.equal(other.closed,1);
});
test('serialized keepNames helper calls run in a remote realm without a module helper',async()=>{
 const source=Function.prototype.toString.call(providerPageAction);
 const compiled='function providerPageAction(args){const pass=__name((value)=>value,"pass");return('+source+')(pass(args));}';
 const own=Object.getOwnPropertyDescriptor(providerPageAction,'toString');
 Object.defineProperty(providerPageAction,'toString',{configurable:true,value:()=>compiled});
 try{
  const provider=PROVIDERS[0],f=browserFixture(provider),result=await searchBrowserProvider(provider,{plate:PLATE,browser:f.browser});
  assert.equal(result.status,'found');assert.equal(result.id,'43123456');assert.equal(f.closed,1);
 }finally{if(own)Object.defineProperty(providerPageAction,'toString',own);else delete providerPageAction.toString;}
});
test('an explicit empty filtered result ends quickly without visiting any detail page',async()=>{
 const provider=PROVIDERS[0],f=browserFixture(provider,{empty:true}),result=await searchBrowserProvider(provider,{plate:PLATE,browser:f.browser});assert.equal(result.status,'not_found');assert.equal(f.navigations.length,1);assert.equal(f.closed,1);
});
test('Carnect can activate an actual filtered View details button without constructing a URL',async()=>{
 const provider=PROVIDERS[0],f=browserFixture(provider,{button:true}),result=await searchBrowserProvider(provider,{plate:PLATE,browser:f.browser});assert.equal(result.status,'found');assert.equal(result.id,'43123456');assert.equal(f.navigations.length,1);assert.equal(f.closed,1);
});
test('cancellation during unchanged search results closes the page and never follows unfiltered links',async()=>{
 const provider=PROVIDERS[0],f=browserFixture(provider,{unchanged:true}),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),40);
 try{await assert.rejects(searchBrowserProvider(provider,{plate:PLATE,browser:f.browser,signal:controller.signal}),error=>error.name==='AbortError');}finally{clearTimeout(timer);}assert.deepEqual(f.navigations,[provider.url]);assert.equal(f.closed,1);
});
test('provider and plate validation happen before any browser is acquired',async()=>{
 let opened=0;const browser={async newPage(){opened++;throw Error('should not open');}};
 for(const [provider,plate]of[[{...PROVIDERS[0],url:'https://evil.invalid'},PLATE],[PROVIDERS[0],'not-a-plate']]){const result=await searchBrowserProvider(provider,{plate,browser});assert.equal(result.status,'error');}
 assert.equal(opened,0);
});
