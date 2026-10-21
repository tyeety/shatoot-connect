'use strict';
class LayoutSync {
  constructor(host) { this.origin = host ? 1 : 0; this.clock = 0; this.stamp = -1; this.initial = host; this.observed = ''; this.expected = ''; this.ready = false; }
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
if (typeof module !== 'undefined') module.exports = { LayoutSync }; else window.LayoutSync = LayoutSync;
