const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { IdentityStore } = require('../server/identity-store.cjs');
const { cloudflareTurnProvider } = require('../server/managed-turn.cjs');

test('persisted identity survives broker reconstruction and stores only credential hashes', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ShatootConnect identity test '));
  t.after(() => { if (path.dirname(path.resolve(folder)) !== path.resolve(os.tmpdir()) || !path.basename(folder).startsWith('ShatootConnect identity test ')) throw new Error('Unsafe temp path'); fs.rmSync(folder, { recursive: true, force: true }); });
  const file = path.join(folder, 'devices.json'), device = crypto.randomUUID(), secret = crypto.randomBytes(32).toString('base64url');
  const first = new IdentityStore(file).register(device, secret);
  assert.match(first, /^\d{9}$/); assert.equal(new IdentityStore(file).register(device, secret), first);
  assert.equal(fs.readFileSync(file, 'utf8').includes(secret), false);
  assert.throws(() => new IdentityStore(file).register(device, crypto.randomBytes(32).toString('base64url')), /verified/);
});
test('managed TURN sends API secret only upstream, caches temporary credentials, and strips blocked ports', async () => {
  const token = 'test-token-never-send-to-client'; let calls = 0;
  const provider = cloudflareTurnProvider({ keyId: 'test-key-123456', apiToken: token }, async (url, options) => {
    calls++; assert.equal(url, 'https://rtc.live.cloudflare.com/v1/turn/keys/test-key-123456/credentials/generate-ice-servers');
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ iceServers: [{ urls: ['turn:turn.example.invalid:3478', 'turn:turn.example.invalid:53'], username: 'temporary-user', credential: 'temporary-password' }] }) };
  });
  const [one, two] = await Promise.all([provider(), provider()]);
  assert.equal(calls, 1); assert.deepEqual(one, two); assert.equal(JSON.stringify(one).includes(token), false);
  assert.deepEqual(one[0].urls, ['turn:turn.example.invalid:3478']); await provider(); assert.equal(calls, 1);
});
test('managed TURN failures never include API response contents or secrets', async () => {
  const provider = cloudflareTurnProvider({ keyId: 'test-key-123456', apiToken: 'test-token-never-send-to-client' }, async () => ({ ok: false, status: 401, text: async () => 'secret contents' }));
  await assert.rejects(provider(), error => /HTTP 401/.test(error.message) && !error.message.includes('test-token') && !error.message.includes('secret contents'));
});
