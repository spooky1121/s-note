/* Vehicle presentation only: retain every original control, handler and permission flag. */
(()=>{
 'use strict';
 if(window.SnoteDesignVehicle)return;
 const root=document.getElementById('vehicle-overlay');
 if(!root)return;
 const mobile=window.matchMedia('(max-width:760px)');
 const tabs=[['basic','기본정보','.vehicle-info-column'],['money','금액·금융','#car-cost-section'],['media','사진·서류','.vehicle-media-grid']];
 let selected='basic',wasOpen=false,frame=0;
 const text=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value;};
 const labels=new Map([
  ['vehicle-header-save','저장'],['vehicle-encar-check','엔카'],['vehicle-header-share','공유'],
  ['vehicle-header-delete','삭제'],['vehicle-header-received-leave','공유 취소']
 ]);
 function labelActions(){
  for(const button of root.querySelectorAll('#vehicle-header-actions>button')){
   const label=labels.get(button.id)||(button.classList.contains('contract-launch')?'판매진행':button.classList.contains('quote-launch')?'견적서':'');
   if(!label)continue;
   let caption=button.querySelector('.design-vehicle-action-label');
   if(!caption){caption=document.createElement('span');caption.className='design-vehicle-action-label';caption.setAttribute('aria-hidden','true');button.append(caption);}
   text(caption,label);
  }
 }
 function mount(){
  const heading=root.querySelector('.vehicle-heading');
  if(!heading)return;
  if(!document.getElementById('design-vehicle-summary')){
   const summary=document.createElement('div');summary.id='design-vehicle-summary';summary.className='design-vehicle-summary';
   const plate=document.createElement('strong');plate.id='design-vehicle-plate';
   const amount=document.createElement('div');amount.className='design-vehicle-summary-amount';
   const label=document.createElement('span');label.id='design-vehicle-price-label';
   const price=document.createElement('strong');price.id='design-vehicle-price';amount.append(label,price);summary.append(plate,amount);
   heading.insertBefore(summary,document.getElementById('vehicle-meta'));
  }
  if(!document.getElementById('design-vehicle-tabs')){
   const nav=document.createElement('div');nav.id='design-vehicle-tabs';nav.className='design-vehicle-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','차량 상세 항목');
   for(const[key,label,selector]of tabs){
    const panel=root.querySelector(selector);if(!panel)continue;
    if(!panel.id)panel.id='design-vehicle-panel-'+key;
    const button=document.createElement('button');button.type='button';button.id='design-vehicle-tab-'+key;button.dataset.vehicleTab=key;button.setAttribute('role','tab');button.setAttribute('aria-controls',panel.id);button.textContent=label;
    button.addEventListener('click',()=>select(key));nav.append(button);
   }
   nav.addEventListener('keydown',event=>{
    const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key)||!event.target.matches('[data-vehicle-tab]'))return;
    event.preventDefault();const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(event.target);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;
    select(buttons[next].dataset.vehicleTab);buttons[next].focus();
   });
   heading.append(nav);
  }
  labelActions();
 }
 function updateSummary(){
  const metrics=[...root.querySelectorAll('#vehicle-overview>.vehicle-metric')];
  const metric=label=>metrics.find(item=>item.querySelector('label')?.textContent.trim()===label);
  const meta=document.getElementById('vehicle-meta')?.textContent.split('·').map(value=>value.trim()).filter(Boolean)||[];
  const plate=metric('차량번호')?.querySelector('strong')?.textContent.trim()||meta.find(value=>!value.startsWith('담당 '))||'차량번호 미입력';
  text(document.getElementById('design-vehicle-plate'),plate);
  const priceMetric=metric('판매가')||metric('판매예정가')||metric('매입가격')||metric('매입가');
  const priceLabel=priceMetric?.querySelector('label')?.textContent.trim()||'판매예정가';
  let value=priceMetric?.querySelector('strong')?.textContent.trim()||'—';
  // Accounting has a separate editor; its hidden dealer inputs may contain a previous car.
  if(!document.body.classList.contains('accountant-mode')){
   const field=document.getElementById(priceLabel==='판매가'?'detail-sold-price':'detail-sell');
   if(priceMetric&&field){const digits=field.value.replace(/[^0-9]/g,'');value=digits?Number(digits).toLocaleString('ko-KR')+'원':'—';}
  }
  text(document.getElementById('design-vehicle-price-label'),priceLabel==='매입가격'?'매입가':priceLabel);
  text(document.getElementById('design-vehicle-price'),value);
 }
 function select(key){
  if(!tabs.some(([value])=>value===key))return;
  selected=key;applyTabs();
  // This navigation stays inside the drawer and never adds a popup/history entry.
  const modal=root.querySelector('.vehicle-modal');if(mobile.matches&&modal)modal.scrollTop=0;
 }
 function applyTabs(){
  const enabled=mobile.matches&&!document.body.classList.contains('accountant-mode');
  const nav=document.getElementById('design-vehicle-tabs');if(nav&&nav.hidden===enabled)nav.hidden=!enabled;
  for(const[key,,selector]of tabs){
   const panel=root.querySelector(selector),button=document.getElementById('design-vehicle-tab-'+key);if(!panel||!button)continue;
   // A presentation class never changes hidden, disabled or readonly from the permission layer.
   panel.classList.toggle('design-vehicle-inactive',enabled&&selected!==key);
   if(button.getAttribute('aria-selected')!==String(selected===key))button.setAttribute('aria-selected',String(selected===key));
   button.tabIndex=selected===key?0:-1;
   if(enabled){if(panel.getAttribute('role')!=='tabpanel')panel.setAttribute('role','tabpanel');if(panel.getAttribute('aria-labelledby')!==button.id)panel.setAttribute('aria-labelledby',button.id);}
   else{panel.removeAttribute('role');panel.removeAttribute('aria-labelledby');}
  }
 }
 function refresh(){
  frame=0;mount();
  const open=root.classList.contains('open');if(open&&!wasOpen)selected='basic';wasOpen=open;
  updateSummary();applyTabs();
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(refresh);};
 new MutationObserver(schedule).observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden']});
 new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
 root.addEventListener('input',event=>{if(event.target.matches('#detail-sell,#detail-sold-price'))updateSummary();});
 mobile.addEventListener('change',schedule);
 window.SnoteDesignVehicle=Object.freeze({refresh:schedule});
 refresh();
})();
