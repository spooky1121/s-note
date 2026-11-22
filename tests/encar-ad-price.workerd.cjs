'use strict';
// Actual Workers Auth handler, native HTMLRewriter and fetch with service-bound
// synthetic upstreams only. No network, credentials, account or vehicle writes.
// NODE_PATH=/path/to/test-tools/node_modules node tests/encar-ad-price.workerd.cjs [pages-build/index.js]
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { Miniflare, Response: WorkerResponse, convertV4MiniflareOptions } = require('miniflare');
const root = path.resolve(__dirname, '..'), USER = '11111111-1111-4111-8111-111111111111', COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID = '43123456', PLATE = '28오6877', ORIGIN = 'https://native-price.example', JWT = 'synthetic.header.signature';
const bindings = { SUPABASE_URL: 'https://native-price-auth.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' };
const fixture = `
let mode='found', calls=[];
export default { async fetch(request) {
 const url=new URL(request.url);
 if(url.hostname==='fixture.internal'){if(url.pathname==='/reset'){mode=url.searchParams.get('mode')||'found';calls=[];}return Response.json(calls);}
 calls.push({url:request.url,method:request.method});
 if(request.method!=='GET')throw Error('No write request is permitted');
 if(url.origin==='https://native-price-auth.supabase.co'){
  if(request.headers.get('Authorization')!=='Bearer ${JWT}'||request.headers.get('apikey')!=='synthetic-public-key')throw Error('Requesting user auth required');
  if(url.pathname==='/auth/v1/user')return Response.json({id:'${USER}'});
  if(url.pathname==='/rest/v1/zc_members')return Response.json(mode==='denied'?[]:[{user_id:'${USER}',company_id:'${COMPANY}',role:'dealer',active:true}]);
 }
 if(request.url!=='https://fem.encar.com/cars/detail/${ID}?listAdvType=share&adnm=mo_detail_url')throw Error('Only the fixed native Encar listing is allowed');
 if(request.headers.has('Authorization')||request.headers.has('Cookie'))throw Error('No caller credential or cookie may leave to Encar');
 if(mode==='slow_found')await new Promise(resolve=>setTimeout(resolve,40));
 if(mode==='rate')return new Response('PRIVATE_UPSTREAM',{status:429});
 if(mode==='blocked')return new Response('PRIVATE_CHALLENGE',{status:403});
 const base={vehicleId:${ID},vehicleNo:mode==='mismatch'?'12가3456':'${PLATE}',manage:{dummy:mode==='dummy'},advertisement:{status:mode==='sold'?'SOLD':'ADVERTISE',price:5490}};
 const html='<script>window.__PRELOADED_STATE__='+JSON.stringify({cars:{base}})+';</script><main><p>차량 판매가 <strong>5,490</strong><span>만원</span></p></main>';
 return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
} };`;
(async () => {
  const entry = `import {onRequest} from './functions/api/encar-ad-price.js';export default{fetch(request,env,ctx){return onRequest({request,env,waitUntil:promise=>ctx.waitUntil(promise)});}};`;
  const filenames = ['functions/api/encar-ad-price.js', ...['api-security.js', 'encar-request-state.mjs', 'encar-ad-price.mjs', 'encar-price-ocr.mjs', 'encar-page-price.mjs', 'encar-id-browser.mjs', 'encar-id-browser-session.mjs', 'encar-id-browser-limits.mjs'].map(name => 'functions/_shared/' + name)];
  const modules = process.argv[2] ? [{ type: 'ESModule', path: '/native-price/compiled.mjs', contents: fs.readFileSync(process.argv[2], 'utf8') }] : [{ type: 'ESModule', path: '/native-price/entry.mjs', contents: entry }, ...filenames.map(filename => ({ type: 'ESModule', path: '/native-price/' + filename, contents: fs.readFileSync(path.join(root, filename), 'utf8') }))];
  let outbound = 0;
  const options = { workers: [
    { name: 'api', modulesRoot: '/native-price', modules, bindings, serviceBindings: { ASSETS: () => new WorkerResponse('synthetic-static') }, compatibilityDate: '2026-10-01', outboundService: 'native-price-fixture' },
    { name: 'native-price-fixture', modulesRoot: '/native-price', modules: [{ type: 'ESModule', path: '/native-price/fixture.mjs', contents: fixture }], compatibilityDate: '2026-10-01' }
  ], cf: false, outboundService: () => { outbound++; return new WorkerResponse('Actual outbound prohibited', { status: 502 }); } };
  const runtime = new Miniflare(typeof convertV4MiniflareOptions === 'function' ? { ...convertV4MiniflareOptions(options), telemetry: { enabled: false } } : options);
  try {
    const upstream = await runtime.getWorker('native-price-fixture'), reports = [];
    const reset = async mode => { await upstream.fetch('https://fixture.internal/reset?mode=' + mode); };
    const call = (extras = {}) => runtime.dispatchFetch(ORIGIN + '/api/encar-ad-price', { method: 'POST', headers: { Origin: ORIGIN, Authorization: 'Bearer ' + JWT, 'Content-Type': 'application/json', ...extras }, body: JSON.stringify({ id: ID, plate: PLATE }) });
    const calls = async () => (await upstream.fetch('https://fixture.internal/stats')).json();
    await reset('found');
    assert.equal((await call({ Origin: 'https://foreign.invalid' })).status, 403); assert.deepEqual(await calls(), []);
    assert.equal((await runtime.dispatchFetch(ORIGIN + '/api/encar-ad-price')).status, 405); assert.deepEqual(await calls(), []);
    for (const [mode, status, code] of [['found', 200, null], ['denied', 403, 'STAFF_REQUIRED'], ['mismatch', 502, 'ENCAR_VEHICLE_MISMATCH'], ['dummy', 502, 'ENCAR_VEHICLE_MISMATCH'], ['sold', 502, 'ENCAR_NOT_ADVERTISING'], ['rate', 429, 'ENCAR_RATE_LIMITED'], ['blocked', 503, 'LOOKUP_NOT_CONFIGURED']]) {
      await reset(mode); const response = await call(), body = await response.json(), requests = await calls();
      assert.equal(response.status, status, JSON.stringify({ mode, body })); assert.match(response.headers.get('Cache-Control'), /no-store/u); assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
      if (status === 200) { assert.equal(body.priceWon, 54900000); assert.equal(body.id, ID); assert.equal(body.plate, PLATE); assert.equal(body.source, 'encar'); assert.deepEqual(Object.keys(body).sort(), ['checkedAt', 'id', 'ok', 'plate', 'priceWon', 'source']); }
      else { assert.equal(body.code, code); assert(!('priceWon' in body)); assert(!JSON.stringify(body).includes('PRIVATE')); }
      assert.equal(requests.length, mode === 'denied' ? 2 : 3); assert(requests.every(item => item.method === 'GET')); reports.push({ mode, status, requestCount: requests.length });
    }
    await reset('slow_found');{const concurrent=await Promise.all([call(),call()]);const bodies=await Promise.all(concurrent.map(response=>response.json()));const requests=await calls();assert(concurrent.every(response=>response.status===200));assert(bodies.every(body=>body.priceWon===54900000));assert.equal(requests.length,5,'Two Auth/membership checks share one native price read');reports.push({mode:'concurrent-same-scope',requestCount:requests.length});}
    assert.equal(outbound, 0); console.log('PASS native Workers Encar price endpoint: live-member auth, same-origin/POST-only, native HTMLRewriter 만원-to-WON quote, exact ID/full plate/status/dummy verification, no secret leakage, no vehicle writes. Synthetic only; actual outbound=0.'); console.log(JSON.stringify({ reports, outbound }));
  } finally { await runtime.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
