import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { onRequest } from '../functions/api/account-recovery.js';

// Actual isolated PostgreSQL/RPC + real Worker handler. Auth mutations and all
// messages remain synthetic fetch stubs; there is no live network or billing.
const require = createRequire(import.meta.url);
const { createOperatorFixture } = require('./operator-core.sql.cjs');
const { COMPANY, OWNER, OUTSIDER } = require('./recycle-bin-db.cjs');
const ENV = { SUPABASE_URL: 'https://recovery-integration.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'integration-public', SUPABASE_SERVICE_ROLE_KEY: 'integration-service-only',
  SOLAPI_API_KEY: 'integration-solapi-key', SOLAPI_API_SECRET: 'integration-solapi-secret', CUSTOMER_INTAKE_OTP_SECRET: 'integration-only-otp-secret-at-least-thirty-two-characters' };
const PHONE = '01012345678', NAME = 'Synthetic integration dealer';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const digest = value => createHash('sha256').update(value).digest('hex');
let db, previousFetch;
const args = {
  prepare: ['request_id', 'challenge_id', 'purpose', 'name', 'phone', 'phone_hash', 'ip_hash', 'otp_hash'],
  delivery: ['challenge_id', 'status'], verify: ['challenge_id', 'purpose', 'otp_hash', 'receipt_hash', 'ip_hash'],
  email_delivery: ['challenge_id', 'receipt_hash', 'status'],
  reset_prepare: ['job_id', 'challenge_id', 'receipt_hash', 'password_fingerprint', 'executor_hash'],
  reset_finalize: ['job_id', 'receipt_hash', 'password_fingerprint', 'executor_hash', 'outcome']
};
const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
const read = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8');
test.before(async () => {
  db = await createOperatorFixture();
  await db.exec("alter table auth.users add column phone text,add column phone_confirmed_at timestamptz,add column encrypted_password text default 'integration-old-hash';");
  await db.exec(await read('20261106131154_verified_profile_contact.sql'));
  const registration = await read('20261122144025_verified_registration.sql'), start = registration.indexOf('create or replace function snote_private.registration_phone('), end = registration.indexOf('end$f$;', start);
  await db.exec(registration.slice(start, end + 7));
  await db.query('update public.zc_members set display_name=$2,phone=$3 where user_id=$1', [OWNER, NAME, PHONE]);
  await db.query('insert into snote_private.member_profiles(user_id,phone) values($1,$2)', [OWNER, PHONE]);
  await db.exec(await read('20261123132420_phone_account_recovery.sql'));
  previousFetch = globalThis.fetch;
});
test.after(async () => { globalThis.fetch = previousFetch; await db?.close(); });
function fixture(t) {
  const state = { calls: [], jobs: [], messages: [], recoveries: [], puts: [], losePasswordAck: false };
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input), body = JSON.parse(options.body), call = { url, options, body }; state.calls.push(call);
    assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-store');
    if (url.origin === 'https://api.solapi.com') {
      assert.equal(url.pathname, '/messages/v4/send'); assert.equal(body.message.to, PHONE); assert.equal(body.message.from, '01096669997');
      state.messages.push(body.message); return json({ statusCode: '2000', messageId: 'SMS_INTEGRATION_ACCEPTED' });
    }
    assert.equal(url.origin, ENV.SUPABASE_URL);
    if (url.pathname === '/auth/v1/recover') {
      assert.equal(options.headers.apikey, ENV.SUPABASE_PUBLISHABLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + ENV.SUPABASE_PUBLISHABLE_KEY);
      assert.equal(url.searchParams.get('redirect_to'), 'https://s-note.kr/'); assert.deepEqual(body, { email: OWNER + '@example.invalid' });
      state.recoveries.push(call); return json({});
    }
    assert.equal(options.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY); assert.equal(options.headers.Authorization, 'Bearer ' + ENV.SUPABASE_SERVICE_ROLE_KEY);
    if (url.pathname === '/auth/v1/admin/users/' + OWNER) {
      assert.equal(options.method, 'PUT'); assert.deepEqual(Object.keys(body), ['password']); state.puts.push(call);
      // Stand in for a successful Auth password hash write. No actual password
      // hash computation or user login is performed by this isolated fixture.
      await db.query('update auth.users set encrypted_password=$2,updated_at=clock_timestamp() where id=$1', [OWNER, 'integration-new-hash-' + digest(body.password)]);
      if (state.losePasswordAck) throw Error('synthetic lost Auth acknowledgement');
      return json({ id: OWNER });
    }
    const suffix = url.pathname.replace('/rest/v1/rpc/snote_phone_recovery_', ''); assert(Object.hasOwn(args, suffix));
    const values = args[suffix].map(name => body['p_' + name]);
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]);
    await db.exec('set role service_role');
    try { return json(await scalar('select public.snote_phone_recovery_' + suffix + '(' + values.map((_, i) => '$' + (i + 1)).join(',') + ')', values)); }
    finally { await db.exec('reset role'); }
  };
  t.after(() => { globalThis.fetch = previousFetch; });
  state.cool = () => db.exec("update snote_private.recovery_rate_events set created_at=clock_timestamp()-interval'25 hours'");
  state.call = async body => {
    const response = await onRequest({ request: new Request('https://s-note.example/api/account-recovery', { method: 'POST', headers: { Origin: 'https://s-note.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.25' }, body: JSON.stringify(body) }),
      env: ENV, waitUntil(job) { state.jobs.push(job); } });
    return { status: response.status, body: await response.json() };
  };
  state.send = async (purpose = 'password', extra = {}) => {
    await state.cool(); const request = { action: 'send-code', purpose, name: NAME, phone: PHONE, requestId: randomUUID(), ...extra };
    const sent = await state.call(request); assert.equal(sent.status, 200); await Promise.all(state.jobs);
    return { sent, request };
  };
  state.prove = async (purpose = 'password') => {
    const { sent, request } = await state.send(purpose), code = state.messages.at(-1).text.match(/인증번호: (\d{6})/u)[1];
    const verify = { action: 'verify', purpose, challengeId: sent.body.challengeId, code }, verified = await state.call(verify);
    return { sent, request, verify, verified, reset: { action: 'reset-password', challengeId: sent.body.challengeId, resetToken: verified.body.resetToken, password: 'Integration-test-new-password!', requestId: randomUUID() } };
  };
  return state;
}

