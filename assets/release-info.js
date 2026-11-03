/* Release labels share the version declared by this HTML document. */
(() => {
  'use strict';
  if (window.SnoteRelease) return;

  const MARKER = '[data-snote-version]';
  let observer = null;

  function readVersion() {
    const value = document.documentElement.getAttribute('data-snote-release') || '';
    return value.length <= 32 && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*))?$/.test(value) ? value : null;
  }

  function syncSubtree(element, version) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE || !version) return;
    const sync = marker => {
      const label = (marker.getAttribute('data-snote-version-prefix') || '') + 'v' + version +
        (marker.getAttribute('data-snote-version-suffix') || '');
      if (marker.textContent !== label) marker.textContent = label;
    };
    if (element.matches(MARKER)) sync(element);
    for (const marker of element.querySelectorAll(MARKER)) sync(marker);
  }

  function refresh() {
    const version = readVersion();
    syncSubtree(document.body, version);
    return Boolean(version && document.body);
  }

  function start() {
    if (observer || !document.body) return;
    refresh();
    observer = new MutationObserver(records => {
      const version = readVersion();
      if (!version) return;
      for (const record of records) {
        for (const node of record.addedNodes) {
          // Updating a label adds only text; skip it to avoid a feedback loop.
          if (node.nodeType === Node.ELEMENT_NODE) syncSubtree(node, version);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.SnoteRelease = Object.freeze({ get version() { return readVersion(); }, refresh });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
