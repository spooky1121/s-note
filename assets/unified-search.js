/* Live search uses only the verified bridge's non-financial projections. */
(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (!root?.document) return;
  const form = document.getElementById('snote-global-search');
  if (!form || root.SnoteUnifiedSearch) return;
  const input = form.querySelector('input'), results = form.querySelector('[data-unified-results]'), submit = form.querySelector('[type="submit"]');
  const bridge = () => root.snoteUnifiedSearchBridge;
  let sequence = 0, context = null, items = [], shown = false, pending = null, composing = false;
  const node = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  const cancelPending = () => { clearTimeout(pending); pending = null; };
  function clear({ query = false } = {}) {
    cancelPending();
    sequence++; context = null; items = []; shown = false;
    results.replaceChildren(); results.hidden = true; results.removeAttribute('aria-busy');
    submit.disabled = false; form.removeAttribute('aria-busy'); input.setAttribute('aria-expanded', 'false');
    if (query) { input.value = ''; composing = false; }
  }
  function message(text, busy = false) {
    results.replaceChildren(node('p', text, 'snote-unified-message')); results.hidden = false;
    results.setAttribute('aria-busy', String(busy)); input.setAttribute('aria-expanded', 'true');
  }
  function paint(found, partial) {
    results.replaceChildren(); results.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (!found.length) message('검색 결과가 없습니다. 다른 검색어로 확인해 주세요.');
    for (const [kind, title] of [['vehicle', '차량'], ['customer', '고객'], ['menu', '메뉴']]) {
      const rows = found.filter(row => row.kind === kind); if (!rows.length) continue;
      const section = node('section', null, 'snote-unified-group'), heading = node('h2', title);
      section.append(heading);
      for (const row of rows) {
        const button = node('button', null, 'snote-unified-result'); button.type = 'button';
        button.dataset.unifiedResult = String(found.indexOf(row));
        const copy = node('span', null, 'snote-unified-copy'); copy.append(node('strong', row.title));
        if (row.detail) copy.append(node('small', row.detail)); button.append(copy, node('span', row.badge || (kind === 'menu' ? '이동' : '보기'), 'snote-unified-badge'));
        section.append(button);
      }
      results.append(section);
    }
    if (partial) results.append(node('p', '일부 자료를 불러오지 못했습니다. 돋보기를 눌러 다시 검색해 주세요.', 'snote-unified-message'));
    results.setAttribute('aria-busy', 'false');
  }
  async function search(event, { focus = true } = {}) {
    event?.preventDefault();
    if (composing || event?.isComposing) return;
    if (focus) input.focus({ preventScroll: true });
    cancelPending();
    const query = input.value.trim(), ticket = ++sequence, ctx = bridge()?.context?.();
    items = []; context = null; shown = true;
    if (!ctx) { message('로그인 상태와 이용 권한을 확인해 주세요.'); return; }
    if (!model.normalize(query)) { message('검색어를 입력한 뒤 돋보기를 눌러 주세요.'); return; }
    context = ctx; form.setAttribute('aria-busy', 'true'); submit.disabled = true; message('자료를 검색하고 있습니다.', true);
    try {
      const data = await bridge().sources(ctx);
      if (ticket !== sequence || !bridge()?.current?.(ctx)) return;
      items = model.find(query, data); paint(items, data.partial === true);
    } catch {
      if (ticket === sequence && bridge()?.current?.(ctx)) message('검색 자료를 불러오지 못했습니다. 다시 검색해 주세요.');
    } finally {
      if (ticket === sequence) { submit.disabled = false; form.removeAttribute('aria-busy'); results.setAttribute('aria-busy', 'false'); }
    }
  }
  function schedule() {
    // Hide the preceding query immediately, including while an IME is active.
    clear();
    if (composing || !model.normalize(input.value) || root.SnoteSearchFocus && root.SnoteSearchFocus.current !== form && typeof form.showPopover === 'function') return;
    const query = input.value, ctx = bridge()?.context?.(), ticket = sequence;
    if (!ctx) return;
    context = ctx; shown = true;
    pending = setTimeout(() => {
      pending = null;
      if (ticket !== sequence || composing || query !== input.value || !bridge()?.current?.(ctx)) return;
      search(undefined, { focus: false });
    }, 220);
  }
  form.addEventListener('submit', search);
  input.addEventListener('input', schedule);
  input.addEventListener('focus', () => { queueMicrotask(() => { if (document.activeElement === input && results.hidden && model.normalize(input.value)) schedule(); }); });
  input.addEventListener('pointerdown', () => { if (results.hidden && model.normalize(input.value)) schedule(); });
  input.addEventListener('compositionstart', () => { composing = true; clear(); });
  input.addEventListener('compositionend', () => { composing = false; schedule(); });
  form.addEventListener('keydown', event => {
    if (event.isComposing || composing || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...results.querySelectorAll('[data-unified-result]')].filter(button => !button.disabled);
    if (results.hidden || !buttons.length) return;
    const target = event.target, index = buttons.indexOf(target);
    if (target !== input && index < 0) return;
    event.preventDefault();
    const next = target === input ? event.key === 'ArrowDown' ? 0 : buttons.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= buttons.length) input.focus({ preventScroll: true });
    else buttons[next].focus();
  });
  results.addEventListener('click', async event => {
    const button = event.target.closest('[data-unified-result]'); if (!button || !results.contains(button)) return;
    const row = items[Number(button.dataset.unifiedResult)], ctx = context;
    if (!row || !ctx || !bridge()?.current?.(ctx)) { clear({ query: true }); root.SnoteSearchFocus?.close(); return; }
    button.disabled = true;
    try {
      root.SnoteSearchFocus?.close();
      const opened = await bridge().open(row, ctx);
      if (opened === false && bridge()?.current?.(ctx)) root.toast?.('자료의 이용 권한이나 현재 상태가 변경되었습니다. 다시 검색해 주세요.');
    } catch { if (bridge()?.current?.(ctx)) root.toast?.('자료를 열지 못했습니다. 다시 검색해 주세요.'); }
  });
  addEventListener('snote:search-closed', event => { if (event.detail?.inputId === input.id) { composing = false; clear(); } });
  for (const name of ['snote:auth-reset', 'pagehide']) addEventListener(name, () => clear({ query: true }));
  addEventListener('snote:route-changed', () => { composing = false; clear(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { clear({ query: true }); if (root.SnoteSearchFocus?.current === form) root.SnoteSearchFocus.close(); } });
  setInterval(() => { if (shown && context && !bridge()?.current?.(context)) { clear({ query: true }); root.SnoteSearchFocus?.close(); } }, 250);
  root.SnoteUnifiedSearch = Object.freeze({ clear, search });
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]/gu, '');
  function find(query, data = {}) {
    const terms = String(query).trim().split(/\s+/).map(normalize).filter(Boolean); if (!terms.length) return [];
    const groups = [
      ['vehicle', data.vehicles || [], row => [row.model, row.plate, row.vin, row.brand, row.make, row.year, row.color, row.memo, row.status, row.ownerLabel]],
      ['customer', data.customers || [], row => [row.name, row.phone, row.address, row.carModel, row.plate]],
      ['menu', data.menus || [], row => [row.title, row.description]]
    ], found = [];
    for (const [kind, rows, fields] of groups) {
      let count = 0;
      for (const row of rows) {
        const searchable = normalize(fields(row).join(' '));
        if (!terms.every(term => searchable.includes(term))) continue;
        if (count++ >= 25) break;
        const title = kind === 'vehicle' ? row.model || row.plate || '차량' : kind === 'customer' ? row.name || '고객' : row.title;
        const detail = (kind === 'vehicle' ? [row.plate, row.year && row.year + '년', row.ownerLabel] : kind === 'customer' ? [row.phone, row.carModel, row.plate] : [row.description]).filter(Boolean).join(' · ');
        found.push({ kind, id: row.id, ownerId: row.ownerId, shared: row.shared === true, title, detail, badge: kind === 'vehicle' ? row.shared ? '공유' : row.status : '', query: kind === 'customer' ? row.phone || row.name || row.plate : '' });
      }
    }
    return found;
  }
  return Object.freeze({ normalize, find });
});
