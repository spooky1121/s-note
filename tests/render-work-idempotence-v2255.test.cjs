'use strict';
// Synthetic DOM and scoped bridges only. No browser, customer data or server.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('./encar/node_modules/jsdom');
const source=name=>fs.readFileSync(path.join(__dirname,'../assets',name),'utf8');
const settle=window=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>setTimeout(resolve,0))));

function navigation(){
 const dom=new JSDOM('<!doctype html><body><nav id="desktop-nav"></nav><nav id="mobile-drawer-nav"></nav><main id="content"></main>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.invalid/'}),w=dom.window;
 w.matchMedia=()=>({matches:false,addEventListener(){}});
 const s={contextCalls:0,reads:0,writes:0,ctx:{ready:true,key:'company-A/dealer-A/session-1',actorId:'11111111-1111-4111-8111-111111111111',companyId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',role:'dealer'}};
 const fill=nav=>{for(const id of['buy','sell','settings']){const button=w.document.createElement('button');button.dataset.page=id;button.textContent=id;nav.append(button);}return nav;};
 for(const nav of w.document.querySelectorAll('nav'))fill(nav);
 w.snoteWorkspaceOrderBridge={context(){s.contextCalls++;return s.ctx;},current:ctx=>!!s.ctx&&ctx.key===s.ctx.key,async read(){s.reads++;return['sell','buy','settings'];},async save(){s.writes++;}};
 w.eval(source('workspace-reorder.js'));
 return{dom,w,s,fill,ids:nav=>[...nav.querySelectorAll(':scope > button')].map(button=>button.dataset.page)};
}

test('unrelated page updates do not rediscover or rewrite the navigation',async()=>{
 const{dom,w,s}=navigation();try{
  await settle(w);s.contextCalls=0;const reads=s.reads;let writes=0;
  const observer=new w.MutationObserver(records=>writes+=records.length);observer.observe(w.document.querySelector('#desktop-nav'),{subtree:true,attributes:true});
  for(let i=0;i<5;i++){w.document.querySelector('#content').append(w.document.createElement('p'));await settle(w);}
  assert.equal(s.contextCalls,0);assert.equal(writes,0);assert.equal(s.reads,reads);assert.equal(s.writes,0);
  w.dispatchEvent(new w.Event('snote:workspace-order-context'));await settle(w);
  assert(s.contextCalls>0,'Explicit context changes must still verify the current scope');assert.equal(writes,0,'An unchanged context must not rewrite the same class or ARIA metadata');observer.disconnect();
 }finally{dom.window.close();}
});

test('navigation replacement, direct child changes and later subtree insertion stay discoverable',async()=>{
 const{dom,w,s,fill,ids}=navigation();try{
  await settle(w);assert.equal(s.reads,1,'Desktop and mobile menus must share the scoped preference read');
  const old=w.document.querySelector('#desktop-nav'),replacement=fill(w.document.createElement('nav'));replacement.id=old.id;old.replaceWith(replacement);await settle(w);
  assert(replacement.classList.contains('snote-reorder-enabled'));assert.deepEqual(ids(replacement),['sell','buy','settings']);assert(!old.classList.contains('snote-reorder-container'));
  const guide=w.document.createElement('button');guide.dataset.page='vehicleInspection';guide.textContent='guide';replacement.append(guide);await settle(w);
  assert(guide.classList.contains('snote-reorder-item'));assert.deepEqual(ids(replacement),['sell','buy','vehicleInspection','settings']);
  w.document.querySelector('#mobile-drawer-nav').remove();await settle(w);const section=w.document.createElement('section'),mobile=fill(w.document.createElement('nav'));mobile.id='mobile-drawer-nav';section.append(mobile);w.document.querySelector('#content').append(section);await settle(w);
  assert(mobile.classList.contains('snote-reorder-enabled'));assert.deepEqual(ids(mobile),['sell','buy','settings']);assert.equal(s.reads,1);assert.equal(s.writes,0);
 }finally{dom.window.close();}
});

test('fixed accountant navigation remains outside draggable ordering and scope changes still refresh',async()=>{
 const{dom,w,s}=navigation();try{
  await settle(w);const navs=[...w.document.querySelectorAll('nav')];s.ctx={...s.ctx,key:'company-A/accountant-A/session-2',role:'accountant'};
  for(const nav of navs)nav.dataset.accountantNavigation='true';await settle(w);
  for(const nav of navs){assert(!nav.classList.contains('snote-reorder-enabled'));assert.equal(nav.querySelectorAll('.snote-reorder-item').length,0);}
  s.ctx={...s.ctx,key:'company-B/dealer-A/session-3',companyId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',role:'dealer'};w.dispatchEvent(new w.Event('snote:workspace-order-context'));await settle(w);
  for(const nav of navs)assert(nav.classList.contains('snote-reorder-enabled'));
  assert.equal(s.reads,2,'A new company/role scope must obtain its own order');assert.equal(s.writes,0);
 }finally{dom.window.close();}
});

function overview(kind){
 const dom=new JSDOM(`<!doctype html><body><section id="snote-${kind}-overview"></section>`,{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.invalid/'}),w=dom.window;
 w.route=kind==='sales'?'sell':'buy';let poll;w.setInterval=callback=>(poll=callback,1);
 if(kind==='purchase')w.eval(source('sales-overview.js'));
 const state={checks:0,snapshot:{key:'company-A/session-1',month:'2026-11',cars:[],loading:true},current:false,failed:false,selected:[]};
 w[kind==='sales'?'snoteSalesOverviewBridge':'snotePurchaseOverviewBridge']={snapshot(){state.checks++;if(state.failed)throw Error('SYNTHETIC_UNAVAILABLE');return state.snapshot;},current:key=>state.current&&state.snapshot?.key===key,selectMonth:month=>state.selected.push(month)};
 w.eval(source(kind==='sales'?'sales-overview.js':'purchase-overview.js'));
 return{dom,w,state,poll:()=>poll(),host:w.document.querySelector('section'),change:()=>w.dispatchEvent(new w.Event('snote:sales-data-changed')),car:()=>kind==='sales'?{status:'판매완료',soldAt:'2026-11-02'}:{purchaseAt:'2026-11-02'}};
}

for(const kind of['sales','purchase']){
 test(kind+': repeated loading/error checks preserve status nodes and still recover',async()=>{
  const f=overview(kind),{dom,w,state,host}=f;try{
   const original=host.firstChild;let mutations=0;const observer=new w.MutationObserver(records=>mutations+=records.length);observer.observe(host,{childList:true,subtree:true});
   for(let i=0;i<5;i++){f.poll();await Promise.resolve();}
   assert(state.checks>=6,'The same display must not suppress scope revalidation');assert.equal(mutations,0);assert.equal(host.firstChild,original);
   state.failed=true;f.poll();await Promise.resolve();assert.equal(host.dataset.state,'unavailable');const unavailable=host.firstChild;mutations=0;
   for(let i=0;i<3;i++){f.poll();await Promise.resolve();}assert.equal(mutations,0);assert.equal(host.firstChild,unavailable);
   state.failed=false;state.current=true;state.snapshot={...state.snapshot,loading:false,cars:[f.car()]};f.change();await Promise.resolve();assert.equal(host.dataset.state,'ready');assert.equal(host.querySelector('.sales-overview-metric dd').textContent,'1대');
   observer.disconnect();
  }finally{dom.window.close();}
 });

 test(kind+': changed data repaints, old scope clears and fresh ready data cannot be skipped',async()=>{
  const f=overview(kind),{dom,w,state,host}=f;try{
   state.current=true;state.snapshot={...state.snapshot,loading:false,cars:[f.car()]};f.change();await Promise.resolve();const ready=host.firstChild;
   f.change();await Promise.resolve();assert.equal(host.firstChild,ready,'Unchanged ready content remains stable');
   state.snapshot.cars.push(f.car());f.change();await Promise.resolve();assert.equal(host.querySelector('.sales-overview-metric dd').textContent,'2대');
   state.current=false;state.snapshot={...state.snapshot,key:'company-B/session-2',loading:true,cars:[]};f.poll();await Promise.resolve();assert.equal(host.dataset.state,'loading');assert.equal(host.querySelectorAll('.sales-overview-metric').length,0,'Old account counts must clear immediately');
   state.current=true;state.snapshot={...state.snapshot,loading:false};f.change();await Promise.resolve();assert.equal(host.dataset.state,'ready');assert.equal(host.querySelector('.sales-overview-metric dd').textContent,'0대');
   w.dispatchEvent(new w.CustomEvent('snote:route-changed',{detail:{page:'settings'}}));assert.equal(host.hidden,true);assert.equal(host.childNodes.length,0);
   w.dispatchEvent(new w.CustomEvent('snote:route-changed',{detail:{page:kind==='sales'?'sell':'buy'}}));assert.equal(host.hidden,false);assert.equal(host.querySelector('.sales-overview-metric dd').textContent,'0대');
   if(kind==='sales'){host.querySelector('.sales-overview-month').click();assert.equal(state.selected.length,1,'Existing month selection keeps its handler');}
  }finally{dom.window.close();}
 });
}

function advertisement(){
 const dom=new JSDOM('<!doctype html><body><section id="list-screen"><a class="snote-list-encar" data-encar-id-car="synthetic-car"></a></section><section id="vehicle-overlay"><h2 id="vehicle-title">합성 차량</h2><button id="vehicle-encar-check" data-encar-id-car="synthetic-car"></button></section>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.invalid/'}),w=dom.window;
 const state={enabled:false,record:null,planned:40000000,role:'dealer',checks:0,requests:0};let poll;w.setInterval=callback=>(poll=callback,1);
 w.snoteNotify=()=>{};w.fetch=()=>{state.requests++;throw Error('Unexpected test request');};
 w.snoteEncarIdBridge={context(id,entry){state.checks++;return state.enabled&&id==='synthetic-car'?{key:'company-A/car-A',plate:'12가3456',entry,actor:{role:state.role}}:null;},current:ctx=>state.enabled&&ctx?.key==='company-A/car-A',saved:()=>state.record,plannedPrice:()=>state.planned};
 w.eval(source('encar-id.js'));
 return{dom,w,state,poll:()=>poll(),price:w.document.querySelector('#snote-encar-advertisement'),link:w.document.querySelector('a.snote-list-encar'),button:w.document.querySelector('#vehicle-encar-check'),record:()=>({id:'43123456',plate:'12가3456',url:'https://fem.encar.com/cars/detail/43123456?listAdvType=share&adnm=mo_detail_url',verifiedAt:new Date().toISOString(),priceWon:50000000,priceSource:'encar',priceCheckedAt:new Date().toISOString()})};
}

test('Encar scope checks keep hidden and ready controls stable while permission and price changes still apply',async()=>{
 const f=advertisement(),{dom,w,state,price,button}=f;try{
  await Promise.resolve();let attributes=0;const observer=new w.MutationObserver(records=>attributes+=records.length);observer.observe(w.document.body,{subtree:true,attributes:true});
  for(let i=0;i<6;i++){f.poll();await Promise.resolve();}assert.equal(attributes,0);assert(state.checks>=7,'Polling must still verify the current vehicle context');
  state.enabled=true;state.record=f.record();f.poll();await Promise.resolve();assert.equal(price.hidden,false);assert.equal(button.disabled,false);assert.equal(w.document.querySelector('#snote-encar-price-change').hidden,false);assert.match(price.textContent,/50,000,000/);
  attributes=0;for(let i=0;i<6;i++){f.poll();await Promise.resolve();}assert.equal(attributes,0,'Steady verified price and permissions must not rewrite hidden/disabled/title');
  state.planned=state.record.priceWon;f.poll();await Promise.resolve();assert.equal(w.document.querySelector('#snote-encar-price-change').hidden,true);
  state.enabled=false;f.poll();await Promise.resolve();assert.equal(price.hidden,true);assert.equal(button.disabled,true);assert(!price.textContent.includes('50,000,000'),'A revoked context must clear the prior price');
  state.enabled=true;state.record={...f.record(),priceWon:60000000};state.role='accountant';f.poll();await Promise.resolve();assert.match(price.textContent,/60,000,000/);assert.equal(w.document.querySelector('#snote-encar-price-change').hidden,true,'Read-only roles do not receive a price-write control');assert.equal(state.requests,0);observer.disconnect();
 }finally{dom.window.close();}
});

test('Encar saved list links retain native navigation and empty link state is idempotent',async()=>{
 const f=advertisement(),{dom,w,state,link}=f;try{
  state.enabled=true;f.poll();await Promise.resolve();assert.equal(link.getAttribute('aria-disabled'),'true');assert.equal(link.tabIndex,-1);
  let attributes=0;const observer=new w.MutationObserver(records=>attributes+=records.length);observer.observe(link,{attributes:true});
  for(let i=0;i<5;i++){f.poll();await Promise.resolve();}assert.equal(attributes,0);
  state.record=f.record();f.poll();await Promise.resolve();assert.equal(link.href,state.record.url);assert.equal(link.hasAttribute('aria-disabled'),false);assert.equal(link.hasAttribute('tabindex'),false);
  attributes=0;for(let i=0;i<5;i++){f.poll();await Promise.resolve();}assert.equal(attributes,0);assert.equal(state.requests,0);observer.disconnect();
 }finally{dom.window.close();}
});

test('vehicle tabs avoid steady tabindex writes and retain mobile, desktop and accountant transitions',async()=>{
 const dom=new JSDOM('<!doctype html><body><section id="vehicle-overlay"><div class="vehicle-modal"><div class="vehicle-heading"><span id="vehicle-meta">12가3456</span></div><div id="vehicle-overview"><div class="vehicle-metric"><label>판매예정가</label><strong>50,000,000원</strong></div></div><section class="vehicle-info-column"></section><section id="car-cost-section"><input id="detail-sell" value="50,000,000" disabled></section><section class="vehicle-media-grid"></section></div></section>',{runScripts:'outside-only',pretendToBeVisual:true,url:'https://example.invalid/'}),w=dom.window,media={matches:true,addEventListener(name,handler){this.changed=handler;}};
 w.matchMedia=()=>media;try{
  w.eval(source('design-vehicle.js'));await settle(w);const nav=w.document.querySelector('#design-vehicle-tabs'),tabs=[...nav.querySelectorAll('button')],money=w.document.querySelector('#car-cost-section'),field=w.document.querySelector('#detail-sell');let writes=0;const observer=new w.MutationObserver(records=>writes+=records.length);observer.observe(nav,{subtree:true,attributes:true});
  for(let i=0;i<4;i++){w.SnoteDesignVehicle.refresh();await settle(w);}assert.equal(writes,0);assert.equal(tabs[0].tabIndex,0);assert.equal(tabs[1].tabIndex,-1);
  tabs[1].click();await settle(w);assert.equal(tabs[1].tabIndex,0);assert.equal(tabs[0].tabIndex,-1);assert.equal(money.classList.contains('design-vehicle-inactive'),false);assert.equal(field.disabled,true,'Presentation changes must preserve permission disabled flags');
  media.matches=false;media.changed();await settle(w);assert.equal(nav.hidden,true);assert.equal(money.hasAttribute('role'),false);assert.equal(money.hasAttribute('aria-labelledby'),false);assert.equal(money.classList.contains('design-vehicle-inactive'),false);
  media.matches=true;media.changed();await settle(w);assert.equal(nav.hidden,false);assert.equal(money.getAttribute('role'),'tabpanel');
  w.document.body.classList.add('accountant-mode');await settle(w);assert.equal(nav.hidden,true);assert.equal(money.hasAttribute('role'),false);assert.equal(field.disabled,true);observer.disconnect();
 }finally{dom.window.close();}
});
