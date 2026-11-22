'use strict';
// Real app flows and pinned RPC requests; every car, account and customer below is synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./encar/node_modules/playwright');
const { setBrowser, finish } = require('./encar/browser-smoke.cjs');
const shared = require('./shared-detail-v2166.browser.cjs');
const OUT = process.env.SHARED_CONTRACT_ARTIFACT_DIR || '/workspace/work/shared-contract-frontend';
const WIDTHS = (process.env.SHARED_CONTRACT_WIDTHS || '1440,390').split(',').map(Number);
const SC = 'sc:77777777-7777-4777-8777-777777777777';
const results = [];
fs.mkdirSync(OUT, { recursive: true });

async function setup(width) {
  const fixture = await shared.setup(width), page = fixture.page, rows = new Map(), calls = [];
  let sequence = 0;
  await page.route('https://synthetic.supabase.co/rest/v1/rpc/snote_shared_contract_*', async route => {
    const request = route.request(), name = new URL(request.url()).pathname.split('/').pop(), args = request.postDataJSON();
    calls.push({ name, args });
    const payload = await page.evaluate(({ SC }) => {
      const source = __sharedDetail.items[0];
      if (!source || source.state !== 'accepted' || !['edit', 'all'].includes(source.permission)) return { error: true };
      return { ok: true, carId: SC, companyId: __encarFixtureState.company.id, ownerId: __encarFixtureState.user.id,
        source: { companyId: source.companyId, ownerId: source.ownerId, carId: source.carId },
        access: { invitationId: source.invitationId, version: source.version },
        car: { ...__sharedDetail.raw[source.ownerId + '/' + source.carId], id: SC },
        sourceCompany: { id: source.companyId, name: '원래 공유 상사', business_number: '1122334455', business_phone: '0212340000', business_address: '원래 상사 공용 주소', business_address_detail: '검증 상세', corporate_number: '1111111111111' } };
    }, { SC });
    await route.fulfill({ status: payload.error ? 403 : 200, contentType: 'application/json', body: JSON.stringify(payload.error ? { code: '42501', message: 'FORBIDDEN' } : payload) });
  });
  await page.route('https://synthetic.supabase.co/rest/v1/rpc/snote_customer_save', async route => {
    const args = route.request().postDataJSON();
    assert.equal(args.p_car_id, SC);
    assert.equal(args.p_payload.ownerId, 'cld_111111111111411181');
    assert.equal(args.p_payload.carId, SC);
    assert(!Object.hasOwn(args.p_payload, 'sourceCustomer'), 'Recipient private customer must not contain owner customer data');
    const updatedAt = new Date(Date.now() + sequence++).toISOString();
    rows.set(SC, { payload: args.p_payload, has_rrn: false, updated_at: updatedAt, restore_generation: '00000000-0000-0000-0000-000000000000' });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, updatedAt, restoreGeneration: '00000000-0000-0000-0000-000000000000' }) });
  });
  await page.route('**/api/customer-intake', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, requests: [] }) }));
  await page.exposeFunction('__sharedCustomerRead', () => rows.get(SC) || null);
  await page.evaluate(() => {
    const client = __encarFixtureState.client, original = client.from;
    client.from = function (table) {
      if (table !== 'zc_customers') return original.call(this, table);
      let single = false;
      const chain = { select() { return chain; }, eq() { return chain; }, limit() { return chain; }, maybeSingle() { single = true; return chain; },
        then(resolve, reject) { return __sharedCustomerRead().then(data => ({ data: single ? data : data ? [data] : [], error: null })).then(resolve, reject); } };
      return chain;
    };
    window.__sharedPrinted = 0; window.print = () => __sharedPrinted++;
  });
  return { fixture, page, rows, calls };
}