test('actual SQL duplicate preparation and legacy proof keep one SMS and one fixed native email request', async t => {
  const f = fixture(t), proof = await f.prove();
  assert.deepEqual(proof.verified.body, { ok: true, requiresEmail: true, delivery: 'sent' }); assert.equal(f.messages.length, 1); assert.equal(f.recoveries.length, 1);
  const duplicate = await f.call(proof.request); await Promise.all(f.jobs); assert.equal(duplicate.status, 200); assert.equal(duplicate.body.challengeId, proof.sent.body.challengeId); assert.equal(f.messages.length, 1);
  assert.deepEqual((await f.call(proof.verify)).body, proof.verified.body); assert.equal(f.recoveries.length, 1);
  assert.equal((await f.call({ ...proof.reset, resetToken: 'a'.repeat(64) })).body.code, 'INVALID_CODE'); assert.equal(f.puts.length, 0);
  const before = f.messages.length, decoy = await f.send('id', { name: 'Unknown synthetic name' });
  assert.equal(decoy.sent.status, 200); assert.equal(f.messages.length, before); assert.deepEqual(Object.keys(decoy.sent.body), Object.keys(proof.sent.body));
});

test('actual phone binding permits ID lookup and a one-use Admin reset whose finalization revokes only that user sessions', async t => {
  const f = fixture(t);
  await db.query("insert into snote_private.recovery_phone_bindings(user_id,phone,verified_at,source) values($1,$2,clock_timestamp(),'profile_otp') on conflict(user_id) do update set invalidated_at=null,phone=excluded.phone", [OWNER, PHONE]);
  const id = await f.prove('id'); assert.deepEqual(id.verified.body, { ok: true, email: OWNER + '@example.invalid' }); assert.equal(f.recoveries.length, 0);
  const proof = await f.prove(); assert.equal(proof.verified.status, 200); assert.match(proof.verified.body.resetToken, /^[a-f0-9]{64}$/u);
  const own = randomUUID(), other = randomUUID(); await db.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$4)', [own, OWNER, other, OUTSIDER]);
  assert.equal((await f.call(proof.reset)).status, 200); assert.equal(f.puts.length, 1);
  assert.equal(await scalar('select count(*)::int from auth.sessions where id=$1', [own]), 0); assert.equal(await scalar('select count(*)::int from auth.sessions where id=$1', [other]), 1);
  const again = await f.call(proof.reset); assert.equal(again.body.duplicate, true); assert.equal(f.puts.length, 1);
  assert.equal((await f.call({ ...proof.reset, password: 'Integration-different-password!' })).body.code, 'REQUEST_REUSED');
  assert.equal((await f.call({ ...proof.reset, requestId: randomUUID() })).body.code, 'PROOF_CONSUMED'); assert.equal(f.puts.length, 1);
});

test('actual SQL freezes uncertain password outcomes and invalidates a receipt after canonical contact change', async t => {
  const f = fixture(t), proof = await f.prove(); f.losePasswordAck = true;
  assert.equal((await f.call(proof.reset)).body.code, 'RESET_UNKNOWN'); assert.equal((await f.call(proof.reset)).body.code, 'RESET_UNKNOWN'); assert.equal(f.puts.length, 1);
  assert.equal(await scalar('select state from snote_private.recovery_reset_jobs where job_id=$1', [proof.reset.requestId]), 'unknown');
  // An uncertain upstream write retains its original bounded identity fence;
  // it must not release contact changes merely because the HTTP ACK was lost.
  await assert.rejects(db.query('update snote_private.member_profiles set phone=$2 where user_id=$1', [OWNER, '01099998888']), error => error.code === '40001');
  assert.equal(await scalar('select phone from snote_private.member_profiles where user_id=$1', [OWNER]), PHONE);
  // Advance only the synthetic job deadline, with no wall-clock wait or change
  // to the production guard, before checking normal contact editing resumes.
  await db.query("update snote_private.recovery_reset_jobs set apply_until=clock_timestamp()-interval'1 second' where job_id=$1", [proof.reset.requestId]);
  f.losePasswordAck = false;
  const changed = await f.prove(); await db.query('update snote_private.member_profiles set phone=$2 where user_id=$1', [OWNER, '01099998888']);
  assert.equal((await f.call(changed.reset)).body.code, 'INVALID_CODE'); assert.equal(f.puts.length, 1);
  await db.query('update snote_private.member_profiles set phone=$2 where user_id=$1', [OWNER, PHONE]);
});
