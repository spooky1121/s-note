import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS } from '../functions/_shared/encar-id-resolver.mjs';
import { readSearchAdvertisement, validatedDetailURL } from '../functions/_shared/encar-id-search-parser.mjs';

// These are minimal visible-source-shaped facts, not captured Tavily replies.
// Trust's public page displayed 66너7230 with its own Лот 43138217. No production
// lookup map or account data is used, and none of these tests performs I/O.
const [CARNECT, GLOAR, TRUST] = PROVIDERS;
const PLATE = '66너7230', OTHER = '12가3456', ID = '43138217';
const URLS = { carnect: 'https://carnect.biz/car/43138220', gloar: 'https://gloar-data.com/en/lot/tesla-model-s-2023-opaque-key', trust: 'https://encar.spb.ru/auto/43138217/' };
const source = id => `[Source](https://fem.encar.com/cars/detail/${id})`;
const trustFields = (plate = PLATE, id = ID) => `* Лот\n\n${id}\n\n* Номер автомобиля\n\n${plate}`;
const genericFields = (plate = PLATE, id = ID) => `License plate: ${plate}\nEncar ID: ${id}`;
function result(provider = TRUST, raw = '# Tesla Model S Plaid\n' + trustFields(), extra = {}) { return { url: URLS[provider.id], title: 'Tesla Model S Plaid — лот ' + ID, raw_content: raw, ...extra }; }
function read(raw, provider = TRUST, extra = {}, plate = PLATE) { return readSearchAdvertisement(result(provider, raw, extra), provider, plate); }

