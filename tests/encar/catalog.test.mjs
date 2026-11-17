// Synthetic form/card contracts, not captured or verified encar.spb.ru markup.
// No real customer plate, advertisement, credential, HTTP request, or remote script.
import test from 'node:test';
import assert from 'node:assert/strict';
import './html-rewriter-setup.mjs';
import { CATALOG_ORIGIN, CatalogError, catalogURL, configuredCatalogSearch, discoverCatalogSearch, discoverCatalogEntry, discoverVehicleCatalogLink, discoverCatalogBranches, getObservedCatalogNext, parseCatalogPage, externalSourceURL, parseExternalAdvertisement } from '../../functions/_shared/encar-catalog.mjs';

const PLATE = '999허0000', OTHER = '888호0000', ID = '81000001';
const PAGE = CATALOG_ORIGIN + '/catalog?car_number=0000';
const form = (body = '<label for="number">Номер автомобиля</label><input id="number" name="car_number">', attrs = 'method="get" action="/catalog"') => `<form ${attrs}>${body}</form>`;
const card = (plate = PLATE, id = ID, tag = 'article', attrs = 'class="car-card"') => `<${tag} ${attrs}><span>${plate}</span><a href="/auto/${id}/">Advertisement</a></${tag}>`;
const rejects = (operation, code = 'CATALOG_PARSE_FAILED') => assert.rejects(operation, error => error instanceof CatalogError && error.code === code && error.message === code);
const throws = (operation, code = 'CATALOG_CONFIG_INVALID') => assert.throws(operation, error => error instanceof CatalogError && error.code === code && error.message === code);

test('catalog URL resolves actual same-origin relative links and returns a detached URL', () => {
  assert.equal(catalogURL('/catalog?page=2').href, CATALOG_ORIGIN + '/catalog?page=2');
  assert.equal(catalogURL('?page=2', PAGE).pathname, '/catalog');
  const value = new URL(PAGE); assert.notEqual(catalogURL(value), value);
});

test('catalog URL rejects non-HTTPS, foreign hosts, credentials, ports and write routes', () => {
  for (const value of ['http://encar.spb.ru/catalog', 'https://evil.example/catalog', 'https://encar.spb.ru.evil.example/catalog', 'https://sub.encar.spb.ru/catalog', 'https://user:pass@encar.spb.ru/catalog', 'https://encar.spb.ru:444/catalog', '/logout', '/admin', '/delete.php', '/a/../remove', '/%2564elete', '/catalog?action=delete', '/catalog?_method=POST', 'javascript:alert(1)', '//evil.example/catalog', '/catalog#next', 'https:\\encar.spb.ru/catalog', '/bad\nroute']) throws(() => catalogURL(value));
});

