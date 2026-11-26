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
 function reset(){const s=session;session=null;if(!s)return;s.live=false;s.version++;clearInterval(s.timer);s.data=null;s.query=null;s.pendingDocument=null;s.root.replaceChildren();s.root.remove();}
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
 async function openDocument(s,kind,origin){
  if(!current(s)||s.busy||s.loading||s.pendingDocument||s.documentReadFailed||typeof s.bridge.openDocument!=='function')return;
  s.busy=true;disableDocuments(s,true);status(s,'문서를 여는 중입니다.');
  try{const opened=await s.bridge.openDocument(s.context,kind,origin,()=>current(s));if(current(s))status(s,opened===false?'문서를 열지 못했습니다. 다시 확인해 주세요.':'',opened===false?'error':'');}catch{if(current(s))status(s,'문서를 열지 못했습니다. 다시 확인해 주세요.','error');}
  finally{if(current(s)){s.busy=false;disableDocuments(s,false);}}
 }
 function disableDocuments(s,busy){for(const item of s.root.querySelectorAll('[data-business-document],[data-business-upload],[data-business-delete],[data-business-file],[data-business-document-retry]'))item.disabled=busy||s.loading||item.dataset.documentReady!=='true'||(s.documentReadFailed||!!s.pendingDocument)&&!item.hasAttribute('data-business-document-retry');s.root.setAttribute('aria-busy',String(busy||s.loading));}
 function documentRow(s,kind){return s.data?.documents.find(row=>row.kind===kind);}
 function documentError(error){const code=String(error?.code||'');if(/CONFLICT/.test(code))return '다른 화면에서 서류가 변경되었습니다. 최신 등록 상태를 확인해 주세요.';if(/TOO_LARGE|LIMIT|SIZE/.test(code))return '사진은 5MB 이하로 등록해 주세요.';if(/MEDIA|IMAGE|FILE_INVALID|INVALID_FILE/.test(code))return 'JPG, PNG, WebP 이미지 파일을 확인해 주세요.';if(/INVALID_REQUEST/.test(code))return '서류 사진과 파일명을 확인한 뒤 다시 선택해 주세요.';if(/SETUP_REQUIRED/.test(code))return '운영 서류 저장소 설정을 확인해 주세요.';if(/FORBIDDEN|CONTEXT|AUTH|TOKEN/.test(code))return '로그인과 상사 권한을 다시 확인해 주세요.';return '저장 결과를 확인하지 못했습니다. 같은 작업을 다시 시도해 주세요.';}
 async function confirmDocument(s,text,unchanged){
  if(!current(s)||s.busy||s.loading||s.pendingDocument)return false;s.busy=true;disableDocuments(s,true);
  try{return typeof root.snoteConfirm==='function'&&await root.snoteConfirm(text,{isCurrent:()=>current(s)&&unchanged()})===true&&current(s)&&unchanged();}catch{return false;}finally{if(current(s)){s.busy=false;disableDocuments(s,false);}}
 }
 async function changeDocument(s,row,file,action){
  if(!current(s)||s.busy||s.loading||s.pendingDocument||s.documentReadFailed||!row.mutable||documentRow(s,row.kind)!==row)return;
  const method=action==='upload'?'uploadDocument':'deleteDocument';if(typeof s.bridge[method]!=='function')return;
  if(action==='upload'){try{model.validatePhoto(file);}catch(error){status(s,documentError(error),'error');return;}}
  const unchanged=()=>documentRow(s,row.kind)===row;
  if((action==='delete'||row.status==='ready')&&!await confirmDocument(s,action==='delete'?row.label+' 사진을 삭제할까요?':row.label+' 사진을 새 사진으로 바꿀까요?',unchanged))return;
  if(!current(s)||s.busy||s.loading||!unchanged())return;
  const requestId=root.crypto?.randomUUID?.();if(!requestId){status(s,'사진 저장을 준비하지 못했습니다. 브라우저를 다시 열어 주세요.','error');return;}
  const request={kind:row.kind,expectedRevision:row.revision,requestId,...(action==='upload'?{file}:{fileId:row.fileId})};s.pendingDocument={action,request};await submitDocument(s);
 }
 async function submitDocument(s){
  const job=s.pendingDocument;if(!current(s)||!job||s.busy||s.loading)return;
  const method=job.action==='upload'?'uploadDocument':'deleteDocument';if(typeof s.bridge[method]!=='function')return;
  s.busy=true;disableDocuments(s,true);status(s,job.action==='upload'?'사진을 저장하고 있습니다.':'사진을 삭제하고 있습니다.');let failure=null;
  try{
   const ack=await s.bridge[method](s.context,job.request,()=>current(s)&&s.pendingDocument===job);if(!current(s)||s.pendingDocument!==job)return;
   if(ack?.ok!==true)throw Object.assign(Error('OFFICE_ACK_INVALID'),{code:'OFFICE_ACK_INVALID'});
   const updated=model.document(ack.document);if(updated.kind!==job.request.kind||!updated.mutable||updated.revision!==job.request.expectedRevision+1||updated.status!==(job.action==='upload'?'ready':'missing'))throw Object.assign(Error('OFFICE_ACK_INVALID'),{code:'OFFICE_ACK_INVALID'});
   s.data=Object.freeze({documents:Object.freeze(s.data.documents.map(row=>row.kind===updated.kind?updated:row))});s.documentReadFailed=false;s.pendingDocument=null;renderDocuments(s);status(s,job.action==='upload'?'사진을 등록했습니다.':'사진을 삭제했습니다.','success');
  }catch(error){if(current(s)&&s.pendingDocument===job){failure=error;if(model.definitePhotoFailure(error))s.pendingDocument=null;status(s,documentError(error),'error');}}
  finally{if(current(s)){s.busy=false;disableDocuments(s,false);}}
  if(failure&&current(s)){const text=documentError(failure);await load(s,{keepError:true});if(current(s)){renderDocuments(s);status(s,text,'error');}}
 }
 function renderDocuments(s){
  const grid=node('div','snote-business-documents');
  for(const row of s.data.documents){const tile=node('article','snote-business-document'),open=button('','snote-business-document-open'),label=node('span','snote-business-document-label',row.label),state=node('span','snote-business-document-state',row.status==='ready'?'등록됨':row.status==='missing'?'미등록':'확인 필요');
   tile.dataset.businessDocumentKind=row.kind;open.dataset.businessDocument=row.kind;open.dataset.documentReady=String(row.status==='ready'&&typeof s.bridge.openDocument==='function');open.disabled=open.dataset.documentReady!=='true';open.setAttribute('aria-label',row.label+(row.status==='ready'?' 열기':' · '+state.textContent));open.append(symbol(row.kind),label);open.onclick=()=>void openDocument(s,row.kind,open);tile.append(open,state);if(row.filename){const name=node('small','snote-business-document-filename',row.filename);name.title=row.filename;tile.append(name);}
   const actions=node('div','snote-business-document-actions'),upload=button(row.status==='ready'?'사진 교체':'사진 등록'),input=node('input');upload.dataset.businessUpload=row.kind;upload.dataset.documentReady=String(row.mutable&&typeof s.bridge.uploadDocument==='function');upload.setAttribute('aria-label',row.label+' '+upload.textContent);input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.dataset.businessFile=row.kind;input.dataset.documentReady=upload.dataset.documentReady;input.setAttribute('aria-label',row.label+' 사진 선택');upload.onclick=()=>{if(current(s)&&!s.busy&&!s.loading&&!s.pendingDocument&&documentRow(s,row.kind)===row)input.click();};input.onchange=()=>{const file=input.files?.[0];input.value='';if(file)void changeDocument(s,row,file,'upload');};actions.append(upload,input);
   if(row.status==='ready'){const remove=button('','snote-business-document-delete');remove.dataset.businessDelete=row.kind;remove.dataset.documentReady=String(row.mutable&&typeof s.bridge.deleteDocument==='function');remove.title=row.label+' 사진 삭제';remove.setAttribute('aria-label',remove.title);remove.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="#fff0f1"/><path d="M7 12h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';remove.onclick=()=>void changeDocument(s,row,null,'delete');actions.append(remove);}
   if(s.pendingDocument?.request.kind===row.kind){const retry=button('다시 시도');retry.dataset.businessDocumentRetry=row.kind;retry.dataset.documentReady='true';retry.setAttribute('aria-label',row.label+' 사진 '+(s.pendingDocument.action==='upload'?'저장':'삭제')+' 다시 시도');retry.onclick=()=>void submitDocument(s);actions.append(retry);}tile.append(actions);grid.append(tile);
  }
  s.list.replaceChildren(grid);disableDocuments(s,s.busy);
 }
 async function load(s,{keepError=false}={}){
  if(!current(s)||s.loading||s.busy)return false;
  const version=++s.version;s.loading=true;if(s.reload)s.reload.disabled=true;s.root.setAttribute('aria-busy','true');if(s.page==='acctOperations')disableDocuments(s,false);if(!keepError)status(s,'자료를 불러오고 있습니다.');
  let timer;
  try{const raw=await Promise.race([s.bridge.load(s.context,s.page),new Promise((_,reject)=>{timer=root.setTimeout(()=>reject(Error('BUSINESS_READ_TIMEOUT')),20000);})]);if(!current(s)||version!==s.version)return false;s.data=model.normalize(s.page,raw);s.documentReadFailed=false;s.pageNumber=1;if(s.page==='acctOperations')renderDocuments(s);else renderList(s);status(s,'');return true;}
  catch{if(current(s)&&version===s.version){if(s.page==='acctOperations'){s.documentReadFailed=true;if(s.data)renderDocuments(s);else message(s,'자료를 확인하지 못했습니다.');const retry=button('다시 시도');retry.dataset.businessLoadRetry='';retry.onclick=()=>void load(s);s.list.append(retry);}else{s.data=null;message(s,'자료를 확인하지 못했습니다. 다시 불러오기를 눌러 주세요.');}status(s,'자료를 확인하지 못했습니다.','error');}return false;}
  finally{root.clearTimeout(timer);if(current(s)&&version===s.version){s.loading=false;if(s.reload)s.reload.disabled=false;s.root.setAttribute('aria-busy','false');if(s.page==='acctOperations')disableDocuments(s,false);}}
 }
 function mount(host,{page,bridge=root.snoteAccountantBusinessBridge}={}){
  if(!(host instanceof root.Element)||!VALID_PAGES.has(page)||!bridge||typeof bridge.context!=='function'||typeof bridge.current!=='function'||typeof bridge.load!=='function')return false;
  let context;try{context=bridge.context(page);}catch{return false;}if(!context?.ready||bridge.current(context)!==true){reset();return false;}
  if(session&&session.host===host&&session.page===page&&session.bridge===bridge&&current(session)&&session.context.key===context.key)return true;
  reset();const section=node('section','snote-accountant-business-page'),tools=node('div','snote-business-toolbar'),statusElement=node('p','snote-business-status'),list=node('div','snote-business-list'),reload=button('다시 불러오기');section.id='snote-accountant-business-page';section.dataset.businessPage=page;section.dataset.accountantPage=page;section.setAttribute('aria-label',({acctCustomers:'판매완료 고객',acctDealerIncome:'직원 사업소득',acctOperations:'운영 서류함'})[page]);statusElement.id='snote-business-status';statusElement.setAttribute('role','status');statusElement.setAttribute('aria-live','polite');reload.dataset.businessReload='';
  const s={host,root:section,bridge,page,context,live:true,version:++sequence,loading:false,busy:false,data:null,pageNumber:1,status:statusElement,list,reload:page==='acctOperations'?null:reload,query:null,timer:null,pendingDocument:null};session=s;
  if(page!=='acctOperations'){const search=node('label','search snote-business-search'),input=node('input');input.type='search';input.id='snote-business-query';input.maxLength=120;input.setAttribute('aria-label',page==='acctCustomers'?'고객·연락처·차량 검색':'차량·담당 딜러 검색');input.placeholder=input.getAttribute('aria-label');input.oninput=()=>{s.pageNumber=1;renderList(s);};search.append(searchIcon(),input);tools.append(search);s.query=input;}
  if(page!=='acctOperations'){tools.append(reload);section.append(tools);}section.append(statusElement,list);host.replaceChildren(section);reload.onclick=()=>void load(s);message(s,'자료를 불러오고 있습니다.');s.timer=setInterval(()=>{if(!current(s))reset();},250);void load(s);return true;
 }
 for(const name of ['snote:auth-reset','pagehide'])root.addEventListener(name,reset);
 root.addEventListener('snote:route-changed',event=>{if(session&&event.detail?.page!==session.page)reset();});
 root.SnoteAccountantBusinessPages=Object.freeze({mount,reset,beforeLeave:()=>{if(!session||!current(session)||!session.busy)return true;status(session,'서류 처리가 끝난 뒤 이동해 주세요.');return false;}});
 root.dispatchEvent(new Event('snote:accountant-business-pages-ready'));
})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const DOCUMENTS=Object.freeze([['businessRegistration','사업자등록증'],['vehicleBusinessRegistration','자동차관리사업 등록증'],['shareholders','주주명부'],['corporatePassbook','법인 통장사본'],['representativeId','대표자 신분증']].map(([kind,label])=>Object.freeze({kind,label})));
 const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value),invalid=()=>{throw Error('INVALID_BUSINESS_PROJECTION');};
 const PHOTO_BYTES=5*1024*1024,PHOTO_MIMES=Object.freeze(['image/jpeg','image/png','image/webp']),UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 function text(value,max,{optional=false}={}){if(optional&&(value===undefined||value===null))return '';if(typeof value!=='string'||Array.from(value).length>max||/[\u0000-\u001f\u007f]/.test(value))invalid();return value;}
 function date(value){if(value===undefined||value===null||value==='')return '';if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||value.startsWith('0000'))invalid();const d=new Date(value+'T12:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)invalid();return value;}
 function amount(value){if(value===undefined||value===null||value==='')return null;if(typeof value!=='number'||!Number.isSafeInteger(value)||Math.abs(value)>9999999999999)invalid();return Object.is(value,-0)?0:value;}
 function document(row){
  const item=DOCUMENTS.find(item=>item.kind===row?.kind);if(!plain(row)||!item||!['ready','missing','unavailable'].includes(row.status))invalid();
  const base={...item,status:row.status,filename:text(row.filename,180,{optional:true})};if(/[\\/]/.test(base.filename))invalid();
  // Older display-only bridges cannot grant mutations by setting canUpload.
  // A complete canonical revision/file record is required as well.
  if(!['revision','fileId','mimeType','size','updatedAt'].some(key=>Object.hasOwn(row,key)))return Object.freeze({...base,revision:null,fileId:null,mimeType:null,size:0,updatedAt:null,mutable:false});
  if(!Number.isSafeInteger(row.revision)||row.revision<0||!Number.isSafeInteger(row.size)||row.size<0||row.size>PHOTO_BYTES||!(row.updatedAt===null||typeof row.updatedAt==='string'&&Number.isFinite(Date.parse(row.updatedAt))))invalid();
  if(row.status==='ready'){if(row.revision<1||!UUID.test(row.fileId||'')||!PHOTO_MIMES.includes(row.mimeType)||row.size<1||!base.filename||row.updatedAt===null)invalid();}
  else if(row.status!=='missing'||row.fileId!==null||row.mimeType!==null||row.size!==0||base.filename)invalid();
  return Object.freeze({...base,revision:row.revision,fileId:row.fileId,mimeType:row.mimeType,size:row.size,updatedAt:row.updatedAt,mutable:row.canUpload===true});
 }
 function validatePhoto(file){
  const fail=code=>{throw Object.assign(Error(code),{code});};if(!file||typeof file.name!=='string'||!file.name.trim()||Array.from(file.name).length>180||/[\u0000-\u001f\u007f/\\]/.test(file.name)||!PHOTO_MIMES.includes(file.type)||!Number.isSafeInteger(file.size)||file.size<1)fail('OFFICE_FILE_INVALID');if(file.size>PHOTO_BYTES)fail('OFFICE_FILE_TOO_LARGE');return true;
 }
 function definitePhotoFailure(error){return /CONFLICT|FORBIDDEN|CONTEXT|AUTH|TOKEN|TOO_LARGE|MEDIA|IMAGE|FILE_INVALID|INVALID_FILE|INVALID_REQUEST|SETUP_REQUIRED/.test(String(error?.code||''));}
 function normalize(page,value){
  if(!plain(value)||value.complete!==true)invalid();
  if(page==='acctOperations'){
   if(!Array.isArray(value.documents)||value.documents.length!==DOCUMENTS.length)invalid();const rows=new Map();
   for(const row of value.documents){if(!plain(row)||rows.has(row.kind))invalid();rows.set(row.kind,document(row));}
   return Object.freeze({documents:Object.freeze(DOCUMENTS.map(item=>rows.get(item.kind)))});
  }
  const key=page==='acctCustomers'?'customers':page==='acctDealerIncome'?'incomes':null;if(!key||!Array.isArray(value[key])||value[key].length>10000)invalid();const ids=new Set(),rows=value[key].map(row=>{
   if(!plain(row))invalid();const id=text(row.id,500);if(!id||ids.has(id))invalid();ids.add(id);const common={id,plate:text(row.plate,32,{optional:true}),model:text(row.model,200,{optional:true}),soldAt:date(row.soldAt),dealerName:text(row.dealerName,120,{optional:true})};
   if(key==='customers')return Object.freeze({...common,name:text(row.name,120,{optional:true}),phone:text(row.phone,40,{optional:true})});
   if(!['reported','unreported','unverified'].includes(row.reportStatus))invalid();return Object.freeze({...common,reportedAmount:amount(row.reportedAmount),reportedDate:date(row.reportedDate),reportStatus:row.reportStatus,savedIncomeAmount:amount(row.savedIncomeAmount)});
  });return Object.freeze({[key]:Object.freeze(rows)});
 }
 return Object.freeze({normalize,documents:DOCUMENTS,document,validatePhoto,definitePhotoFailure,photoBytes:PHOTO_BYTES});
});