test('66너7230 uses explicit primary fields and returns the original ID without a hardcoded map', () => {
  assert.deepEqual(read('# Tesla Model S Plaid\n' + trustFields()), { status: 'found', plate: PLATE, id: ID, sourceUrl: URLS.trust });
  assert.equal(read('# Another vehicle\n' + trustFields(OTHER, '43999999'), TRUST, { title: 'Other vehicle' }, OTHER).id, '43999999');
});
test('all providers accept a labelled full plate and explicit Encar ID', () => {
  for (const provider of PROVIDERS) assert.equal(read('# Vehicle\n' + genericFields(), provider, { title: 'Vehicle' }).id, ID, provider.id);
});
test('a raw primary plate and explicit original Encar link resolve GLOAR without grade, VIN or year', () => {
  assert.equal(read('# Vehicle\n' + PLATE + '\n' + source(ID), GLOAR, { title: 'Vehicle' }).id, ID);
});
test('original Encar desktop and mobile detail links are read without visiting them', () => {
  for (const url of [`https://www.encar.com/dc/dc_cardetailview.do?carid=${ID}`, `https://m.encar.com/ca/cardetail.do?carId=${ID}`, `https://fem.encar.com/cars/detail/${ID}?x=1`]) assert.equal(read('# Vehicle\n' + PLATE + `\n[Source](${url})`, GLOAR, { title: '' }).id, ID);
});
test('an external internal path number and Tavily opaque id can never be original advertisement proof', () => {
  for (const provider of PROVIDERS) {
    const r = read('# Vehicle\nLicense plate: ' + PLATE, provider, { id: ID, title: 'Vehicle' }); assert.equal(r.status, 'error'); assert.equal(r.code, 'AD_ID_UNVERIFIED');
  }
  assert.equal(read('# Vehicle\n' + genericFields(PLATE, '43999999'), CARNECT, { title: 'Vehicle' }).id, '43999999', 'A genuine explicit original ID need not equal an external site internal path');
});
test('catalog pages and broad source URLs cannot be final ID evidence', () => {
  for (const provider of PROVIDERS) for (const url of [provider.url, 'https://' + provider.host + '/', 'https://' + provider.host + '/catalog/']) assert.equal(validatedDetailURL(url, provider), '');
});
test('source URL validation rejects lookalikes, userinfo, ports, fragments, encoded paths and write queries', () => {
  for (const url of ['http://encar.spb.ru/auto/43138217/', 'https://encar.spb.ru.evil.invalid/auto/43138217/', 'https://x@encar.spb.ru/auto/43138217/', 'https://encar.spb.ru:443/auto/43138217/', 'https://encar.spb.ru/auto/43138217/#a', 'https://encar.spb.ru/auto/%34%33%31%33%38%32%31%37/', 'https://encar.spb.ru/auto/43138217/?action=delete', 'https://encar.spb.ru\\@evil.invalid/auto/43138217/', ' https://encar.spb.ru/auto/43138217/', 'https://encar.spb.ru/auto/43138217/\n']) assert.equal(validatedDetailURL(url, TRUST), '', url);
  assert.equal(validatedDetailURL(URLS.trust + '?utm_source=search', TRUST), URLS.trust);
  assert.equal(validatedDetailURL(URLS.trust, { ...TRUST, host: 'evil.invalid' }), '');
});
test('the primary plate must match fully; matching digits with another Korean letter is not enough', () => {
  for (const plate of ['66나7230', '166너7230', '66너7231']) assert.equal(read('# Vehicle\n' + trustFields(plate), TRUST, { title: 'Vehicle' }).status, 'not_found');
});
test('raw primary mismatch dominates a matching indexed snippet', () => {
  const r = read('# Vehicle\n' + trustFields(OTHER), TRUST, { content: trustFields(), title: 'Vehicle' }); assert.equal(r.status, 'not_found');
});
test('unverified raw content cannot silently fall through to a stronger indexed snippet', () => {
  const r = read('# Vehicle\nNo verified fields', TRUST, { content: trustFields() }); assert.equal(r.status, 'error');
});
test('a complete labelled indexed field pair can be used when raw content is unavailable', () => {
  for (const raw_content of [null, undefined, '']) {
    const r = readSearchAdvertisement({ url: URLS.trust, title: 'Tesla Model S Plaid — лот ' + ID, content: trustFields(), raw_content }, TRUST, PLATE); assert.equal(r.id, ID);
  }
});
test('bare indexed plate, ID in a title, URL or opaque document id remain discovery clues only', () => {
  for (const content of [PLATE, 'Номер автомобиля ' + PLATE, `Found ${PLATE} in listing ${ID}`, PLATE + '\n' + source(ID)]) {
    const r = readSearchAdvertisement({ url: URLS.trust, title: 'Tesla — лот ' + ID, id: ID, content }, TRUST, PLATE); assert.equal(r.status, 'error', content);
  }
});
test('indexed fragments separated by ellipses cannot join a lot and a plate', () => {
  for (const gap of ['...', '…']) assert.equal(readSearchAdvertisement({ url: URLS.trust, title: 'Vehicle — лот ' + ID, content: `Лот ${ID}\n${gap}\nНомер автомобиля ${PLATE}` }, TRUST, PLATE).status, 'error');
});
test('a contradictory original link also rejects otherwise complete indexed field evidence', () => {
  assert.equal(readSearchAdvertisement({ url: URLS.trust, title: 'Vehicle — лот ' + ID, content: trustFields() + '\n' + source('43999999') }, TRUST, PLATE).status, 'ambiguous');
});
test('title declarations may reject conflicts but cannot supply missing evidence', () => {
  assert.equal(read('# Vehicle\n' + trustFields(), TRUST, { title: 'Vehicle — лот 43999999' }).code, 'AD_ID_CONFLICT');
  assert.equal(read('# Vehicle\n' + trustFields(), TRUST, { title: 'Vehicle ' + OTHER }).code, 'PLATE_MISMATCH');
});
test('English, Russian and Korean recommendations never replace another primary vehicle', () => {
  for (const heading of ['Similar vehicles', 'Related vehicles', 'Recommended vehicles', 'Похожие автомобили', 'Рекомендуемые автомобили', 'Смотрите также', '추천 차량', '유사 매물']) assert.equal(read('# Primary\n' + trustFields(OTHER, '43111111') + '\n## ' + heading + '\n' + trustFields(), TRUST, { title: 'Vehicle' }).status, 'not_found', heading);
});
test('recommendations of the same plate cannot add conflicting IDs to verified primary evidence', () => {
  assert.equal(read('# Primary\n' + trustFields() + '\n## Похожие автомобили\n' + trustFields(PLATE, '43999999')).id, ID);
});
test('lot and plate cannot be borrowed from separate vehicle sections', () => {
  assert.equal(read('# Vehicle\n## Car A\nЛот ' + ID + '\n## Car B\nНомер автомобиля ' + PLATE).status, 'error');
  assert.equal(read('# Vehicle A\n' + trustFields(OTHER, '43111111') + '\n# Vehicle B\n' + trustFields(), TRUST, { title: '' }).status, 'not_found');
});
test('multiple full primary plates or advertisement IDs are explicitly ambiguous', () => {
  assert.equal(read('# Vehicle\n' + trustFields() + '\nНомер автомобиля ' + OTHER).status, 'ambiguous');
  assert.equal(read('# Vehicle\n' + trustFields() + '\nЛот 43999999').status, 'ambiguous');
  assert.equal(read('# Vehicle\n' + trustFields() + '\n' + source('43999999')).status, 'ambiguous');
});
test('two original source IDs for the same plate are never resolved by picking the first', () => {
  assert.equal(read('# Vehicle\n' + PLATE + '\n' + source(ID) + '\n' + source('43999999'), GLOAR, { title: 'Vehicle' }).status, 'ambiguous');
});
test('format normalization preserves three digits, regional prefixes and Korean identity', () => {
  for (const [input, value] of [['378더9436', '378 더 9436'], ['경기13바1234', '경기 13바1234'], ['66너7230', '６６너７２３０']]) assert.equal(read('# Vehicle\n' + genericFields(value), CARNECT, { title: 'Vehicle' }, input).plate, input);
});
test('Markdown table field pairs are supported', () => {
  assert.equal(read('# Vehicle\n| Лот | ' + ID + ' |\n| Номер автомобиля | ' + PLATE + ' |').id, ID);
});
test('code examples, hidden HTML and image alt text are not primary vehicle evidence', () => {
  for (const raw of ['# Vehicle\n```text\n' + trustFields() + '\n```', '# Vehicle\n<div hidden>' + trustFields() + '</div>', '# Vehicle\n<!--' + trustFields() + '-->', '# Vehicle\n![' + trustFields().replace(/\n/g, ' ') + '](https://images.invalid/a.png)']) assert.equal(read(raw).status, 'error', raw);
});
test('later HTML does not erase already complete plain primary evidence, and no evidence is read through HTML', () => {
  assert.equal(read('# Vehicle\n' + trustFields() + '\n## Seller notes\n<div>Legacy seller description</div>').id, ID);
  for (const raw of ['# Vehicle\n<div hidden>' + trustFields() + '</div>', '# Vehicle\nЛот ' + ID + '\n<div hidden>Номер автомобиля ' + PLATE + '</div>', '# Vehicle\nЛот ' + ID + '\n<div hidden>Other information</div>\nНомер автомобиля ' + PLATE]) assert.equal(read(raw).status, 'error', raw);
});
test('malformed, missing and oversized content fails without an ID', () => {
  for (const raw_content of [42, {}, 'x'.repeat(128001), null]) { const r = readSearchAdvertisement({ url: URLS.trust, raw_content }, TRUST, PLATE); assert.equal(r.status, 'error'); assert(!('id' in r)); }
  assert.equal(readSearchAdvertisement(null, TRUST, PLATE).status, 'error');
});