test('URL objects and composed form queries share the same URL length bound', async () => {
  throws(() => catalogURL(new URL(CATALOG_ORIGIN + '/catalog?value=' + 'a'.repeat(4100))));
  const hidden = Array.from({length:5}, (_, n) => `<input type="hidden" name="filter${n}" value="${'x'.repeat(900)}">`).join('');
  await rejects(() => discoverCatalogSearch(form('<input name="plate">' + hidden), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
});

test('configured search requires one query value placeholder and preserves duplicate non-search values', () => {
  const value = configuredCatalogSearch(CATALOG_ORIGIN + '/catalog?kind=one&car_number={suffix}&kind=two', '0000');
  assert.deepEqual(value.searchParams.getAll('kind'), ['one', 'two']); assert.equal(value.searchParams.get('car_number'), '0000');
  const sameKey = configuredCatalogSearch(CATALOG_ORIGIN + '/catalog?filter=one&filter={suffix}&filter=two', '0000');
  assert.deepEqual(sameKey.searchParams.getAll('filter'), ['one', '0000', 'two']);
});

test('configured search never guesses a URL or accepts a path/host/fragment placeholder', () => {
  for (const template of [undefined, null, '', '/catalog', '/{suffix}', '/catalog?q=prefix{suffix}', '/catalog?q={suffix}&x={suffix}', 'https://{suffix}.encar.spb.ru/catalog', '/catalog?q=1#{suffix}', '/catalog?q=%7Bsuffix%7D']) throws(() => configuredCatalogSearch(template, '0000'));
  for (const suffix of ['000', '00000', '1e03', '１２３４', 1234, null]) throws(() => configuredCatalogSearch('/catalog?q={suffix}', suffix));
});

test('GET form discovery uses an actual associated Russian label and hidden defaults', async () => {
  const value = await discoverCatalogSearch(form('<label for="number">Номер автомобиля</label><input id="number" name="car_number"><input type="hidden" name="sort" value="new"><input type="hidden" name="type" value="one"><input type="hidden" name="type" value="two">'), CATALOG_ORIGIN + '/', '0000');
  assert.equal(value.url.pathname, '/catalog'); assert.equal(value.url.searchParams.get('car_number'), '0000');
  assert.equal(value.url.searchParams.get('sort'), 'new'); assert.deepEqual(value.url.searchParams.getAll('type'), ['one', 'two']);
  assert.equal(value.formCount, 1); assert.equal(value.plateFieldCount, 1);
});

test('homepage without a plate form follows its observed public catalog link only', async () => {
  const html = '<nav><a href="/catalog/">Каталог</a></nav><form action="/catalog/"><select name="brand"><option>Brand</option></select></form>';
  await rejects(() => discoverCatalogSearch(html, CATALOG_ORIGIN + '/', '0000'), 'CATALOG_FORM_UNSUPPORTED');
  assert.equal((await discoverCatalogEntry(html, CATALOG_ORIGIN + '/')).href, CATALOG_ORIGIN + '/catalog/');
});

test('catalog entry discovery does not guess private, foreign, query or hidden links', async () => {
  for (const html of ['<a href="https://evil.example/catalog/">Каталог</a>', '<a href="/catalog/?action=delete">Каталог</a>', '<a href="/catalog/?brand=other">Каталог</a>', '<a href="/account/catalog/">Каталог</a>', '<a href="/catalog/" hidden>Каталог</a>', '<script>const route="/catalog/"</script>', '<form action="/catalog/"><button>Каталог</button></form>']) {
    await rejects(() => discoverCatalogEntry(html, CATALOG_ORIGIN + '/'), 'CATALOG_FORM_UNSUPPORTED');
  }
  assert.equal((await discoverCatalogEntry('<base href="https://evil.example/"><a href="/catalog/">Каталог</a><a href="/catalog">Каталог</a>', CATALOG_ORIGIN + '/')).origin, CATALOG_ORIGIN);
});

test('GET form discovery replaces action and current-page queries with successful controls', async () => {
  const controls = '<input name="plate"><input type="hidden" name="sort" value="new">';
  for (const attrs of ['method="get" action="/catalog?brand=stale&sort=old&plate=other"', 'method="get"']) {
    const {url} = await discoverCatalogSearch(form(controls, attrs), CATALOG_ORIGIN + '/catalog?brand=stale&sort=old', '0000');
    assert.deepEqual([...url.searchParams], [['sort', 'new'], ['plate', '0000']]);
  }
});

test('form attribute and text entities decode before interpretation, and base tags have no authority', async () => {
  const html = '<head><base href="https://evil.example/"></head>' + form('<label for="n">차량 &#48264;&#54840;</label><input id="n" name="car&#95;number"><input type="hidden" name="mode" value="a&amp;b">', 'action="/catalog?sort=a&amp;type=used"');
  const {url} = await discoverCatalogSearch(html, CATALOG_ORIGIN + '/published', '0000');
  assert.equal(url.origin, CATALOG_ORIGIN); assert.equal(url.searchParams.get('car_number'), '0000');
  assert.equal(url.searchParams.has('sort'), false); assert.equal(url.searchParams.has('type'), false); assert.equal(url.searchParams.get('mode'), 'a&b');
});

test('English, Korean, placeholder and enclosing labels can identify a plate field', async () => {
  for (const body of ['<input name="plate">', '<input name="license_plate">', '<input name="q" placeholder="Vehicle registration number">', '<label>번호판<input name="plate_search"></label>', '<input name="p" aria-label="Госномер">']) {
    const {url} = await discoverCatalogSearch(form(body), PAGE, '0000'); assert.equal([...url.searchParams.values()].includes('0000'), true);
  }
});

test('generic query, phone, login, contact and POST forms are never guessed as catalogue search', async () => {
  const bad = [form('<input name="q">'), form('<input name="phone" placeholder="Phone number">'), form('<input name="car_number"><input type="password" name="password">'), form('<input name="car_number"><input name="contact_phone">'), form('<input name="car_number"><textarea name="message"></textarea>'), form('<input name="car_number">', 'class="login-form" method="get" action="/catalog"'), form(undefined, 'method="post" action="/catalog"'), form(undefined, 'method="get" action="https://evil.example/search"'), form(undefined, 'method="get" action="/contact"'), form('<input name="car_number"><button formaction="/remove">Go</button>')];
  for (const html of bad) await rejects(() => discoverCatalogSearch(html, PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
});

test('only one supported form and exactly one successful named plate control are accepted', async () => {
  const duplicate = await discoverCatalogSearch(form() + form(), PAGE, '0000'); assert.equal(duplicate.formCount, 2); assert.equal(duplicate.url.searchParams.get('car_number'), '0000');
  await rejects(() => discoverCatalogSearch(form() + form(undefined, 'method="get" action="/different-catalog"'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input name="car_number"><input name="license_plate">'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input id="license_plate">'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input name="car_number" disabled>'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input name="plate" readonly>'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input name="template">'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  await rejects(() => discoverCatalogSearch(form('<input name="car_number"><input type="hidden" name="car_number" value="other">'), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
  const answer = await discoverCatalogSearch(form() + '<form action="/login"><input name="username"></form>', PAGE, '0000'); assert.equal(answer.formCount, 2);
});

test('actual successful GET defaults are preserved without choosing new filter values', async () => {
  const html = form('<input name="plate"><input name="query" value="actual" readonly><input type="number" name="minimum" value="0"><input type="search" name="q" value=""><input type="radio" name="market" checked value="public"><input type="radio" name="market" value="other"><input type="checkbox" name="active" checked><input type="checkbox" name="ignored"><input name="disabled" disabled value="x"><select name="sort"><option value="old">Old</option><option selected value="new">New</option></select><select name="kind"><option disabled value="skip">Disabled</option><option value="first">First</option><option value="second">Second</option></select><select name="many" multiple><option selected value="a">A</option><option selected value="b">B</option></select><select name="none" multiple><option value="a">A</option></select>');
  const {url} = await discoverCatalogSearch(html, PAGE, '0000');
  for (const [name, value] of Object.entries({plate:'0000',query:'actual',minimum:'0',q:'',market:'public',active:'on',sort:'new',kind:'first'})) assert.equal(url.searchParams.get(name), value);
  assert.deepEqual(url.searchParams.getAll('many'), ['a','b']); for (const name of ['ignored','disabled','none']) assert.equal(url.searchParams.has(name), false);
});

test('ambiguous static controls and named submitters fail closed', async () => {
  for (const extra of ['<input type="radio" name="market" checked value="a"><input type="radio" name="market" checked value="b">', '<select name="sort"><option selected value="a">A</option><option selected value="b">B</option></select>', '<button name="search" value="1">Search</button>']) await rejects(() => discoverCatalogSearch(form('<input name="plate">' + extra), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
});

test('an explicitly selected disabled option omits that filter instead of selecting another value', async () => {
  for (const options of ['<option disabled selected value="">Choose</option><option value="brand-a">A</option>', '<option disabled hidden selected value="">Choose</option><option value="brand-a">A</option>', '<optgroup disabled><option selected value="brand-a">A</option></optgroup><option value="brand-b">B</option>']) {
    const {url} = await discoverCatalogSearch(form('<input name="plate"><select name="brand">' + options + '</select>'), PAGE, '0000');
    assert.equal(url.searchParams.has('brand'), false); assert.equal(url.searchParams.get('plate'), '0000');
  }
  const {url} = await discoverCatalogSearch(form('<input name="plate"><select name="brand" multiple><option disabled selected value="brand-a">A</option><option selected value="brand-b">B</option></select>'), PAGE, '0000');
  assert.deepEqual(url.searchParams.getAll('brand'), ['brand-b']);
  const hidden = await discoverCatalogSearch(form('<input name="plate"><select name="brand"><option hidden selected>  Brand &amp; model </option><option value="other">Other</option></select>'), PAGE, '0000');
  assert.equal(hidden.url.searchParams.get('brand'), 'Brand & model');
});

test('a single-select listbox without explicit selection omits its value', async () => {
  const {url} = await discoverCatalogSearch(form('<input name="plate"><select name="brand" size="4"><option value="a">A</option><option value="b">B</option></select>'), PAGE, '0000'); assert.equal(url.searchParams.has('brand'), false);
  const selected = await discoverCatalogSearch(form('<input name="plate"><select name="brand" size="4"><option value="a">A</option><option selected value="b">B</option></select>'), PAGE, '0000'); assert.equal(selected.url.searchParams.get('brand'), 'b');
});

test('disabled-fieldset forms fail closed instead of submitting unavailable controls', async () => {
  for (const body of ['<input name="plate"><fieldset disabled><input name="brand" value="a"></fieldset>', '<fieldset disabled><input name="plate"></fieldset>', '<fieldset disabled><legend><input name="plate"></legend><input name="brand" value="a"></fieldset>']) await rejects(() => discoverCatalogSearch(form(body), PAGE, '0000'), 'CATALOG_FORM_UNSUPPORTED');
});

test('one semantic card yields only its explicit same-record advertisement ID', async () => {
  const value = await parseCatalogPage(card(), PAGE, PLATE);
  assert.deepEqual(value.ids, [ID]); assert.equal(value.recordCount, 1); assert.equal(value.exactMatchCount, 1); assert.equal(value.linkCount, 1); assert.equal(value.empty, false); assert.equal(value.nextUrl, null);
});

test('same last four digits are not enough; different full plates remain separate', async () => {
  const value = await parseCatalogPage(card(OTHER) + card(PLATE, '81000002'), PAGE, PLATE);
  assert.deepEqual(value.ids, ['81000002']); assert.equal(value.recordCount, 2); assert.equal(value.exactMatchCount, 1);
});

test('a regional full plate cannot be mistaken for the embedded national plate', async () => {
  const html = card('서울99허0000');
  assert.deepEqual((await parseCatalogPage(html, PAGE, '99허0000')).ids, []);
  assert.deepEqual((await parseCatalogPage(html, PAGE, '서울99허0000')).ids, [ID]);
});

test('NFKC, inline fragments, spacing, hyphens and numeric entities preserve a full plate', async () => {
  for (const value of ['９９９ 허 ００００', '999-허-0000', '999<b>허</b>00<span>00</span>', '&#57;&#57;&#57;&#xD5C8;0000']) assert.deepEqual((await parseCatalogPage(card(value), PAGE, PLATE)).ids, [ID]);
});

test('plate matching respects numeric boundaries without merging price blocks', async () => {
  await rejects(() => parseCatalogPage(card('1' + PLATE), PAGE, PLATE));
  await rejects(() => parseCatalogPage(card(PLATE + '1'), PAGE, PLATE));
  const html = `<article><div>${PLATE}</div><div>10000000</div><a href="/auto/${ID}">View</a></article>`;
  assert.deepEqual((await parseCatalogPage(html, PAGE, PLATE)).ids, [ID]);
});

test('adjacent or nested cards never borrow a plate from a different record or header', async () => {
  await rejects(() => parseCatalogPage(`<p>${PLATE}</p><article><a href="/auto/${ID}">View</a></article>`, PAGE, PLATE));
  await rejects(() => parseCatalogPage(`<article>${PLATE}</article><article><a href="/auto/${ID}">View</a></article>`, PAGE, PLATE));
  await rejects(() => parseCatalogPage(`<div class="card">${PLATE}<article><a href="/auto/${ID}">View</a></article></div>`, PAGE, PLATE));
  const nested = `<div class="card">${card(OTHER)}${card(PLATE, '81000002')}</div>`;
  assert.deepEqual((await parseCatalogPage(nested, PAGE, PLATE)).ids, ['81000002']);
});

test('script, style, forms, textarea, templates and hidden text cannot supply card proof', async () => {
  for (const snippet of [`<script>${PLATE}</script>`, `<style>${PLATE}</style>`, `<form>${PLATE}</form>`, `<textarea>${PLATE}</textarea>`, `<template>${PLATE}</template>`, `<span hidden>${PLATE}</span>`, `<span style="display:none">${PLATE}</span>`]) await rejects(() => parseCatalogPage(`<article>${snippet}<a href="/auto/${ID}">View</a></article>`, PAGE, PLATE));
});

test('duplicate links and repeated cards deduplicate IDs while distinct exact cards remain visible', async () => {
  const duplicate = card().replace('</article>', `<a href="/auto/${ID}/">More</a></article>`);
  const first = await parseCatalogPage(duplicate + card(), PAGE, PLATE); assert.deepEqual(first.ids, [ID]); assert.equal(first.linkCount, 3); assert.equal(first.exactMatchCount, 2);
  assert.deepEqual((await parseCatalogPage(card() + card(PLATE, '81000002'), PAGE, PLATE)).ids, [ID, '81000002']);
});

test('one card with multiple distinct plates or advertisement IDs is ambiguous', async () => {
  await rejects(() => parseCatalogPage(card().replace('</article>', `<a href="/auto/81000002">Other</a></article>`), PAGE, PLATE));
  await rejects(() => parseCatalogPage(card(PLATE + ' / ' + OTHER), PAGE, PLATE));
});

test('semantic li and vehicle-record class are supported without guessing unstructured divs', async () => {
  assert.deepEqual((await parseCatalogPage('<ul>' + card(PLATE, ID, 'li', '') + '</ul>', PAGE, PLATE)).ids, [ID]);
  assert.deepEqual((await parseCatalogPage(card(PLATE, ID, 'div', 'class="vehicle-record"'), PAGE, PLATE)).ids, [ID]);
  await rejects(() => parseCatalogPage(card(PLATE, ID, 'div', ''), PAGE, PLATE));
});

test('decorative card-image and BEM card__body remain inside their actual record', async () => {
  for (const imageClass of ['card__image', 'card-image']) {
    const html = `<article class="car-card"><div class="${imageClass}"><a href="/auto/${ID}/">Photo</a></div><div class="card__body">${PLATE}</div></article>`;
    const result = await parseCatalogPage(html, PAGE, PLATE); assert.deepEqual(result.ids, [ID]); assert.equal(result.recordCount, 1);
  }
  const html = `<div class="car-card--featured"><div class="card-image"><a href="/auto/${ID}">Photo</a></div><div class="card__body">${PLATE}</div></div>`;
  assert.deepEqual((await parseCatalogPage(html, PAGE, PLATE)).ids, [ID]);
});

test('up to twelve unique matches are returned with an explicit truncation flag', async () => {
  const value = await parseCatalogPage(Array.from({length:14}, (_, n) => card(PLATE, String(81000001 + n))).join(''), PAGE, PLATE);
  assert.equal(value.ids.length, 12); assert.equal(value.recordCount, 14); assert.equal(value.exactMatchCount, 14); assert.equal(value.truncated, true);
});

test('only actual rel-next or pagination next links are returned; no path is invented', async () => {
  const rel = await parseCatalogPage(card() + '<a rel="nofollow next" href="?car_number=0000&amp;page=2">Next</a>', PAGE, PLATE);
  assert.equal(rel.nextUrl.searchParams.get('page'), '2'); assert.equal(rel.nextUrl.searchParams.get('car_number'), '0000');
  const nav = await parseCatalogPage(card() + '<nav class="pagination"><a href="?page=2">Следующая</a></nav>', PAGE, PLATE); assert.equal(nav.nextUrl.searchParams.get('page'), '2');
  const mainMenu = await parseCatalogPage(card() + '<nav><a href="/unrelated">Next</a></nav>', PAGE, PLATE); assert.equal(mainMenu.nextUrl, null);
  const cycle = await parseCatalogPage(card() + `<a rel="next" href="${PAGE}">Next</a>`, PAGE, PLATE); assert.equal(cycle.nextUrl.href, PAGE);
});

test('foreign, encoded-foreign, unsafe or ambiguous next links fail without returning raw addresses', async () => {
  for (const href of ['https://evil.example/catalog', 'https:&#47;&#47;evil.example/catalog', '/logout', 'javascript:alert(1)', 'https://encar.spb.ru:444/catalog']) await rejects(() => parseCatalogPage(card() + `<a rel="next" href="${href}">Next</a>`, PAGE, PLATE));
  await rejects(() => parseCatalogPage(card() + '<a rel="next" href="?page=2">Next</a><a rel="next" href="?page=3">Next</a>', PAGE, PLATE));
});

test('genuine explicit empty states differ from valid nonmatching records', async () => {
  for (const html of ['<div class="no-results">Ничего не найдено</div>', '<p role="status">No vehicles found.</p>', '<div class="empty">검색 결과가 없습니다.</div>']) { const value = await parseCatalogPage(html, PAGE, PLATE); assert.equal(value.empty, true); assert.deepEqual(value.ids, []); }
  const other = await parseCatalogPage(card(OTHER), PAGE, PLATE); assert.equal(other.empty, false); assert.deepEqual(other.ids, []);
});

test('blank, JS-only, blocked, unclosed and contradictory empty pages fail closed', async () => {
  for (const html of ['', '<div id="app"></div><script>renderCars()</script>', '<title>Access Denied</title><div class="no-results">No results</div>', '<div class="no-results">No results</div><a href="/auto/not-an-id">Advertisement</a>', '<div class="no-results">No results</div><a rel="next" href="?page=2">Next</a>', '<main>FAQ<p>No results</p></main>', `<article>${PLATE}<a href="/auto/${ID}">View</a>`]) await rejects(() => parseCatalogPage(html, PAGE, PLATE));
});

test('malformed/foreign advertisement links and page-wide proof cannot produce an ID', async () => {
  for (const href of ['https://evil.example/auto/81000001', '/auto/0', '/auto/1234567890123', '/auto/no-id']) await rejects(() => parseCatalogPage(`<article>${PLATE}<a href="${href}">View</a></article>`, PAGE, PLATE));
  await rejects(() => parseCatalogPage(`<div>${PLATE}</div><a href="/auto/${ID}">View</a>`, PAGE, PLATE));
});

test('parser errors are fixed enums and a missing runtime parser is explicit', async () => {
  const engine = globalThis.HTMLRewriter;
  try { globalThis.HTMLRewriter = undefined; await rejects(() => discoverCatalogSearch(form(), PAGE, '0000'), 'CATALOG_PARSER_UNAVAILABLE'); await rejects(() => parseCatalogPage(card(), PAGE, PLATE), 'CATALOG_PARSER_UNAVAILABLE'); }
  finally { globalThis.HTMLRewriter = engine; }
});

test('helpers never call HTTP or mutate inputs', async () => {
  const oldFetch = globalThis.fetch, html = card(); globalThis.fetch = () => { throw new Error('No HTTP in parser'); };
  try { await discoverCatalogSearch(form(), PAGE, '0000'); const result = await parseCatalogPage(html, PAGE, PLATE); assert.deepEqual(result.ids, [ID]); assert.equal(html, card()); }
  finally { globalThis.fetch = oldFetch; }
});

const EXTERNAL_ORIGIN = 'https://fixture-region.trust-encar.ru';
const EXTERNAL_DETAIL = EXTERNAL_ORIGIN + '/auto/' + ID + '/';
function externalDetail({ plate = PLATE, id = ID, outId = id, added = '21.10.2026', modified = '22.10.2026', related = '', before = '', status = '' } = {}) {
  return `<main><h1>Synthetic vehicle</h1>${before}<p>Дата добавления объявления ${added}</p><p>Дата модификации объявления ${modified}</p><ul class="vehicle-specs"><li><span>Статус</span><strong>${status}</strong></li><li><span>Лот</span><strong>${id}</strong></li><li><span>Номер автомобиля</span><strong>${plate}</strong></li></ul><a href="https://www.encar.com/dc/dc_cardetailview.do?carid=${outId}">Авто на Encar</a></main>${related}`;
}

test('external source URLs support only known HTTPS detail/catalog hosts and preserve read filters', () => {
  for (const host of ['trust-encar.ru', 'encar.spb.ru', 'encar.msk.ru', 'encar.cbg.ru', 'fixture-region.trust-encar.ru']) {
    const url = externalSourceURL(`https://${host}/catalog/tesla/model-y/?page=2`);
    assert.equal(url.hostname, host); assert.equal(url.searchParams.get('page'), '2');
    assert.equal(externalSourceURL(`/auto/${ID}/`, url).href, `https://${host}/auto/${ID}/`);
  }
  assert.equal(externalSourceURL('?page=3', EXTERNAL_ORIGIN + '/catalog/').searchParams.get('page'), '3');
});

test('external URL checks reject host lookalikes, explicit ports, credentials, unicode and write routes', () => {
  for (const value of [
    'http://trust-encar.ru/auto/81000001/', 'https://trust-encar.ru.evil.example/auto/81000001/',
    'https://nottrust-encar.ru/auto/81000001/', 'https://encar.spb.ru.evil.example/catalog/',
    'https://sub.encar.spb.ru/catalog/', 'https://-bad.trust-encar.ru/catalog/', 'https://bad_.trust-encar.ru/catalog/',
    'https://a..trust-encar.ru/catalog/', 'https://xn--fake.trust-encar.ru/catalog/', 'https://지역.trust-encar.ru/catalog/',
    'https://trust-encar.ru:443/catalog/', 'https://trust-encar.ru:444/catalog/', 'https://user:pass@trust-encar.ru/catalog/',
    '/auto/0/', '/auto/1234567890123/', '/auto/no-id/', '/auto/81000001/extra', '/auto/81000001/#x',
    '/auto/81000001/?page=2', '/catalog/Tesla/', '/catalog/model_y/', '/catalog/?q=' + 'x'.repeat(2048),
    '/catalog/../auto/81000001/', '/catalog/%2e%2e/auto/81000001/', '/%61uto/81000001/',
    '/catalog/delete/', '/catalog/?action=delete', '/catalog/?_method=POST', '/catalog/?delete=1',
    '/account/', 'javascript:alert(1)', 'https:\\trust-encar.ru/catalog/', '/catalog/\nunsafe'
  ]) throws(() => externalSourceURL(value, EXTERNAL_ORIGIN));
});

test('external detail confirms only the main labelled plate, lot and matching official link', async () => {
  const value = await parseExternalAdvertisement(externalDetail(), EXTERNAL_DETAIL, PLATE);
  assert.deepEqual(value, { matches: [{ id: ID, sourceUrl: EXTERNAL_DETAIL, advertisedAt: '2026-10-21', modifiedAt: '2026-10-22' }], recordCount: 1, kind: 'detail' });
  assert.equal(JSON.stringify(value).includes('price'), false);
});

test('external detail supports semantic dt/dd and table label-value pairs', async () => {
  for (const fields of [
    `<dl><dt>Лот</dt><dd>${ID}</dd><dt>Номер автомобиля</dt><dd>${PLATE}</dd></dl>`,
    `<table><tr><th>Лот</th><td>${ID}</td></tr><tr><th>Номер автомобиля</th><td>${PLATE}</td></tr></table>`,
    `<div class="car-info"><div>Лот: ${ID}</div><div>Номер автомобиля: ${PLATE}</div></div>`
  ]) {
    const value = await parseExternalAdvertisement('<h1>Fixture vehicle</h1>' + fields, EXTERNAL_DETAIL, PLATE);
    assert.equal(value.matches[0].id, ID);
  }
});

test('different main plate is not replaced by the requested plate in recommended cars', async () => {
  const related = `<section class="related-cars"><h2>Похожие автомобили</h2><article><h3><a href="/auto/81000002/">Other vehicle</a></h3><ul><li>Лот 81000002</li><li>Номер автомобиля ${PLATE}</li></ul></article></section>`;
  const result = await parseExternalAdvertisement(externalDetail({ plate: OTHER, related }), EXTERNAL_DETAIL, PLATE);
  assert.deepEqual(result.matches, []);
  await rejects(() => parseExternalAdvertisement(`<main><h1>Fixture vehicle</h1><ul><li>Лот ${ID}</li></ul></main>${related}`, EXTERNAL_DETAIL, PLATE));
});

test('a related heading bounds main identity even without a recognizable related CSS class', async () => {
  const html = externalDetail({ plate: OTHER }).replace('</main>', `<h2>Похожие лоты</h2><ul><li>Лот ${ID}</li><li>Номер автомобиля ${PLATE}</li></ul></main>`);
  assert.deepEqual((await parseExternalAdvertisement(html, EXTERNAL_DETAIL, PLATE)).matches, []);
});

test('main source ID, lot and official outgoing link must not contradict one another', async () => {
  await rejects(() => parseExternalAdvertisement(externalDetail({ id: '81000002' }), EXTERNAL_DETAIL, PLATE));
  await rejects(() => parseExternalAdvertisement(externalDetail({ outId: '81000002' }), EXTERNAL_DETAIL, PLATE));
  const mixed = externalDetail().replace('</ul>', `<li>Номер автомобиля ${OTHER}</li></ul>`);
  await rejects(() => parseExternalAdvertisement(mixed, EXTERNAL_DETAIL, PLATE));
});

test('main identity cannot borrow lot and plate from separate lists or page header', async () => {
  for (const html of [
    `<h1>${PLATE}</h1><ul><li>Лот ${ID}</li></ul>`,
    `<main><h1>Fixture vehicle</h1><ul><li>Лот ${ID}</li></ul><ul><li>Номер автомобиля ${PLATE}</li></ul></main>`,
    `<main><h1>Fixture vehicle</h1><ul><li>Лот ${ID}</li><li>Номер автомобиля UNKNOWN</li></ul><ul><li>Номер автомобиля ${PLATE}</li></ul></main>`,
    `<h1>Fixture vehicle</h1><p>Лот ${ID}</p><p>Номер автомобиля ${PLATE}</p>`
  ]) await rejects(() => parseExternalAdvertisement(html, EXTERNAL_DETAIL, PLATE));
});

test('detail matching ignores scripts, forms, hidden content and unrelated dates', async () => {
  const noise = `<script>const plate='${PLATE}'</script><form>Номер автомобиля ${PLATE}</form><div hidden><ul><li>Лот ${ID}</li><li>Номер автомобиля ${PLATE}</li></ul></div>`;
  assert.deepEqual((await parseExternalAdvertisement(externalDetail({ plate: OTHER, before: noise }), EXTERNAL_DETAIL, PLATE)).matches, []);
  const related = '<section class="related"><p>Дата добавления объявления 01.01.2001</p></section>';
  const found = await parseExternalAdvertisement(externalDetail({ related }), EXTERNAL_DETAIL, PLATE);
  assert.equal(found.matches[0].advertisedAt, '2026-10-21');
});

test('a wrapper spanning the recommendations cannot leak their dates or sold status into primary evidence', async () => {
  const html = `<main><h1>Synthetic vehicle</h1><div class="vehicle-info"><p>Дата добавления объявления 21.10.2026</p><ul><li>Лот ${ID}</li><li>Номер автомобиля ${PLATE}</li></ul><section class="related-cars"><h2>Похожие автомобили</h2><p>Дата добавления объявления 01.01.2001</p><p>Автомобиль продан или снят с продажи</p></section>Дата добавления объявления 02.02.2002 Автомобиль продан</div></main>`;
  const result = await parseExternalAdvertisement(html, EXTERNAL_DETAIL, PLATE);
  assert.equal(result.matches[0].advertisedAt, '2026-10-21');
  assert.equal(result.matches[0].id, ID);
});

test('malformed publication dates become unknown without invalidating plate identity', async () => {
  for (const added of ['31.02.2026', '29.02.2025', '00.10.2026', '21.13.2026', '21.10.1999', 'unknown']) {
    const value = await parseExternalAdvertisement(externalDetail({ added }), EXTERNAL_DETAIL, PLATE);
    assert.equal(value.matches[0].advertisedAt, null);
    assert.equal(value.matches[0].id, ID);
  }
  const leap = await parseExternalAdvertisement(externalDetail({ added: '29.02.2024' }), EXTERNAL_DETAIL, PLATE);
  assert.equal(leap.matches[0].advertisedAt, '2024-02-29');
});

test('explicitly removed external advertisements and browser verification cannot become active matches', async () => {
  assert.deepEqual((await parseExternalAdvertisement(externalDetail({ status: 'Автомобиль продан или снят с продажи' }), EXTERNAL_DETAIL, PLATE)).matches, []);
  for (const html of ['<h1>Проверка браузера...</h1>', '<title>Access Denied</title>' + externalDetail(), '<h1>Enable JavaScript</h1>']) {
    await rejects(() => parseExternalAdvertisement(html, EXTERNAL_DETAIL, PLATE));
  }
});

test('external catalogs use plate and ID from the same semantic card only', async () => {
  const sourceUrl = EXTERNAL_ORIGIN + '/catalog/fixture/?page=2';
  const result = await parseExternalAdvertisement(card(OTHER, '81000002') + card(), sourceUrl, PLATE);
  assert.deepEqual(result.matches, [{ id: ID, sourceUrl, advertisedAt: null, modifiedAt: null }]);
  assert.equal(result.recordCount, 2); assert.equal(result.kind, 'catalog');
  await rejects(() => parseExternalAdvertisement(`<p>${PLATE}</p><div><a href="/auto/${ID}/">Vehicle</a></div>`, sourceUrl, PLATE));
});

test('external catalogue cards explicitly marked removed or sold never produce a usable match', async () => {
  for (const status of ['Автомобиль продан или снят с продажи', 'Продан', 'Sold']) {
    const html = `<article><h2><a href="/auto/${ID}/">Synthetic</a></h2><p>${PLATE}</p><p>${status}</p></article>`;
    const value = await parseExternalAdvertisement(html, EXTERNAL_ORIGIN + '/catalog/', PLATE);
    assert.deepEqual(value.matches, []); assert.equal(value.recordCount, 1);
  }
});

test('catalog heading-linked record containers are supported without relying on an invented class name', async () => {
  const html = `<div class="published-layout"><h2><a href="/auto/${ID}/">Fixture vehicle</a></h2><p>${PLATE}</p></div>`;
  assert.equal((await parseExternalAdvertisement(html, EXTERNAL_ORIGIN + '/catalog/', PLATE)).matches[0].id, ID);
});

test('nested title wrappers cannot discard the actual card containing its sibling plate', async () => {
  for (const cls of ['catalog-card', 'published-layout']) {
    const html = `<div class="${cls}"><div class="card-header"><h3><a href="/auto/${ID}/">Synthetic model</a></h3></div><div class="card-body"><p>${PLATE}</p></div></div>`;
    const result = await parseExternalAdvertisement(html, EXTERNAL_ORIGIN + '/catalog/', PLATE);
    assert.equal(result.matches[0].id, ID); assert.equal(result.recordCount, 1);
  }
});

test('external catalogs reject mixed IDs, different plates on the same ID, or borrowed inline page text', async () => {
  const sourceUrl = EXTERNAL_ORIGIN + '/catalog/';
  for (const html of [
    card() + card(OTHER, ID),
    `<article>${PLATE}<a href="/auto/${ID}/">One</a><a href="/auto/81000002/">Two</a></article>`,
    `<article>${PLATE}<span> ${OTHER}</span><a href="/auto/${ID}/">One</a></article>`
  ]) await rejects(() => parseExternalAdvertisement(html, sourceUrl, PLATE));
  assert.deepEqual((await parseExternalAdvertisement(`<header>${PLATE}</header>${card(OTHER)}`, sourceUrl, PLATE)).matches, []);
});

test('external catalogs ignore hidden/form/script plates and unsafe links', async () => {
  const sourceUrl = EXTERNAL_ORIGIN + '/catalog/';
  const html = `<article><span>${OTHER}</span><span hidden>${PLATE}</span><script>${PLATE}</script><form>${PLATE}</form><a href="/auto/${ID}/">View</a></article>`;
  assert.deepEqual((await parseExternalAdvertisement(html, sourceUrl, PLATE)).matches, []);
  for (const href of ['https://evil.example/auto/81000001/', 'https://trust-encar.ru:443/auto/81000001/', '/auto/no-id/', '/%61uto/81000001/']) {
    await rejects(() => parseExternalAdvertisement(`<article>${PLATE}<a href="${href}">View</a></article>`, sourceUrl, PLATE));
  }
});

test('external parser never fetches, executes remote scripts or exposes seller metadata', async () => {
  const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error('Parser must not fetch'); };
  try {
    const html = externalDetail({ before: '<p>Seller PRIVATE_SELLER · PRIVATE_PHONE</p><script src="https://evil.example/run.js"></script>' });
    const value = await parseExternalAdvertisement(html, EXTERNAL_DETAIL, PLATE);
    assert.equal(value.matches[0].id, ID); assert.equal(JSON.stringify(value).includes('PRIVATE_'), false);
  } finally { globalThis.fetch = previous; }
});

test('observed make and model catalogue anchors work without a registration-number form', async () => {
  const directory = CATALOG_ORIGIN + '/catalog/';
  const makeHTML = '<!doctype html><html><head><title>Автомобили из Кореи — Каталог</title></head><body><form method="post" action="/private-submit"><input name="brand"><a href="/catalog/hyundai/">Hyundai <span class="count">1000</span></a><a href="/catalog/toyota/">Toyota <span class="count">809</span></a></form></body></html>';
  const make = await discoverVehicleCatalogLink(makeHTML, directory, { make: '토요타', model: 'RAV4' }, 'make');
  assert.equal(make.href, CATALOG_ORIGIN + '/catalog/toyota/');
  const modelHTML = '<ul><li><a href="/catalog/toyota/camry/">Camry 20</a></li><li><a href="/catalog/toyota/rav4/"><span>RAV4</span><span class="badge">147</span></a></li></ul>';
  const model = await discoverVehicleCatalogLink(modelHTML, make, { make: '토요타', model: 'RAV4' }, 'model');
  assert.equal(model.href, CATALOG_ORIGIN + '/catalog/toyota/rav4/');
  const vehicle = await parseExternalAdvertisement(card(), model, PLATE);
  assert.equal(vehicle.matches[0].id, ID);
});

test('make aliases change matching names but never construct a missing route', async () => {
  const directory = CATALOG_ORIGIN + '/catalog/';
  for (const [make, slug, label] of [
    ['도요타', 'toyota', 'Toyota'], ['테슬라', 'tesla', 'Tesla'], ['현대', 'hyundai', 'Hyundai'],
    ['기아', 'kia', 'Kia'], ['벤츠', 'mercedes-benz', 'Mercedes-Benz'], ['르노삼성', 'renault', 'Renault'],
    ['KG모빌리티', 'ssangyong', 'Ssangyong'], ['쉐보레', 'chevrolet', 'Chevrolet (GM Daewoo)']
  ]) {
    const result = await discoverVehicleCatalogLink(`<a href="/catalog/${slug}/">${label}</a>`, directory, { make }, 'make');
    assert.equal(result.href, CATALOG_ORIGIN + '/catalog/' + slug + '/');
    assert.equal(await discoverVehicleCatalogLink('<p>There is no matching anchor.</p>', directory, { make }, 'make'), null);
  }
});

test('observed catalogue labels tolerate count badges and preserve digits belonging to the model', async () => {
  const make = CATALOG_ORIGIN + '/catalog/toyota/';
  for (const label of ['RAV4 <span class="count">147</span>', '<strong>RAV</strong><span>4</span> 147', 'RAV4']) {
    const url = await discoverVehicleCatalogLink(`<a href="/catalog/toyota/rav4/">${label}</a>`, make, { model: 'RAV4' }, 'model');
    assert.equal(url.href, make + 'rav4/');
  }
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/rav4-prime/">RAV4 Prime 23</a>', make, { model: 'RAV4' }, 'model'), null);
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/rav4/">RAV4 147</a>', make, { model: 'RAV' }, 'model'), null);
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/rav4/">RAV <span>4</span></a>', make, { model: 'RAV' }, 'model'), null);
  assert.equal((await discoverVehicleCatalogLink('<a href="/catalog/tesla/model-y/">Model Y <span class="badge">200</span></a>', CATALOG_ORIGIN + '/catalog/tesla/', { model: '모델 Y' }, 'model')).pathname, '/catalog/tesla/model-y/');
});

test('navigation follows the actual published slug rather than a translated or generated URL', async () => {
  const make = await discoverVehicleCatalogLink('<a href="/catalog/published-make-name/">Toyota 20</a>', CATALOG_ORIGIN + '/catalog/', { make: '토요타' }, 'make');
  assert.equal(make.pathname, '/catalog/published-make-name/');
  const model = await discoverVehicleCatalogLink('<a href="/catalog/published-make-name/published-model-name/">RAV4 <span class="count">5</span></a>', make, { model: 'RAV4' }, 'model');
  assert.equal(model.pathname, '/catalog/published-make-name/published-model-name/');
  assert.equal((await discoverVehicleCatalogLink('<a href="/catalog/tesla/published-model/">Model&nbsp;Y</a>', CATALOG_ORIGIN + '/catalog/tesla/', { model: '모델 Y' }, 'model')).pathname, '/catalog/tesla/published-model/');
});

test('catalogue make/model discovery rejects absent, malformed or ambiguous hints and links', async () => {
  const directory = CATALOG_ORIGIN + '/catalog/';
  for (const hints of [null, [], {}, { make: '' }, { make: ' ' }, { make: 'Toyota\n' }, { make: 'https://toyota' }, { make: 'x'.repeat(121) }]) {
    assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/">Toyota</a>', directory, hints, 'make'), null);
  }
  const ambiguous = '<a href="/catalog/toyota/">Toyota</a><a href="/catalog/alternate/">Toyota</a>';
  assert.equal(await discoverVehicleCatalogLink(ambiguous, directory, { make: '토요타' }, 'make'), null);
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/">Toyota</a><a href="/catalog/toyota">Toyota</a>', directory, { make: '토요타' }, 'make').then(url => url.pathname), '/catalog/toyota/');
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/rav4/">RAV4</a>', directory, { model: 'RAV4' }, 'model'), null);
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/">Toyota</a>', directory, { make: 'Toyota' }, 'unknown'), null);
});

test('navigation cannot escape its observed make or borrow deeper generation/trim routes', async () => {
  const make = CATALOG_ORIGIN + '/catalog/toyota/';
  for (const href of ['/catalog/honda/rav4/', '/catalog/toyota/rav4/generation/', '/catalog/toyota/', '/catalog/toyota/rav4/?sort=price']) {
    assert.equal(await discoverVehicleCatalogLink(`<a href="${href}">RAV4</a>`, make, { model: 'RAV4' }, 'model'), null);
  }
  assert.equal(await discoverVehicleCatalogLink('<a href="/catalog/toyota/rav4/">Toyota</a>', CATALOG_ORIGIN + '/catalog/', { make: 'Toyota' }, 'make'), null);
});

test('navigation ignores hidden, scripted and unsafe catalogue destinations', async () => {
  const directory = CATALOG_ORIGIN + '/catalog/';
  for (const html of [
    '<a href="/catalog/toyota/" hidden>Toyota</a>', '<div aria-hidden="true"><a href="/catalog/toyota/">Toyota</a></div>',
    '<script>"<a href=\"/catalog/toyota/\">Toyota</a>"</script>', '<a href="javascript:location=\'/catalog/toyota/\'">Toyota</a>',
    '<a href="https://evil.example/catalog/toyota/">Toyota</a>', '<a href="https://encar.spb.ru.evil.example/catalog/toyota/">Toyota</a>',
    '<a href="https://user:password@encar.spb.ru/catalog/toyota/">Toyota</a>', '<a href="https://encar.spb.ru:443/catalog/toyota/">Toyota</a>',
    '<a href="/catalog/%74oyota/">Toyota</a>', '<a href="/catalog/../catalog/toyota/">Toyota</a>', '<a href="/catalog/delete/">Toyota</a>'
  ]) assert.equal(await discoverVehicleCatalogLink(html, directory, { make: 'Toyota' }, 'make'), null);
  assert.equal((await discoverVehicleCatalogLink('<footer><a href="/catalog/toyota/">Toyota</a></footer>', directory, { make: 'Toyota' }, 'make')).pathname, '/catalog/toyota/');
});

test('observed next-page navigation retains the same model and all existing filters', async () => {
  const current = CATALOG_ORIGIN + '/catalog/toyota/rav4/?page=2&sort=new&fuel=hybrid';
  const next = await getObservedCatalogNext('<nav class="pagination"><a rel="next" href="?page=3&amp;sort=new&amp;fuel=hybrid">Следующая</a></nav>', current);
  assert.equal(next.href, CATALOG_ORIGIN + '/catalog/toyota/rav4/?page=3&sort=new&fuel=hybrid');
  assert.equal(await getObservedCatalogNext('<a href="?page=3">3</a>', current), null);
  assert.equal(await getObservedCatalogNext('<div>No more pages.</div>', current), null);
  assert.equal((await getObservedCatalogNext('<form method="post" action="/submit"><a rel="next" href="?page=3&amp;sort=new&amp;fuel=hybrid">Next</a></form>', current)).href, next.href);
});

test('next-page navigation rejects loops, conflicting next links and changed model/filter scopes', async () => {
  const current = CATALOG_ORIGIN + '/catalog/toyota/rav4/?page=2&sort=new';
  for (const href of ['?page=2&sort=new', '?page=3&sort=price', '?page=3', '/catalog/honda/?page=3&sort=new', 'https://evil.example/catalog/toyota/rav4/?page=3&sort=new', 'https://encar.spb.ru:443/catalog/toyota/rav4/?page=3&sort=new']) {
    await rejects(() => getObservedCatalogNext(`<a rel="next" href="${href.replaceAll('&', '&amp;')}">Next</a>`, current));
  }
  await rejects(() => getObservedCatalogNext('<a rel="next" href="?page=3&amp;sort=new">Next</a><a rel="next" href="?page=4&amp;sort=new">Next</a>', current));
});

test('catalogue navigation performs no HTTP, submits no form and does not execute scripts', async () => {
  const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error('No HTTP in navigation parser'); };
  try {
    const html = '<form action="https://evil.example/delete" method="post"><a href="/catalog/toyota/">Toyota 4</a><button>Submit</button></form><script>throw Error("do not execute")</script>';
    assert.equal((await discoverVehicleCatalogLink(html, CATALOG_ORIGIN + '/catalog/', { make: 'Toyota' }, 'make')).pathname, '/catalog/toyota/');
    assert.equal((await getObservedCatalogNext('<a rel="next" href="?page=2">Next</a>', CATALOG_ORIGIN + '/catalog/toyota/rav4/')).search, '?page=2');
  } finally { globalThis.fetch = previous; }
});

test('observed generation and grade branches reach an exact plate absent from parent model pages', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/', generation = model + 'model-y/', leaf = generation + 'long-range-awd/';
  const hints = { model: '모델 Y', grade: '롱레인지' }, plate = '12가3456', id = '43000001';
  const modelHTML = '<h1>Tesla Model Y</h1><nav><a href="' + generation + '">Model Y <span class="count">40</span></a></nav>' + card(OTHER, '43000002');
  const generationHTML = '<h1>Model Y</h1><a href="' + leaf + '"><span>Long Range</span> <strong>AWD</strong><span class="badge">12</span></a>' + card(OTHER, '43000002');
  assert.deepEqual((await parseExternalAdvertisement(modelHTML, model, plate)).matches, []);
  const first = await discoverCatalogBranches(modelHTML, model, hints);
  assert.deepEqual(first.map(url => url.href), [generation]);
  assert.deepEqual((await parseExternalAdvertisement(generationHTML, first[0], plate)).matches, []);
  const second = await discoverCatalogBranches(generationHTML, first[0], hints);
  assert.deepEqual(second.map(url => url.href), [leaf]);
  assert.equal((await parseExternalAdvertisement(card(plate, id), second[0], plate)).matches[0].id, id);
  assert.deepEqual(await discoverCatalogBranches(card(plate, id), second[0], hints), []);
});

test('model hints prioritize an observed generation while retaining other generations', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
  const html = '<a href="model-y-juniper/">Model Y Juniper 30</a><a href="model-y/">Model Y <span class="count">40</span></a><a href="another-generation/">Another generation</a>';
  assert.deepEqual((await discoverCatalogBranches(html, model, { model: '모델 Y' })).map(url => url.href), [model + 'model-y/', model + 'model-y-juniper/', model + 'another-generation/']);
  assert.deepEqual((await discoverCatalogBranches(html, model, { model: 'unrelated model' })).map(url => url.href), [model + 'model-y-juniper/', model + 'model-y/', model + 'another-generation/']);
});

test('Tesla grade aliases rank actual Long Range branches without excluding other grades', async () => {
  const generation = CATALOG_ORIGIN + '/catalog/tesla/model-y/model-y/';
  const html = '<a href="performance/">Performance</a><a href="long-range-rwd/">Long Range RWD</a><a href="long-range-awd/">Long Range AWD</a><a href="standard-range/">Standard Range</a>';
  assert.deepEqual((await discoverCatalogBranches(html, generation, { grade: '롱레인지' })).map(url => url.pathname.split('/').at(-2)), ['long-range-rwd', 'long-range-awd', 'performance', 'standard-range']);
  assert.deepEqual((await discoverCatalogBranches(html, generation, { grade: 'Long Range AWD' })).map(url => url.pathname.split('/').at(-2)), ['long-range-awd', 'long-range-rwd', 'performance', 'standard-range']);
  assert.equal((await discoverCatalogBranches(html, generation, { grade: '퍼포먼스' }))[0].pathname, new URL('performance/', generation).pathname);
});

test('branch selection follows published hrefs and does not fabricate routes from hints', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
  assert.deepEqual(await discoverCatalogBranches('<p>No child links.</p>', model, { model: '모델 Y', grade: '롱레인지' }), []);
  const html = '<a href="published-generation/">Model&nbsp;Y</a><a href="other-generation/">Other</a>';
  assert.equal((await discoverCatalogBranches(html, model, { model: '모델 Y' }))[0].href, model + 'published-generation/');
  const generation = model + 'published-generation/';
  assert.equal((await discoverCatalogBranches('<a href="published-grade/">Long Range AWD</a>', generation, { grade: '롱레인지' }))[0].href, generation + 'published-grade/');
  for (const hints of [null, [], 'Model Y', { model: 'https://evil.example', grade: ['Long Range'] }, { model: 'x'.repeat(121), grade: 'Performance\n' }]) {
    assert.equal((await discoverCatalogBranches(html, model, hints)).length, 2);
  }
});

test('branches are restricted to immediate children of the exact current model and generation', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/', generation = model + 'model-y/';
  const invalid = [
    '/catalog/toyota/model-y/', '/catalog/tesla/model-3/model-y/', '/catalog/tesla/model-y-new/model-y/',
    '/catalog/tesla/', model, model + 'model-y/long-range-awd/', model + 'model-y/?page=2',
    model + 'model-y/#next', '/auto/43000001/', '/logout', model + 'redirect/', model + 'redirect-to-example/'
  ];
  for (const href of invalid) assert.deepEqual(await discoverCatalogBranches(`<a href="${href}">Model Y</a>`, model, { model: 'Model Y' }), []);
  assert.deepEqual(await discoverCatalogBranches('<a href="../model-y-juniper/long-range-awd/">Long Range AWD</a>', generation, { grade: '롱레인지' }), []);
  assert.deepEqual(await discoverCatalogBranches('<a href="long-range-awd/">Long Range AWD</a>', CATALOG_ORIGIN + '/catalog/tesla/'), []);
  assert.deepEqual(await discoverCatalogBranches('<a href="deeper/">Deeper</a>', generation + 'long-range-awd/'), []);
});

test('branch anchors reject hidden, scripted, foreign, encoded and credentialed destinations', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
  const unsafe = [
    '<a href="model-y/" hidden>Model Y</a>', '<div aria-hidden="true"><a href="model-y/">Model Y</a></div>',
    '<div style="display:none"><a href="model-y/">Model Y</a></div>', '<script>"<a href=\"model-y/\">Model Y</a>"</script>',
    '<a href="javascript:alert(1)">Model Y</a>', '<a href="https://evil.example/catalog/tesla/model-y/model-y/">Model Y</a>',
    '<a href="https://encar.spb.ru.evil.example/catalog/tesla/model-y/model-y/">Model Y</a>',
    '<a href="https://user:pass@encar.spb.ru/catalog/tesla/model-y/model-y/">Model Y</a>',
    '<a href="https://encar.spb.ru:443/catalog/tesla/model-y/model-y/">Model Y</a>',
    '<a href="/catalog/tesla/model-y/%6dodel-y/">Model Y</a>', '<a href="/catalog/tesla/model-y/../model-y/model-y/">Model Y</a>',
    '<a href="model-y/?redirect=https://evil.example">Model Y</a>', '<a href="delete/">Model Y</a>'
  ];
  for (const html of unsafe) assert.deepEqual(await discoverCatalogBranches(html, model, { model: 'Model Y' }), []);
});

test('branch discovery deduplicates observed slash copies and returns at most six ranked URLs', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
  const html = '<a href="generation-0/">Other</a><a href="generation-0">Duplicate</a>' +
    Array.from({ length: 7 }, (_, index) => `<a href="generation-${index + 1}/">${index === 6 ? 'Model Y' : 'Other'}</a>`).join('');
  assert.deepEqual((await discoverCatalogBranches(html, model, { model: 'Model Y' })).map(url => url.href), [model + 'generation-7/', ...Array.from({ length: 5 }, (_, index) => model + `generation-${index}/`)]);
});

test('branch navigation reads static links inside forms without submitting or making requests', async () => {
  const previous = globalThis.fetch; globalThis.fetch = () => { throw new Error('No HTTP in branch parser'); };
  try {
    const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
    const html = '<form action="/delete" method="post"><input name="redirect" value="https://evil.example"><a href="model-y/">Model Y</a><button>Submit</button></form><script>throw Error("must not run")</script>';
    assert.deepEqual((await discoverCatalogBranches(html, model, { model: 'Model Y' })).map(url => url.href), [model + 'model-y/']);
  } finally { globalThis.fetch = previous; }
});

test('branch discovery rejects browser verification pages and unsafe base URLs', async () => {
  const model = CATALOG_ORIGIN + '/catalog/tesla/model-y/';
  await rejects(() => discoverCatalogBranches('<title>Access Denied</title><a href="model-y/">Model Y</a>', model));
  await rejects(() => discoverCatalogBranches('<h1>Captcha</h1><a href="model-y/">Model Y</a>', model));
  for (const url of ['https://evil.example/catalog/tesla/model-y/', 'https://user:pass@encar.spb.ru/catalog/tesla/model-y/', 'https://encar.spb.ru:443/catalog/tesla/model-y/']) {
    await rejects(() => discoverCatalogBranches('<a href="model-y/">Model Y</a>', url), 'CATALOG_CONFIG_INVALID');
  }
});
