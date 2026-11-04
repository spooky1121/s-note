(function (global) {
  'use strict';

  const nameText = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);
  const sameScope = (a, b) => Boolean(a && b && a.actor && a.actor === b.actor &&
    a.ownerId === b.ownerId && sameId(a.carId, b.carId) && a.view === b.view);
  const usableContext = context => Boolean(context?.open && context.actor && context.ownerId &&
    context.carId !== null && context.carId !== undefined);

  // A source is attached only by an existing, authenticated saved-customer flow.
  // No name-based database lookup or signature URL supplied by a record is used.
  function createCustomerContractSignature(options) {
    let source = null, generation = 0;
    const knownSources = new WeakMap();
    const empty = () => ({ visible: false, image: '', caption: '' });
    const current = () => options.currentContext?.() || null;
    function state() {
      const context = current();
      if (!source || !usableContext(context) || !sameScope(source.context, context) ||
          context.mode !== 'sale' || !source.name || nameText(context.customerName) !== source.name) return empty();
      return { visible: true, image: source.image, caption: source.caption };
    }
    function sync() {
      const context = current();
      if (source && (!usableContext(context) || !sameScope(source.context, context))) {
        source = null; ++generation;
      }
      const value = state();
      options.render?.(value);
      return value;
    }
    function clear() {
      source = null; ++generation;
      options.render?.(empty());
      return empty();
    }
    function set(customer, expectedContext = current()) {
      const context = current();
      if (!usableContext(context) || !sameScope(context, expectedContext)) return false;
      clear();
      if (!customer ||
          customer.ownerId !== context.ownerId || !sameId(customer.carId, context.carId)) return false;
      let image = '';
      try { image = options.imageFor?.(customer.customerSignature) || ''; } catch (_) { return false; }
      // The existing signature sanitizer draws validated coordinates into a PNG canvas.
      if (typeof image !== 'string' || image.length > 500000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return false;
      let name = nameText(customer.name);
      if (!name) return false;
      // A subsequent manual customer save preserves the original signature. Keep
      // its first observed name for this actor/car during this page session.
      let known = knownSources.get(context.actor);
      if (!known) { known = new Map(); knownSources.set(context.actor, known); }
      const key = JSON.stringify([context.ownerId, String(context.carId), image]);
      if (known.has(key)) name = known.get(key);
      else {
        if (known.size >= 128) known.delete(known.keys().next().value);
        known.set(key, name);
      }
      const date = new Date(customer.customerSignatureSignedAt || '');
      source = { context: { ...context }, name, image,
        caption: '고객 원제출 서명' + (Number.isFinite(date.getTime()) ? ' · ' + date.toLocaleDateString('ko-KR') : '') };
      sync();
      return true;
    }
    async function ready() {
      const context = current(), version = generation, value = sync();
      if (value.visible) {
        try { await options.imageReady?.(); } catch (_) { return false; }
      }
      if (generation !== version || !usableContext(current()) || !sameScope(context, current())) return false;
      const latest = sync();
      return latest.visible === value.visible && latest.image === value.image;
    }
    async function setSaved(customer, expectedContext = current()) {
      const live = () => usableContext(current()) && sameScope(current(),expectedContext);
      if (!live()) return false;
      const resolved = global.snoteResolveDocumentCustomer ? await global.snoteResolveDocumentCustomer(customer,live) : customer;
      if (!live()) return false;
      return set(resolved,expectedContext);
    }
    return { set, setSaved, clear, sync, ready };
  }

  global.snoteCreateCustomerContractSignature = createCustomerContractSignature;
  if (!global.document) return;
  const byId = id => document.getElementById(id);
  function signatureNodes() {
    const nodes = [];
    for (const side of ['seller', 'buyer']) {
      const slot = byId('ct-' + side + '-name')?.closest('.ct-stamp-line')?.querySelector('.ct-seal-slot');
      if (!slot) continue;
      let image = slot.querySelector('[data-customer-contract-signature-image]');
      if (!image) {
        image = document.createElement('img');
        image.className = 'ct-customer-signature-image';
        image.dataset.customerContractSignatureImage = side;
        image.alt = '고객 원제출 서명'; image.hidden = true;
        slot.appendChild(image);
      }
      nodes.push({ side, slot, image });
    }
    return nodes;
  }
  function render(value) {
    for (const { side, slot, image } of signatureNodes()) {
      const visible = side === 'buyer' && value.visible;
      slot.classList.toggle('has-customer-signature', visible);
      image.hidden = !visible;
      if (visible) {
        if (image.getAttribute('src') !== value.image) image.src = value.image;
        image.title = value.caption + '. 원래 제출한 정보의 서명이며, 이후 수정한 내용의 새 서명이 아닙니다.';
      } else {
        image.removeAttribute('src'); image.removeAttribute('title');
      }
    }
    let note = byId('snote222-contract-signature-note');
    const paper = byId('contract-paper');
    if (!note && paper?.parentNode) {
      note = document.createElement('p');
      note.id = 'snote222-contract-signature-note';
      note.className = 'ct-small-note ct-customer-signature-note';
      paper.insertAdjacentElement('afterend', note);
    }
    if (note) {
      note.hidden = !value.visible;
      note.dataset.customerContractSignatureCaption = '';
      note.textContent = value.visible ? value.caption + ' · 원래 제출한 정보의 서명입니다. 이후 수정한 내용의 새 서명이 아닙니다.' : '';
    }
  }
  global.snote222ContractSignature = createCustomerContractSignature({
    currentContext: () => global.snote222ContractSignatureContext?.(),
    imageFor: value => global.snoteCustomerSignatureImage?.(value) || '',
    render,
    imageReady: async () => {
      const image = signatureNodes().find(item => item.side === 'buyer')?.image;
      if (!image || image.hidden) return;
      if (typeof image.decode === 'function') await image.decode();
      else if (!image.complete || !image.naturalWidth) throw Error('SIGNATURE_IMAGE_NOT_READY');
    }
  });
  function receiptNodes() {
    return {host:byId('snote215-receipt-signature'),image:byId('snote215-receipt-signature-image'),caption:byId('snote215-receipt-signature-caption')};
  }
  global.snote250ReceiptSignature = createCustomerContractSignature({
    currentContext: () => global.snote250ReceiptSignatureContext?.(),
    imageFor: value => global.snoteCustomerSignatureImage?.(value) || '',
    render: value => {
      const {host,image,caption}=receiptNodes();if(!host||!image)return;
      host.hidden=!value.visible;host.closest('.zc76-sign-slot')?.classList.toggle('has-customer-signature',value.visible);
      if(value.visible){if(image.getAttribute('src')!==value.image)image.src=value.image;image.title=value.caption;}
      else{image.removeAttribute('src');image.removeAttribute('title');}
      if(caption){caption.hidden=!value.visible;caption.textContent=value.visible?value.caption+' · 원래 제출한 정보의 서명입니다. 이후 수정한 내용의 새 서명이 아닙니다.':'';}
    },
    imageReady: async () => {const {image,host}=receiptNodes();if(!image||host?.hidden)return;if(typeof image.decode==='function')await image.decode();else if(!image.complete||!image.naturalWidth)throw Error('SIGNATURE_IMAGE_NOT_READY');}
  });
  document.addEventListener('input',event=>{if(['zc76-name','zc76-sign-name'].includes(event.target.id))global.snote250ReceiptSignature.sync();});
  global.addEventListener('pagehide', () => {global.snote222ContractSignature.clear();global.snote250ReceiptSignature.clear();});
})(typeof window === 'undefined' ? globalThis : window);
