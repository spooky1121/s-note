/* Authorized customer list: identity search stays in this view's private memory. */
(function(){
 'use strict';
 let dispose=null,viewSequence=0;
 const viewKey='snote:customer-list-view:v1',viewModes=['list','cards'];
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu,'');
 function maskIdentity(value){const digits=String(value||'').replace(/\D/g,'');return digits.length===13?digits.slice(0,6)+'-*******':digits.length===10?digits.slice(0,3)+'-**-*****':digits?'확인 필요':'미등록';}
 function searchable(value){if(value==null)return '';if(Array.isArray(value))return value.map(searchable).join(' ');if(typeof value==='object')return Object.entries(value).filter(([key])=>!['rrnCipher','identityCipher','customerSignature','contractData'].includes(key)).map(([,item])=>searchable(item)).join(' ');return String(value);}
 function clear(){dispose?.();dispose=null;}
 async function mount({host,records,readIdentities,isCurrent,carFor,renderRow}){
  clear();let rows=records,values=new Map(),failed=new Set(),pending=true,disposed=false,lastQuery=null,queryVersion=0;const viewId=++viewSequence;
  host.innerHTML='<section id="snote-customer-view" data-customer-view="list" aria-label="고객 목록"><div class="snote-customer-search"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="snote-customer-search" type="search" autocomplete="off" spellcheck="false" aria-label="고객 통합 검색" placeholder="이름, 주민번호, 전화번호, 차량번호, 주소, 차명, 제조사 검색"></label><span id="snote-customer-count" role="status" aria-live="polite"></span></div><div class="zc72-customers"><div id="snote-customer-view-toolbar"><div class="snote-customer-view-toggle" role="group" aria-label="고객 보기 방식"></div></div><div class="tablewrap"><table><thead><tr><th>차량</th><th>고객</th><th>주민번호 / 사업자번호</th><th>상태</th><th>주소</th><th>관리</th></tr></thead><tbody id="snote-customer-rows"></tbody></table></div></div><div id="snote-customer-empty" class="empty" hidden></div><nav id="customer-pagination" class="snote-pagination" aria-label="고객 목록 페이지"></nav></section>';
  const input=host.querySelector('#snote-customer-search'),body=host.querySelector('tbody'),count=host.querySelector('#snote-customer-count'),empty=host.querySelector('#snote-customer-empty');
  const view=host.querySelector('#snote-customer-view'),group=host.querySelector('.snote-customer-view-toggle');
  const icons={list:'<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',cards:'<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2"/><rect x="14" y="14" width="6.5" height="6.5" rx="1.2"/>'};
  function applyView(mode,persist=false){if(disposed||!isCurrent())return;if(!viewModes.includes(mode))mode='list';view.dataset.customerView=mode;for(const button of group.children)button.setAttribute('aria-pressed',String(button.dataset.customerViewChoice===mode));if(persist)try{localStorage.setItem(viewKey,mode);}catch{}}
  function chooseView(event){const button=event.target.closest('[data-customer-view-choice]');if(button&&group.contains(button))applyView(button.dataset.customerViewChoice,true);}
  function viewKeydown(event){if(disposed||!isCurrent())return;const buttons=[...group.children],index=buttons.indexOf(event.target);if(index<0)return;let next;if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();applyView(buttons[next].dataset.customerViewChoice,true);buttons[next].focus({preventScroll:true});}
  for(const mode of viewModes){const button=document.createElement('button'),label=mode==='cards'?'카드 보기':'목록 보기';button.type='button';button.className='snote-list-action';button.dataset.customerViewChoice=mode;button.dataset.tooltip=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed','false');button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[mode]+'</svg>';group.append(button);}
  group.addEventListener('click',chooseView);group.addEventListener('keydown',viewKeydown);
  let savedView='list';try{savedView=localStorage.getItem(viewKey);}catch{}applyView(savedView);
  function render(){
   if(disposed||!isCurrent())return;
   if(input.value!==lastQuery){lastQuery=input.value;queryVersion++;}
   const terms=input.value.trim().split(/\s+/).map(normalize).filter(Boolean);
   const filtered=rows.filter(record=>{const car=carFor(record),haystack=normalize(searchable(record)+' '+searchable(car)+' '+(values.get(String(record.carId))||''));return terms.every(term=>haystack.includes(term));});
   count.textContent=`${filtered.length}명`+(pending?' · 식별번호 확인 중':'');
   const visible=window.snote236Paginate(filtered,'customers',viewId+':'+queryVersion,'customer-pagination',render);
   const pageCount=view.querySelector('#customer-pagination .snote-page-count');if(pageCount)pageCount.textContent=pageCount.textContent.replace(/^총 (\d+)대/,'총 $1명');
   body.innerHTML=visible.map(record=>{const id=String(record.carId),identity=values.has(id)?maskIdentity(values.get(id)):failed.has(id)?'조회 실패':record.rrnCipher&&pending?'확인 중…':'미등록';return renderRow(record,identity,carFor(record));}).join('');
   empty.hidden=filtered.length>0;empty.textContent=rows.length?'검색 결과가 없습니다.':'저장된 고객이 없습니다.';
  }
  window.SnoteListSort?.values('customers',(record,label)=>{const car=carFor(record);if(label==='차량')return car?.model||record.carModel||'';if(label==='고객')return record.name||'';if(label.includes('주민'))return (values.get(String(record.carId))||'').slice(0,6);if(label==='상태')return car?.status==='판매완료'?'판매완료':'판매중';if(label==='주소')return record.address||record.addressBase||'';return record.updatedAt||0;});
  input.addEventListener('input',render);
  dispose=()=>{window.SnoteListSort?.unbind('customers');disposed=true;rows=[];values.clear();failed.clear();lastQuery=null;input.value='';input.removeEventListener('input',render);group.removeEventListener('click',chooseView);group.removeEventListener('keydown',viewKeydown);body.replaceChildren();count.textContent='';empty.textContent='';empty.hidden=true;const pages=view.querySelector('#customer-pagination');pages.replaceChildren();pages.hidden=true;};
  render();
  try{const result=await readIdentities(records);if(disposed||!isCurrent())return;values=result.values;failed=result.failed;}catch(_){if(disposed||!isCurrent())return;failed=new Set(rows.filter(record=>record.rrnCipher).map(record=>String(record.carId)));}
  pending=false;render();
 }
 window.SnoteCustomerList=Object.freeze({mount,clear,maskIdentity});
 addEventListener('pagehide',clear);
 addEventListener('pageshow',event=>{if(event.persisted===true&&typeof route==='string'&&route==='users'&&window.snoteWorkspaceVisible?.()===true&&typeof window.buildCustomerManagement==='function')void window.buildCustomerManagement();});
})();
