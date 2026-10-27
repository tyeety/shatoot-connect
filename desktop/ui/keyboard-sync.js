'use strict';
class LayoutSync {
  constructor(host) { this.origin = host ? 1 : 0; this.clock = 0; this.stamp = -1; this.initial = host; this.observed = ''; this.expected = ''; this.ready = false; }
  local(layout) {
    if(!/^[0-9a-f]{8}$/i.test(layout))return;
    // An explicit local shortcut takes precedence over an outstanding remote
    // echo. Background samples must not turn that echo into a new local change.
    this.expected='';this.observed='';this.initial=false;
    const packet=this.observe(layout);
    this.expected=layout.toUpperCase();this.deadline=Date.now()+500;
    return packet;
  }
  observe(layout) {
    if (!/^[0-9a-f]{8}$/i.test(layout)) return;
    layout = layout.toUpperCase();
    if (this.expected) { if (layout === this.expected) this.expected = ''; else if (Date.now() < this.deadline) return; else this.expected = ''; }
    if (layout === this.observed) return;
    this.observed = layout;
    if (this.initial) { this.initial = false; return; }
    if (!this.ready) return;
    this.clock++; this.stamp = this.origin;
    return { type: 'layout-sync', layout, clock: this.clock, origin: this.origin };
  }
  receive(message) {
    if (!message || !/^[0-9a-f]{8}$/i.test(message.layout) || !Number.isSafeInteger(message.clock) || message.clock < 1 || message.clock > Number.MAX_SAFE_INTEGER - 1000 || ![0,1].includes(message.origin)) return false;
    if (message.clock < this.clock || (message.clock === this.clock && message.origin <= this.stamp)) return false;
    this.clock = message.clock; this.stamp = message.origin; this.initial = false;
    this.expected = message.layout.toUpperCase(); this.observed = this.expected; this.deadline = Date.now() + 500;
    return true;
  }
}
// Native capture and DOM fallback can take over while Shift is already held.
// Use one key representation for modifiers and recover a missing down/up from
// the modifier snapshot on the next ordinary key, on the same ordered stream.
class GuestShiftState {
  constructor() { this.held = new Set(); this.recovered = false; }
  reset() { this.held.clear(); this.recovered = false; }
  packets(data, shift) {
    let code = data.code;
    if (data.type === 'physical-key') {
      if (data.vk === 0xA1 || data.vk === 0x10 && data.scan === 0x36) code = 'ShiftRight';
      else if (data.vk === 0xA0 || data.vk === 0x10) code = 'ShiftLeft';
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      if (this.recovered) {
        this.recovered = false; this.held.delete('ShiftLeft');
        if (!data.down) return [{ type: 'key', code: 'ShiftLeft', down: false }];
        this.held.add(code);
        return code === 'ShiftRight' ? [{ type: 'key', code, down: true }, { type: 'key', code: 'ShiftLeft', down: false }] : [{ type: 'key', code, down: true }];
      }
      if (data.down) this.held.add(code); else this.held.delete(code);
      return [{ type: 'key', code, down: data.down }];
    }
    const packets = [];
    if (shift === true && !this.held.size) { this.held.add('ShiftLeft'); this.recovered = true; packets.push({ type: 'key', code: 'ShiftLeft', down: true }); }
    else if (shift === false && this.held.size) { for (const code of this.held) packets.push({ type: 'key', code, down: false }); this.reset(); }
    packets.push(data); return packets;
  }
}
if (typeof module !== 'undefined') module.exports = { LayoutSync, GuestShiftState }; else { window.LayoutSync = LayoutSync; window.GuestShiftState = GuestShiftState; }
