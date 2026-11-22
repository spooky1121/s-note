/* Load the mobile editor only after a current document has finished opening. */
(()=>{'use strict';
 if(window.SnoteMobileDocumentBoot)return;
 const mobile=matchMedia('(max-width:760px)'),ready=new Map();
 function read(kind){try{const root=document.getElementById(kind==='contract'?'contract-overlay':'zc76-receipt-overlay'),car=kind==='contract'?contractCarId:zc80ReceiptCarId,view=kind==='contract'?snote214ContractView:snote214ReceiptView;if(!currentUser||!car||activeCarId!==car||root?.hidden||root?.dataset.mobileDocumentReadyView!==String(view)||(kind==='contract'?!root.classList.contains('open'):!zc76ReceiptOpen)||!cars.some(c=>c.id===car&&canManageCar(c)))return null;return{actor:currentUser,car,view,page:route,root};}catch{return null;}}
 const current=(kind,context)=>{const now=read(kind);return ready.get(kind)===context&&!!now&&['actor','car','view','page','root'].every(key=>context[key]===now[key]);};
 function load(kind,context){if(!mobile.matches||!current(kind,context))return;context.root.removeAttribute('data-mobile-document-invalid');context.root.dataset.mobileDocumentLoading=String(context.view);const viewport=visualViewport;context.root.style.setProperty('--snote-mobile-doc-height',Math.max(200,Math.min(innerHeight,viewport?.height||innerHeight)-16)+'px');context.root.style.setProperty('--snote-mobile-doc-top',Math.max(0,viewport?.offsetTop||0)+'px');
  void window.SnoteFeatures.load('mobileDocument').then(()=>{if(mobile.matches&&current(kind,context))window.SnoteMobileDocumentEditor?.ready(kind);}).catch(()=>{if(mobile.matches&&current(kind,context))window.snoteNotify?.('문서 편집 화면을 불러오지 못했습니다. 문서를 다시 열어 주세요.',{tone:'error',isCurrent:()=>current(kind,context)});}).finally(()=>{if(context.root.dataset.mobileDocumentLoading===String(context.view)){context.root.removeAttribute('data-mobile-document-loading');if(!current(kind,context)&&!context.root.hidden&&(kind==='receipt'?zc76ReceiptOpen:context.root.classList.contains('open')))context.root.dataset.mobileDocumentInvalid='true';window.SnoteDocumentViewport?.refresh();}});
 }
 window.SnoteMobileDocumentBoot=Object.freeze({ready(kind){if(!['contract','receipt'].includes(kind))return;const context=read(kind);if(!context)return;ready.set(kind,context);load(kind,context);}});
 mobile.addEventListener('change',()=>{if(mobile.matches)for(const[kind,context]of ready)load(kind,context);});
 window.addEventListener('snote:auth-reset',()=>{for(const context of ready.values())context.root.removeAttribute('data-mobile-document-loading');ready.clear();});
})();