async function run(width) {
  const { fixture, page: p, rows, calls } = await setup(width);
  try {
    // Read/delete grants stay read/delete-only, even through a direct adapter call.
    for (const permission of ['read', 'delete']) {
      await shared.grant(p, permission); await shared.open(p);
      assert.equal(await p.locator('#vehicle-header-actions button[onclick="openSaleProgress()"]').isVisible(), false);
      assert.equal(await p.evaluate(() => SnoteContractWork.ensure(activeCarId)), null);
      assert.equal(calls.length, 0);
      await p.evaluate(() => closeVehicle({ discard: true }));
    }
    await shared.grant(p, 'edit'); await shared.open(p);
    await p.locator('#vehicle-header-actions button[onclick="openSaleProgress()"]').click();
    await p.locator('#zc72-sale-modal').waitFor({ state: 'visible' });
    assert.equal(await p.evaluate(() => zc72SaleCarId), SC);
    assert.match(await p.evaluate(() => activeCarId), /^snote-shared:/);
    assert.equal(await p.evaluate(() => cars.some(car => car.id === zc72SaleCarId)), false);
    assert.equal(await p.evaluate(() => snoteWorkCar(zc72SaleCarId).sell), 15000000, 'Legacy 만원 snapshot normalizes exactly once');
    assert.equal(calls[0].name, 'snote_shared_contract_bind');
    await p.locator('#zc72-name').fill('가상 계약 고객');
    await p.locator('#zc72-phone').fill('01011112222');
    await p.locator('#zc72-print-button').click();
    await p.locator('#contract-overlay.open').waitFor();
    assert.equal(await p.locator('#ct-seller-name').inputValue(), '원래 공유 상사');
    assert.equal(await p.locator('#ct-seller-id').inputValue(), '112-23-34455');
    assert.equal(await p.locator('#ct-seller-address').inputValue(), '원래 상사 공용 주소 검증 상세');
    assert.equal(await p.locator('#ct-agent-name').textContent(), '가상 검증 딜러');
    assert.equal(await p.locator('#ct-buyer-name').inputValue(), '가상 계약 고객');
    assert.equal(await p.locator('#ct-total-price').inputValue(), '15,000,000');
    assert.equal(await p.locator('#ct-seller-stamp').isVisible(), false);
    assert.equal(await p.locator('#contract-overlay .zc-footer-emblem').first().isVisible(), false);
    assert.equal(await p.locator('#contract-overlay .snote95-footer-company').first().textContent(), '원래 공유 상사');
    assert.equal(await p.evaluate(() => SnoteSharedVehicleDetail.active()), true);
    assert.equal(await p.evaluate(() => snote165ContractViewCurrent(currentUser, contractCarId, snote214ContractView)), true);
    assert.equal(await p.evaluate(() => printContract()), true);
    assert.equal(await p.evaluate(() => __sharedPrinted), 1);
    assert.equal(await p.locator('#contract-print-pages .contract-print-copy').count(), 2);
    await p.screenshot({ path: path.join(OUT, 'contract-' + width + '.png') });
    if (width === 1440) {
      await p.emulateMedia({ media: 'print' });
      const pdf = await p.pdf({ path: path.join(OUT, 'shared-contract-a4.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
      assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 2);
      await p.emulateMedia({ media: 'screen' });
    }
    await p.evaluate(() => closeContractPreview());
    await p.locator('#zc72-sale-modal').waitFor({ state: 'visible' });
    await p.evaluate(() => closeSaleProgress());
    await p.locator('#vehicle-overlay.open').waitFor();
    await shared.unchanged(p);
    await p.evaluate(async () => { await closeVehicle({ discard: true }); await navigate('users'); });
    await p.locator('[data-customer-contract="' + SC + '"]').first().click();
    await p.locator('#contract-overlay.open').waitFor();
    assert.equal(await p.evaluate(() => contractCarId), SC);
    assert.equal(await p.locator('#ct-buyer-name').inputValue(), '가상 계약 고객');
    assert.equal(await p.locator('#ct-seller-name').inputValue(), '원래 공유 상사');
    assert.equal(await p.evaluate(() => snote165ContractViewCurrent(currentUser, contractCarId, snote214ContractView)), true);
    await p.evaluate(() => closeContractPreview());
    await p.locator('[data-customer-receipt="' + SC + '"]').first().click();
    await p.locator('#zc76-receipt-overlay').waitFor({ state: 'visible' });
    assert.equal(await p.locator('#zc76-name').inputValue(), '가상 계약 고객');
    assert.equal(await p.locator('#zc76-company').inputValue(), '원래 공유 상사');
    await p.evaluate(() => zc76PrintReceipt());
    assert.equal(await p.evaluate(() => __sharedPrinted), 2);
    await p.screenshot({ path: path.join(OUT, 'receipt-' + width + '.png') });
    await p.evaluate(() => zc76CloseReceipt());
    await p.locator('[data-customer-contract="' + SC + '"]').first().click();
    await p.locator('#contract-overlay.open').waitFor();
    await p.evaluate(() => { __sharedDetail.items = []; window.dispatchEvent(new Event('snote-vehicle-sharing-updated')); });
    await p.locator('#contract-overlay').waitFor({ state: 'hidden', timeout: 4000 });
    assert.equal(await p.evaluate(() => SnoteContractWork.context()), null);
    assert.equal(await p.locator('#ct-buyer-name').inputValue(), '');
    assert.equal(await p.evaluate(() => snoteWorkCar('sc:77777777-7777-4777-8777-777777777777')), null);
    assert(rows.has(SC), 'Recipient customer exists separately from source inventory');
    await shared.unchanged(p);
    await finish(fixture);
    results.push({ width, passed: true, bindCount: calls.filter(call => call.name === 'snote_shared_contract_bind').length, privateCustomerRows: rows.size });
    console.log('PASS shared contract work', width);
  } catch (error) {
    await p.screenshot({ path: path.join(OUT, 'failure-' + width + '.png') }).catch(() => {});
    console.error(await p.evaluate(() => ({ toast: document.getElementById('toast').textContent, activeCarId, saleCarId: zc72SaleCarId, contractCarId, receiptCarId: zc80ReceiptCarId })).catch(() => ({})));
    await fixture.context.close(); throw error;
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  setBrowser(browser);
  try { for (const width of WIDTHS) await run(width); }
  finally { await browser.close(); fs.writeFileSync(path.join(OUT, 'verification.json'), JSON.stringify({ syntheticOnly: true, productionReads: 0, productionWrites: 0, results }, null, 2) + '\n'); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
