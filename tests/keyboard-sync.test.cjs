const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LayoutSync, GuestShiftState } = require('../desktop/ui/keyboard-sync.js');

test('a captured shifted slash recovers missing Shift-down before sending the physical key', () => {
  const state = new GuestShiftState(), slash = {type:'physical-key',vk:0xBF,scan:0x35,extended:false,down:true};
  assert.deepEqual(state.packets(slash, true), [{type:'key',code:'ShiftLeft',down:true}, slash]);
  assert.deepEqual(state.packets({...slash,down:false}, true), [{...slash,down:false}]);
  assert.deepEqual(state.packets({type:'physical-key',vk:0xA1,scan:0x36,down:false}, true), [{type:'key',code:'ShiftLeft',down:false}]);
  assert.deepEqual(state.packets(slash, false), [slash]);
});

test('DOM and native Shift events share one representation across capture handoff', () => {
  const state = new GuestShiftState();
  assert.deepEqual(state.packets({type:'key',code:'ShiftLeft',down:true}, true), [{type:'key',code:'ShiftLeft',down:true}]);
  assert.deepEqual(state.packets({type:'physical-key',vk:0xA0,scan:0x2A,down:false}, true), [{type:'key',code:'ShiftLeft',down:false}]);
  assert.deepEqual(state.packets({type:'physical-key',vk:0xA1,scan:0x36,down:true}, false), [{type:'key',code:'ShiftRight',down:true}]);
  assert.deepEqual(state.packets({type:'key',code:'ShiftRight',down:false}, false), [{type:'key',code:'ShiftRight',down:false}]);
  assert.equal(state.held.size, 0);
});

test('missing Shift-up is repaired before an unshifted key; both sides and release/reset stay consistent', () => {
  const state = new GuestShiftState(), slash = {type:'key',code:'Slash',down:true};
  state.packets({type:'key',code:'ShiftLeft',down:true}, true);
  state.packets({type:'key',code:'ShiftRight',down:true}, true);
  assert.deepEqual(state.packets(slash, true), [slash]);
  assert.deepEqual(state.packets(slash, false), [{type:'key',code:'ShiftLeft',down:false},{type:'key',code:'ShiftRight',down:false},slash]);
  state.packets(slash, true); state.reset();
  assert.deepEqual(state.packets(slash, true), [{type:'key',code:'ShiftLeft',down:true},slash]);
  assert.deepEqual(state.packets({type:'key',code:'ShiftRight',down:true}, true), [{type:'key',code:'ShiftRight',down:true},{type:'key',code:'ShiftLeft',down:false}]);
});
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
