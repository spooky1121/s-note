/* Public automotive columns. Scope guards own the view; no account or financial data enters this request. */
(function(root,factory){
 'use strict';const model=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document)return;
 if(root.SnoteDashboardNews)return;
 root.SnoteDashboardNewsModel=model;
 const document=root.document,client=model.createClient(),SOURCE=model.sourceUrl;
 let controller=null,sequence=0,mountFrame=null,suspended=false;
 const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 const bridge=()=>root.snoteDashboardNewsBridge;
 function context(){try{const value=bridge()?.context?.();return value&&value.ready===true&&typeof value.key==='string'&&value.key&&bridge()?.current?.(value)===true?value:null;}catch{return null;}}
 function current(c){
  try{return controller===c&&c.live&&c.host.isConnected&&document.getElementById('snote-dashboard-news')===c.host&&!c.host.closest('[hidden],[inert]')&&bridge()?.current?.(c.context)===true;}catch{return false;}
 }
 function cancelMount(){if(mountFrame!==null){root.cancelAnimationFrame(mountFrame);mountFrame=null;}}
 function reset(){cancelMount();const c=controller;controller=null;sequence++;if(!c)return;c.live=false;if(c.host){c.host.replaceChildren();delete c.host.dataset.newsState;c.host.removeAttribute('aria-busy');}}
 function sourceLink(){const link=node('a','snote-news-source','네이버 뉴스');link.href=SOURCE;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.dataset.newsSource='';link.setAttribute('aria-label','네이버 뉴스에서 자동차 칼럼 검색 · 새 창');return link;}
 function date(value){return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(new Date(value)).replace(/\s/g,'').replace(/\.$/,'');}
 function paint(c){
  if(!current(c))return;
  const card=node('section','snote-dashboard-news-card'),head=node('header','snote-news-head'),title=node('h2','snote-news-title','자동차 칼럼');title.id='snote-dashboard-news-title';card.setAttribute('aria-labelledby',title.id);head.append(title,sourceLink());card.append(head);
  c.host.dataset.newsState=c.status;c.host.setAttribute('aria-busy',String(c.status==='loading'));
  if(c.status==='ready'){
   const list=node('ul','snote-news-list');
   for(const item of c.result.items){
    const row=node('li','snote-news-item'),link=node('a','snote-news-link',item.title),meta=node('span','snote-news-meta'),publisher=node('span','snote-news-publisher',item.publisher),time=node('time','snote-news-date',date(item.publishedAt));
    row.dataset.newsItem='';link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.title=item.title+' · '+item.publisher;time.dateTime=item.publishedAt;meta.append(publisher,time);row.append(link,meta);list.append(row);
   }
   card.append(list);c.host.dataset.newsPartial=String(c.result.partial);
  }else{
   delete c.host.dataset.newsPartial;
   const text=c.status==='loading'?'칼럼을 불러오는 중입니다.':c.status==='unconfigured'?'자동차 칼럼을 준비하고 있습니다.':c.status==='empty'?'표시할 자동차 칼럼이 없습니다.':'자동차 칼럼을 불러오지 못했습니다.';
   const state=node('div','snote-news-state'),message=node('p','snote-news-message',text);message.setAttribute('role','status');state.append(message);
   if(c.status==='error'){const retry=node('button','snote-news-retry','다시 불러오기');retry.type='button';retry.dataset.newsRetry='';retry.addEventListener('click',()=>{if(current(c))void load(c,{force:true});});state.append(retry);}
   card.append(state);
  }
  c.host.replaceChildren(card);
 }
 async function load(c,{force=false}={}){
  if(!current(c)||c.loading)return false;
  c.loading=true;c.status='loading';c.result=null;paint(c);
  try{const result=await client.read({force});if(controller!==c||!c.live)return false;c.result=result;c.status=result.configured===false?'unconfigured':result.items.length?'ready':'empty';}
  catch{if(controller!==c||!c.live)return false;c.status='error';c.result=null;}
  finally{c.loading=false;}
  if(current(c))paint(c);return current(c);
 }
 function mount(target=document.getElementById('snote-dashboard-news')){
  const scope=suspended?null:context();if(!scope||!(target instanceof root.Element)||target!==document.getElementById('snote-dashboard-news')||!target.isConnected||target.closest('[hidden]')){reset();return false;}
  if(target.closest('[inert]')){
   let preserve=false;try{preserve=controller?.live===true&&controller.host===target&&controller.context.key===scope.key&&bridge()?.current?.(controller.context)===true;}catch{}
   if(!preserve)reset();return false;
  }
  if(controller&&controller.host===target&&controller.context.key===scope.key&&current(controller)){paint(controller);return true;}
  reset();const c={host:target,context:scope,live:true,version:++sequence,loading:false,status:'loading',result:null};controller=c;void load(c);return true;
 }
 function refresh({force=true}={}){if(!controller||!current(controller))return mount();void load(controller,{force});return true;}
 function scheduleMount(){if(suspended||mountFrame!==null)return;mountFrame=root.requestAnimationFrame(()=>{mountFrame=null;mount();});}
 for(const name of ['snote:home-dashboard-rendered','snote:scheduler-context-changed'])root.addEventListener(name,scheduleMount);
 root.addEventListener('pageshow',()=>{suspended=false;scheduleMount();});
 root.addEventListener('snote:route-changed',event=>{if(event.detail?.page==='dashboard')scheduleMount();else reset();});
 root.addEventListener('snote:auth-reset',reset);
 root.addEventListener('pagehide',()=>{suspended=true;reset();});
 // Login releases the gate and app inert state after the dashboard events.
 // Observe those boundaries only; painting this card never reschedules itself.
 const visibilityObserver=new root.MutationObserver(scheduleMount);
 for(const[id,attributes]of [['snote-app',['inert','hidden','aria-hidden','style','class']],['zc-cloud-gate',['hidden','style','class']],['snote-dashboard-home',['hidden']]]){
  const element=document.getElementById(id);if(element)visibilityObserver.observe(element,{attributes:true,attributeFilter:attributes});
 }
 const content=document.querySelector('#snote-app main.content');if(content)visibilityObserver.observe(content,{attributes:true,attributeFilter:['inert','hidden','aria-hidden']});
 root.SnoteDashboardNews=Object.freeze({mount,refresh,reset});scheduleMount();
})(typeof window==='object'?window:globalThis,function(root){
 'use strict';
 const SOURCE='https://search.naver.com/search.naver?where=news&query=%EC%9E%90%EB%8F%99%EC%B0%A8%20%EC%B9%BC%EB%9F%BC',TTL=15*60000,MAX_BYTES=131072,ERRORS=new Set(['NEWS_NOT_CONFIGURED','NEWS_AUTH_FAILED','NEWS_RATE_LIMITED','NEWS_UPSTREAM_UNAVAILABLE','NEWS_INVALID_RESPONSE','NEWS_TIMEOUT']);
 const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value),fail=code=>{throw Object.assign(new Error(code),{code});};
 const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 function text(value,max){if(typeof value!=='string'||!value.trim()||value!==value.trim()||Array.from(value).length>max||/[\u0000-\u001f\u007f]/.test(value)||Array.from(value).some(c=>{const n=c.codePointAt(0);return n>=0xd800&&n<=0xdfff;}))fail('NEWS_INVALID_RESPONSE');return value;}
 function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('NEWS_INVALID_RESPONSE');return value;}
 function link(value){
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f\\]/.test(value))fail('NEWS_INVALID_RESPONSE');let url;try{url=new URL(value);}catch{fail('NEWS_INVALID_RESPONSE');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(url.hostname)||/[\[\]:]/.test(url.hostname)||/(?:^|\.)(?:localhost|local|internal|invalidhost)$/.test(url.hostname))fail('NEWS_INVALID_RESPONSE');return url.href;
 }
 function response(value){
  if(!object(value))fail('NEWS_INVALID_RESPONSE');
  if(value.ok===false){if(typeof value.configured!=='boolean'||!ERRORS.has(value.code)||!Array.isArray(value.items)||value.items.length||(value.code==='NEWS_NOT_CONFIGURED')!==!value.configured)fail('NEWS_INVALID_RESPONSE');if(value.code==='NEWS_NOT_CONFIGURED')return freeze({configured:false,items:[]});fail(value.code);}
  if(value.ok!==true||value.configured!==true||value.source!=='네이버 뉴스 검색'||value.sourceUrl!==SOURCE||value.stale!==false||typeof value.partial!=='boolean'||!Array.isArray(value.items)||value.items.length>5)fail('NEWS_INVALID_RESPONSE');
  const fetchedAt=timestamp(value.fetchedAt),seen=new Set(),items=value.items.map(row=>{if(!object(row))fail('NEWS_INVALID_RESPONSE');const url=link(row.url),host=new URL(url).hostname.replace(/^www\./,'');if(seen.has(url)||row.publisher!==host)fail('NEWS_INVALID_RESPONSE');seen.add(url);return {title:text(row.title,180),url,publishedAt:timestamp(row.publishedAt),publisher:text(row.publisher,253)};});
  return freeze({configured:true,fetchedAt,items,partial:value.partial,stale:false,source:'네이버 뉴스 검색',sourceUrl:SOURCE});
 }
 function createClient({fetch:fetcher=root.fetch?.bind(root),now=()=>Date.now(),timeoutMs=12000}={}){
  if(typeof fetcher!=='function'||typeof now!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('NEWS_UNAVAILABLE');
  let cached=null,expires=0,lastTime=0,pending=null;
  function read({force=false}={}){
   const time=now();if(!Number.isFinite(time))return Promise.reject(Object.assign(new Error('NEWS_UNAVAILABLE'),{code:'NEWS_UNAVAILABLE'}));
   if(time<lastTime){cached=null;expires=0;}lastTime=time;
   if(!force&&cached&&time<expires)return Promise.resolve(cached);
   if(pending)return pending;
   const task=Promise.resolve().then(async()=>{
    const controller=new root.AbortController();let reader,timer;
    const deadline=new Promise((_,reject)=>{timer=root.setTimeout(()=>{controller.abort();reject(Object.assign(new Error('NEWS_TIMEOUT'),{code:'NEWS_TIMEOUT'}));},timeoutMs);});
    const request=(async()=>{
     const result=await fetcher('/api/automotive-columns',{method:'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal:controller.signal});
     if(controller.signal.aborted){try{void result?.body?.cancel?.().catch(()=>{});}catch{}fail('NEWS_TIMEOUT');}
     if(!result||!/^application\/json(?:\s*;|\s*$)/i.test(result.headers?.get?.('content-type')||''))fail('NEWS_INVALID_RESPONSE');
     reader=result.body?.getReader();if(!reader)fail('NEWS_INVALID_RESPONSE');const chunks=[];let size=0;
     for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BYTES)fail('NEWS_INVALID_RESPONSE');chunks.push(part.value);}
     const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
     let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('NEWS_INVALID_RESPONSE');}
     if(!result.ok&&body?.ok!==false||result.ok&&body?.ok===false)fail('NEWS_INVALID_RESPONSE');const value=response(body);
     if(result.ok!==true&&value.configured!==false)fail('NEWS_INVALID_RESPONSE');return value;
    })();
    try{const value=await Promise.race([request,deadline]);if(value.configured){cached=value;expires=Math.min(now()+TTL,Date.parse(value.fetchedAt)+TTL);}return value;}
    catch(error){throw Object.assign(new Error(ERRORS.has(error?.code)?error.code:'NEWS_UPSTREAM_UNAVAILABLE'),{code:ERRORS.has(error?.code)?error.code:'NEWS_UPSTREAM_UNAVAILABLE'});}
    finally{root.clearTimeout(timer);controller.abort();if(reader)try{void reader.cancel().catch(()=>{});}catch{}}
   });
   pending=task;task.then(()=>{if(pending===task)pending=null;},()=>{if(pending===task)pending=null;});return task;
  }
  return Object.freeze({read});
 }
 return Object.freeze({response,createClient,sourceUrl:SOURCE,ttlMs:TTL,maxBytes:MAX_BYTES});
});
