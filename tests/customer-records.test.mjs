import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('function scrub(o){');
const end = html.indexOf('function cloudKey(', start);
assert(start >= 0 && end > start);
const clean = runInNewContext(html.slice(start, end) + '\ncleanCustomer');

test('legitimate 13-digit refund accounts survive canonical customer storage', () => {
  for (const account of ['1234567890123', '123456-7890123', ' 1234567890123 ']) {
    const input = { name: '고객', refundBank: '테스트은행', refundAccount: account, refundHolder: '고객' };
    const result = clean(input);
    assert.equal(result.refundAccount, account.trim());
    assert.equal(result.refundHolder, input.refundHolder);
    assert.equal(input.refundAccount, account);
  }
});

test('the narrow account exception preserves resident-ID filtering elsewhere', () => {
  const result = clean({
    refundAccount: '1234567890123', rrn: '900101-1234567', residentId: '9001011234567',
    extra: '9001011234567', contractData: { 'ct-buyer-id': '9001011234567', 'ct-buyer-name': '고객' }
  });
  assert.equal(result.refundAccount, '1234567890123');
  assert(!Object.hasOwn(result, 'rrn'));
  assert(!Object.hasOwn(result, 'residentId'));
  assert.equal(result.extra, '');
  assert(!Object.hasOwn(result.contractData, 'ct-buyer-id'));
  assert.equal(result.contractData['ct-buyer-name'], '고객');
  assert.equal(clean(null), null);
});
