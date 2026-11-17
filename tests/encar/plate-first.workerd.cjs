'use strict';
// Exercise the production parser in Cloudflare's native runtime, not the WASM
// HTMLRewriter used by the offline Node suite. All HTML and URLs are synthetic.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar/plate-first.workerd.cjs
// Add --baseline-ref=<git ref> to compare the previous parser without editing it.
// Use --baseline-only with that flag while the production fix is still pending.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');

const ROOT = path.resolve(__dirname, '../..');
const PARSER = 'functions/_shared/encar-catalog.mjs';
const ORIGIN = 'https://native-parser.example';
const PLATE = '12가3456', OTHER_PLATE = '34나5678', ID = '83000001', OTHER_ID = '83000002';
const DETAIL = 'https://nnov.trust-encar.ru/auto/' + ID + '/';
const MODEL = 'https://encar.spb.ru/catalog/tesla/model-y/';
const BRANCH = MODEL + 'model-y/';
const hints = { make: '테슬라', model: '모델 Y', grade: '롱레인지' };
const anchor = '<a href="' + BRANCH + '">Model Y</a>';
const specs = (plate = PLATE, id = ID) => '<ul><li>Лот ' + id + '</li><li>Номер автомобиля ' + plate + '</li></ul>';
const detail = (body = specs(), before = '', after = '') => before + '<main><h1>Synthetic vehicle</h1>' + body + '</main>' + after;
const branchFixture = (name, html, expected = true) => ({ name, action: 'branches', html, url: MODEL, hints, expected });
const detailFixture = (name, html, expected = true) => ({ name, action: 'advertisement', html, url: DETAIL, plate: PLATE, expected });

const fixtures = [
  branchFixture('branch control', anchor),
  detailFixture('detail control', detail()),
  branchFixture('self-closing SVG path does not break branch navigation', '<svg><path d="M0 0"/></svg>' + anchor),
  branchFixture('self-closing SVG use does not break branch navigation', '<svg><use href="#synthetic-icon"/></svg>' + anchor),
  branchFixture('self-closing foreign root does not swallow following anchors', '<svg/>' + anchor),
  detailFixture('self-closing SVG icon does not invalidate primary specifications', detail('<svg><path d="M0 0"/></svg>' + specs())),
  branchFixture('optional li end tags retain a bounded actual sibling list', '<ul>' + '<li>Menu item'.repeat(150) + '<li>' + anchor + '</ul>'),
  branchFixture('optional option end tags do not retain an artificial depth', '<select>' + Array.from({ length: 150 }, (_, i) => '<option value="' + i + '">Model ' + i).join('') + '</select>' + anchor),
  detailFixture('optional specification li end tags remain in one record', detail('<ul><li>Лот ' + ID + '<li>Номер автомобиля ' + PLATE + '</ul>')),
  detailFixture('ordinary primary specification grid requires no CSS class', detail('<div><p>Лот ' + ID + '</p><p>Номер автомобиля ' + PLATE + '</p></div>')),
  detailFixture('an unrelated header h1 does not replace the main vehicle', detail(specs(), '<header><h1>Synthetic site</h1></header>')),
  detailFixture('a primary h2 title does not change the plate and lot identity', '<main><h2>Synthetic vehicle</h2>' + specs() + '</main>'),
  detailFixture('a public GET form can wrap visible vehicle specifications', detail('<form method="get" action="/catalog/">' + specs() + '</form>')),
  branchFixture('ordinary reCAPTCHA footer is not a challenge page', anchor + '<footer>This site is protected by reCAPTCHA.</footer>'),
  detailFixture('unrelated JavaScript help in the footer is not an access denial', detail(specs(), '', '<footer>Enable JavaScript to use the interactive map.</footer>')),
  branchFixture('hidden or foreign branch links do not become observed navigation', '<a hidden href="' + BRANCH + '">Model Y</a><a href="https://foreign.example/catalog/tesla/model-y/model-y/">Model Y</a>', false),
  detailFixture('a different primary plate cannot borrow the requested plate from recommendations', detail(specs(OTHER_PLATE) + '<section class="related"><h2>Related vehicles</h2>' + specs() + '</section>'), false),
  detailFixture('the footer cannot supply the requested plate', detail(specs(OTHER_PLATE), '', '<footer>' + specs() + '</footer>'), false),
  detailFixture('hidden specifications cannot supply the requested plate', detail(specs(OTHER_PLATE) + '<div hidden>' + specs() + '</div>'), false),
  detailFixture('separate semantic lists cannot combine a lot from one record and plate from another', detail('<ul><li>Лот ' + ID + '</li></ul><ul><li>Номер автомобиля ' + PLATE + '</li></ul>'), false),
  detailFixture('the lot must equal the current public advertisement ID', detail(specs(PLATE, OTHER_ID)), false),
  detailFixture('a conflicting official outlink cannot confirm the current public advertisement', detail(specs() + '<a href="https://fem.encar.com/cars/detail/' + OTHER_ID + '">Encar</a>'), false),
  detailFixture('multiple primary plates are not resolved by selecting the requested one', detail(specs() + '<ul><li>Номер автомобиля ' + OTHER_PLATE + '</li></ul>'), false),
  detailFixture('POST form content cannot provide public vehicle identity', detail('<form method="post" action="/submit">' + specs() + '</form>'), false),
  detailFixture('a real challenge cannot be bypassed by leaving vehicle text on the page', '<main><h1>Access denied</h1><p>Verify you are human. CAPTCHA challenge.</p>' + specs() + '</main>', false)
];

