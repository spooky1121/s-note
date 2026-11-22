/* Accountant mobile landing tasks: verified read-only evidence, never inferred balances. */
(()=>{'use strict';
 const host=document.getElementById('snote-accountant-today');if(!host)return;
 const mobile=matchMedia('(max-width:760px)'),bridge=()=>window.snoteMobileOfficeTasksBridge;
 let signature='',paintedKey=null,scheduled=false;
 const node=(tag,text,cls)=>{const value=document.createElement(tag);if(text!=null)value.textContent=text;if(cls)value.className=cls;return value;};
 function reset(){host.hidden=true;host.replaceChildren();signature='';paintedKey=null;}
 function open(kind,key){if(paintedKey!==key||bridge()?.current?.(key)!==true)return;bridge()?.open?.(kind,key);refresh();}
 function task(kind,title,evidence,caption,key){
  const card=node('article',null,'snote-office-task');card.dataset.officeTask=kind;card.dataset.verified=String(evidence!==null);
  const row=node('div',null,'snote-office-task-head');row.append(node('h3',title));
  if(evidence===null){row.append(node('span','확인 중','snote-office-task-unknown'));card.append(row,node('p','자료와 저장 상태를 확인한 뒤 표시합니다.'));return card;}
  const count=node('strong',Number(evidence.count).toLocaleString('ko-KR')+(kind==='documents'?'대':'건'),'snote-office-task-count');row.append(count);card.append(row,node('p',caption));
  if(evidence.count>0){const button=node('button','확인하기','snote-office-task-open');button.type='button';button.setAttribute('aria-label',title+' '+count.textContent+' 확인하기');button.onclick=()=>open(kind,key);card.append(button);}
  else card.append(node('span',kind==='documents'?'확인된 재고 서류 미등록 내역이 없습니다.':'확인된 미상환 내역이 없습니다.','snote-office-task-empty'));
  return card;
 }
 function refresh(){
  scheduled=false;if(!mobile.matches){reset();return;}
  let value;try{value=bridge()?.snapshot?.();}catch{reset();return;}
  if(!value||typeof value.key!=='string'||bridge()?.current?.(value.key)!==true){reset();return;}
  if(value.key!==paintedKey){host.replaceChildren();signature='';paintedKey=value.key;}
  const next=JSON.stringify(value);if(signature===next){host.hidden=false;return;}signature=next;
  const panel=node('section',null,'snote-office-today-card');panel.append(node('h2','오늘 처리할 일'));
  const tasks=node('div',null,'snote-office-today-list');tasks.append(task('documents','재고 서류 확인',value.documents,'자동차등록증·성능기록부 등록 기준',value.key),task('finance','미상환 재고금융',value.finance,'판매 여부와 별도로 남은 원금 기준',value.key));panel.append(tasks);host.replaceChildren(panel);host.dataset.state=value.settled?'ready':'pending';host.setAttribute('aria-busy',String(!value.settled));host.hidden=false;
 }
 function schedule(){if(!scheduled){scheduled=true;queueMicrotask(refresh);}}
 for(const event of ['snote:route-changed','snote:company-cars-ready','snote:inventory-finance-ready','snote:sales-data-changed','snote:vehicle-documents-ready'])addEventListener(event,schedule);
 addEventListener('snote:auth-reset',reset);addEventListener('pagehide',reset);mobile.addEventListener('change',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
 // Readiness can change after a CAS without a new route. Only the currently
 // authorized mobile office is projected, and unchanged snapshots keep the DOM.
 setInterval(()=>{if(!document.hidden&&(paintedKey||typeof route==='string'&&route==='contractOffice'))refresh();},1000);
 window.SnoteMobileOfficeTasks=Object.freeze({refresh,reset});refresh();
})();
