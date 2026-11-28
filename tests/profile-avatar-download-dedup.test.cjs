'use strict';

// Execute the actual private-image functions with disposable identities and
// held synthetic responses. No browser, credentials or network is involved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const stateStart = html.indexOf('let snoteProfileSession=null');
const stateEnd = html.indexOf('function snoteProfileContext()', stateStart);
const imageStart = html.indexOf('function snoteProfileAvatarPath(');
const imageEnd = html.indexOf('async function snoteProfileAvatarRead(', imageStart);
assert(stateStart >= 0 && stateEnd > stateStart && imageStart >= 0 && imageEnd > imageStart);

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_COMPANY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';
const OLD_PHOTO = '22222222-2222-4222-8222-222222222222.png';
const NEW_PHOTO = '33333333-3333-4333-8333-333333333333.png';
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

function fixture() {
  let active = { key: COMPANY + ':' + USER + ':0', companyId: COMPANY, userId: USER, client: {} };
  let serial = 0, onPaint = null;
  const downloads = [], paints = [], revoked = [], host = { textContent: '' };
  const scope = {
    Blob, Uint8Array, Promise, Map,
    currentUser: { name: '가상 계정' },
    window: { SnotePaymentAccounts: { reset() {} }, SnoteContractOffice: { reset() {} } },
    byId: () => host,
    snote128ResetCompanyAssets() {},
    snoteProfileAssert(context) {
      if (context.key !== active.key || context.client !== active.client) {
        throw Object.assign(Error('Changed synthetic context'), { code: 'SNOTE_PROFILE_CONTEXT' });
      }
    },
    snoteProfileError: (code, message) => Object.assign(Error(message), { code }),
    snoteProfilePaintAvatar(context) {
      scope.snoteProfileAssert(context);
      paints.push(vm.runInContext('snoteProfileAvatarImageCache?.url || null', scope));
      onPaint?.();
    },
    URL: {
      createObjectURL() { return 'blob:synthetic-' + (++serial); },
      revokeObjectURL(url) { revoked.push(url); }
    },
    fetch(url, options) {
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      downloads.push({ url, options, release({ ok = true, bytes = png } = {}) {
        release({ ok, blob: async () => new Blob([bytes], { type: 'image/png' }) });
      } });
      return promise;
    }
  };
  vm.createContext(scope);
  vm.runInContext(html.slice(stateStart, stateEnd) + '\n' + html.slice(imageStart, imageEnd), scope);
  const bound = { url: 'https://synthetic.invalid', key: 'SYNTHETIC', token: 'SYNTHETIC' };
  return {
    scope, downloads, paints, revoked,
    context: () => active,
    metadata(revision = 1, photo = OLD_PHOTO) {
      return { user_id: active.userId, company_id: active.companyId, avatar_path: active.companyId + '/' + active.userId + '/' + photo, avatar_revision: revision };
    },
    read(metadata, context = active) { return scope.snoteProfileAvatarResult(context, bound, metadata); },
    pending: () => vm.runInContext('snoteProfileAvatarDownloads.size', scope),
    cache: () => vm.runInContext('snoteProfileAvatarImageCache', scope),
    afterPaint(callback) { onPaint = callback; },
    switchCompany() {
      scope.snoteProfileResetAssets();
      active = { key: OTHER_COMPANY + ':' + USER + ':1', companyId: OTHER_COMPANY, userId: USER, client: {} };
    },
    replaceClientWithoutKeyChange() { active = { ...active, client: {} }; }
  };
}

test('concurrent same-scope image requests share one download and paint one avatar', async () => {
  const f = fixture(), metadata = f.metadata();
  const first = f.read(metadata), second = f.read(metadata);
  assert.equal(f.downloads.length, 1);
  assert.equal(f.pending(), 1);
  assert.equal(f.downloads[0].options.credentials, 'omit');
  assert.equal(f.downloads[0].options.cache, 'no-store');
  assert.equal(f.downloads[0].options.headers.Authorization, 'Bearer SYNTHETIC');
  f.downloads[0].release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.avatarURL, two.avatarURL);
  assert.equal(f.paints.length, 1);
  assert.equal(f.pending(), 0);
  assert.equal((await f.read(metadata)).avatarURL, one.avatarURL);
  assert.equal(f.downloads.length, 1);
});

test('a failed shared download clears the pending slot and permits a fresh retry', async () => {
  const f = fixture(), metadata = f.metadata();
  const result = Promise.allSettled([f.read(metadata), f.read(metadata)]);
  f.downloads[0].release({ ok: false });
  const failures = await result;
  assert(failures.every(item => item.status === 'rejected' && item.reason.code === 'SNOTE_PROFILE_IMAGE'));
  assert.equal(f.pending(), 0);
  assert.equal(f.cache(), null);
  const retry = f.read(metadata);
  assert.equal(f.downloads.length, 2);
  f.downloads[1].release();
  await retry;
  assert.equal(f.paints.length, 1);
});

