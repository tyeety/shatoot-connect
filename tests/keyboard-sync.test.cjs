const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LayoutSync } = require('../desktop/ui/keyboard-sync.js');
test('layout changes propagate in both directions without echo; stale updates cannot revert them', () => {
  const host = new LayoutSync(true), guest = new LayoutSync(false); host.ready = guest.ready = true;
  assert.equal(host.observe('00000409'), undefined);
  const initial = guest.observe('00000409'); assert.ok(host.receive(initial)); assert.equal(host.observe('00000409'), undefined);
  const change = host.observe('00000429'); assert.ok(guest.receive(change)); assert.equal(guest.observe('00000429'), undefined);
  const reverse = guest.observe('00000409'); assert.ok(host.receive(reverse)); assert.equal(host.receive(initial), false);
  assert.equal(host.observe('00000409'), undefined);
  assert.equal(host.receive({ layout: '../bad', clock: 9, origin: 0 }), false);
});
test('simultaneous changes converge deterministically', () => {
  const host = new LayoutSync(true), guest = new LayoutSync(false); host.ready = guest.ready = true;
  host.observe('00000409'); const first = guest.observe('00000409'); host.receive(first); host.observe('00000409');
  const a = host.observe('00000429'), b = guest.observe('00000429');
  assert.ok(guest.receive(a)); assert.equal(host.receive(b), false); assert.equal(guest.observe('00000429'), undefined);
});
test('an unapplied layout does not suppress later local changes permanently', () => {
  const guest = new LayoutSync(false); guest.ready = true;
  guest.observe('00000409'); assert.ok(guest.receive({ layout: '00000429', clock: 2, origin: 1 }));
  assert.equal(guest.observe('00000409'), undefined);
  guest.deadline = 0; const corrected = guest.observe('00000409');
  assert.equal(corrected.layout, '00000409'); assert.equal(corrected.clock, 3);
});
