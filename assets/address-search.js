(function () {
  'use strict';

  const status = document.getElementById('search-status');
  const root = document.getElementById('postcode-root');
  const popupButton = document.getElementById('open-search-popup');
  const nonce = window.location.hash.slice(1);
  let parentOrigin = '';
  let Postcode = null;
  let loadTimer = null;

  function notify(kind, values) {
    if (!parentOrigin || window.parent === window) return;
    window.parent.postMessage({type: 'SNOTE_CUSTOMER_ADDRESS', nonce, kind, ...values}, parentOrigin);
  }

  function fail() {
    window.clearTimeout(loadTimer);
    status.hidden = false;
    status.dataset.tone = 'error';
    status.textContent = '주소 검색을 불러오지 못했습니다. 새 창에서 검색하거나 창을 닫고 직접 입력해 주세요.';
    notify('error');
  }

  try {
    const ownUrl = new URL(window.location.href);
    const candidate = ownUrl.searchParams.get('parentOrigin');
    if (window.parent === window || !/^[a-f0-9]{32}$/.test(nonce) || candidate !== ownUrl.origin) throw new Error('Invalid search context');
    parentOrigin = candidate;
    window.history.replaceState(null, '', ownUrl.pathname + ownUrl.search);
  } catch (_) {
    status.dataset.tone = 'error';
    status.textContent = '고객정보 입력 화면의 주소 검색 버튼으로 열어 주세요.';
    return;
  }

  function options() {
    return {
      width: '100%', height: '100%',
      oncomplete(data) {
        const selected = data?.userSelectedType === 'J' ? data.jibunAddress || data.address : data?.roadAddress || data?.address;
        const address = String(selected || data?.autoRoadAddress || data?.autoJibunAddress || '').trim();
        const postcode = String(data?.zonecode || '').trim();
        if (!address || address.length > 200 || /[\u0000-\u001f\u007f]/.test(address) || (postcode && !/^\d{5}$/.test(postcode))) { fail(); return; }
        notify('selected', {address, postcode});
      },
      onclose() { notify('closed'); }
    };
  }

  // The SDK is invoked from this HTTPS document. This document remains opaque;
  // only the user-triggered SDK popup can leave its inherited sandbox.
  popupButton.addEventListener('click', () => {
    if (!Postcode) return;
    try {
      new Postcode({...options(), width: 500, height: 600}).open();
      status.hidden = false;
      delete status.dataset.tone;
      status.textContent = '새 창에서 주소를 선택해 주세요. 창이 열리지 않으면 직접 입력할 수 있습니다.';
    } catch (_) { fail(); }
  });

  const script = document.createElement('script');
  script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  script.referrerPolicy = 'no-referrer';
  script.onerror = fail;
  script.onload = () => {
    Postcode = window.daum?.Postcode || window.kakao?.Postcode;
    if (typeof Postcode !== 'function') { Postcode = null; fail(); return; }
    popupButton.disabled = false;
    try {
      new Postcode(options()).embed(root, {autoClose: false});
      window.clearTimeout(loadTimer);
      status.hidden = true;
      notify('ready');
    } catch (_) { fail(); }
  };
  loadTimer = window.setTimeout(fail, 12000);
  document.head.appendChild(script);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); notify('closed'); }
  });
})();
