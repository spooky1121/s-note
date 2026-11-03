/* Authorized customer list: identity search stays in this view's private memory. */
(function(){
 'use strict';
 let dispose=null,viewSequence=0;
 const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu,'');
 function maskIdentity(value){const digits=String(value||'').replace(/\D/g,'');return digits.length===13?digits.slice(0,6)+'-*******':digits.length===10?digits.slice(0,3)+'-**-*****':digits?'확인 필요':'미등록';}
 function searchable(value){if(value==null)return '';if(Array.isArray(value))return value.map(searchable).join(' ');if(typeof value==='object')return Object.entries(value).filter(([key])=>!['rrnCipher','identityCipher','customerSignature','contractData'].includes(key)).map(([,item])=>searchable(item)).join(' ');return String(value);}
 function clear(){dispose?.();dispose=null;}
 async function mount({host,records,readIdentities,isCurrent,carFor,renderRow}){
  clear();let rows=records,values=new Map(),failed=new Set(),pending=true,disposed=false,lastQuery=null,queryVersion=0;const viewId=++viewSequence;
  host.innerHTML='<div class="snote-customer-search"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="snote-customer-search" type="search" autocomplete="off" spellcheck="false" aria-label="고객 통합 검색" placeholder="이름, 주민번호, 전화번호, 차량번호, 주소, 차명, 제조사 검색"></label><span id="snote-customer-count" role="status" aria-live="polite"></span></div><div class="zc72-customers"><div class="tablewrap"><table><thead><tr><th>차량</th><th>고객</th><th>주민번호 / 사업자번호</th><th>상태</th><th>주소</th><th>관리</th></tr></thead><tbody id="snote-customer-rows"></tbody></table></div></div><div id="snote-customer-empty" class="empty" hidden></div><nav id="customer-pagination" class="snote-pagination" aria-label="고객 목록 페이지"></nav>';
  const input=host.querySelector('#snote-customer-search'),body=host.querySelector('tbody'),count=host.querySelector('#snote-customer-count'),empty=host.querySelector('#snote-customer-empty');
  function render(){
   if(disposed||!isCurrent())return;
   if(input.value!==lastQuery){lastQuery=input.value;queryVersion++;}
   const terms=input.value.trim().split(/\s+/).map(normalize).filter(Boolean);
   const filtered=rows.filter(record=>{const car=carFor(record),haystack=normalize(searchable(record)+' '+searchable(car)+' '+(values.get(String(record.carId))||''));return terms.every(term=>haystack.includes(term));});
   count.textContent=`${filtered.length}명`+(pending?' · 식별번호 확인 중':'');
   const visible=window.snote236Paginate(filtered,'customers',viewId+':'+queryVersion,'customer-pagination',render);
   body.innerHTML=visible.map(record=>{const id=String(record.carId),identity=values.has(id)?maskIdentity(values.get(id)):failed.has(id)?'조회 실패':record.rrnCipher&&pending?'확인 중…':'미등록';return renderRow(record,identity,carFor(record));}).join('');
   empty.hidden=filtered.length>0;empty.textContent=rows.length?'검색 결과가 없습니다.':'저장된 고객이 없습니다.';
  }
  input.addEventListener('input',render);
  dispose=()=>{disposed=true;rows=[];values.clear();failed.clear();lastQuery=null;input.value='';input.removeEventListener('input',render);};
  render();
  try{const result=await readIdentities(records);if(disposed||!isCurrent())return;values=result.values;failed=result.failed;}catch(_){if(disposed||!isCurrent())return;failed=new Set(rows.filter(record=>record.rrnCipher).map(record=>String(record.carId)));}
  pending=false;render();
 }
 window.SnoteCustomerList=Object.freeze({mount,clear,maskIdentity});
 addEventListener('pagehide',clear);
})();
