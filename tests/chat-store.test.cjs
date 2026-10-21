'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ChatStore } = require('../desktop/chat-store.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shatoot-history-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32), self = crypto.randomUUID(), peer = crypto.randomUUID(), other = crypto.randomUUID();
  const options = { file: path.join(root, 'history.dat'), self,
    encrypt: text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: bytes => { if (bytes.length < 28) throw new Error('Invalid envelope'); const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 }); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString(); } };
  const store = new ChatStore(options); store.contact({ deviceId: peer, name: 'همکار' }, { type: 'lan', address: '192.168.1.10:8788' }); return { store, options, self, peer, other };
}
test('encrypted history survives restart, deduplicates delivery, paginates without timestamp gaps and persists the outbox', t => {
  const { store, options, self, peer } = fixture(t);
  for (let index = 0; index < 125; index++) store.append({ id: crypto.randomUUID(), conversation: `p:${peer}`, sender: self, name: 'Me', kind: 'text', text: `پیام ${index}`, pending: [peer] }, true);
  assert.equal(store.pending(peer).length, 125); const last = store.history({ conversation: `p:${peer}` }); assert.equal(last.length, 100);
  assert.equal(store.history({ conversation: `p:${peer}`, before: last[0].receivedAt }).length, 25);
  const message = last.at(-1); assert.equal(store.append(message, true).duplicate, true);
  store.delivered(message.id, peer); assert.equal(store.pending(peer).length, 124);
  assert.equal(fs.readFileSync(options.file).includes(Buffer.from('پیام')), false);
  const reopened = new ChatStore(options); assert.equal(reopened.pending(peer).length, 124); assert.equal(reopened.history({ conversation: `p:${peer}`, search: '124' })[0].status, 'delivered');
});
test('group owner keeps an offline relay queue and corrupt history is retained instead of overwritten', t => {
  const { store, options, self, peer, other } = fixture(t);
  const group = { id: crypto.randomUUID(), owner: self, name: 'Team', members: [{ deviceId: self, name: 'Owner' }, { deviceId: peer, name: 'A' }, { deviceId: other, name: 'B' }] }; store.group(group);
  const m = { id: crypto.randomUUID(), conversation: `g:${group.id}`, sender: peer, name: 'A', kind: 'text', text: 'For offline B', pending: [other] }; store.append(m);
  assert.equal(new ChatStore(options).pending(other).length, 1); store.delivered(m.id, other); assert.equal(store.pending(other).length, 0); assert.equal(store.history({ conversation: m.conversation })[0].status, 'received');
  assert.throws(() => store.group({ ...group, owner: peer }), /cannot change/);
  const damaged = Buffer.from('corrupt encrypted history'); fs.writeFileSync(options.file, damaged);
  assert.throws(() => new ChatStore(options).list(), /has been kept/); assert.deepEqual(fs.readFileSync(options.file), damaged);
});
