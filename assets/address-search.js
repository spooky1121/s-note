(function () {
  'use strict';

  const status = document.getElementById('search-status');
  const root = document.getElementById('postcode-root');
  // Capture the first-party receiver, then remove the public opener before any
  // provider code is loaded. The SDK can only return a selected address here.
  const receiver = window.opener;
  try { window.opener = null; } catch (_) { /* Invalid contexts are rejected below. */ }
  const nonce = window.location.hash.slice(1);
  let parentOrigin = '';
  let loadTimer = null;

  function notify(kind, values) {
    if (!parentOrigin || !receiver) return;
    try { receiver.postMessage({type: 'SNOTE_CUSTOMER_ADDRESS', nonce, kind, ...values}, parentOrigin); } catch (_) { /* The input page may have closed. */ }
  }

  function fail() {
    window.clearTimeout(loadTimer);
    status.hidden = false;
    status.dataset.tone = 'error';
    status.textContent = '주소 검색을 불러오지 못했습니다. 창을 닫고 다시 검색하거나 주소를 직접 입력해 주세요.';
    notify('error');
  }

  function closeSearch() {
    notify('closed');
    window.close();
  }
  document.getElementById('close-search').addEventListener('click', closeSearch);
  window.addEventListener('pagehide', () => notify('closed'));
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
  });

  try {
    const ownUrl = new URL(window.location.href);
    const candidate = ownUrl.searchParams.get('parentOrigin');
    if (window.top !== window || !receiver || receiver.closed || window.opener !== null || !/^[a-f0-9]{32}$/.test(nonce) || candidate !== ownUrl.origin || receiver.location.origin !== candidate) throw new Error('Invalid search context');
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

  const script = document.createElement('script');
  script.src = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  script.referrerPolicy = 'no-referrer';
  script.onerror = fail;
  script.onload = () => {
    const Postcode = window.daum?.Postcode || window.kakao?.Postcode;
    if (typeof Postcode !== 'function') { fail(); return; }
    try {
      new Postcode(options()).embed(root, {autoClose: false});
      window.clearTimeout(loadTimer);
      status.hidden = true;
      notify('ready');
    } catch (_) { fail(); }
  };
  loadTimer = window.setTimeout(fail, 12000);
  document.head.appendChild(script);
})();
