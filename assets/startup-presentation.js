/* Presentation readiness only. Never waits for or modifies authentication/data. */
(() => {
  'use strict';
  if (window.SnoteStartupPresentation) return;
  const root = document.documentElement, LIMIT = 1800, QUIET = 90;
  const before = root.getAttribute('data-snote-startup');
  let released = false, prepared = false, fontsReady = false, imagesReady = false;
  let typographyAllowed = true, localFonts = false, deadline = false;
  let raf = 0, timer = 0, fadeTimer = 0, stamp = '', stableAt = performance.now();
  const settledStyles = new WeakSet();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const current = () => !released && root.getAttribute('data-snote-startup') === 'pending';
  function finish() {
    clearTimeout(timer); clearTimeout(fadeTimer); cancelAnimationFrame(raf);
    if (root.getAttribute('data-snote-startup') === 'revealing' || root.getAttribute('data-snote-startup') === 'pending') {
      if (before === null) root.removeAttribute('data-snote-startup'); else root.setAttribute('data-snote-startup', before);
    }
  }
  function reveal() {
    if (released) return;
    released = true; clearTimeout(timer); cancelAnimationFrame(raf);
    if (motion.matches || document.hidden) finish();
    else { root.setAttribute('data-snote-startup', 'revealing'); fadeTimer = setTimeout(finish, 220); }
    dispatchEvent(new CustomEvent('snote:startup-ready', { detail: { localFonts, deadline } }));
  }
  function freezeFonts() {
    if (!fontsReady || !document.fonts || document.fonts.status === 'loading' || [...document.fonts].some(face => face.status === 'error')) {
      localFonts = true; root.setAttribute('data-snote-startup-fonts', 'local');
    }
    // A deferred typography script may itself be stalled. Keep the first
    // usable size instead of applying its 2px enlargement after presentation.
    if (!window.snoteReadableType) typographyAllowed = false;
  }
  function expire() {
    if (released) return;
    deadline = true;
    // Body-tail CSS can keep readyState at "loading" even after the real login
    // controller and its listeners are installed. Presentation must not make
    // that working login unavailable while an optional stylesheet is pending.
    const loginReady = !!document.getElementById('zc-cloud-gate') && !!window.zc86Cloud;
    if (!document.body || document.readyState === 'loading' && !loginReady) {
      clearTimeout(timer); timer = setTimeout(expire, 100); return;
    }
    freezeFonts();
    cancelAnimationFrame(raf);
    reveal();
  }
  function stylesPending() {
    return [...document.querySelectorAll('link[rel="stylesheet"]')].some(link =>
      !link.disabled && !link.hasAttribute('data-snote-startup-style') && !link.sheet && !settledStyles.has(link));
  }
  function scope() {
    const gate = document.getElementById('zc-cloud-gate');
    if (gate && !gate.hidden) return gate;
    return document.getElementById('operator-app')?.hidden === false ? document.getElementById('operator-app') : document;
  }
  function geometry() {
    const values = [innerWidth, innerHeight];
    const host = scope();
    const probes = host.querySelectorAll('[data-snote-service-brand],h1,h2,.zc-field,input:not([type="hidden"]),.topbar,.sidebar,.snote-login-shell,.operator-toolbar,.site-header,.intake-card,.snote-email-recovery-card');
    let count = 0;
    for (const node of probes) {
      if (count >= 36) break;
      const box = node.getBoundingClientRect(); if (!(box.width > 0 && box.height > 0)) continue;
      count++;
      for (const value of [box.x, box.y, box.width, box.height]) values.push(Math.round(value * 4) / 4);
      const style = getComputedStyle(node); values.push(style.fontSize, style.lineHeight);
    }
    return values.join('|');
  }
  function tick() {
    if (!current()) return;
    if (deadline) { expire(); return; }
    const now = performance.now(), next = geometry();
    if (next !== stamp) { stamp = next; stableAt = now; }
    if (fontsReady && imagesReady && !stylesPending() && now - stableAt >= QUIET) { reveal(); return; }
    raf = requestAnimationFrame(tick);
  }
  function prepare() {
    if (prepared || released) return;
    prepared = true;
    try {
      window.SnoteReadableType?.refresh();
      window.SnoteIconSizing?.refresh();
      const fonts = document.fonts;
      if (!fonts) { freezeFonts(); fontsReady = true; }
      else {
        // These are the already-used local UI faces, not new data dependencies.
        const requests = ["14px 'Noto Sans KR'", '14px Manrope', '14px OperatorNoto', '14px OperatorManrope'].map(face => fonts.load(face, '가나다 0123456789'));
        Promise.allSettled(requests).then(() => fonts.ready).then(() => {
          if (!current()) return;
          if ([...fonts].some(face => face.status === 'error')) freezeFonts();
          fontsReady = true; stableAt = performance.now();
        }).catch(() => { if (current()) { freezeFonts(); fontsReady = true; } });
      }
      Promise.resolve(window.SnoteServiceBrand?.whenReady(scope())).catch(() => {}).then(() => { imagesReady = true; });
      stableAt = performance.now(); raf = requestAnimationFrame(tick);
    } catch { expire(); }
  }
  // Install a bounded release before hiding anything. No-JS/blocked-bootstrap
  // pages never receive this attribute and retain their ordinary HTML fallback.
  timer = setTimeout(expire, LIMIT);
  window.SnoteStartupPresentation = Object.freeze({
    typographyAllowed: () => typographyAllowed,
    get pending() { return !released; },
    get state() { return { released, prepared, fontsReady, imagesReady, localFonts, deadline }; }
  });
  root.setAttribute('data-snote-startup', 'pending');
  document.addEventListener('DOMContentLoaded', prepare, { once: true });
  document.addEventListener('readystatechange', () => { if (deadline && !released && document.readyState !== 'loading') expire(); });
  for (const type of ['load', 'error']) document.addEventListener(type, event => {
    if (!(event.target instanceof HTMLLinkElement) || event.target.rel !== 'stylesheet') return;
    settledStyles.add(event.target); stableAt = performance.now();
    if (deadline && !released) expire();
  }, true);
  addEventListener('snote-fonts-enlarged', () => { stableAt = performance.now(); });
  addEventListener('resize', () => { stableAt = performance.now(); });
  addEventListener('beforeprint', () => { if (!released) { freezeFonts(); released = true; } finish(); });
  addEventListener('pagehide', () => { released = true; finish(); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (released) finish(); else expire();
  });
  if (document.readyState !== 'loading') prepare();
})();