const worker = `
import { discoverCatalogBranches, parseExternalAdvertisement } from './encar-catalog.mjs';
export default {
  async fetch(request) {
    const input = await request.json();
    try {
      if (input.action === 'probe') {
        const events = [];
        await new HTMLRewriter().on('*', { element(element) {
          const tag = element.tagName;
          events.push({ kind: 'start', tag, namespace: element.namespaceURI || null });
          try { element.onEndTag(() => events.push({ kind: 'end', tag })); }
          catch (_) { events.push({ kind: 'no-end-tag', tag }); }
        } }).transform(new Response(input.html)).text();
        return Response.json({ ok: true, events });
      }
      const value = input.action === 'branches'
        ? (await discoverCatalogBranches(input.html, input.url, input.hints)).map(url => url.href)
        : await parseExternalAdvertisement(input.html, input.url, input.plate);
      return Response.json({ ok: true, value });
    } catch (error) {
      return Response.json({ ok: false, code: error?.code || 'UNEXPECTED_ERROR',
        ...(typeof error?.reason === 'string' ? { reason: error.reason } : {}) });
    }
  }
};
`;

async function exercise(source, label, verify) {
  let outbound = 0;
  const options = {
    modulesRoot: '/native-parser-fixture',
    modules: [
      { type: 'ESModule', path: '/native-parser-fixture/entry.mjs', contents: worker },
      { type: 'ESModule', path: '/native-parser-fixture/encar-catalog.mjs', contents: source }
    ],
    compatibilityDate: '2026-10-01', cf: false,
    outboundService: () => {
      ++outbound;
      return new WorkerResponse('Outbound network is blocked in this synthetic test.', { status: 502 });
    }
  };
  const runtime = new Miniflare(typeof convertV4MiniflareOptions === 'function'
    ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
  const invoke = async body => {
    const response = await runtime.dispatchFetch(ORIGIN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, label + ': native test dispatch failed');
    return response.json();
  };
  const results = [];
  try {
    const probe = await invoke({ action: 'probe', html: '<svg><path d="M0 0"/></svg><ul><li>a<li>b</ul>' });
    assert.equal(probe.ok, true, label + ': native HTMLRewriter probe failed');
    assert(probe.events.some(event => event.kind === 'start' && event.tag === 'path' && event.namespace === 'http://www.w3.org/2000/svg'),
      label + ': native foreign-content namespace was unavailable');
    for (const fixture of fixtures) {
      const result = await invoke(fixture);
      const matched = fixture.action === 'branches'
        ? result.ok && result.value.length === 1 && result.value[0] === BRANCH
        : result.ok && Array.isArray(result.value?.matches) && result.value.matches.length === 1 &&
          result.value.matches[0].id === ID && result.value.matches[0].sourceUrl === DETAIL;
      results.push({ name: fixture.name, expected: fixture.expected, matched: !!matched,
        ...(result.code ? { code: result.code } : {}), ...(result.reason ? { reason: result.reason } : {}) });
      if (verify) assert.equal(!!matched, fixture.expected, label + ': ' + fixture.name + ' ' + JSON.stringify(result));
      // Baseline controls distinguish a real parser rejection from a bad harness.
      if (fixture.name.endsWith(' control')) assert.equal(!!matched, true, label + ': positive control failed');
    }
    assert.equal(outbound, 0, label + ': the parser attempted an outbound request');
    return { label, parserSha256: createHash('sha256').update(source).digest('hex'),
      fixtureCount: results.length, outboundRequests: outbound, nativeProbe: probe.events, results };
  } finally { await runtime.dispose(); }
}

(async () => {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--baseline-only' || arg.startsWith('--baseline-ref=')), 'Unknown argument');
  const baselineRef = args.find(arg => arg.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
  const baselineOnly = args.includes('--baseline-only');
  assert(!baselineOnly || baselineRef, '--baseline-only requires --baseline-ref=<git ref>');
  assert(!baselineRef || /^[A-Za-z0-9._/-]{1,128}$/.test(baselineRef) && !baselineRef.startsWith('-'), 'Invalid baseline ref');
  const receipts = [];
  if (baselineRef) {
    const baseline = execFileSync('git', ['show', baselineRef + ':' + PARSER], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    receipts.push(await exercise(baseline, 'baseline ' + baselineRef, false));
  }
  if (!baselineOnly) receipts.push(await exercise(readFileSync(path.join(ROOT, PARSER), 'utf8'), 'working tree', true));
  console.log(JSON.stringify({ engine: 'Cloudflare workerd through Miniflare', miniflareVersion: require('miniflare/package.json').version,
    workerdVersion: require('workerd/package.json').version, compatibilityDate: '2026-10-01', syntheticOnly: true, receipts }, null, 2));
  console.log(baselineOnly ? 'PASS native baseline observation; no outbound requests.'
    : 'PASS native Cloudflare parser: SVG, optional end tags, primary specifications, safe forms, observed branches and negative identity boundaries; no outbound requests.');
})().catch(error => { console.error(error); process.exitCode = 1; });
