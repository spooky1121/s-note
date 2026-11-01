// Small, fixed vehicle-paint palette. Raw vehicle data never becomes CSS.
(function (root) {
  'use strict';

  const aliases = new Map();
  const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\s_-]+/gu, '');
  const palette = [
    ['black', ['검정색', '검정', '검은색', '흑색', '블랙', 'black']],
    ['pearl-black', ['펄 블랙', '블랙 펄', '검정색 펄', '검정 펄', '검정색(펄)', 'pearl black', 'black pearl']],
    ['matte-black', ['매트 블랙', '무광 검정', '무광 검정색', '무광 블랙', 'matte black']],
    ['white', ['흰색', '흰', '백색', '화이트', 'white']],
    ['pearl-white', ['진주색', '진주', '진주흰색', '진주백색', '펄 화이트', '화이트 펄', '펄 흰색', '흰색 펄', '흰색(펄)', '백색(펄)', 'pearl white', 'white pearl']],
    ['cream-white', ['크림 화이트', '크림색', '크림', 'cream white', 'cream']],
    ['ivory', ['아이보리', '아이보리색', '상아색', 'ivory']],
    ['silver', ['은색', '은', '실버', '은회색', 'silver']],
    ['light-silver', ['밝은 은색', '라이트 실버', '밝은 실버', 'light silver']],
    ['dark-silver', ['다크 실버', '진한 은색', '짙은 은색', 'dark silver']],
    ['gray', ['회색', '그레이', 'grey', 'gray']],
    ['light-gray', ['라이트 그레이', '밝은 회색', '연회색', 'light gray', 'light grey']],
    ['dark-gray', ['쥐색', '진회색', '짙은 회색', '다크 그레이', 'dark gray', 'dark grey']],
    ['charcoal-gray', ['차콜 그레이', '차콜', 'charcoal gray', 'charcoal grey', 'charcoal']],
    ['matte-gray', ['매트 그레이', '무광 회색', '무광 그레이', 'matte gray', 'matte grey']],
    ['blue', ['파란색', '파랑', '파랑색', '청색', '블루', 'blue']],
    ['sky-blue', ['하늘색', '스카이 블루', '연청색', 'sky blue', 'light blue']],
    ['navy', ['남색', '곤색', '네이비', 'navy', 'navy blue']],
    ['deep-blue', ['딥 블루', '진청색', '진한 청색', 'deep blue', 'dark blue']],
    ['teal', ['청록색', '청록', '틸 블루', '틸', 'teal', 'teal blue']],
    ['red', ['빨간색', '빨강', '빨강색', '적색', '레드', 'red']],
    ['burgundy', ['와인색', '와인', '버건디', '자주색', 'burgundy', 'wine', 'wine red', 'maroon']],
    ['dark-red', ['다크 레드', '진한 빨강', '진적색', 'dark red']],
    ['pink', ['핑크색', '핑크', '분홍색', '분홍', 'pink']],
    ['brown', ['갈색', '브라운', 'brown']],
    ['dark-brown', ['다크 브라운', '진갈색', '짙은 갈색', 'dark brown']],
    ['beige', ['베이지색', '베이지', 'beige']],
    ['champagne-gold', ['샴페인 골드', '샴페인색', '샴페인', 'champagne gold', 'champagne']],
    ['gold', ['금색', '골드', 'gold', 'golden']],
    ['yellow', ['노란색', '노랑', '노랑색', '황색', '옐로우', 'yellow']],
    ['orange', ['주황색', '주황', '오렌지', 'orange']],
    ['green', ['초록색', '초록', '녹색', '그린', 'green']],
    ['khaki', ['카키색', '카키', '올리브', '올리브색', 'khaki', 'olive', 'olive green']],
    ['mint', ['민트색', '민트', 'mint', 'mint green']],
    ['purple', ['보라색', '보라', '퍼플', 'purple', 'violet']]
  ];
  for (const [key, names] of palette) for (const name of names) aliases.set(normalize(name), key);
  const missing = new Set(['', '-', '—', '미입력', '없음', '색상선택', '선택', 'n/a', 'null', 'undefined']);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function rawColor(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) value = value.color;
    if (value == null) return '';
    if (typeof value !== 'string') return null;
    return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 160);
  }

  function component(value) {
    const direct = aliases.get(normalize(value));
    if (direct) return direct;
    const withoutPlacement = value.replace(/^(?:루프|지붕|바디|외장|roof|body)\s*[:：]?\s*/i, '').replace(/\s*(?:루프|지붕|바디|외장|roof|body)$/i, '').trim();
    return aliases.get(normalize(withoutPlacement)) || null;
  }

  function resolve(value) {
    const label = rawColor(value);
    if (label === null) return {state:'unknown', label:'색상 형식 확인 필요', colors:[]};
    if (missing.has(normalize(label))) return {state:'missing', label:'외장색 미입력', colors:[]};
    const direct = aliases.get(normalize(label));
    if (direct) return {state:'known', label, colors:[direct]};

    // A slash, plus or explicit two-tone separator is required. Never guess a
    // recognized word inside an otherwise unrecognized manufacturer paint name.
    let composite = label.replace(/\(\s*(?:투톤|two[\s-]*tone)\s*\)/gi, '').replace(/(?:투톤|two[\s-]*tone)/gi, '/').trim();
    composite = composite.replace(/^\s*[/+]\s*/, '').replace(/\s*[/+]\s*$/, '').trim();
    if (composite.startsWith('(') && composite.endsWith(')')) composite = composite.slice(1, -1).trim();
    const parts = composite.split(/\s*[/+,&·]\s*/u);
    if (parts.length === 2 && parts.every(Boolean)) {
      const colors = parts.map(component);
      if (colors.every(Boolean)) return {state:colors[0] === colors[1] ? 'known' : 'two-tone', label, colors:[...new Set(colors)]};
    }
    // Parenthesized synonyms such as "백색(화이트)" identify one paint only.
    const synonym = /^(.+?)\s*\(([^()]+)\)$/.exec(label);
    if (synonym) {
      const first = component(synonym[1].trim()), second = component(synonym[2].trim());
      if (first && first === second) return {state:'known', label, colors:[first]};
    }
    return {state:'unknown', label, colors:[]};
  }

  function render(value) {
    const color = resolve(value);
    const title = color.state === 'missing' ? color.label : color.state === 'unknown' ? `외장색 확인 필요: ${color.label}` : `외장색: ${color.label}`;
    const fills = color.colors.map(key => `<span class="snote222-vehicle-color__fill snote222-color--${key}" data-color-key="${key}" aria-hidden="true"></span>`).join('');
    return `<span class="snote222-vehicle-color snote222-vehicle-color--${color.state}" data-color-state="${color.state}" role="img" title="${escape(title)}" aria-label="${escape(title)}">${fills || '<span class="snote222-vehicle-color__dash" aria-hidden="true">—</span>'}</span>`;
  }

  const api = Object.freeze({resolve, render, paletteKeys:Object.freeze(palette.map(([key]) => key))});
  root.snote222VehicleColor = render;
  root.SnoteVehicleColors = api;
})(typeof window === 'object' ? window : globalThis);
