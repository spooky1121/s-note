/* Upgrade existing close controls without changing their handlers or dirty/save rules. */
(function(){
 'use strict';
 function mark(button){button.classList.add('snote-popup-close');button.textContent='×';button.removeAttribute('title');if(!button.hasAttribute('aria-label'))button.setAttribute('aria-label','닫기');}
 const specs=[
  ['#overlay','.modal','.close','760px'],
  ['#vin-select-overlay','.vin-select-dialog','.vin-select-head .close','980px'],
  ['#quote-overlay','.quote-window','.quote-close','960px'],
  ['#contract-overlay','.contract-window','.contract-close','930px'],
  ['#status-overlay','.status-confirm-card','.close','520px'],
  ['#ps-confirm-overlay','.modal','.close','520px'],
  ['#zc-dashboard-gate','.zc71-dialog','.zc71-x','480px'],
  ['#zc-auto-reg-overlay','.zc71-dialog','.zc71-x','1100px'],
  ['#zc182-finance-overlay','.zc182-modal','.zc182-close','760px'],
  ['#zc80-unlock','.zc80-unlock-card','button[onclick*="zc80DismissUnlock"]','480px'],
  ['#zc85-postcode-overlay','.zc85-postcode-dialog','#zc85-postcode-close','560px'],
  ['#zc76-receipt-overlay','.zc76-window','button[onclick="zc76CloseReceipt()"]','1000px']
 ];
 function upgrade(){
  for(const [rootSelector,cardSelector,closeSelector,width] of specs){
   const root=document.querySelector(rootSelector),card=root?.querySelector(cardSelector),button=root?.querySelector(closeSelector);
   if(!card||!button||root.dataset.snotePopupReady==='1')continue;
   root.dataset.snotePopupReady='1';
   const frame=document.createElement('div');frame.className='snote-popup-frame';frame.style.setProperty('--snote-popup-width',width);
   card.before(frame);frame.append(card,button);card.classList.add('snote-popup-card');root.classList.add('snote-popup-overlay');mark(button);
  }
  for(const selector of ['#vehicle-overlay .detail-close','#zc72-sale-modal .zc72-close','.mobile-drawer-close']){const button=document.querySelector(selector);if(button&&!button.classList.contains('snote-popup-close'))mark(button);}
  for(const dialog of document.querySelectorAll('dialog')){
   if(dialog.classList.contains('snote-popup-native'))continue;
   let button=dialog.querySelector('button[aria-label*="닫기"],button.close-dialog,form[method="dialog"] button');
   if(!button)continue;
   const form=button.closest('form[method="dialog"]');if(form&&!form.id)form.id=dialog.id+'-close-form';if(form)button.setAttribute('form',form.id);
   const content=document.createElement('div');content.className='snote-popup-native-body';content.append(...dialog.childNodes);dialog.append(content,button);dialog.classList.add('snote-popup-native');mark(button);
  }
  const calculator=document.getElementById('snote-calculator-close');if(calculator&&!calculator.classList.contains('snote-popup-close')){const panel=document.getElementById('snote-calculator-panel'),content=document.createElement('div');content.className='snote-calculator-content';content.append(...panel.childNodes);panel.append(content,calculator);mark(calculator);}
  for(const [id,handler] of [['zoom-overlay','closeZoom()'],['snote201-image-zoom','snote201CloseImageZoom()']]){
   const zoom=document.getElementById(id),zoomClose=zoom?.querySelector('button[onclick="'+handler+'"]');
   if(zoomClose&&!zoomClose.classList.contains('snote-popup-close')){const frame=document.createElement('div'),body=document.createElement('div');frame.className='snote-popup-frame';body.className='snote-zoom-body';body.append(...zoom.childNodes);frame.append(body,zoomClose);zoom.append(frame);zoom.classList.add('snote-popup-overlay');mark(zoomClose);}
  }
 }
 upgrade();let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;upgrade();});}).observe(document.body,{childList:true,subtree:true});
})();