test('reset and company change cannot share or publish the old private photo', async () => {
  const f = fixture(), oldContext = f.context();
  const oldResult = f.read(f.metadata(), oldContext).then(value => ({ value }), error => ({ error }));
  f.switchCompany();
  assert.equal(f.pending(), 0);
  const newer = f.read(f.metadata());
  assert.equal(f.downloads.length, 2);
  assert(f.downloads[0].url.includes(COMPANY));
  assert(f.downloads[1].url.includes(OTHER_COMPANY));
  f.downloads[0].release();
  assert.equal((await oldResult).error.code, 'SNOTE_PROFILE_CONTEXT');
  assert.equal(f.paints.length, 0);
  f.downloads[1].release();
  const current = await newer;
  assert.equal(f.paints.length, 1);
  assert.equal(f.cache().key, f.context().key);
  assert.equal(current.avatar.company_id, OTHER_COMPANY);
});

test('an older image response joins the latest revision instead of repainting it', async () => {
  const f = fixture();
  const older = f.read(f.metadata(1, OLD_PHOTO));
  const latest = f.read(f.metadata(2, NEW_PHOTO));
  assert.equal(f.downloads.length, 2);
  f.downloads[1].release();
  const current = await latest;
  f.downloads[0].release();
  const late = await older;
  assert.equal(late.avatarURL, current.avatarURL);
  assert.equal(late.avatar.avatar_revision, 2);
  assert.equal(f.paints.length, 1);
  assert.equal(f.downloads.length, 2);
  assert.equal(f.pending(), 0);
});

test('a newly acknowledged photo replaces and revokes the prior URL exactly once', async () => {
  const f = fixture(), first = f.read(f.metadata());
  f.downloads[0].release();
  const old = await first;
  const one = f.read(f.metadata(2, NEW_PHOTO)), two = f.read(f.metadata(2, NEW_PHOTO));
  assert.equal(f.downloads.length, 2);
  f.downloads[1].release();
  const values = await Promise.all([one, two]);
  assert.equal(values[0].avatarURL, values[1].avatarURL);
  assert.equal(f.paints.length, 2);
  assert.deepEqual(f.revoked, [old.avatarURL]);
});

test('same path with a newer revision keeps distinct pending work and resolves monotonically', async () => {
  const f = fixture(), older = f.read(f.metadata(1)), newer = f.read(f.metadata(2));
  assert.equal(f.downloads.length, 2);
  f.downloads[0].release();
  f.downloads[1].release();
  const [late, current] = await Promise.all([older, newer]);
  assert.equal(late.avatar.avatar_revision, 2);
  assert.equal(late.avatarURL, current.avatarURL);
  assert.equal(f.paints.length, 1);
});

test('replacement client cannot reuse a pending entry even if its key is unchanged', async () => {
  const f = fixture(), oldContext = f.context();
  const oldResult = f.read(f.metadata(), oldContext).then(value => ({ value }), error => ({ error }));
  f.replaceClientWithoutKeyChange();
  const newer = f.read(f.metadata());
  assert.equal(f.downloads.length, 2);
  f.downloads[0].release();
  assert.equal((await oldResult).error.code, 'SNOTE_PROFILE_CONTEXT');
  assert.equal(f.pending(), 1, 'Old cleanup cannot erase the replacement client task');
  f.downloads[1].release();
  await newer;
  assert.equal(f.paints.length, 1);
  assert.equal(f.pending(), 0);
});

test('shared work still validates the image bytes before creating any object URL', async () => {
  const f = fixture(), metadata = f.metadata();
  const result = Promise.allSettled([f.read(metadata), f.read(metadata)]);
  f.downloads[0].release({ bytes: new Uint8Array([1, 2, 3]) });
  const failures = await result;
  assert(failures.every(item => item.status === 'rejected' && item.reason.code === 'SNOTE_PROFILE_IMAGE'));
  assert.equal(f.paints.length, 0);
  assert.equal(f.cache(), null);
  assert.equal(f.pending(), 0);
});

test('new metadata acknowledged between shared-task completion and caller resumption wins', async () => {
  const f = fixture();
  let newest, oldSettled = false, scheduled = false;
  f.afterPaint(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { newest = f.read(f.metadata(2, NEW_PHOTO)); });
  });
  const old = f.read(f.metadata()).then(value => { oldSettled = true; return value; });
  f.downloads[0].release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.downloads.length, 2);
  assert.equal(oldSettled, false, 'Caller must wait for the newly acknowledged revision');
  f.downloads[1].release();
  const [late, current] = await Promise.all([old, newest]);
  assert.equal(late.avatar.avatar_revision, 2);
  assert.equal(late.avatarURL, current.avatarURL);
  assert.equal(f.cache().url, current.avatarURL);
  assert.equal(f.pending(), 0);
  assert.deepEqual(f.revoked, ['blob:synthetic-1']);
});
