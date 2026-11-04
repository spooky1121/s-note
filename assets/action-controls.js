/* Reuse the vehicle-detail disk and one red outline printer. Keep buttons and handlers intact. */
(()=>{'use strict';if(window.snoteActionControls)return;window.snoteActionControls=true;
 const shapes={save:'<path d="M5 3h12l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 3v6h9V3M7 21v-7h10v7M13 5v2"/>',print:'<path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z"/><path d="M17 11h.01"/>'};
 function upgrade(button){if(!(button instanceof HTMLButtonElement)||button.id==='zc-cloud-status'||button.classList.contains('snote-popup-close'))return;
  const label=[button.getAttribute('aria-label'),button.dataset.tooltip,button.textContent].filter(Boolean).join(' ');
  if(/닫기|취소/.test(label)&&!/저장/.test(label))return;
  const kind=button.hasAttribute('data-document-print')||/인쇄|출력|print/i.test(label)||['print-button','income-print'].includes(button.id)?'print':/저장/.test(label)||['save-now','income-save','vehicle-header-save','snote214-save-customer'].includes(button.id)?'save':null;
  if(!kind)return;let svg=button.querySelector('svg');
  if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');button.prepend(svg);}
  if(svg.dataset.snoteActionSymbol!==kind){svg.innerHTML=shapes[kind];svg.dataset.snoteActionSymbol=kind;svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.classList.add('snote-action-symbol');}
  const own='snote-'+kind+'-control',other='snote-'+(kind==='print'?'save':'print')+'-control';if(!button.classList.contains(own))button.classList.add(own);if(button.classList.contains(other))button.classList.remove(other);
  const iconOnly=!button.textContent.trim();button.classList.toggle('snote-action-icon-only',iconOnly);
 }
 function scan(root){if(!(root instanceof Element))return;if(root.matches('button'))upgrade(root);root.querySelectorAll('button').forEach(upgrade);}
 scan(document.body);new MutationObserver(records=>{for(const r of records){if(r.type==='attributes')upgrade(r.target);else{upgrade(r.target.closest?.('button'));for(const node of r.addedNodes)scan(node);}}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-label','data-tooltip']});
})();
