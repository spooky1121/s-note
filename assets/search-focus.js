/* Focus the real search field in the browser's top layer without proxy events. */
(() => {
  'use strict';
  if (window.SnoteSearchFocus) return;
  const SELECTOR = 'input[type="search"]';
  let active = null, preparing = false, queued = false, outsidePointer = false;
  const visible = node => node?.isConnected && !node.closest('[hidden], [inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const svg = (kind) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('fill', 'none'); node.setAttribute('stroke', 'currentColor'); node.setAttribute('stroke-width', '1.8'); node.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(node.namespaceURI, 'path');
    path.setAttribute('d', kind === 'close' ? 'm6 6 12 12M18 6 6 18' : 'M17 17l4 4M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0'); node.append(path); return node;
  };
  function frameFor(input) {
    const frame = input.closest('label.search, label.recycle-search, form.search-field');
    if (frame) return frame;
    if (input.parentElement?.classList.contains('snote-search-frame')) return input.parentElement;
    const wrapper = document.createElement('span'); wrapper.className = 'snote-search-frame';
    input.before(wrapper); wrapper.append(input); return wrapper;
  }
  function prepare(root) {
    for (const input of root.querySelectorAll(SELECTOR)) frameFor(input);
  }
  function position(state) {
    const view = window.visualViewport, left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
    const width = Math.min(Math.max(state.rect.width, Math.min(520, innerWidth - 24)), (view?.width || innerWidth) - 24);
    const x = Math.max(left + 12, Math.min(state.rect.left, left + (view?.width || innerWidth) - width - 12));
    const y = Math.max(top + 12, Math.min(state.rect.top, top + (view?.height || innerHeight) - 74));
    state.frame.style.setProperty('--snote-search-left', x + 'px');
    state.frame.style.setProperty('--snote-search-top', y + 'px');
    state.frame.style.setProperty('--snote-search-width', width + 'px');
  }
  function close({ focus = false } = {}) {
    const state = active; if (!state) return;
    active = null; preparing = true;
    try { if (state.frame.matches(':popover-open')) state.frame.hidePopover(); } catch {}
    state.frame.classList.remove('snote-search-active');
    for (const [name, value] of Object.entries(state.attrs)) {
      if (value === null) state.frame.removeAttribute(name); else state.frame.setAttribute(name, value);
    }
    for (const name of ['--snote-search-left', '--snote-search-top', '--snote-search-width']) state.frame.style.removeProperty(name);
    state.placeholder.remove(); state.close.remove(); state.icon?.remove();
    if (document.activeElement === state.input || state.frame.contains(document.activeElement)) document.activeElement.blur();
    if (focus && visible(state.input)) state.input.focus({ preventScroll: true });
    preparing = false; window.SnoteMobilePopupHistory?.refresh();
  }
  function open(input) {
    if (preparing || active?.input === input || input.disabled || input.readOnly || !visible(input) || !HTMLElement.prototype.showPopover) return;
    close(); preparing = true;
    const frame = frameFor(input), rect = (frame.classList.contains('snote-search-frame') ? input : frame).getBoundingClientRect();
    const style = getComputedStyle(frame.classList.contains('snote-search-frame') ? input : frame);
    const placeholder = document.createElement('span'); placeholder.className = 'snote-search-placeholder';
    placeholder.setAttribute('aria-hidden', 'true'); placeholder.inert = true;
    Object.assign(placeholder.style, { display: style.display === 'inline' ? 'inline-block' : style.display, width: rect.width + 'px', height: rect.height + 'px', flex: style.flex, order: style.order, alignSelf: style.alignSelf, justifySelf: style.justifySelf, gridColumn: style.gridColumn, gridRow: style.gridRow, minWidth: style.minWidth, maxWidth: style.maxWidth, margin: style.margin, boxSizing: 'border-box' });
    frame.before(placeholder);
    const attrs = Object.fromEntries(['popover', 'role', 'aria-label'].map(name => [name, frame.getAttribute(name)]));
    const button = document.createElement('button'); button.type = 'button'; button.className = 'snote-search-dismiss'; button.setAttribute('aria-label', '검색 닫기'); button.append(svg('close'));
    button.addEventListener('pointerdown', event => event.preventDefault());
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close({ focus: true }); });
    frame.append(button);
    let icon = null;
    if (frame.classList.contains('snote-search-frame')) { icon = svg('search'); icon.classList.add('snote-search-magnifier'); frame.prepend(icon); }
    const state = { input, frame, rect, placeholder, attrs, close: button, icon }; active = state;
    frame.classList.add('snote-search-active'); frame.setAttribute('popover', 'manual'); frame.setAttribute('role', 'dialog'); frame.setAttribute('aria-label', input.getAttribute('aria-label') || '검색'); position(state);
    try { frame.showPopover(); input.focus({ preventScroll: true }); }
    catch { close(); }
    preparing = false; window.SnoteMobilePopupHistory?.refresh();
  }
  document.addEventListener('focusin', event => { if (event.target.matches?.(SELECTOR)) open(event.target); }, true);
  document.addEventListener('pointerdown', event => {
    outsidePointer = false;
    if (!active && event.target.matches?.(SELECTOR)) { open(event.target); return; }
    if (!active || active.frame.contains(event.target)) return;
    outsidePointer = true;
    event.preventDefault(); event.stopImmediatePropagation(); close();
  }, true);
  document.addEventListener('click', event => {
    if (!outsidePointer) return;
    outsidePointer = false; event.preventDefault(); event.stopImmediatePropagation();
  }, true);
  document.addEventListener('keydown', event => {
    if (!active && !['Escape', 'Tab'].includes(event.key) && !event.isComposing && event.target.matches?.(SELECTOR)) open(event.target);
    if (!active) return;
    if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); event.stopImmediatePropagation(); close({ focus: true }); }
    else if (event.key === 'Tab') { close({ focus: true }); }
  }, true);
  document.addEventListener('focusout', () => queueMicrotask(() => {
    if (!preparing && active && !active.frame.contains(document.activeElement)) close();
  }));
  document.addEventListener('submit', event => { if (active && event.target.contains(active.input)) close(); }, true);
  addEventListener('resize', () => { if (active) position(active); });
  window.visualViewport?.addEventListener('resize', () => { if (active) position(active); });
  window.visualViewport?.addEventListener('scroll', () => { if (active) position(active); });
  for (const name of ['snote:auth-reset', 'snote:route-changed', 'hashchange', 'pagehide', 'beforeprint']) addEventListener(name, () => close());
  function scan() {
    queued = false;
    if (active && (active.input.disabled || active.input.readOnly || !active.input.isConnected || !active.placeholder.isConnected || !visible(active.placeholder.parentElement))) close();
    if (!active) prepare(document);
  }
  const observer = new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(scan); } });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style', 'disabled'] });
  window.SnoteSearchFocus = Object.freeze({ close, refresh: scan, get current() { return active?.frame || null; } });
  prepare(document);
})();
