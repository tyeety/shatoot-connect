const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ClientPreferences } = require('../desktop/preferences.cjs');
function fixture() {
  let stored = {}; const secrets = new Map();
  const options = { read: () => stored, write: patch => stored = { ...stored, ...patch },
    encrypt: value => { const key = crypto.randomUUID(); secrets.set(key, value); return key; }, decrypt: key => secrets.get(key),
    validateEndpoint: endpoint => { if (!endpoint.startsWith('wss://')) throw Error('Invalid endpoint'); return endpoint; },
    validateDirect: address => { if (!/^192\.168\.\d+\.\d+(?::\d+)?$/.test(address)) throw Error('Invalid LAN IP'); return address; } };
  return { preferences: new ClientPreferences(options), storage: () => stored };
}
test('fixed credentials and favorites are stored only through the encryption boundary', () => {
  const { preferences, storage } = fixture();
  preferences.setFixedPassword('fixed-secret-123');
  const id = preferences.save({ name: 'Office', address: '123 456 789', password: 'remote-secret', endpoint: 'wss://office.example', serverKey: 'enrollment-secret' });
  const raw = JSON.stringify(storage());
  for (const secret of ['fixed-secret-123', 'remote-secret', 'enrollment-secret']) assert.ok(!raw.includes(secret));
  assert.equal(preferences.fixedPassword(), 'fixed-secret-123');
  assert.equal(preferences.get(id).password, 'remote-secret');
  assert.equal(preferences.get(id).serverKey, 'enrollment-secret');
  assert.ok(!JSON.stringify(preferences.list()).includes('remote-secret'));
  preferences.setFixedPassword(''); assert.equal(preferences.fixedPassword(), '');
});
test('favorites update without changing shortcut identity and reject invalid destinations', () => {
  const { preferences } = fixture();
  const value = { name: 'LAN', address: '192.168.1.10:8788', password: 'lan-password' };
  const id = preferences.save(value); preferences.markShortcut(id);
  assert.equal(preferences.save({ ...value, name: 'Renamed', password: 'new-secret' }), id);
  assert.equal(preferences.list().length, 1); assert.equal(preferences.list()[0].shortcut, true);
  assert.match(preferences.shortcutName(id), /^Shatoot Connect - LAN \([a-f0-9]{8}\)\.lnk$/);
  assert.throws(() => preferences.shortcutName('../bad'), /Invalid/);
  assert.throws(() => preferences.setFixedPassword('short'), /8 to 128/);
  assert.throws(() => preferences.save({ ...value, address: 'example.com' }), /Invalid LAN/);
  preferences.remove(id); assert.equal(preferences.list().length, 0);
});
test('unattended access is opt-in and is revoked when the fixed password is removed', () => {
  const { preferences } = fixture();
  assert.equal(preferences.unattended(), false);
  assert.throws(() => preferences.setUnattended(true), /fixed password/);
  preferences.setFixedPassword('unattended-secret'); assert.equal(preferences.unattended(), false);
  preferences.setUnattended(true); assert.equal(preferences.unattended(), true);
  assert.equal(preferences.canAutoApprove(true), true);
  for (const unverified of [false, undefined, 'true', 1]) assert.equal(preferences.canAutoApprove(unverified), false);
  preferences.setFixedPassword(''); assert.equal(preferences.unattended(), false);
  preferences.setFixedPassword('another-secret'); assert.equal(preferences.unattended(), false);
});
