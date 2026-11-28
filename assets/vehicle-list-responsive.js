/* Presentation metadata only. Do not replace rows, copy amounts or persist a
   different column preference when the available screen width changes. */
(()=>{
 'use strict';
 if(window.SnoteVehicleListResponsive)return;
 const screen=document.getElementById('list-screen'),host=document.getElementById('list-table');
 if(!screen||!host)return;
 const desktop=matchMedia('(min-width:761px)'),roles=new WeakMap();
 const widths={model:210,owner:90,color:36,plate:84,year:50,mileage:80,purchaseDate:84,buyPrice:94,expectedSellPrice:94,expectedProfit:94,totalInvestment:94,additionalCosts:94,inventoryLoan:94,inventoryInterest:88,vin:130,lender:100,documents:44,quote:48,advertising:64,status:100,age:64};
 let queued=false;
 function rememberRole(node,value){
  if(!roles.has(node))roles.set(node,node.getAttribute('role'));
  if(node.getAttribute('role')!==value)node.setAttribute('role',value);
 }
 function restoreRoles(table){
  for(const node of [table,...table.querySelectorAll('thead,tbody,tr,th,td')]){
   if(node.tagName==='TD')node.removeAttribute('data-snote-list-label');
   if(!roles.has(node))continue;
   const previous=roles.get(node);if(previous===null)node.removeAttribute('role');else node.setAttribute('role',previous);
   roles.delete(node);
  }
 }
 function refresh(){
  queued=false;
  const table=host.querySelector('table'),header=table?.tHead?.rows[0],available=host.clientWidth;
  if(!table||!header){host.removeAttribute('data-snote-list-flow');host.removeAttribute('data-snote-list-flow-columns');return;}
  const headers=[...header.cells],visible=headers.filter(cell=>!cell.hidden&&getComputedStyle(cell).display!=='none');
  const required=visible.reduce((sum,cell)=>sum+(widths[cell.dataset.purchaseColumn]||100),0);
  // The module is independent of the deferred view/settings controllers. Treat
  // an as-yet uninitialised desktop view as its existing list default.
  const flow=desktop.matches&&screen.dataset.vehicleView!=='cards'&&available>0&&required>available;
  if(!flow){host.removeAttribute('data-snote-list-flow');host.removeAttribute('data-snote-list-flow-columns');restoreRoles(table);return;}
  const labels=headers.map(cell=>String(cell.dataset.sortLabel||cell.textContent).replace(/[↕↑↓▾]/g,'').trim());
  rememberRole(table,'table');rememberRole(table.tHead,'rowgroup');rememberRole(header,'row');
  for(const cell of headers)rememberRole(cell,'columnheader');
  for(const body of table.tBodies){
   rememberRole(body,'rowgroup');
   for(const row of body.rows){
    rememberRole(row,'row');
    for(const [index,cell] of [...row.cells].entries()){
     rememberRole(cell,'cell');
     if(cell.colSpan>1){cell.removeAttribute('data-snote-list-label');continue;}
     if(cell.getAttribute('data-snote-list-label')!==labels[index])cell.setAttribute('data-snote-list-label',labels[index]||'');
    }
   }
  }
  const columns=available>=850?'eight':available>=760?'six':'four';
  if(host.dataset.snoteListFlowColumns!==columns)host.dataset.snoteListFlowColumns=columns;
  if(host.dataset.snoteListFlow!=='true')host.dataset.snoteListFlow='true';
 }
 function queue(){if(!queued){queued=true;queueMicrotask(refresh);}}
 new MutationObserver(queue).observe(host,{subtree:true,childList:true});
 new MutationObserver(queue).observe(screen,{attributes:true,attributeFilter:['data-vehicle-view','data-purchase-hidden-columns','data-purchase-columns-active']});
 if(typeof ResizeObserver==='function')new ResizeObserver(queue).observe(host);else addEventListener('resize',queue);
 desktop.addEventListener('change',queue);
 for(const name of ['snote:route-changed','snote:auth-reset','snote-fonts-enlarged'])addEventListener(name,queue);
 window.SnoteVehicleListResponsive=Object.freeze({refresh});refresh();
})();
