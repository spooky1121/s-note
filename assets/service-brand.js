/* Decode official service artwork before revealing it in a fixed logo box. */
(() => {
  'use strict';
  if (window.SnoteServiceBrand) return;
  const base = new URL('.', document.currentScript.src), brand = new URL('snote-brand.png', base).href, symbol = new URL('snote-symbol.png', base).href;
  const marker = '[data-snote-service-brand]', compact = matchMedia('(min-width: 761px) and (max-width: 1120px)'), records = new Map();
  let queued = false, serial = 0;
  const resource = value => { try { const url = new URL(value, location.href); return url.origin + url.pathname; } catch { return ''; } };
  function markState(record, state) {
    record.phase = state;
    if (record.mark.getAttribute('data-snote-brand-state') !== state) record.mark.setAttribute('data-snote-brand-state', state);
  }
  function settle(record, state) {
    markState(record, state); record.task = null;
    record.resolve?.(state); record.resolve = null;
    dispatchEvent(new Event('snote:brand-settled'));
  }
  function retire(record) {
    record.version = ++serial; record.resolve?.('detached'); record.resolve = null;
    record.image.removeEventListener('load', record.loaded); record.image.removeEventListener('error', record.failed); records.delete(record.mark);
  }
  function desired(record) { return record.sidebar && compact.matches ? symbol : record.image.src; }
  function chosen(record) { return record.image.currentSrc || record.image.src; }
  function begin(record) {
    const { mark, image } = record;
    if (!mark.isConnected || !image.isConnected || !(mark === image || mark.contains(image))) { retire(record); return; }
    const expected = desired(record), url = chosen(record), candidate = resource(url) === resource(expected) ? url : expected;
    if (record.url !== candidate) {
      record.resolve?.('superseded'); record.version = ++serial; record.url = candidate; record.task = null;
      record.done = new Promise(resolve => { record.resolve = resolve; }); markState(record, 'loading');
    }
    if (record.phase === 'ready' || record.phase === 'error' || record.task || resource(url) !== resource(expected)) return;
    if (image.complete && image.naturalWidth === 0) { settle(record, 'error'); return; }
    const version = record.version;
    const valid = () => records.get(mark) === record && version === record.version && mark.isConnected && image.isConnected && resource(chosen(record)) === resource(desired(record));
    record.task = typeof image.decode === 'function' ? image.decode() : image.complete && image.naturalWidth > 0 ? Promise.resolve() : null;
    if (!record.task) return;
    Promise.resolve(record.task).then(() => {
      if (!valid()) return;
      record.task = null;
      if (image.complete && image.naturalWidth > 0) settle(record, 'ready');
    }).catch(() => {
      if (!valid()) return;
      record.task = null;
      // A responsive candidate may abort an old decode before its load event.
      if (image.complete && image.naturalWidth === 0) settle(record, 'error');
    });
  }
  function sync(mark) {
    if (!(mark instanceof Element)) return;
    let image = mark instanceof HTMLImageElement ? mark : mark.querySelector('img');
    if (!image) { image = document.createElement('img'); image.alt = 'snote'; image.decoding = 'async'; mark.replaceChildren(image); }
    if (resource(image.getAttribute('src') || '') !== resource(brand)) image.src = brand;
    const sidebar = !!mark.closest('#snote-app > .sidebar');
    if (sidebar) {
      let picture = image.parentElement;
      if (picture.tagName !== 'PICTURE') { picture = document.createElement('picture'); mark.replaceChildren(picture); picture.append(image); }
      let source = picture.querySelector('source[data-snote-service-symbol]');
      if (!source) { source = document.createElement('source'); source.dataset.snoteServiceSymbol = ''; picture.prepend(source); }
      if (source.media !== compact.media) source.media = compact.media;
      if (source.getAttribute('srcset') !== symbol) source.srcset = symbol;
    }
    let record = records.get(mark);
    if (record?.image !== image) { if (record) retire(record); record = null; }
    if (!record) {
      record = { mark, image, sidebar, version:0, url:null, task:null, phase:'loading', done:null, resolve:null };
      record.loaded = () => { if (record.phase === 'error') record.url = null; begin(record); };
      record.failed = () => { if (record.phase !== 'error') { record.version = ++serial; settle(record, 'error'); } };
      image.addEventListener('load', record.loaded); image.addEventListener('error', record.failed); records.set(mark, record);
    }
    begin(record);
  }
  function nodes(scope) { const found = [...scope.querySelectorAll(marker)]; if (scope instanceof Element && scope.matches(marker)) found.unshift(scope); return found; }
  function refresh() {
    queued = false;
    for (const record of records.values()) if (!record.mark.isConnected || !record.image.isConnected) retire(record);
    nodes(document).forEach(sync);
  }
  function schedule() { if (!queued) { queued = true; queueMicrotask(refresh); } }
  function whenReady(scope = document) {
    refresh();
    return Promise.all(nodes(scope).map(mark => records.get(mark)?.done || Promise.resolve('missing')));
  }
  compact.addEventListener('change', () => {
    for (const record of records.values()) if (record.sidebar) { record.url = null; record.task = null; record.version = ++serial; markState(record, 'loading'); }
    requestAnimationFrame(schedule);
  });
  const observer = new MutationObserver(changes => {
    if (changes.some(change => change.type === 'attributes' ? change.target.matches?.(marker) || change.target.closest?.(marker) : [...change.addedNodes, ...change.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && (node.matches(marker) || node.querySelector(marker))))) schedule();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['src','srcset','media','data-snote-service-brand'] });
  window.SnoteServiceBrand = Object.freeze({ refresh, whenReady });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once:true }); else refresh();
})();
