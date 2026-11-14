// Synthetic form/card contracts, not captured or verified encar.spb.ru markup.
// No real customer plate, advertisement, credential, HTTP request, or remote script.
import test from 'node:test';
import assert from 'node:assert/strict';
import './html-rewriter-setup.mjs';
import { CATALOG_ORIGIN, CatalogError, catalogURL, configuredCatalogSearch, discoverCatalogSearch, discoverCatalogEntry, parseCatalogPage } from '../../functions/_shared/encar-catalog.mjs';

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
