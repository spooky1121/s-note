import {createBrowserSession} from './encar-id-browser.mjs';

// One fixed public UI. No search-engine query, guessed API route, original
// Encar navigation, price lookup, client script, cookie, or database write.
export const GLOAR_HOME='https://gloar-data.com/en';
const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?\d{2,3}[가-힣]\d{4}$/u;
const failure=(code,extras={})=>Object.assign(new Error(code),{code,...extras});
function check(signal){if(signal?.aborted)throw Object.assign(failure('ABORTED'),{name:'AbortError'});}
function pause(signal,milliseconds){check(signal);return new Promise((resolve,reject)=>{
 const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(Object.assign(failure('ABORTED'),{name:'AbortError'}));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},milliseconds);
 signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
});}
async function release(resource){if(typeof resource?.close!=='function')return;let timer;try{await Promise.race([Promise.resolve().then(()=>resource.close()),new Promise(resolve=>{timer=setTimeout(resolve,1000);})]);}catch{}finally{clearTimeout(timer);}}

// Complete and self-contained: serialized into the remote GLOAR tab. The only
// extracted original ID comes from an explicit Encar source link/label in the
// same primary detail document as the matching full Korean plate.
export function gloarAdvertisementPageAction({operation='read',plate}){
 if(location.href==='about:blank'||!document.body)return {pending:true};
 if(location.protocol!=='https:'||location.hostname!=='gloar-data.com'||location.port||
    !/^\/en(?:\/(?:catalog|search|lot)(?:\/.*)?)?\/?$/u.test(location.pathname))return {error:'GLOAR_NAVIGATION_BLOCKED'};
 const visible=element=>{
  if(!element||element.closest('[hidden],[aria-hidden="true"],script,style,template'))return false;
  for(let parent=element;parent&&parent.nodeType===1;parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;}
  return element.getClientRects().length>0;
 };
 const compact=value=>String(value||'').normalize('NFKC').replace(/[\s-]+/gu,'');
 if(/just a moment|access denied|attention required|verify you are human/iu.test(document.title)||
    [...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"],[data-sitekey]')].some(visible))return {error:'GLOAR_ACCESS_BLOCKED'};
 const detailURL=value=>{
  try{const url=new URL(value,location.href),authority=/^https:\/\/([^/?#]+)/iu.exec(url.href)?.[1];
   if(url.href.length>2048||url.protocol!=='https:'||url.hostname!=='gloar-data.com'||authority?.toLowerCase()!=='gloar-data.com'||url.port||url.username||url.password||!/^\/en\/lot\/[A-Za-z0-9_-]+\/?$/u.test(url.pathname))return '';
   url.search='';url.hash='';return url.href;
  }catch{return '';}
 };
 const anchors=[...document.querySelectorAll('a[href]')].slice(0,1800),links=[];
 for(const anchor of anchors){const url=detailURL(anchor.href);if(url&&visible(anchor)&&!links.includes(url))links.push(url);if(links.length>=100)break;}
 const fingerprint=links.join('|'),input=document.getElementById('headerSearchInput');
 const empty=[...document.querySelectorAll('p,h1,h2,h3,span,output')].slice(0,2000).some(element=>visible(element)&&/^(?:no (?:matching )?(?:results|vehicles|lots)(?: found)?[.!]?|nothing found|0 (?:results|vehicles|lots))$/iu.test((element.textContent||'').trim()));
 const ready=document.readyState!=='loading';
 if(operation==='probe')return {ready:ready&&!!input&&visible(input),url:location.href,fingerprint,empty};
 if(operation==='prepare'){
  if(!ready||!input)return {pending:true};
  if(!visible(input)||input.disabled||input.readOnly)return {error:'GLOAR_INPUT_UNAVAILABLE'};
  input.focus({preventScroll:true});if(document.activeElement!==input)return {error:'GLOAR_FOCUS_FAILED'};
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)return {error:'GLOAR_INPUT_UNAVAILABLE'};
  setter.call(input,plate);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  return {prepared:true};
 }
 if(operation==='focus'){
  if(!ready||!input)return {pending:true};
  if(!visible(input)||input.disabled||input.readOnly)return {error:'GLOAR_INPUT_UNAVAILABLE'};
  if(compact(input.value)!==plate)return {error:'GLOAR_INPUT_UNCONFIRMED'};
  input.focus({preventScroll:true});return document.activeElement===input?{focused:true}:{error:'GLOAR_FOCUS_FAILED'};
 }
 const current=detailURL(location.href),detail=!!current;
 const headings=[...document.querySelectorAll('h1,h2,h3,h4')].filter(visible);
 const boundary=headings.find(element=>/^(?:similar|related|recommended|other vehicles|you may also|похожие|рекомендуемые|другие автомобили|смотрите также|추천\s*(?:차량|매물)|유사\s*(?:차량|매물))(?=$|[^\p{L}\p{N}_])/iu.test((element.textContent||'').trim()));
 const afterBoundary=element=>!!boundary&&(element===boundary||!!(boundary.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING));
 const related=element=>{
  for(let parent=element;parent&&parent!==document.body;parent=parent.parentElement){
   const key=[parent.id,typeof parent.className==='string'?parent.className:'',parent.getAttribute('aria-label'),parent.getAttribute('data-testid'),parent.getAttribute('data-section')].filter(Boolean).join(' ').replace(/([a-z])([A-Z])/gu,'$1 $2').replace(/[_-]+/gu,' ');
   if(/(?:^|\s)(?:similar|related|recommended|recommendations|recommendation)(?=$|\s)/iu.test(key)||/(?:추천|유사|관련)\s*(?:차량|매물)/u.test(key))return true;
  }
  return false;
 };
 const excluded=element=>{
  const header=element.closest('header');
  return !!element.closest('input,textarea,select,form,nav,footer,[role="search"]')||!!(header&&input&&header.contains(input))||related(element)||afterBoundary(element);
 };
 const blockTags=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DD','DIV','DL','DT','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TD','TH','TR','UL']);
 const blockOf=element=>{for(let parent=element;parent&&parent!==document.body;parent=parent.parentElement){const display=getComputedStyle(parent).display;if(/^(?:block|flex|grid|table|list-item|flow-root)/u.test(display)||(!display&&blockTags.has(parent.tagName)))return parent;}return document.body;};
 const primaryText=(root,recordFilter=null)=>{
  const chunks=[];let size=0,visited=0,lastBlock=null,truncated=false;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
   if(++visited>6000){truncated=true;break;}
   const element=node.parentElement;if(!element||!visible(element)||excluded(element))continue;
   if(recordFilter&&!recordFilter(element))continue;
   const value=(node.nodeValue||'').replace(/[\t\r\n\f ]+/gu,' '),block=blockOf(element);
   size+=value.length;if(size>28000){truncated=true;break;}
   if(lastBlock&&lastBlock!==block)chunks.push('\n');lastBlock=block;chunks.push(value);
  }
  return {text:chunks.join('').normalize('NFKC'),truncated};
 };
 const {text,truncated}=detail?primaryText(document.body):{text:'',truncated:false};
 const pattern=/(?<![\d가-힣])(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[ \t\u00a0]*)?\d{2,3}[ \t\u00a0]*[가-힣][ \t\u00a0]*\d{4}(?![\d가-힣])/gu;
 const platesFrom=value=>[...new Set([...value.matchAll(pattern)].map(match=>compact(match[0])))];
 const plates=platesFrom(text),recordCache=new Map();
 const sameRecord=element=>{
  const record=element.closest('article,[data-lot-id],[data-car-id]');if(!record)return true;
  if(!recordCache.has(record)){
   const content=primaryText(record),values=platesFrom(content.text);
   recordCache.set(record,!content.truncated&&values.length===1&&values[0]===plate);
  }
  return recordCache.get(record);
 };
 const originalID=value=>{
  try{const url=new URL(value,location.href);if(!['http:','https:'].includes(url.protocol)||!['encar.com','www.encar.com','fem.encar.com','m.encar.com'].includes(url.hostname)||url.username||url.password||url.port)return '';
   let id=/^\/cars\/detail\/([1-9][0-9]{5,11})(?:\/|$)/u.exec(url.pathname)?.[1]||'';
   if(!id&&/(?:^|\/)(?:dc_)?cardetail(?:view)?\.do$/iu.test(url.pathname))for(const [key,value]of url.searchParams)if(key.toLowerCase()==='carid'&&/^[1-9][0-9]{5,11}$/u.test(value))id=value;
   return id;
  }catch{return '';}
 };
 const ids=new Set();
 if(detail){
  for(const anchor of anchors){if(!visible(anchor)||excluded(anchor)||!sameRecord(anchor))continue;const id=originalID(anchor.href);if(id)ids.add(id);}
  const scopedText=primaryText(document.body,sameRecord);
  if(!scopedText.truncated)for(const match of scopedText.text.matchAll(/(?:original\s+)?encar\s*(?:(?:advertisement|listing|ad|source|lot)\s*)?(?:id|number|no\.?|#)\s*[:#]?\s*([1-9][0-9]{5,11})(?![0-9])/giu))ids.add(match[1]);
 }
 const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].slice(0,80).some(visible);
 const exact=!truncated&&plates.length===1&&plates[0]===plate;
 return {ready,url:location.href,sourceUrl:current,detail,links,fingerprint,empty,busy,inputMatches:!!input&&compact(input.value)===plate,
  exact,different:!truncated&&plates.length===1&&plates[0]!==plate,ids:exact?[...ids].slice(0,5):[],ambiguous:exact&&ids.size>1};
}
function expression(args){return '(()=>{const __name=fn=>fn;return ('+gloarAdvertisementPageAction.toString()+')('+JSON.stringify(args)+');})()';}
function proof(snapshot,plate){
 if(snapshot?.ambiguous)throw failure('GLOAR_AMBIGUOUS');
 if(snapshot?.detail&&snapshot.exact&&snapshot.ids?.length===1&&/^[1-9][0-9]{5,11}$/u.test(snapshot.ids[0]))return {status:'found',plate,id:snapshot.ids[0],provider:'gloar',sourceUrl:snapshot.sourceUrl};
 return null;
}

export async function searchGloarAdvertisement({plate,browser,signal,pollMs=180}={}){
 if(typeof plate!=='string'||!PLATE.test(plate))throw failure('INVALID_PLATE');
 if(typeof browser?.newPage!=='function')throw failure('BROWSER_UNAVAILABLE');
 check(signal);let page;
 try{
  page=await browser.newPage({signal});await page.goto(GLOAR_HOME);check(signal);
  const read=async operation=>{check(signal);try{const value=await page.evaluate(expression({operation,plate}));check(signal);if(value?.error)throw failure(value.error);return value;}catch(error){check(signal);if(error?.code==='PAGE_CONTEXT_UNAVAILABLE')return {pending:true,navigationTransition:true};throw error;}};
  let initial;
  for(let i=0;i<32;i++){initial=await read('probe');if(initial?.ready)break;await pause(signal,pollMs);}
  if(!initial?.ready)throw failure('GLOAR_INPUT_MISSING');
  let prepared;
  for(let i=0;i<16;i++){prepared=await read('prepare');if(prepared?.prepared||prepared?.navigationTransition)break;await pause(signal,pollMs);}
  if(!prepared?.prepared&&!prepared?.navigationTransition)throw failure('GLOAR_INPUT_MISSING');
  await pause(signal,pollMs);
  let focused;
  for(let i=0;i<16;i++){focused=await read('focus');if(focused?.focused)break;await pause(signal,pollMs);}
  if(!focused?.focused)throw failure('GLOAR_FOCUS_FAILED');
  try{await page.keypress('Enter');}catch{check(signal);throw failure('GLOAR_ENTER_FAILED');}
  check(signal);
  let result,stable='',stableCount=0;
  for(let i=0;i<60;i++){
   result=await read('read');const found=proof(result,plate);if(found)return found;
   const changed=result?.fingerprint!==initial.fingerprint||result?.url!==initial.url||result?.empty!==initial.empty;
   const before=new Set((initial.fingerprint||'').split('|'));
   const newLinks=Array.isArray(result?.links)&&result.links.some(url=>!before.has(url));
   if(result?.ready&&!result.busy&&changed&&(result.inputMatches||result.detail||newLinks||result.empty&&!initial.empty)){
    const key=(result.sourceUrl||result.url||'')+'|'+result.fingerprint+'|'+result.empty;
    stableCount=key===stable?stableCount+1:1;stable=key;
    if(stableCount>=3&&(result.links?.length||result.empty||result.detail))break;
   }else{stableCount=0;stable='';}
   await pause(signal,pollMs);
  }
  if(!result?.ready||result.busy||stableCount<3)throw failure('GLOAR_SEARCH_UNCONFIRMED');
  if(result.detail)throw failure('GLOAR_ID_UNVERIFIED');
  if(result.empty&&!result.links.length)return {status:'not_found',plate,provider:'gloar',code:'NOT_FOUND'};
  const previous=new Set((initial.fingerprint||'').split('|')),added=result.links.filter(url=>!previous.has(url));
  const eligible=added.length?added:result.links,candidates=eligible.slice(0,6);let different=0,unverified=false;
  for(const url of candidates){
   check(signal);await page.goto(url);
   let detail,otherCount=0;
   for(let i=0;i<16;i++){
    detail=await read('read');const found=proof(detail,plate);if(found)return found;
    if(detail?.detail&&detail.ready&&!detail.busy&&detail.different){if(++otherCount>=2)break;}else otherCount=0;
    await pause(signal,pollMs);
   }
   if(otherCount>=2)different++;else unverified=true;
  }
  if(candidates.length&&candidates.length===eligible.length&&different===candidates.length&&!unverified)return {status:'not_found',plate,provider:'gloar',code:'NOT_FOUND'};
  throw failure(unverified?'GLOAR_ID_UNVERIFIED':'GLOAR_SEARCH_UNCONFIRMED');
 }catch(error){if(signal?.aborted||error?.name==='AbortError')throw Object.assign(failure('ABORTED'),{name:'AbortError'});if(/^[A-Z][A-Z0-9_]{0,63}$/u.test(error?.code||''))throw error;throw failure('GLOAR_UNAVAILABLE');}
 finally{await release(page);}
}

export async function findGloarAdvertisement({plate,env={},signal,waitUntil,createBrowser=createBrowserSession,pollMs=180}={}){
 if(typeof plate!=='string'||!PLATE.test(plate))throw failure('INVALID_PLATE');
 check(signal);let browser;
 try{browser=await createBrowser(env,{signal,waitUntil,gloarOnly:true});check(signal);return await searchGloarAdvertisement({plate,browser,signal,pollMs});}
 finally{await release(browser);}
}
