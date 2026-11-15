/* A confirmed registration is revealed in its owner's purchase view only. */
(() => {
 'use strict';
 if (window.SnotePurchaseRegistrationSuccess) return;
 let job = null, pin = null;
 const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
 const actorNow = () => typeof currentUser === 'undefined' ? null : currentUser;
 const pageNow = () => typeof route === 'undefined' ? '' : route;
 const frame = callback => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(callback) : setTimeout(callback, 0);
 const stopFrame = handle => typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(handle) : clearTimeout(handle);
 function permitted(entry) {
  try {
   return !!entry && actorNow() === entry.actor && entry.valid() === true &&
    typeof cars !== 'undefined' && cars.some(car => String(car.id) === entry.id && car.ownerId === entry.actor.username && car.status !== '판매완료');
  } catch { return false; }
 }
 function removeNotice(entry) {
  clearTimeout(entry.timer);stopFrame(entry.frame);
  entry.observer?.disconnect();entry.notice?.remove();
 }
 function settle(entry, value) {
  if (entry.settled) return;
  entry.settled = true;removeNotice(entry);
  if (job === entry) job = null;
  entry.resolve(value);
 }
 function cancel() {
  if (job) settle(job, false);
  pin = null;
 }
 function prioritize(rows, key) {
  if (!pin || key !== 'vehicles') return rows;
  if (pageNow() !== 'buy' || !permitted(pin)) { pin = null;return rows; }
  const index = rows.findIndex(car => String(car.id) === pin.id);
  if (index <= 0) return rows;
  return [rows[index], ...rows.slice(0,index), ...rows.slice(index+1)];
 }
 function rendered() {
  const entry = pin;
  if (!entry || entry.animated || entry.scheduled || pageNow() !== 'buy' || !permitted(entry)) return;
  entry.scheduled = true;
  frame(() => {
   entry.scheduled = false;
   if (pin !== entry || entry.animated || pageNow() !== 'buy' || !permitted(entry)) return;
   const matches = [...document.querySelectorAll('#list-table [data-registration-car-id],#list-mobile [data-registration-car-id]')]
    .filter(element => element.dataset.registrationCarId === entry.id && element.getClientRects().length > 0);
   if (!matches.length) return;
   entry.animated = true;
   for (const element of matches) {
    element.classList.add('snote-registration-created');
    if (!reduced()) {
     element.addEventListener('animationend', () => element.classList.remove('snote-registration-created'), {once:true});
    }
    setTimeout(() => element.classList.remove('snote-registration-created'), 1500);
   }
   const first = matches[0];
   first.scrollIntoView?.({block:'nearest',behavior:reduced() ? 'auto' : 'smooth'});
   if (document.activeElement === document.body || !document.activeElement?.getClientRects().length) first.focus?.({preventScroll:true});
  });
 }
 function notice() {
  const root = document.createElement('div');
  root.id = 'snote-purchase-registration-success';root.className = 'snote-registration-success';
  root.setAttribute('role','status');root.setAttribute('aria-live','polite');root.setAttribute('aria-atomic','true');
  root.innerHTML = '<div class="snote-registration-success-card"><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="27"/><path d="m20 32 8 8 17-18"/></svg><strong>저장 되었습니다.</strong></div>';
  document.body.append(root);return root;
 }
 function reveal(entry) {
  if (job !== entry || !permitted(entry) || pageNow() !== entry.startPage) { settle(entry,false);return; }
  removeNotice(entry);
  pin = {...entry,animated:false,scheduled:false};
  entry.navigating = true;
  let navigated = false;
  try {
   navigated = typeof navigate === 'function' && navigate('buy') === true;
   if (!navigated || !permitted(entry) || pageNow() !== 'buy') { pin = null;settle(entry,false);return; }
   window.snote236ResetPagination?.('vehicles');
   if (typeof renderCars === 'function') renderCars();
   window.SnoteListSort?.refresh();rendered();
   settle(entry,true);
  } catch {
   pin = null;settle(entry,false);
  }
 }
 function complete({id, actor, valid} = {}) {
  cancel();
  const entry = {id:String(id ?? ''),actor,valid,startPage:pageNow(),settled:false,navigating:false};
  if (!entry.id || entry.id.length > 300 || typeof valid !== 'function' || !permitted(entry)) return Promise.resolve(false);
  const promise = new Promise(resolve => { entry.resolve = resolve; });
  job = entry;
  entry.notice = notice();
  entry.observer = new MutationObserver(() => { if (job === entry && !permitted(entry)) settle(entry,false); });
  for (const [id,attribute] of [['auth-shell','class'],['zc-cloud-gate','hidden'],['overlay','class']]) {
   const element = document.getElementById(id);if (element) entry.observer.observe(element,{attributes:true,attributeFilter:[attribute]});
  }
  const watch = () => { if (job !== entry) return;if (!permitted(entry)) { settle(entry,false);return; }entry.frame=frame(watch); };
  entry.frame = frame(watch);entry.timer = setTimeout(() => reveal(entry), 750);
  return promise;
 }
 // View controls clear the one-time registration priority before their own render.
 function explicitViewChange() { pin = null;if (job) settle(job,false); }
 document.addEventListener('click', event => {
  if (event.target.closest?.('#list-pagination button,[data-sort-column],[data-sort-direction]')) explicitViewChange();
  else if (job && event.target.closest?.('[data-registration-car-id]')) settle(job,false);
 }, true);
 document.addEventListener('input', event => { if (event.target.matches?.('#list-query')) explicitViewChange(); }, true);
 document.addEventListener('change', event => { if (event.target.matches?.('#list-filter,[data-sort-select]')) explicitViewChange(); }, true);
 document.addEventListener('keydown', event => { if (job && ['Enter',' '].includes(event.key) && event.target.closest?.('[data-registration-car-id]')) settle(job,false); }, true);
 window.addEventListener('snote:route-changed', event => {
  if (job && !job.navigating && event.detail?.page !== job.startPage) settle(job,false);
  if (event.detail?.page !== 'buy') pin = null;
 });
 window.addEventListener('pagehide', cancel);
 window.SnotePurchaseRegistrationSuccess = {complete,prioritize,rendered,cancel};
})();
