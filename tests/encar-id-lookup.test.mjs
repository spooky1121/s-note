import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { findAdvertisementId } from '../functions/_shared/encar-id-lookup.mjs';

// Injected search responses only. No browser, live search or business data.
const PLATE = '66너7230';
const found = (provider, patch = {}) => ({ status: 'found', plate: PLATE, id: '43138217', sourceUrl: provider.url, ...patch });
const run = search => findAdvertisementId({ plate: PLATE, search });

test('the first exact plate and explicit ID stop before another provider starts', async () => {
  const calls = [];
  const result = await run(async (provider, options) => { calls.push(provider.id); assert.deepEqual(Object.keys(options).sort(), ['plate', 'signal']); return { ...found(provider), price: 1, secret: 'PRIVATE' }; });
  assert.deepEqual(calls, ['carnect']);
  assert.deepEqual(result, { status: 'found', plate: PLATE, id: '43138217', provider: 'carnect' });
});
test('sources are searched in order, with no parallel work, until GLOAR or Trust finds the plate', async () => {
  for (const winner of ['gloar', 'trust']) {
    let active = 0; const calls = [];
    const result = await run(async provider => { assert.equal(active, 0); active++; calls.push(provider.id); await setImmediate(); active--; return provider.id === winner ? found(provider) : { status: 'not_found' }; });
    assert.equal(result.provider, winner);
    assert.deepEqual(calls, ['carnect', 'gloar', 'trust'].slice(0, winner === 'gloar' ? 2 : 3));
  }
});
test('three genuine no-matches return NOT_FOUND without a guessed ID', async () => {
  const calls = [];
  const result = await run(async provider => { calls.push(provider.id); return { status: 'not_found' }; });
  assert.deepEqual(calls, ['carnect', 'gloar', 'trust']);
  assert.deepEqual(result, { status: 'not_found', plate: PLATE, code: 'NOT_FOUND' });
});
test('unverified, timed out and malformed responses are failures, not confirmed no-matches', async () => {
  for (const value of [null, [], {}, { status: 'found' }, { status: 'error', code: 'AD_ID_UNVERIFIED' }, { status: 'error', code: 'SEARCH_TIMEOUT' }]) {
    const result = await run(async () => value);
    assert.deepEqual(result, { status: 'error', plate: PLATE, code: 'PROVIDERS_UNAVAILABLE' });
  }
  const result = await run(async () => { throw Error('PRIVATE_TOKEN'); });
  assert.equal(result.code, 'PROVIDERS_UNAVAILABLE'); assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('a later exact result can follow an unverified or ambiguous source', async () => {
  const calls = [];
  const result = await run(async provider => { calls.push(provider.id); return provider.id === 'carnect' ? { status: 'ambiguous' } : found(provider); });
  assert.deepEqual(calls, ['carnect', 'gloar']); assert.equal(result.provider, 'gloar');
  const ambiguous = await run(async provider => provider.id === 'carnect' ? { status: 'ambiguous' } : { status: 'not_found' });
  assert.equal(ambiguous.code, 'AMBIGUOUS'); assert(!('id' in ambiguous));
});
test('global search configuration, credentials, limits and protocol failures stop after one call', async () => {
  for (const code of ['SEARCH_NOT_CONFIGURED', 'SEARCH_AUTH_FAILED', 'SEARCH_RATE_LIMITED', 'SEARCH_UNAVAILABLE', 'SEARCH_INVALID_RESPONSE']) {
    let calls = 0; const error = Object.assign(new Error(code), { code, retryAfter: 29 });
    await assert.rejects(run(async () => { calls++; throw error; }), result => result === error && result.retryAfter === 29);
    assert.equal(calls, 1);
    calls = 0;
    await assert.rejects(run(async () => { calls++; return { status: 'error', code, retryAfter: 9000 }; }), result => result.code === code && result.retryAfter === 3600);
    assert.equal(calls, 1);
  }
});
test('wrong full plates, malformed IDs and foreign sources cannot become an accepted result', async () => {
  for (const patch of [{ plate: '66나7230' }, { plate: '7230' }, { id: 43138217 }, { id: '043138217' }, { id: '<img src=x>' }, { id: '123' }, { id: '1234567890123' }, { sourceUrl: 'https://foreign.invalid/auto/43138217/' }]) {
    const result = await run(async provider => provider.id === 'carnect' ? found(provider, patch) : provider.id === 'gloar' ? found(provider) : { status: 'not_found' });
    assert.equal(result.provider, 'gloar', JSON.stringify(patch));
  }
});
test('source validation rejects credentials, explicit ports, fragments, controls and sibling hosts', async () => {
  for (const sourceUrl of ['http://carnect.biz/car/1', 'https://carnect.biz.evil.invalid/car/1', 'https://sub.carnect.biz/car/1', 'https://user:secret@carnect.biz/car/1', 'https://carnect.biz:443/car/1', 'https://carnect.biz/car/1#id', 'https://carnect.biz/car/1\n', 'https://carnect.biz\\@foreign.invalid/car/1']) {
    const result = await run(async provider => provider.id === 'carnect' ? found(provider, { sourceUrl }) : { status: 'not_found' });
    assert.equal(result.status, 'error', sourceUrl); assert(!('id' in result));
  }
});
test('plate normalization preserves the whole Korean plate before starting a search', async () => {
  const result = await findAdvertisementId({ plate: ' ６６너-７２３０ ', search: async (provider, { plate }) => { assert.equal(plate, PLATE); return found(provider, { plate: '66너 7230' }); } });
  assert.equal(result.plate, PLATE); assert.equal(result.id, '43138217');
});
test('already cancelled input never starts a provider', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(findAdvertisementId({ plate: PLATE, signal: controller.signal, search: async () => { calls++; } }), error => error.name === 'AbortError' && error.code === 'ABORTED');
  assert.equal(calls, 0);
});
test('cancellation settles a pending search and a late result cannot start another provider', async () => {
  const controller = new AbortController(); let resolve, calls = 0;
  const lookup = findAdvertisementId({ plate: PLATE, signal: controller.signal, search: () => { calls++; return new Promise(yes => { resolve = yes; }); } });
  await setImmediate(); controller.abort();
  await assert.rejects(lookup, error => error.name === 'AbortError' && error.code === 'ABORTED');
  resolve({ status: 'found', plate: PLATE, id: '43138217', sourceUrl: 'https://carnect.biz/car/43138217' }); await setImmediate(); assert.equal(calls, 1);
});
test('a response that arrives in the same turn as cancellation is discarded', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(findAdvertisementId({ plate: PLATE, signal: controller.signal, search: async provider => { calls++; controller.abort(); return found(provider); } }), error => error.code === 'ABORTED');
  assert.equal(calls, 1);
});
test('invalid inputs fail before search execution', async () => {
  let calls = 0; const search = async () => { calls++; };
  for (const patch of [{ plate: '' }, { plate: 66 }, { plate: 'not-a-plate' }, { search: null }, { signal: {} }, { signal: null }]) await assert.rejects(findAdvertisementId({ plate: PLATE, search, ...patch }), error => ['INVALID_PLATE', 'INVALID_SEARCH', 'INVALID_SIGNAL'].includes(error.code));
  assert.equal(calls, 0);
});
