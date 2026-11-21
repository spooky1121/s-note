/* Fit the complete editable sheet to both viewport axes without changing print geometry. */
(()=>{'use strict';
 if(window.SnoteDocumentViewport)return;
 const specs=[['contract-overlay','contract-paper'],['zc76-receipt-overlay','zc76-receipt-paper']];
 let frame=0;
 const property=(element,name,value)=>{if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);};
 function fit(){
  frame=0;if(window.matchMedia('print').matches)return;
  const viewport=window.visualViewport,width=Math.min(innerWidth,viewport?.width||innerWidth),height=Math.min(innerHeight,viewport?.height||innerHeight);
  for(const [rootId,paperId]of specs){
   const root=document.getElementById(rootId),paper=document.getElementById(paperId),holder=root?.querySelector('.snote-popup-frame');
   if(!root||!paper||!holder||root.hidden||getComputedStyle(root).display==='none')continue;
   // Measuring an already zoomed auto-height sheet can round its height by a
   // pixel differently at each scale. Measure at 1 in the same animation frame
   // and restore before painting, so the action rail and sheet stay still.
   const previousZoom=paper.style.getPropertyValue('zoom'),priority=paper.style.getPropertyPriority('zoom');
   let naturalWidth,naturalHeight;
   paper.style.setProperty('zoom','1','important');
   try{naturalWidth=Math.max(paper.offsetWidth,paper.scrollWidth);naturalHeight=Math.max(paper.offsetHeight,paper.scrollHeight);}
   finally{if(previousZoom)paper.style.setProperty('zoom',previousZoom,priority);else paper.style.removeProperty('zoom');}
   if(!(naturalWidth>0&&naturalHeight>0))continue;
   const availableWidth=Math.max(1,width-68),availableHeight=Math.max(1,height-28);
   let scale=Math.max(.03,Math.min(1,availableWidth/naturalWidth,availableHeight/naturalHeight)),box;
   // Auto-sized rows and browser font hinting can grow a few pixels under zoom.
   // Resolve that rounding in this frame, rather than chasing it frame to frame.
   for(let attempt=0;attempt<4;attempt++){
    property(root,'--snote-document-scale',String(scale));box=paper.getBoundingClientRect();
    const correction=Math.min(1,availableWidth/box.width,availableHeight/box.height);
    if(correction>=1)break;
    scale=Math.max(.03,scale*correction*.9999);
   }
   property(root,'--snote-document-scale',String(scale));box=paper.getBoundingClientRect();
   const scaledWidth=Math.ceil(box.width),scaledHeight=Math.ceil(box.height)+2;
   property(root,'--snote-document-width',scaledWidth+'px');
   property(root,'--snote-document-height',scaledHeight+'px');
   property(root,'--snote-document-frame-width',(scaledWidth+44)+'px');
  }
 }
 function queue(){if(!frame)frame=requestAnimationFrame(fit);}
 for(const name of ['resizeContractPreview','zc76FitReceipt']){const prior=window[name];if(typeof prior==='function')window[name]=function(...args){const value=prior.apply(this,args);queue();return value;};}
 const observer=new ResizeObserver(queue);
 for(const [,paperId]of specs){const paper=document.getElementById(paperId);if(paper)observer.observe(paper);}
 new MutationObserver(records=>{if(records.some(record=>specs.some(([id])=>{const root=document.getElementById(id);return root&&(record.target===root||root.contains(record.target));})))queue();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','hidden','src']});
 window.addEventListener('resize',queue);window.addEventListener('afterprint',queue);
 window.visualViewport?.addEventListener('resize',queue);
 document.addEventListener('input',event=>{if(event.target.closest?.('#contract-paper,#zc76-receipt-paper'))queue();});
 document.fonts?.ready.then(queue);document.fonts?.addEventListener('loadingdone',queue);
 window.SnoteDocumentViewport=Object.freeze({refresh:queue});queue();
})();
