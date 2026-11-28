'use strict';
// Real page/controllers with disposable accounts and intercepted HTTP only.
// Idle presentation must preserve existing nodes; actual data changes must paint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {chromium} = require('./encar/node_modules/playwright');
const {fixture, setBrowser, finish} = require('./encar/browser-smoke.cjs');
const {setup: workspace} = require('./accountant-refinements-v2246.browser.cjs');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.SNOTE_UI_RENDER_QA_DIR || path.join(os.tmpdir(), 'snote-ui-render-idempotence-v2253');
const FILES = ['index.html', 'assets/icon-sizing.js', 'assets/dealer-scheduler.js'];
const sourceHashes = () => Object.fromEntries(FILES.map(file => [file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]));
const results = [];
fs.mkdirSync(OUT, {recursive: true});

async function settle(page) {
  await page.waitForFunction(() => !window.SnoteRouteTransition?.pending());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
}

async function idle(page) {
  return page.evaluate(() => new Promise(resolve => {
    const scheduler = document.getElementById('snote-dealer-scheduler');
    const nodes = scheduler ? [...scheduler.querySelectorAll('.snote-scheduler-grid,.snote-scheduler-month-nav,.snote-scheduler-agenda-section')] : [];
    let classRecords = 0, childRecords = 0;
    const classes = new MutationObserver(records => {classRecords += records.length;});
    const children = new MutationObserver(records => {childRecords += records.length;});
    classes.observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class']});
    if (scheduler) children.observe(scheduler, {subtree: true, childList: true});
    const start = performance.now();
    setTimeout(() => {
      classes.disconnect(); children.disconnect();
      resolve({duration: performance.now() - start, classRecords, childRecords,
        schedulerStatus: scheduler?.dataset.state || null, nodes: nodes.length,
        connectedNodes: nodes.filter(node => node.isConnected).length});
    }, 1200);
  }));
}

function unchanged(value, label, expectCalendar = true) {
  if (expectCalendar) assert(value.nodes > 0, label + ' has a rendered calendar and agenda');
  assert.equal(value.classRecords, 0, label + ' must not rewrite icon classes while idle');
  assert.equal(value.childRecords, 0, label + ' must not rebuild the same calendar while idle');
  assert.equal(value.connectedNodes, value.nodes, label + ' must retain the original DOM nodes');
}

async function unavailableSource(browser) {
  setBrowser(browser);
  const f = await fixture(1366, null, {lookupUnavailable: true});
  const page = f.page;
  try {
    await page.waitForFunction(() => !!window.SnoteIconSizing && !!window.SnoteDealerSchedulerUI);
    await settle(page);
    const detail = await idle(page);
    unchanged(detail, 'Vehicle detail over an unavailable schedule');
    await page.evaluate(async () => {await closeVehicle({discard: true}); navigate('buy');});
    await settle(page);
    const list = await idle(page);
    unchanged(list, 'Purchase list', false);
    results.push({name: 'idle icons and unavailable calendar retain nodes', detail, list});
    await finish(f);
    console.log('PASS idle vehicle/list icons and unavailable schedule do not repaint');
  } catch (error) {await f.context.close(); throw error;}
}

async function realChange(browser) {
  const f = await workspace(browser, 1366, 'dealer@example.invalid');
  const page = f.page;
  try {
    await page.locator('#snote-dealer-scheduler[data-state=ready]').waitFor();
    await settle(page);
    const before = await idle(page);
    unchanged(before, 'Ready schedule');
    await page.evaluate(() => {
      // The existing fixture has several events on the 15th. Use a free day so
      // the normal visible-event limit does not hide this added vehicle.
      const date = document.querySelector('#snote-dealer-scheduler .snote-scheduler-day.is-today').dataset.date.slice(0, 8) + '20';
      const base = cars[0];
      window.__renderOriginalGrid = document.querySelector('#snote-dealer-scheduler .snote-scheduler-grid');
      cars.push({...base, id: 'dynamic-schedule-vehicle', ownerId: currentUser.username,
        model: '일정 갱신 확인용 가상 차량', plate: '88가8888', status: '판매중', purchaseAt: date, buy: 100, sell: 200});
      dispatchEvent(new Event('snote:sales-data-changed'));
    });
    await page.waitForFunction(() => document.querySelector('#snote-dealer-scheduler [data-vehicle-id="dynamic-schedule-vehicle"]'));
    assert.equal(await page.evaluate(() => __renderOriginalGrid.isConnected), false,
      'A genuine vehicle calendar change must refresh the grid');
    await settle(page);
    const after = await idle(page);
    unchanged(after, 'Updated schedule');
    results.push({name: 'real derived schedule changes still repaint once', before, after});
    await f.finish();
    console.log('PASS real schedule change updates, then the calendar remains stable');
  } catch (error) {await f.context.close(); throw error;}
}

if (require.main === module) (async () => {
  const initialHashes = sourceHashes();
  const browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium'});
  try {
    await unavailableSource(browser);
    await realChange(browser);
    assert.deepEqual(sourceHashes(), initialHashes, 'Product sources remain frozen during verification');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ok: true, syntheticOnly: true,
      operatingReads: 0, operatingWrites: 0, sourceHashes: initialHashes, results}, null, 2) + '\n');
  } finally {await browser.close();}
})().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
