/* Official service artwork; no document or company-owned asset is selected. */
(() => {
  'use strict';
  if (window.SnoteServiceBrand) return;
  const base = new URL('.', document.currentScript.src);
  const brand = new URL('snote-brand.png', base).href;
  const symbol = new URL('snote-symbol.png', base).href;
  const marker = '[data-snote-service-brand]';
  let queued = false;
  function correctAsset(image) {
    if (!image) return;
    try { if (new URL(image.getAttribute('src') || '', location.href).pathname === new URL(brand).pathname) return; } catch {}
    image.src = brand;
  }
  function sync(mark) {
    if (!(mark instanceof Element)) return;
    if (mark instanceof HTMLImageElement) { correctAsset(mark); return; }
    let image = mark.querySelector('img');
    if (!image) {
      image = document.createElement('img'); image.alt = 'snote'; image.decoding = 'async';
      mark.replaceChildren(image);
    }
    correctAsset(image);
    if (mark.closest('.snote-brand-home')) mark.classList.add('snote-spaced-logo');
    // The old shell split one padded image into independent S/NOTE crops.
    // Keep the outer size class, but display one intact official artwork.
    if (mark.querySelector('.snote-logo-s,.snote-logo-note')) mark.replaceChildren(image);
    if (mark.closest('#snote-app > .sidebar')) {
      let picture = image.parentElement;
      if (picture.tagName !== 'PICTURE') {
        picture = document.createElement('picture'); mark.replaceChildren(picture); picture.append(image);
      }
      let source = picture.querySelector('source[data-snote-service-symbol]');
      if (!source) { source = document.createElement('source'); source.dataset.snoteServiceSymbol = ''; picture.prepend(source); }
      source.media = '(min-width: 761px) and (max-width: 1120px)';
      if (source.getAttribute('srcset') !== symbol) source.srcset = symbol;
    }
  }
  function refresh() { queued = false; document.querySelectorAll(marker).forEach(sync); }
  const observer = new MutationObserver(records => {
    if (queued || !records.some(record => [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE && (node.matches(marker) || node.querySelector(marker))))) return;
    queued = true; queueMicrotask(refresh);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.SnoteServiceBrand = Object.freeze({ refresh });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh, { once: true }); else refresh();
})();
