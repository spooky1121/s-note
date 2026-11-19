// Only the public GLOAR catalog is controlled here. The caller supplies a full
// plate, never a destination, page script, cookie, or API query parameter.
export const GLOAR_CATALOG = 'https://gloar-data.com/en/catalog';
const PLATE = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주))?\d{2,3}[가-힣]\d{4}$/u;
const abortError = () => Object.assign(new Error('REQUEST_ABORTED'), {name:'AbortError',code:'REQUEST_ABORTED'});
const check = signal => { if (signal?.aborted) throw abortError(); };
function pause(signal, milliseconds) {
  check(signal);
  return new Promise((resolve,reject) => {
    const stop = () => {clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(abortError());};
    const timer = setTimeout(() => {signal?.removeEventListener('abort',stop);resolve();},milliseconds);
    signal?.addEventListener('abort',stop,{once:true});
    if (signal?.aborted) stop();
  });
}

// Runs inside GLOAR's real browser tab. No external call or guessed search URL.
export function gloarPageAction({operation='read',plate}) {
  if (location.href === 'about:blank') return {pending:true};
  if (location.protocol !== 'https:' || location.hostname !== 'gloar-data.com' || location.port ||
      !/^\/en\/(?:catalog(?:\/.*)?|lot\/[^/]+)\/?$/.test(location.pathname)) return {error:'GLOAR_NAVIGATION_BLOCKED'};
  if (!document.body) return {pending:true};
  const compact = value => String(value||'').normalize('NFKC').replace(/[\s-]+/gu,'');
  const visible = element => {
    if (!element || element.closest('[hidden],[aria-hidden="true"],script,style,template')) return false;
    for (let p=element;p && p.nodeType===1;p=p.parentElement) {
      const style=getComputedStyle(p);
      if (style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse') return false;
    }
    return element.getClientRects().length>0;
  };
  const input = [...document.querySelectorAll('input')].slice(0,80).find(element =>
    visible(element) && /\bplate\b/i.test(element.placeholder||'') && /\b(?:vin|lot)\b/i.test(element.placeholder||''));
  if (/just a moment|access denied|verify you are human|attention required/i.test(document.title) ||
      [...document.querySelectorAll('iframe[src*="challenges.cloudflare.com"],[data-sitekey]')].some(visible)) return {error:'GLOAR_ACCESS_BLOCKED'};
  const detailURL = value => {
    try {
      const url=new URL(value,location.href);
      if (url.protocol!=='https:' || url.hostname!=='gloar-data.com' || url.port || url.username || url.password ||
          !/^\/en\/lot\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname) || url.href.length>2048) return '';
      url.search='';url.hash='';return url.href;
    } catch {return '';}
  };
  const links=[];
  for (const anchor of [...document.querySelectorAll('a[href]')].slice(0,800)) {
    const url=detailURL(anchor.href);
    if (url && visible(anchor) && !links.includes(url)) links.push(url);
    if (links.length>=60) break;
  }
  const fingerprint=links.join('|');
  if (operation==='prepare') {
    if (!input || document.readyState==='loading') return {pending:true};
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
    if (!setter) return {error:'GLOAR_SEARCH_UNSUPPORTED'};
    input.focus();setter.call(input,plate);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return {prepared:true,baseline:fingerprint};
  }
  const current=detailURL(location.href);
  const headings=[...document.querySelectorAll('h1,h2,h3,h4')].filter(visible);
  const boundary=headings.find(element => /^(?:similar|related|recommended|other vehicles|you may also|похожие|рекомендуемые)(?=$|[^\p{L}\p{N}_])/iu.test((element.textContent||'').trim()));
  const matcher=/(?<![\d가-힣])(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[ \t\u00a0]*)?\d{2,3}[ \t\u00a0]*[가-힣][ \t\u00a0]*\d{4}(?![\d가-힣])/gu;
  const chunks=[];let length=0,visited=0;
  if (current) {
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
    while ((node=walker.nextNode()) && visited++<5000) {
      const parent=node.parentElement;
      if (!parent || !visible(parent) || parent.closest('input,textarea,select,button,form,header,nav,footer,[role="search"],[data-related],.related,.recommendations')) continue;
      if (boundary && (parent===boundary || boundary.compareDocumentPosition(parent)&Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      const value=node.nodeValue||'';length+=value.length;
      if (length>18000) break;
      chunks.push(value);
    }
  }
  const plates=[...new Set([...chunks.join(' ').normalize('NFKC').matchAll(matcher)].map(match=>compact(match[0])))];
  const busy=[...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]')].some(visible);
  const empty=[...document.querySelectorAll('p,h1,h2,h3,span,output')].slice(0,2000).some(element=>
    visible(element) && /^(?:no (?:matching )?(?:results|vehicles|lots)(?: found)?[.!]?|nothing found|0 (?:results|vehicles|lots))$/i.test((element.textContent||'').trim()));
  return {ready:document.readyState!=='loading',inputMatches:!!input && compact(input.value)===plate,
    fingerprint,links,linkCount:links.length,busy,empty,
    url:current,title:(document.querySelector('h1')?.textContent||document.title||'').trim().slice(0,160),
    plates,exact:plates.length===1 && plates[0]===plate,other:plates.length===1 && plates[0]!==plate};
}

function expression(args) {
  return '(()=>{const __name=fn=>fn;return ('+gloarPageAction.toString()+')('+JSON.stringify(args)+');})()';
}

export async function searchGloarLinks({plate,browser,signal,pollMs=180}={}) {
  if (typeof plate!=='string' || !PLATE.test(plate) || typeof browser?.newPage!=='function') return {status:'error',code:'INVALID_REQUEST'};
  check(signal);let page;
  try {
    page=await browser.newPage({signal});await page.goto(GLOAR_CATALOG);check(signal);
    const read=async operation => {
      check(signal);
      try {const value=await page.evaluate(expression({operation,plate}));check(signal);return value;}
      catch(error) {check(signal);if(error?.code==='PAGE_CONTEXT_UNAVAILABLE') return {pending:true};throw error;}
    };
    let prepared;
    for (let i=0;i<32;i++) {
      prepared=await read('prepare');
      if (prepared?.error) return {status:'error',code:prepared.error};
      if (prepared?.prepared) break;
      await pause(signal,pollMs);
    }
    if (!prepared?.prepared) return {status:'error',code:'GLOAR_SEARCH_UNSUPPORTED'};
    await pause(signal,pollMs);await page.keypress('Enter');check(signal);
    let result,stable='',stableCount=0;
    for (let i=0;i<50;i++) {
      result=await read('read');
      if (result?.error) return {status:'error',code:result.error};
      if (result?.url && result.exact) return {status:'found',plate,links:[{url:result.url,title:result.title}]};
      if (result?.ready && !result.busy && result.inputMatches && result.fingerprint!==prepared.baseline) {
        stableCount=result.fingerprint===stable ? stableCount+1 : 1;stable=result.fingerprint;
        if (stableCount>=3 && (result.links.length || result.empty)) break;
      }
      await pause(signal,pollMs);
    }
    if (!result?.ready || result.busy || !result.inputMatches || stableCount<3) return {status:'error',code:'GLOAR_RESULTS_UNCONFIRMED'};
    if (result.empty && !result.linkCount) return {status:'not_found'};
    // Global-search suggestions can be appended after the unchanged 24-card
    // catalog. Check newly returned links first, not the old grid's first six.
    const previous=new Set((prepared.baseline||'').split('|'));
    const added=result.links.filter(url=>!previous.has(url));
    const eligible=added.length?added:result.links;
    const candidates=eligible.slice(0,6);let mismatched=0;
    for (const url of candidates) {
      check(signal);await page.goto(url);
      let detail,otherCount=0;
      for (let i=0;i<15;i++) {
        detail=await read('read');
        if (detail?.error) return {status:'error',code:detail.error};
        if (detail?.url && detail.exact) return {status:'found',plate,links:[{url:detail.url,title:detail.title}]};
        if (detail?.ready && !detail.busy && detail.other) {if(++otherCount>=2) break;} else otherCount=0;
        await pause(signal,pollMs);
      }
      if (otherCount>=2) mismatched++;
    }
    return candidates.length && candidates.length===eligible.length && mismatched===candidates.length
      ? {status:'not_found'} : {status:'error',code:'GLOAR_RESULTS_UNCONFIRMED'};
  } catch(error) {
    if (signal?.aborted || error?.name==='AbortError') throw abortError();
    return {status:'error',code:'GLOAR_UNAVAILABLE'};
  } finally {if(page) await page.close().catch(()=>{});}
}
