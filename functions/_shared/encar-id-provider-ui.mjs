// Public search UI automation. Search URLs/parameters are never constructed.
// Labels below were observed on the public catalogs; live interaction still
// needs the user's production test. Synthetic DOM fixtures are not a capture.
const CATALOGS=Object.freeze({
 carnect:Object.freeze({url:'https://carnect.biz/catalog?tab=encar',host:'carnect.biz'}),
 gloar:Object.freeze({url:'https://gloar-data.com/en/catalog',host:'gloar-data.com'}),
 trust:Object.freeze({url:'https://encar.spb.ru/catalog/',host:'encar.spb.ru'})
});
const PLATE=/^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?[0-9]{2,3}[가-힣][0-9]{4}$/u;
function abortError(){return Object.assign(new Error('ABORTED'),{code:'ABORTED',name:'AbortError'});}
function check(signal){if(signal?.aborted)throw abortError();}
function pause(signal,ms=150){check(signal);return new Promise((resolve,reject)=>{const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(abortError());};const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();});}

// This entire function executes in the remote public page. It returns only
// bounded ID evidence and same-provider navigation targets, never page HTML.
export function providerPageAction({provider,plate,op='inspect',index=0,numericTrust=false}){
 const profiles={carnect:{host:'carnect.biz',detail:/^\/car\/[^/]+\/?$/},gloar:{host:'gloar-data.com',detail:/^\/en\/lot\/[^/]+\/?$/},trust:{host:'encar.spb.ru',detail:/^\/auto\/[^/]+\/?$/}};
 const profile=profiles[provider];if(profile&&location.href==='about:blank')return{pending:true,ready:false};if(!profile||location.protocol!=='https:'||location.hostname!==profile.host||location.port||location.hash)return{error:'PROVIDER_NAVIGATION_BLOCKED'};if(!document.body)return{pending:true,ready:false};
 const clean=value=>String(value||'').normalize('NFKC').replace(/[\s-]+/gu,'');
 const text=value=>String(value||'').replace(/\s+/gu,' ').trim();
 const visible=element=>{if(!element||element.closest('[hidden],[aria-hidden="true"],script,style,template'))return false;for(let parent=element;parent&&parent.nodeType===1;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse')return false;}return element.getClientRects().length>0;};
 const related=element=>{for(let parent=element;parent&&parent!==document.body;parent=parent.parentElement){const key=[parent.id,typeof parent.className==='string'?parent.className:'',parent.getAttribute('aria-label'),parent.getAttribute('data-section'),parent.getAttribute('data-testid')].filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ');if(/(?:^|\s)(?:similar|related|recommended|recommendations|recommendation)(?=$|\s)/iu.test(key)||/(?:похожие|рекомендуемые|другие)\s*(?:автомобили|машины|авто)/iu.test(key)||/(?:추천|유사|관련|다른)\s*(?:차량|매물|자동차)/u.test(key))return true;}return false;};
 const excluded=element=>{if(element.closest('input,textarea,select,button,form,header,nav,footer,[role="search"]')||related(element))return true;for(let parent=element,depth=0;parent&&depth<5;parent=parent.parentElement,depth++){if(/(?:^|[\s_-])(?:chip|searchbar|search-bar|search-input|search-form|filter|filters|filter-chip|breadcrumb)(?:$|[\s_-])/i.test(String(parent.className||'')))return true;}return false;};
 const plates=value=>{const found=[];const matcher=/(?<![0-9가-힣])(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[ \t\u00a0]*)?\d{2,3}[ \t\u00a0]*[가-힣][ \t\u00a0]*\d{4}(?![0-9가-힣])/gu;for(const match of String(value||'').normalize('NFKC').matchAll(matcher)){const value=clean(match[0]);if(!found.includes(value))found.push(value);if(found.length>8)break;}return found;};
 const detailURL=value=>{try{const url=new URL(value,location.href);if(url.href.length>2048||url.protocol!=='https:'||url.hostname!==profile.host||url.port||url.username||url.password||url.hash||!profile.detail.test(url.pathname))return'';return url.href;}catch{return'';}};
 const originalID=value=>{try{const url=new URL(value,location.href);if(url.protocol!=='https:'||!['fem.encar.com','www.encar.com','m.encar.com','encar.com'].includes(url.hostname)||url.port||url.username||url.password)return'';let id=/^\/cars\/detail\/([1-9][0-9]{5,11})(?:\/|$)/.exec(url.pathname)?.[1];if(!id&&/(?:^|\/)(?:dc_)?cardetail(?:view)?\.do$/i.test(url.pathname))for(const[key,value]of url.searchParams)if(key.toLowerCase()==='carid'&&/^[1-9][0-9]{5,11}$/.test(value))id=value;return id||'';}catch{return'';}};
 const links=[];for(const anchor of [...document.querySelectorAll('a[href]')].slice(0,1200)){const url=detailURL(anchor.href);if(!url||!visible(anchor))continue;if(url&&!links.includes(url))links.push(url);if(links.length>=40)break;}
 const detailButtons=[...document.querySelectorAll('button,[role="button"],a')].filter(button=>/^View details$/i.test(text(button.innerText||button.textContent))&&visible(button)&&!button.closest('header,nav,footer,form')&&!!button.closest('main,article,[data-car-id]')).slice(0,4);
 const buttonKeys=detailButtons.map(button=>{let card=button.closest('article,[data-car-id],[data-lot-id]');for(let parent=button.parentElement,depth=0;!card&&parent&&depth<4;parent=parent.parentElement,depth++){if(parent.querySelector('h1,h2,h3,h4,img'))card=parent;}return text((card||button.parentElement)?.innerText||(card||button.parentElement)?.textContent).slice(0,800);});
 const fingerprint=links.join('|')+'|buttons:'+JSON.stringify(buttonKeys);
 const inputCandidates=[...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="email"])')].slice(0,120);
 const score=input=>{const placeholder=text(input.placeholder);const labels=text([...(input.labels||[])].map(label=>label.textContent).join(' '));if(provider==='carnect')return /123\s*가\s*4567/u.test(placeholder)||/license\s*plate/i.test(labels+' '+placeholder)?10:0;if(provider==='gloar')return /\bplate\b/i.test(placeholder)&&/\b(?:vin|lot)\b/i.test(placeholder)?10:0;return placeholder==='364406'||/Номер\s+(?:автомобиля|авто)/i.test(labels)?10:0;};
 const input=inputCandidates.filter(input=>score(input)>0).sort((a,b)=>Number(visible(b))-Number(visible(a)))[0];
 if(op==='probe')return{ready:document.readyState!=='loading'&&!!input,fingerprint};
 if(op==='prepare'){
  if(document.readyState==='loading')return{pending:true,fingerprint};
  if(!input)return{pending:true,fingerprint};
  if(!visible(input)){const toggle=[...document.querySelectorAll('button,[role="button"]')].find(button=>visible(button)&&/^(?:Filters(?:\s+\d+)?|Все фильтры(?:\s+\d+)?|Фильтры(?:\s+\d+)?)$/i.test(text(button.innerText||button.textContent)));if(toggle)toggle.click();return{pending:true,fingerprint};}
  const baseline=fingerprint;
  // Trust may expose a digit-only search control. This changes the query
  // format only; advertisement evidence below still requires the full plate.
  const digits=plate.replace(/[^0-9]/g,'');
  const pattern=String(input.pattern||'').replace(/^\^|\$$/g,'');
  const numericControl=provider==='trust'&&(input.type==='number'||input.inputMode==='numeric'||/^(?:\\d|\[0-9\])(?:[+*?]|\{[0-9]+(?:,[0-9]*)?\})?$/.test(pattern));
  input.focus();const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;if(!setter)return{error:'PROVIDER_UNSUPPORTED'};
  setter.call(input,numericControl?digits:plate);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  // Activate only the actual search form's own visible search submit control.
  // An Enter key is used by the controller when no such control exists.
  const form=input.form;let submitted=false;
  if(form){const submit=[...form.querySelectorAll('button,input[type="submit"]')].find(button=>visible(button)&&/^(?:search|поиск|применить(?:\s+\d+\s+вариант(?:ов|а)?)?)$/i.test([button.innerText,button.textContent,button.value,button.getAttribute('aria-label')].map(text).find(Boolean)||''));if(submit){submit.click();submitted=true;}}
  const numericSearch=provider==='trust'&&(numericControl||clean(input.value)===digits);
  return{prepared:true,submitted,baseline,numericSearch};
 }
 if(op==='open_button'){
  const button=Number.isInteger(index)&&index>=0&&index<detailButtons.length?detailButtons[index]:null;
  if(!button)return{error:'PROVIDER_UNSUPPORTED'};button.click();return{clicked:true};
 }
 const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].slice(0,60).some(visible);
 const empty=[...document.querySelectorAll('p,h1,h2,h3,h4,div,span,output')].slice(0,3500).some(element=>element.children.length===0&&/^(?:0\s+(?:results?|vehicles?|вариант(?:ов|а)?|автомобил(?:ей|я)?)|no\s+(?:matching\s+)?(?:results?|vehicles?|matches)(?:\s+found)?[.!]?|nothing found|совпадений нет|ничего не найдено)$/i.test(text(element.innerText||element.textContent))&&visible(element));
 const isDetail=profile.detail.test(location.pathname);
 const boundary=isDetail?[...document.querySelectorAll('h1,h2,h3,h4')].find(heading=>visible(heading)&&/^(?:similar|related|recommended|похожие|рекомендуемые|другие автомобили|смотрите также|(?:추천|유사|관련|다른)\s*(?:차량|매물|자동차)(?:\s*(?:목록|보기|리스트))?)(?=$|[^\p{L}\p{N}_])/iu.test(text(heading.innerText||heading.textContent))):null;
 const afterBoundary=element=>!!boundary&&!!(boundary.compareDocumentPosition(element)&Node.DOCUMENT_POSITION_FOLLOWING);
 const blockTags=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DD','DIV','DL','DT','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TD','TH','TR','UL']);
 const textBlock=(element,root)=>{for(let parent=element;parent&&parent!==root;parent=parent.parentElement){const display=getComputedStyle(parent).display;if(/^(?:block|flex|grid|table|list-item|flow-root)/.test(display)||(!display&&blockTags.has(parent.tagName)))return parent;}return root;};
 const primaryText=element=>{const chunks=[];let size=0,visited=0,lastBlock=null;const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())&&visited++<3500){const parent=node.parentElement;if(!parent||parent===boundary||afterBoundary(parent)||excluded(parent)||!visible(parent))continue;const value=(node.nodeValue||'').replace(/[\t\r\n\f ]+/g,' '),block=textBlock(parent,element);if(lastBlock&&lastBlock!==block)chunks.push('\n');lastBlock=block;size+=value.length+1;if(size>18000)return null;chunks.push(value);}if(visited>3500)return null;return chunks.join('');};
 const ids=new Set();let exactPlateSeen=false,differentPlateSeen=false;
 const collect=element=>{
  if(!visible(element)||afterBoundary(element))return;const content=primaryText(element);if(content===null)return;const found=plates(content);if(found.length!==1)return;
  const anchors=[...element.querySelectorAll('a[href]')].slice(0,100).filter(anchor=>visible(anchor)&&!excluded(anchor)&&!afterBoundary(anchor));
  if(!isDetail&&new Set(anchors.map(anchor=>detailURL(anchor.href)).filter(Boolean)).size>1)return;
  const ownIDs=new Set();for(const anchor of anchors){const id=originalID(anchor.href);if(id)ownIDs.add(id);}
  const explicit=/(?:original\s+)?encar\s*(?:(?:advertisement|listing|ad|source|lot)\s*)?(?:id|number|no\.?|#)\s*[:#]?\s*([1-9][0-9]{5,11})(?![0-9])/ig;
  for(const match of content.matchAll(explicit))ownIDs.add(match[1]);
  if(provider==='trust')for(const match of content.matchAll(/(?:Номер\s+лота|Лот(?:\s+объявления)?)\s*[:№#]?\s*([1-9][0-9]{5,11})(?![0-9])/igu))ownIDs.add(match[1]);
  if(!ownIDs.size)return false;
  if(found[0]!==plate){if(isDetail)differentPlateSeen=true;return true;}
  for(const id of ownIDs)ids.add(id);exactPlateSeen=true;return true;
 };
 // Exact plate text must belong to a result/detail region, not the search input,
 // navigation, a search chip, or an unrelated recommendation card.
 const seeds=new Set();
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node,count=0;
 while((node=walker.nextNode())&&count++<9000){const element=node.parentElement;if(element&&plates(node.nodeValue).length)seeds.add(element);}
 // A styled plate value can split its digits and Korean letter across inline
 // elements. Aggregate only a short value/row, never the whole page or cards.
 for(const element of [...document.querySelectorAll('p,td,dd,dt,span,[data-plate],[data-license-plate],[class*="plate" i],[id*="plate" i]')].slice(0,1500)){
  if(!plates((element.textContent||'').replace(/\s+/gu,' ')).length)continue;
  if(element.matches('body,main,article,section,form,header,nav,footer,input,textarea,select,button')||element.querySelector('article,section,li,form,header,nav,footer,table,[data-car-id],[data-lot-id]')||excluded(element)||!visible(element)||afterBoundary(element))continue;
  const value=primaryText(element);if(value!==null&&value.length<=96&&plates(value).length===1)seeds.add(element);
 }
 for(const element of seeds){if(excluded(element)||!visible(element)||afterBoundary(element))continue;const value=primaryText(element);if(value===null)continue;if(plates(value).includes(plate))exactPlateSeen=true;const record=element.closest('article,[data-car-id],[data-lot-id]');for(let parent=element,depth=0;parent&&parent!==document.body&&depth<7;parent=parent.parentElement,depth++){
   if(excluded(parent))break;
   const content=parent.innerText||parent.textContent||'';if(content.length>18000)break;
   if((isDetail||parent.matches('article,[data-car-id],[data-lot-id]')||parent.querySelector('a[href]'))&&collect(parent))break;
   if(parent===record)break;
  }}
 const matchesSearch=value=>clean(value)===plate||(provider==='trust'&&numericTrust===true&&clean(value)===plate.replace(/[^0-9]/g,''));
 const inputMatches=!!input&&matchesSearch(input.value);const searchMatches=inputMatches||[...new URL(location.href).searchParams.values()].some(matchesSearch);
 return{url:location.href,detail:profile.detail.test(location.pathname),ready:document.readyState==='complete'||document.readyState==='interactive',busy,empty,fingerprint,links:links.slice(0,4),linkCount:links.length,buttonCount:detailButtons.length,inputMatches,searchMatches,exactPlateSeen,differentPlateSeen,ids:[...ids].slice(0,5)};
}
// Wrangler's keepNames transform adds __name calls inside the serialized action.
// CDP evaluates in a different JavaScript realm, so provide that trusted helper
// locally rather than relying on any module/global binding or rewriting code.
function expression(value){return'(()=>{const __name=(fn)=>fn;return('+providerPageAction.toString()+')('+JSON.stringify(value)+');})()';}
function evidence(snapshot,plate){if(snapshot?.error)return{status:'error',code:snapshot.error};if(snapshot?.ids?.length>1)return{status:'ambiguous',code:'AMBIGUOUS'};if(snapshot?.ids?.length===1&&/^[1-9][0-9]{5,11}$/.test(snapshot.ids[0]))return{status:'found',plate,id:snapshot.ids[0],sourceUrl:snapshot.url};return null;}

export async function searchBrowserProvider(provider,{plate,signal,browser}={}){
 const profile=CATALOGS[provider?.id];if(!profile||provider.host!==profile.host||provider.url!==profile.url||typeof plate!=='string'||!PLATE.test(plate))return{status:'error',code:'PROVIDER_UNSUPPORTED'};
 check(signal);let page,numericTrust=false;
 const read=async args=>{check(signal);try{const snapshot=await page.evaluate(expression({provider:provider.id,plate,numericTrust,...args}));check(signal);return snapshot;}catch(error){check(signal);if(error?.code==='PAGE_CONTEXT_UNAVAILABLE')return{pending:true,ready:false,navigationTransition:true};throw error;}};
 const inspect=()=>read({});
 try{
  page=await browser.newPage({signal});check(signal);await page.goto(profile.url);check(signal);
  let prepared;
  for(let attempt=0;attempt<22;attempt++){
   const before=await read({op:'probe'});if(before?.error)return{status:'error',code:before.error};if(!before?.ready){await pause(signal);continue;}
   prepared=await read({op:'prepare'});check(signal);
   // A form action can navigate before Runtime.evaluate acknowledges it. Its
   // submission is uncertain, so recover by reading rather than submitting it
   // again. The pre-action fingerprint still proves a changed result set.
   if(prepared?.navigationTransition){prepared={prepared:true,submitted:true,baseline:before.fingerprint,numericSearch:provider.id==='trust'};break;}
   if(prepared?.error)return{status:'error',code:prepared.error};if(prepared?.prepared)break;await pause(signal);
  }
  if(!prepared?.prepared)return{status:'error',code:'PROVIDER_UNSUPPORTED'};
  numericTrust=provider.id==='trust'&&prepared.numericSearch===true;
  if(!prepared.submitted){await page.keypress('Enter');check(signal);}
  let snapshot,stable='',stableCount=0;
  for(let attempt=0;attempt<34;attempt++){
   snapshot=await inspect();const result=evidence(snapshot,plate);if(result)return result;
   const changed=snapshot?.fingerprint!==prepared.baseline;
   if(snapshot?.ready&&!snapshot.busy&&snapshot.searchMatches&&changed){stableCount=snapshot.fingerprint===stable?stableCount+1:1;stable=snapshot.fingerprint;if(stableCount>=2){if(snapshot.empty&&snapshot.linkCount===0&&snapshot.buttonCount===0)return{status:'not_found'};if(snapshot.linkCount>0||snapshot.buttonCount>0)break;}}
   else{stableCount=0;stable='';}
   await pause(signal);
  }
  if(!snapshot?.ready||snapshot.busy||!snapshot.searchMatches||snapshot.fingerprint===prepared.baseline||stableCount<2)return{status:'error',code:'PROVIDER_SEARCH_UNCONFIRMED'};
  const candidates=snapshot.links.slice(0,3);
  let unmatched=0,unverified=false;
  for(const url of candidates){
   check(signal);await page.goto(url);
   let detail;
   for(let attempt=0;attempt<18;attempt++){detail=await inspect();const result=evidence(detail,plate);if(result)return result;if(detail?.detail&&detail.ready&&!detail.busy&&detail.differentPlateSeen&&!detail.exactPlateSeen&&attempt>=1)break;await pause(signal);}
   if(detail?.detail&&detail.ready&&!detail.busy&&detail.differentPlateSeen&&!detail.exactPlateSeen)unmatched++;else unverified=true;
  }
  if(!candidates.length&&snapshot.buttonCount){
   const opened=await read({op:'open_button',index:0});check(signal);
   if(opened?.error)return{status:'error',code:opened.error};
   for(let attempt=0;attempt<18;attempt++){const detail=await inspect();const result=evidence(detail,plate);if(result)return result;if(detail?.detail&&detail.ready&&!detail.busy&&detail.differentPlateSeen&&!detail.exactPlateSeen&&attempt>=1)return{status:'error',code:'PROVIDER_RESULT_MISMATCH'};await pause(signal);}
   return{status:'error',code:'PROVIDER_SEARCH_UNCONFIRMED'};
  }
  if(unverified)return{status:'error',code:'AD_ID_UNVERIFIED'};
  if(candidates.length&&snapshot.linkCount<=3&&unmatched===candidates.length)return{status:'not_found'};
  return{status:'error',code:snapshot.linkCount>3?'PROVIDER_RESULT_LIMIT':'PROVIDER_SEARCH_UNCONFIRMED'};
 }catch(error){if(signal?.aborted||error?.name==='AbortError')throw abortError();return{status:'error',code:/^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code||'')?error.code:'PROVIDER_UNAVAILABLE'};}
 finally{if(page)await page.close().catch(()=>{});}
}
