/* Accountant business views consume only the host's verified company projections. */
(function(root,factory){
 'use strict';const model=factory();
 if(typeof module==='object'&&module.exports)module.exports=model;
 if(!root?.document||root.SnoteAccountantBusinessPages)return;
 const doc=root.document,VALID_PAGES=new Set(['acctCustomers','acctDealerIncome','acctOperations']);
 const node=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
 let session=null,sequence=0;
 function current(s){
  if(session!==s||!s.live||!s.host.isConnected||!s.host.contains(s.root))return false;
  try{const now=s.bridge.context(s.page);return !!now?.ready&&now.key===s.context.key&&s.bridge.current(s.context)===true;}catch{return false;}
 }
 function reset(){const s=session;session=null;if(!s)return;s.live=false;s.version++;clearInterval(s.timer);s.data=null;s.query=null;s.root.replaceChildren();s.root.remove();}
 function status(s,text,tone=''){if(!current(s))return;s.status.textContent=text;s.status.dataset.tone=tone;}
 function searchIcon(){const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),path=doc.createElementNS(svg.namespaceURI,'path');for(const[key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','aria-hidden':'true'}))svg.setAttribute(key,value);path.setAttribute('d','m16 16 5 5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0');svg.append(path);return svg;}
 function button(label,cls='snote-business-button'){const e=node('button',cls,label);e.type='button';return e;}
 function symbol(kind){
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg'),p=doc.createElementNS(svg.namespaceURI,'path');
  svg.setAttribute('viewBox','0 0 48 56');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const marks={businessRegistration:'M14 37V23h18v14M18 27h3m6 0h2m-11 5h3m6 0h2M21 37v-5h4v5',vehicleBusinessRegistration:'m13 31 3-7h16l3 7M12 31h24v9H12zM16 40v3m16-3v3m-16-8h3m10 0h3',shareholders:'M23 25a5 5 0 1 1-10 0 5 5 0 0 1 10 0m13 3a4 4 0 1 1-8 0 4 4 0 0 1 8 0M10 41v-4a8 8 0 0 1 16 0v4m2-8a7 7 0 0 1 10 6v2',corporatePassbook:'M12 23h24v17H12zM12 28h24m-19 7h8',representativeId:'M11 22h26v19H11zM23 29a3 3 0 1 1-6 0 3 3 0 0 1 6 0m-8 9a5 5 0 0 1 10 0m3-10h6m-6 5h6'};
  p.setAttribute('d','M8 3h23l10 10v40H8zM31 3v11h10'+marks[kind]);svg.append(p);return svg;
 }
 function message(s,text){s.list.replaceChildren(node('p','snote-business-empty',text));}
 function makeTable(s,headers,rows,values,id){
  const wrap=node('div','snote-business-table-scroll'),table=node('table','snote-business-table'),head=node('thead'),hr=node('tr'),body=node('tbody');table.id=id;
  for(const label of headers){const th=node('th','',label);th.scope='col';hr.append(th);}head.append(hr);
  for(const row of rows){const tr=node('tr');tr.dataset.businessRow=row.id;for(const [i,value]of values(row).entries()){const td=node('td',typeof value==='object'&&value?.negative?'snote-business-negative':'',typeof value==='object'?value.text:value);td.dataset.label=headers[i];tr.append(td);}body.append(tr);}
  table.append(head,body);wrap.append(table);return wrap;
 }
 const money=value=>value===null?'—':Number(value).toLocaleString('ko-KR')+'원';
 function renderList(s){
  if(!current(s)||!s.data)return;
  const query=(s.query?.value||'').trim().toLocaleLowerCase('ko-KR'),items=s.page==='acctCustomers'?s.data.customers:s.data.incomes;
  const rows=items.filter(row=>!query||[row.name,row.phone,row.plate,row.model,row.dealerName].some(value=>String(value||'').toLocaleLowerCase('ko-KR').includes(query)));
  s.list.replaceChildren();if(!rows.length){message(s,query?'검색 결과가 없습니다.':s.page==='acctCustomers'?'판매완료 차량에 연결된 고객정보가 없습니다.':'판매완료 차량이 없습니다.');return;}
  const count=Math.max(1,Math.ceil(rows.length/30));s.pageNumber=Math.max(1,Math.min(s.pageNumber,count));const visible=rows.slice((s.pageNumber-1)*30,s.pageNumber*30);
  if(s.page==='acctCustomers')s.list.append(makeTable(s,['고객명','연락처','차량번호','차명','판매일','담당 딜러'],visible,row=>[row.name||'—',row.phone||'—',row.plate||'—',row.model||'—',row.soldAt||'—',row.dealerName||'—'],'snote-accountant-customers-table'));
  else s.list.append(makeTable(s,['차량번호','차명','판매일','담당 딜러','저장된 사업소득','소득신고액','신고일','신고정보'],visible,row=>[row.plate||'—',row.model||'—',row.soldAt||'—',row.dealerName||'—',{text:money(row.savedIncomeAmount),negative:row.savedIncomeAmount!==null&&row.savedIncomeAmount<0},{text:money(row.reportedAmount),negative:row.reportedAmount!==null&&row.reportedAmount<0},row.reportedDate||'—',({reported:'신고정보 등록',unreported:'미신고',unverified:'신고정보 없음'})[row.reportStatus]],'snote-accountant-income-table'));
  if(count>1){const pager=node('nav','snote-business-pagination'),previous=button('이전'),next=button('다음');pager.setAttribute('aria-label','목록 페이지');previous.disabled=s.pageNumber===1;next.disabled=s.pageNumber===count;previous.onclick=()=>{if(current(s)&&s.pageNumber>1){s.pageNumber--;renderList(s);}};next.onclick=()=>{if(current(s)&&s.pageNumber<count){s.pageNumber++;renderList(s);}};pager.append(previous,node('span','',s.pageNumber+' / '+count),next);s.list.append(pager);}
 }
 async function openDocument(s,kind){
  if(!current(s)||s.busy||typeof s.bridge.openDocument!=='function')return;
  s.busy=true;disableDocuments(s,true);status(s,'문서를 여는 중입니다.');
  try{await s.bridge.openDocument(s.context,kind);if(current(s))status(s,'');}catch{if(current(s))status(s,'문서를 열지 못했습니다. 다시 확인해 주세요.','error');}
  finally{if(current(s)){s.busy=false;disableDocuments(s,false);}}
 }
 function disableDocuments(s,busy){for(const item of s.root.querySelectorAll('[data-business-document]'))item.disabled=busy||item.dataset.documentReady!=='true';}
 function renderDocuments(s){
  const grid=node('div','snote-business-documents');
  for(const row of s.data.documents){const tile=node('article','snote-business-document'),open=button('','snote-business-document-open'),label=node('span','snote-business-document-label',row.label),state=node('span','snote-business-document-state',row.status==='ready'?'등록됨':row.status==='missing'?'미등록':'확인 필요');
   tile.dataset.businessDocumentKind=row.kind;open.dataset.businessDocument=row.kind;open.dataset.documentReady=String(row.status==='ready'&&typeof s.bridge.openDocument==='function');open.disabled=open.dataset.documentReady!=='true';open.setAttribute('aria-label',row.label+(row.status==='ready'?' 열기':' · '+state.textContent));open.append(symbol(row.kind),label);open.onclick=()=>void openDocument(s,row.kind);tile.append(open,state);if(row.filename){const name=node('small','snote-business-document-filename',row.filename);name.title=row.filename;tile.append(name);}grid.append(tile);
  }
  s.list.replaceChildren(grid);
 }
 async function load(s){
  if(!current(s)||s.loading||s.busy)return false;
  const version=++s.version;s.loading=true;s.reload.disabled=true;s.root.setAttribute('aria-busy','true');status(s,'자료를 불러오고 있습니다.');
  let timer;
  try{const raw=await Promise.race([s.bridge.load(s.context,s.page),new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(Error('BUSINESS_READ_TIMEOUT')),20000);})]);if(!current(s)||version!==s.version)return false;s.data=model.normalize(s.page,raw);s.pageNumber=1;if(s.page==='acctOperations')renderDocuments(s);else renderList(s);status(s,'');return true;}
  catch{if(current(s)&&version===s.version){s.data=null;message(s,'자료를 확인하지 못했습니다. 다시 불러오기를 눌러 주세요.');status(s,'자료를 확인하지 못했습니다.','error');}return false;}
  finally{root.clearTimeout(timer);if(current(s)&&version===s.version){s.loading=false;s.reload.disabled=false;s.root.setAttribute('aria-busy','false');}}
 }
 function mount(host,{page,bridge=root.snoteAccountantBusinessBridge}={}){
  if(!(host instanceof root.Element)||!VALID_PAGES.has(page)||!bridge||typeof bridge.context!=='function'||typeof bridge.current!=='function'||typeof bridge.load!=='function')return false;
  let context;try{context=bridge.context(page);}catch{return false;}if(!context?.ready||bridge.current(context)!==true){reset();return false;}
  if(session&&session.host===host&&session.page===page&&session.bridge===bridge&&current(session)&&session.context.key===context.key)return true;
  reset();const section=node('section','snote-accountant-business-page'),tools=node('div','snote-business-toolbar'),statusElement=node('p','snote-business-status'),list=node('div','snote-business-list'),reload=button('다시 불러오기');section.id='snote-accountant-business-page';section.dataset.businessPage=page;section.dataset.accountantPage=page;section.setAttribute('aria-label',({acctCustomers:'판매완료 고객',acctDealerIncome:'딜러 소득신고 항목',acctOperations:'운영 서류함'})[page]);statusElement.id='snote-business-status';statusElement.setAttribute('role','status');statusElement.setAttribute('aria-live','polite');reload.dataset.businessReload='';
  const s={host,root:section,bridge,page,context,live:true,version:++sequence,loading:false,busy:false,data:null,pageNumber:1,status:statusElement,list,reload,query:null,timer:null};session=s;
  if(page!=='acctOperations'){const search=node('label','search snote-business-search'),input=node('input');input.type='search';input.id='snote-business-query';input.maxLength=120;input.setAttribute('aria-label',page==='acctCustomers'?'고객·연락처·차량 검색':'차량·담당 딜러 검색');input.placeholder=input.getAttribute('aria-label');input.oninput=()=>{s.pageNumber=1;renderList(s);};search.append(searchIcon(),input);tools.append(search);s.query=input;}
  tools.append(reload);section.append(tools,statusElement,list);host.replaceChildren(section);reload.onclick=()=>void load(s);message(s,'자료를 불러오고 있습니다.');s.timer=setInterval(()=>{if(!current(s))reset();},250);void load(s);return true;
 }
 for(const name of ['snote:auth-reset','pagehide'])root.addEventListener(name,reset);
 root.addEventListener('snote:route-changed',event=>{if(session&&event.detail?.page!==session.page)reset();});
 root.SnoteAccountantBusinessPages=Object.freeze({mount,reset,beforeLeave:()=>{if(!session||!current(session)||!session.busy)return true;status(session,'문서 열기가 끝난 뒤 이동해 주세요.');return false;}});
 root.dispatchEvent(new Event('snote:accountant-business-pages-ready'));
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const DOCUMENTS=Object.freeze([['businessRegistration','사업자등록증'],['vehicleBusinessRegistration','자동차관리사업 등록증'],['shareholders','주주명부'],['corporatePassbook','법인 통장사본'],['representativeId','대표자 신분증']].map(([kind,label])=>Object.freeze({kind,label})));
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),invalid=()=>{throw Error('INVALID_BUSINESS_PROJECTION');};
 function text(value,max,{optional=false}={}){if(optional&&(value===undefined||value===null))return '';if(typeof value!=='string'||Array.from(value).length>max||/[\u0000-\u001f\u007f]/.test(value))invalid();return value;}
 function date(value){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||value.startsWith('0000'))invalid();const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)invalid();return value;}
 function amount(value){if(value===undefined||value===null||value==='')return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||Math.abs(value)>9999999999999)invalid();return Object.is(value,-0)?0:value;}
 function normalize(page,value){
  if(!plain(value)||value.complete!==true)invalid();
  if(page==='acctOperations'){
   if(!Array.isArray(value.documents)||value.documents.length!==DOCUMENTS.length)invalid();const rows=new Map();
   for(const row of value.documents){if(!plain(row)||rows.has(row.kind)||!DOCUMENTS.some(item=>item.kind===row.kind)||!['ready','missing','unavailable'].includes(row.status))invalid();rows.set(row.kind,{kind:row.kind,status:row.status,filename:text(row.filename,180,{optional:true})});}
   return Object.freeze({documents:Object.freeze(DOCUMENTS.map(item=>Object.freeze({...item,...rows.get(item.kind)})))});
  }
  const key=page==='acctCustomers'?'customers':page==='acctDealerIncome'?'incomes':null;if(!key||!Array.isArray(value[key])||value[key].length>10000)invalid();const ids=new Set(),rows=value[key].map(row=>{
   if(!plain(row))invalid();const id=text(row.id,500);if(!id||ids.has(id))invalid();ids.add(id);const common={id,plate:text(row.plate,32,{optional:true}),model:text(row.model,200,{optional:true}),soldAt:date(row.soldAt),dealerName:text(row.dealerName,120,{optional:true})};
   if(key==='customers')return Object.freeze({...common,name:text(row.name,120,{optional:true}),phone:text(row.phone,40,{optional:true})});
   if(!['reported','unreported','unverified'].includes(row.reportStatus))invalid();return Object.freeze({...common,reportedAmount:amount(row.reportedAmount),reportedDate:date(row.reportedDate),reportStatus:row.reportStatus,savedIncomeAmount:amount(row.savedIncomeAmount)});
  });return Object.freeze({[key]:Object.freeze(rows)});
 }
 return Object.freeze({normalize,documents:DOCUMENTS});
});
