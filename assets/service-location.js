/* Retired HTML entry points move to the current service; stored company data is untouched. */
(() => {
  'use strict';
  const retiredPages = 'zerocar-office.pages.dev';
  const retired = location => {
    if (!['https:', 'http:'].includes(location.protocol)) return false;
    const hostname = location.hostname.toLowerCase().replace(/\.$/, '');
    return hostname === retiredPages || hostname.endsWith('.' + retiredPages) ||
      /^zerocar-office\.[a-z0-9-]+\.workers\.dev$/.test(hostname);
  };
  let owner = window, source = window.location, page = document;
  if (!retired(source)) return;
  // An already-open old app may first load this guard inside its monthly frame.
  // Move that same-origin app as a whole; never take over an external embedder.
  try {
    const top = window.top;
    if (top && top !== window && top.location.origin === source.origin && retired(top.location)) {
      const topPage = top.document;
      owner = top; source = top.location; page = topPage;
    }
  } catch (_) { /* Cross-origin parents are deliberately left unchanged. */ }

  // Set URL components individually: a path beginning with // cannot change origin.
  const target = new URL('https://s-note.kr/');
  target.pathname = source.pathname;
  target.search = source.search;
  target.hash = source.hash;

  const root = page.documentElement;
  if (root) root.style.visibility = 'hidden';
  // Keep an explicit exit visible even if a restricted browser ignores replace().
  // Append only: an already-open parent may still contain an unsaved local form.
  const notice = page.createElement('section');
  notice.id = 'snote-service-location';
  notice.setAttribute('role', 'status');
  Object.assign(notice.style, { position: 'fixed', inset: '0', zIndex: '2147483647',
    display: 'grid', placeContent: 'center', gap: '16px', padding: '32px',
    background: '#f5f7fb', color: '#15304e', fontFamily: 'sans-serif',
    textAlign: 'center', visibility: 'visible' });
  const title = page.createElement('p');
  title.textContent = 'S-NOTE로 이동합니다.';
  const link = page.createElement('a');
  link.id = 'snote-service-location-exit';
  link.href = target.href;
  link.referrerPolicy = 'no-referrer';
  link.textContent = 'S-NOTE 열기';
  Object.assign(link.style, { padding: '12px 20px', borderRadius: '10px',
    background: '#2364a5', color: '#fff', textDecoration: 'none' });
  notice.append(title, link);
  root?.append(notice);
  for (const ownerPage of page === document ? [page] : [document, page]) {
    const referrer = ownerPage.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    ownerPage.head?.append(referrer);
  }
  // Do not continue starting an obsolete app while the new document loads.
  try { owner.stop(); } catch (_) { /* The direct exit remains available. */ }
  try { source.replace(target.href); } catch (_) { /* Keep the visible exit link. */ }
})();
